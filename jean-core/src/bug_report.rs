//! In-app "Report a bug" backend.
//!
//! Local-first: a report is persisted to `<app_data_dir>/bug-reports/<id>.json`
//! before anything else happens, and the command returns immediately. A
//! background task then hands the report to the host's shared `issue-queue`
//! CLI (a separate worker owns the GitHub token; Jean never talks to GitHub).
//!
//! Record statuses: `pending-sync` (saved locally, not yet handed to the queue),
//! `uncertain` (enqueue outcome unknown; not retried automatically to avoid
//! duplicate issues), then the queue's own `pending`, `filing`, `retry`, `filed`
//! and `failed`.
//!
//! Context: the client sends an allowlisted set of environment/app facts (see
//! `CLIENT_CONTEXT_ALLOWLIST`); the server adds authoritative facts (app version,
//! platform, host OS release, report time) that override client values.
//!
//! Screenshots: up to 3 images (jpeg/png/gif/webp, 2 MB each) arrive base64
//! encoded and are re-validated here (count, size, magic bytes). They are stored
//! under `<app_data_dir>/bug-reports/<id>/` only when the record is first created.
//! At enqueue time a `manifest.json` of absolute paths is passed to
//! `issue-queue enqueue --attachments-manifest`; the queue copies the bytes into its
//! own storage and its worker uploads them in place of the screenshots token in the body.
//!
//! Privacy: report text (description, title, body, argv, stdout/stderr) and
//! screenshot names/bytes are never logged. Logs carry only the report id, job id,
//! repo and a content-free category.
//!
//! Configuration (environment variables, read by `QueueConfig::from_env`):
//!
//! | Variable | Type | Default | Purpose |
//! | --- | --- | --- | --- |
//! | `JEAN_ISSUE_QUEUE_BIN` | string (path or name) | `issue-queue` | issue-queue CLI to invoke |
//! | `JEAN_GITHUB_REPO` | string `owner/name` | `Josephkready/jean` | Repo that receives reports; invalid values fall back to the default |
//! | `JEAN_ISSUE_QUEUE_TIMEOUT` | integer seconds | `5` (max `60`) | Timeout per issue-queue call; zero or invalid values use the default |
//! | `ISSUE_QUEUE_DB` | file path | `~/.local/share/issue-queue/queue.db` | Queue database, always passed to the CLI |

use std::collections::{BTreeMap, HashMap};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use base64::Engine;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::platform::silent_command;

const DEFAULT_REPO: &str = "Josephkready/jean";
const DEFAULT_TIMEOUT_SECS: u64 = 5;
const MAX_TIMEOUT_SECS: u64 = 60;
const MIN_DESCRIPTION_CHARS: usize = 10;
const MAX_DESCRIPTION_CHARS: usize = 8000;
const MAX_CONTEXT_VALUE_CHARS: usize = 500;
const MAX_ATTACHMENTS: usize = 3;
const MAX_ATTACHMENT_BYTES: usize = 2_000_000;
const MAX_ATTACHMENT_NAME_CHARS: usize = 64;
const SCREENSHOTS_TOKEN: &str = "<!-- issue-queue:screenshots -->";
const MANIFEST_FILE: &str = "manifest.json";
const MAX_TITLE_CHARS: usize = 72;
const MAX_SYNC_BATCH: usize = 20;
const MAX_QUEUE_OUTPUT_BYTES: u64 = 64 * 1024;

const STATUS_PENDING_SYNC: &str = "pending-sync";
const STATUS_PENDING: &str = "pending";
/// Claim written before calling the queue: the enqueue outcome is unknown, so
/// the record is never retried automatically (avoids duplicate GitHub issues).
const STATUS_UNCERTAIN: &str = "uncertain";
const QUEUE_STATUSES: [&str; 6] = ["pending", "filing", "retry", "filed", "failed", "uncertain"];

/// Client-supplied context keys we accept, in the order they are rendered.
const CLIENT_CONTEXT_ALLOWLIST: [&str; 28] = [
    "view",
    "projectName",
    "projectPath",
    "worktreeName",
    "worktreeBranch",
    "sessionId",
    "backend",
    "model",
    "executionMode",
    "runtime",
    "deviceType",
    "os",
    "browser",
    "userAgent",
    "screen",
    "viewport",
    "pixelRatio",
    "touch",
    "colorScheme",
    "theme",
    "language",
    "timezone",
    "online",
    "clientVersion",
    "webBuildId",
    "gitSha",
    "tauriVersion",
    "cliVersions",
];
const SERVER_FACT_KEYS: [&str; 4] = ["appVersion", "platform", "osRelease", "reportedAt"];

/// Serializes every read-modify-write of report records (and the enqueue that
/// precedes it) so a report is never handed to the queue twice by this process.
static RECORD_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BugReportStatus {
    pub id: String,
    pub status: String,
    pub issue_url: Option<String>,
    pub issue_number: Option<u64>,
}

/// A screenshot as sent by the client: standard base64, no `data:` prefix.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BugReportAttachmentInput {
    pub name: String,
    pub data: String,
}

/// A re-validated screenshot ready to be stored.
#[derive(Debug)]
struct ValidatedAttachment {
    name: String,
    mime: &'static str,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct StoredAttachment {
    name: String,
    mime: String,
    /// File name only, relative to the report's attachment dir.
    file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BugReportRecord {
    id: String,
    description: String,
    context: BTreeMap<String, String>,
    created_at: String,
    status: String,
    #[serde(default)]
    job_id: Option<String>,
    #[serde(default)]
    issue_url: Option<String>,
    #[serde(default)]
    issue_number: Option<u64>,
    #[serde(default)]
    attachments: Vec<StoredAttachment>,
}

impl BugReportRecord {
    fn to_status(&self) -> BugReportStatus {
        BugReportStatus {
            id: self.id.clone(),
            status: self.status.clone(),
            issue_url: self.issue_url.clone(),
            issue_number: self.issue_number,
        }
    }

    fn is_terminal(&self) -> bool {
        self.status == "filed" || self.status == "failed"
    }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/// Validate a canonical UUID and return it lowercase (safe for use as a filename).
fn validate_report_id(id: &str) -> Result<String, String> {
    if id.len() != 36 {
        return Err("Invalid report id".to_string());
    }
    let parsed = Uuid::parse_str(id).map_err(|_| "Invalid report id".to_string())?;
    Ok(parsed.hyphenated().to_string())
}

fn validate_description(description: &str) -> Result<String, String> {
    let trimmed = description.trim();
    let len = trimmed.chars().count();
    if len < MIN_DESCRIPTION_CHARS {
        return Err(format!(
            "Description must be at least {MIN_DESCRIPTION_CHARS} characters"
        ));
    }
    if len > MAX_DESCRIPTION_CHARS {
        return Err(format!(
            "Description must be at most {MAX_DESCRIPTION_CHARS} characters"
        ));
    }
    Ok(trimmed.to_string())
}

fn sanitize_context_value(value: &str) -> String {
    let stripped: String = value.chars().filter(|c| *c != '<' && *c != '>').collect();
    let collapsed = stripped.split_whitespace().collect::<Vec<_>>().join(" ");
    let escaped = collapsed.replace('|', "\\|");
    let mut capped: String = escaped.chars().take(MAX_CONTEXT_VALUE_CHARS).collect();
    // Don't leave a dangling escape char if the cap split a `\|` pair.
    if capped.ends_with('\\') && !capped.ends_with("\\\\") && capped.len() < escaped.len() {
        capped.pop();
    }
    capped.trim().to_string()
}

/// Allowlist client keys (dropping everything else), sanitize values, then apply
/// server-authoritative facts which override any client-sent value.
fn build_context(
    client: &HashMap<String, String>,
    app_version: &str,
    platform: &str,
    os_release: &str,
    reported_at: &str,
) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for key in CLIENT_CONTEXT_ALLOWLIST {
        if let Some(value) = client.get(key) {
            let clean = sanitize_context_value(value);
            if !clean.is_empty() {
                out.insert(key.to_string(), clean);
            }
        }
    }
    out.insert(
        "appVersion".to_string(),
        sanitize_context_value(app_version),
    );
    out.insert("platform".to_string(), sanitize_context_value(platform));
    let os_release = sanitize_context_value(os_release);
    if !os_release.is_empty() {
        out.insert("osRelease".to_string(), os_release);
    }
    out.insert(
        "reportedAt".to_string(),
        sanitize_context_value(reported_at),
    );
    out
}

/// Identify an allowed image type from its magic bytes: `(mime, extension)`.
fn sniff_image_type(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(("image/jpeg", "jpg"))
    } else if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some(("image/png", "png"))
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(("image/gif", "gif"))
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(("image/webp", "webp"))
    } else {
        None
    }
}

/// Basename only, `[A-Za-z0-9._-]`, no `..`, capped, extension forced to `ext`.
fn sanitize_attachment_name(raw: &str, ext: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let stem = base.rsplit_once('.').map_or(base, |(stem, _)| stem);
    let mut clean: String = stem
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '-'
            }
        })
        .collect();
    while clean.contains("..") {
        clean = clean.replace("..", ".");
    }
    let budget = MAX_ATTACHMENT_NAME_CHARS - ext.len() - 1;
    let clean: String = clean.chars().take(budget).collect();
    let clean = clean.trim_matches('.');
    let stem = if clean.is_empty() {
        "screenshot"
    } else {
        clean
    };
    format!("{stem}.{ext}")
}

/// Re-validate client attachments (never trust the client). Pure: writes nothing.
fn validate_attachments(
    inputs: &[BugReportAttachmentInput],
) -> Result<Vec<ValidatedAttachment>, String> {
    if inputs.len() > MAX_ATTACHMENTS {
        return Err(format!("Up to {MAX_ATTACHMENTS} screenshots per report"));
    }
    let too_large = || "Screenshot is too large (max 2 MB)".to_string();
    let mut out = Vec::with_capacity(inputs.len());
    for input in inputs {
        // Bound memory before decoding: base64 expands 3 bytes into 4 characters.
        if input.data.len() > MAX_ATTACHMENT_BYTES.div_ceil(3) * 4 + 4 {
            return Err(too_large());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(input.data.trim())
            .map_err(|_| "Invalid screenshot data".to_string())?;
        if bytes.len() > MAX_ATTACHMENT_BYTES {
            return Err(too_large());
        }
        let (mime, ext) = sniff_image_type(&bytes).ok_or("Unsupported image type")?;
        out.push(ValidatedAttachment {
            name: sanitize_attachment_name(&input.name, ext),
            mime,
            bytes,
        });
    }
    Ok(out)
}

/// `PRETTY_NAME` from `/etc/os-release` content (quotes stripped).
fn parse_os_release_pretty_name(contents: &str) -> Option<String> {
    contents.lines().find_map(|line| {
        let value = line.trim().strip_prefix("PRETTY_NAME=")?.trim();
        let value = value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
            .unwrap_or(value)
            .trim();
        (!value.is_empty()).then(|| value.to_string())
    })
}

fn format_linux_release(pretty_name: Option<&str>, kernel: Option<&str>) -> String {
    match (pretty_name, kernel.map(str::trim).filter(|k| !k.is_empty())) {
        (Some(name), Some(kernel)) => format!("{name} (kernel {kernel})"),
        (Some(name), None) => name.to_string(),
        (None, Some(kernel)) => format!("Linux (kernel {kernel})"),
        (None, None) => String::new(),
    }
}

fn compute_os_release() -> String {
    match std::env::consts::OS {
        "linux" => {
            let pretty = std::fs::read_to_string("/etc/os-release")
                .ok()
                .and_then(|c| parse_os_release_pretty_name(&c));
            let kernel = std::fs::read_to_string("/proc/sys/kernel/osrelease").ok();
            format_linux_release(pretty.as_deref(), kernel.as_deref())
        }
        "macos" => silent_command("sw_vers")
            .arg("-productVersion")
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|v| !v.is_empty())
            .map(|v| format!("macOS {v}"))
            .unwrap_or_default(),
        other => other.to_string(),
    }
}

/// Best-effort host OS description, computed once.
fn host_os_release() -> &'static str {
    static OS_RELEASE: OnceLock<String> = OnceLock::new();
    OS_RELEASE.get_or_init(compute_os_release)
}

fn build_issue_title(description: &str) -> String {
    const PREFIX: &str = "Bug: ";
    let line = description
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("");
    let full = format!("{PREFIX}{line}");
    if full.chars().count() <= MAX_TITLE_CHARS {
        return full;
    }
    // Leave room for the ellipsis.
    let budget = MAX_TITLE_CHARS - 1;
    let chars: Vec<char> = full.chars().collect();
    let mut end = budget;
    if !chars[budget].is_whitespace() {
        // Cut back to the last word boundary, if one exists after the prefix.
        if let Some(pos) = chars[..budget]
            .iter()
            .rposition(|c| c.is_whitespace())
            .filter(|p| *p >= PREFIX.chars().count())
        {
            end = pos;
        }
    }
    let mut title: String = chars[..end].iter().collect();
    title = title.trim_end().to_string();
    title.push('…');
    title
}

fn build_issue_body(
    description: &str,
    context: &BTreeMap<String, String>,
    report_id: &str,
    attachment_count: usize,
) -> String {
    let mut body = String::new();
    body.push_str(description);
    if attachment_count > 0 {
        body.push_str(&format!("\n\n{SCREENSHOTS_TOKEN}"));
    }
    body.push_str("\n\n---\n<details><summary>Reported from Jean</summary>\n\n");
    body.push_str("| Field | Value |\n| --- | --- |\n");
    let ordered = SERVER_FACT_KEYS
        .iter()
        .chain(CLIENT_CONTEXT_ALLOWLIST.iter());
    for key in ordered {
        if let Some(value) = context.get(*key) {
            body.push_str(&format!("| {key} | {value} |\n"));
        }
    }
    if attachment_count > 0 {
        body.push_str(&format!("| screenshots | {attachment_count} |\n"));
    }
    body.push_str(&format!("| localReport | {report_id} |\n"));
    body.push_str("\n</details>\n");
    body
}

fn resolve_repo(raw: Option<&str>) -> String {
    match raw.map(str::trim) {
        Some(repo) if is_valid_repo(repo) => repo.to_string(),
        _ => DEFAULT_REPO.to_string(),
    }
}

fn is_valid_repo(repo: &str) -> bool {
    let ok = |s: &str| {
        !s.is_empty()
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
    };
    match repo.split_once('/') {
        Some((owner, name)) => ok(owner) && ok(name),
        None => false,
    }
}

fn resolve_timeout(raw: Option<&str>) -> Duration {
    let secs = raw
        .and_then(|s| s.trim().parse::<u64>().ok())
        .filter(|s| *s > 0)
        .unwrap_or(DEFAULT_TIMEOUT_SECS)
        .min(MAX_TIMEOUT_SECS);
    Duration::from_secs(secs)
}

/// `{"status":"queued","id":"<uuid>"}` -> job id; anything else -> None.
fn parse_enqueue_output(stdout: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(stdout.trim()).ok()?;
    if value.get("status")?.as_str()? != "queued" {
        return None;
    }
    let id = value.get("id")?.as_str()?;
    Uuid::parse_str(id).ok().map(|u| u.hyphenated().to_string())
}

struct QueueStatus {
    status: String,
    url: Option<String>,
    number: Option<u64>,
}

fn parse_status_output(stdout: &str) -> Option<QueueStatus> {
    let value: serde_json::Value = serde_json::from_str(stdout.trim()).ok()?;
    let status = value.get("status")?.as_str()?;
    if !QUEUE_STATUSES.contains(&status) {
        return None;
    }
    Some(QueueStatus {
        status: status.to_string(),
        url: value
            .get("url")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        number: value.get("number").and_then(|v| v.as_u64()),
    })
}

fn apply_queue_status(record: &mut BugReportRecord, queue: QueueStatus) {
    record.status = queue.status;
    if queue.url.is_some() {
        record.issue_url = queue.url;
    }
    if queue.number.is_some() {
        record.issue_number = queue.number;
    }
}

// ---------------------------------------------------------------------------
// Storage (takes a base dir so it is testable without an AppHandle)
// ---------------------------------------------------------------------------

fn reports_dir(base: &Path) -> PathBuf {
    base.join("bug-reports")
}

fn record_path(base: &Path, id: &str) -> PathBuf {
    reports_dir(base).join(format!("{id}.json"))
}

fn report_dir(base: &Path, id: &str) -> PathBuf {
    reports_dir(base).join(id)
}

fn ensure_reports_dir(base: &Path) -> Result<PathBuf, String> {
    let dir = reports_dir(base);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create bug report dir: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("Failed to secure bug report dir: {e}"))?;
    }
    Ok(dir)
}

fn save_record(base: &Path, record: &BugReportRecord) -> Result<(), String> {
    let dir = ensure_reports_dir(base)?;
    let data = serde_json::to_vec_pretty(record)
        .map_err(|e| format!("Failed to serialize bug report: {e}"))?;
    let tmp = dir.join(format!("{}.json.tmp", record.id));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&tmp)
        .map_err(|e| format!("Failed to write bug report: {e}"))?;
    file.write_all(&data)
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("Failed to write bug report: {e}"))?;
    drop(file);
    std::fs::rename(&tmp, record_path(base, &record.id)).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Failed to save bug report: {e}")
    })
}

fn load_record(base: &Path, id: &str) -> Result<Option<BugReportRecord>, String> {
    match std::fs::read(record_path(base, id)) {
        Ok(data) => serde_json::from_slice(&data)
            .map(Some)
            .map_err(|e| format!("Corrupt bug report record: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Failed to read bug report: {e}")),
    }
}

/// Oldest-first list of record ids still waiting to be handed to the queue.
fn list_pending_sync(base: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(reports_dir(base)) else {
        return Vec::new();
    };
    let mut pending: Vec<(String, String)> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            let id = name.strip_suffix(".json")?;
            let id = validate_report_id(id).ok()?;
            let record = match load_record(base, &id) {
                Ok(Some(record)) => record,
                Ok(None) => return None,
                Err(category) => {
                    log::warn!("bug-report {id}: unreadable record skipped ({category})");
                    return None;
                }
            };
            (record.status == STATUS_PENDING_SYNC).then_some((record.created_at, id))
        })
        .collect();
    pending.sort();
    pending.into_iter().map(|(_, id)| id).collect()
}

fn write_private_file(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(data).and_then(|_| file.sync_all())
}

/// Write screenshots to `<base>/bug-reports/<id>/<n>-<name>` (dir 0700, files 0600).
/// Removes the dir again on failure so nothing is left half-written.
fn store_attachments(
    base: &Path,
    id: &str,
    attachments: &[ValidatedAttachment],
) -> Result<Vec<StoredAttachment>, String> {
    if attachments.is_empty() {
        return Ok(Vec::new());
    }
    ensure_reports_dir(base)?;
    let dir = report_dir(base, id);
    let write_all = || -> Result<Vec<StoredAttachment>, String> {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create screenshot dir: {e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| format!("Failed to secure screenshot dir: {e}"))?;
        }
        let mut stored = Vec::with_capacity(attachments.len());
        for (index, attachment) in attachments.iter().enumerate() {
            let file = format!("{}-{}", index + 1, attachment.name);
            write_private_file(&dir.join(&file), &attachment.bytes)
                .map_err(|e| format!("Failed to save screenshot: {e}"))?;
            stored.push(StoredAttachment {
                name: attachment.name.clone(),
                mime: attachment.mime.to_string(),
                file,
            });
        }
        Ok(stored)
    };
    write_all().inspect_err(|_| {
        let _ = std::fs::remove_dir_all(&dir);
    })
}

/// Write `manifest.json` (`[{"path": <absolute>, "name": <name>}]`) for the queue.
fn write_attachments_manifest(base: &Path, record: &BugReportRecord) -> Result<PathBuf, String> {
    let dir = report_dir(base, &record.id);
    let dir = std::path::absolute(&dir).unwrap_or(dir);
    let entries: Vec<serde_json::Value> = record
        .attachments
        .iter()
        .map(|a| {
            serde_json::json!({
                "path": dir.join(&a.file).display().to_string(),
                "name": a.name,
            })
        })
        .collect();
    let data = serde_json::to_vec_pretty(&entries)
        .map_err(|e| format!("Failed to serialize manifest: {e}"))?;
    let path = dir.join(MANIFEST_FILE);
    write_private_file(&path, &data).map_err(|e| format!("Failed to write manifest: {e}"))?;
    Ok(path)
}

/// Create the record unless one with this id already exists. Returns the
/// stored record either way (idempotent; an existing id ignores `attachments`).
fn create_or_get_record(
    base: &Path,
    id: &str,
    description: &str,
    context: BTreeMap<String, String>,
    created_at: &str,
    attachments: &[ValidatedAttachment],
) -> Result<BugReportRecord, String> {
    let _guard = RECORD_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(existing) = load_record(base, id)? {
        return Ok(existing);
    }
    let stored = store_attachments(base, id, attachments)?;
    let record = BugReportRecord {
        id: id.to_string(),
        description: description.to_string(),
        context,
        created_at: created_at.to_string(),
        status: STATUS_PENDING_SYNC.to_string(),
        job_id: None,
        issue_url: None,
        issue_number: None,
        attachments: stored,
    };
    if let Err(e) = save_record(base, &record) {
        if !record.attachments.is_empty() {
            let _ = std::fs::remove_dir_all(report_dir(base, id));
        }
        return Err(e);
    }
    Ok(record)
}

// ---------------------------------------------------------------------------
// issue-queue invocation
// ---------------------------------------------------------------------------

struct QueueConfig {
    bin: String,
    repo: String,
    db: PathBuf,
    timeout: Duration,
}

impl QueueConfig {
    fn from_env() -> Result<Self, &'static str> {
        let bin = std::env::var("JEAN_ISSUE_QUEUE_BIN")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "issue-queue".to_string());
        let repo = resolve_repo(std::env::var("JEAN_GITHUB_REPO").ok().as_deref());
        // The shared worker reads $HOME/.local/share/issue-queue/queue.db; issue-queue's
        // own default differs and jean-server has no ISSUE_QUEUE_DB, so always pin it.
        let db = match std::env::var_os("ISSUE_QUEUE_DB").filter(|s| !s.is_empty()) {
            Some(path) => PathBuf::from(path),
            None => dirs::home_dir()
                .ok_or("no-home-dir")?
                .join(".local/share/issue-queue/queue.db"),
        };
        let timeout = resolve_timeout(std::env::var("JEAN_ISSUE_QUEUE_TIMEOUT").ok().as_deref());
        Ok(Self {
            bin,
            repo,
            db,
            timeout,
        })
    }
}

/// Run `issue-queue <args>` (argv only, no shell), optionally piping `stdin_data`,
/// killing the child on timeout. Returns stdout on exit 0, else a content-free category.
fn run_queue(
    config: &QueueConfig,
    args: &[&str],
    stdin_data: Option<Vec<u8>>,
) -> Result<String, &'static str> {
    let mut child = silent_command(&config.bin)
        .args(args)
        .env("ISSUE_QUEUE_DB", &config.db)
        .stdin(if stdin_data.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "spawn-failed")?;

    let writer = match (stdin_data, child.stdin.take()) {
        (Some(data), Some(mut stdin)) => Some(std::thread::spawn(move || {
            let _ = stdin.write_all(&data);
        })),
        _ => None,
    };
    let reader = child.stdout.take().map(|mut stdout| {
        std::thread::spawn(move || {
            // Keep draining past the cap so the child never blocks on a full pipe;
            // only the first MAX_QUEUE_OUTPUT_BYTES are retained.
            let mut buf = Vec::new();
            let _ = (&mut stdout)
                .take(MAX_QUEUE_OUTPUT_BYTES)
                .read_to_end(&mut buf);
            let _ = std::io::copy(&mut stdout, &mut std::io::sink());
            buf
        })
    });

    let deadline = Instant::now() + config.timeout;
    let outcome = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status.success()),
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                break Err("timeout");
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(_) => break Err("wait-failed"),
        }
    };

    if let Some(writer) = writer {
        let _ = writer.join();
    }
    let stdout = reader
        .and_then(|r| r.join().ok())
        .map(|b| String::from_utf8_lossy(&b).to_string())
        .unwrap_or_default();

    match outcome {
        Ok(true) => Ok(stdout),
        Ok(false) => Err("nonzero-exit"),
        Err(category) => Err(category),
    }
}

/// Hand one `pending-sync` record to the queue. No-op if it is no longer
/// `pending-sync`. A definite failure leaves it `pending-sync`; an ambiguous one
/// leaves it `uncertain` (see [`STATUS_UNCERTAIN`]).
fn enqueue_record(base: &Path, id: &str, config: &QueueConfig) -> Result<(), &'static str> {
    let _guard = RECORD_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut record = match load_record(base, id) {
        Ok(Some(r)) => r,
        _ => return Err("record-unavailable"),
    };
    if record.status != STATUS_PENDING_SYNC {
        return Ok(());
    }
    let title = build_issue_title(&record.description);
    let body = build_issue_body(
        &record.description,
        &record.context,
        &record.id,
        record.attachments.len(),
    );
    let manifest = if record.attachments.is_empty() {
        None
    } else {
        match write_attachments_manifest(base, &record) {
            Ok(path) => Some(path.display().to_string()),
            Err(_) => return Err("manifest-failed"),
        }
    };
    let mut args = vec![
        "enqueue",
        "--repo",
        config.repo.as_str(),
        "--title",
        title.as_str(),
        "--label",
        "bug",
        "--body-file",
        "-",
    ];
    if let Some(manifest) = manifest.as_deref() {
        args.extend(["--attachments-manifest", manifest]);
    }
    // Persist a claim first: issue-queue has no idempotency key, so if we crash or
    // lose the answer after the queue inserted the job, a retry would duplicate it.
    record.status = STATUS_UNCERTAIN.to_string();
    if save_record(base, &record).is_err() {
        return Err("save-failed");
    }
    let outcome = run_queue(config, &args, Some(body.into_bytes()))
        .and_then(|stdout| parse_enqueue_output(&stdout).ok_or("bad-output"));
    let job_id = match outcome {
        Ok(job_id) => job_id,
        // Definitely not enqueued (issue-queue never started, or exited non-zero
        // before inserting): safe to retry later.
        Err(category @ ("spawn-failed" | "nonzero-exit")) => {
            record.status = STATUS_PENDING_SYNC.to_string();
            if save_record(base, &record).is_err() {
                log::warn!("bug-report {id}: could not restore pending-sync ({category})");
            }
            return Err(category);
        }
        // Ambiguous (timeout, wait failure, unparseable output): stay `uncertain`.
        Err(category) => {
            log::warn!("bug-report {id}: enqueue outcome unknown ({category}); not retrying");
            return Err(category);
        }
    };
    record.job_id = Some(job_id.clone());
    record.status = STATUS_PENDING.to_string();
    if save_record(base, &record).is_err() {
        log::warn!("bug-report {id}: job {job_id} queued but record save failed");
        return Err("save-failed");
    }
    log::info!(
        "bug-report {id}: enqueued job {job_id} repo {}",
        config.repo
    );
    Ok(())
}

/// Enqueue `first` (if any) and then every other `pending-sync` record, oldest
/// first, capped at [`MAX_SYNC_BATCH`]. A failure on one record never stops the rest.
fn sync_pending(base: &Path, first: Option<&str>, config: &QueueConfig) {
    let mut ids: Vec<String> = first.map(str::to_string).into_iter().collect();
    for id in list_pending_sync(base) {
        if Some(id.as_str()) != first {
            ids.push(id);
        }
    }
    ids.truncate(MAX_SYNC_BATCH);
    for id in ids {
        if let Err(category) = enqueue_record(base, &id, config) {
            log::warn!(
                "bug-report {id}: enqueue failed ({category}) repo {}",
                config.repo
            );
        }
    }
}

fn refresh_status(base: &Path, id: &str, config: &QueueConfig) -> Result<BugReportStatus, String> {
    // Take the lock just for this load so a poll racing an in-flight enqueue waits
    // for it instead of observing the transient `uncertain` claim.
    let mut record = {
        let _guard = RECORD_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        load_record(base, id)?
    }
    .ok_or_else(|| "Bug report not found".to_string())?;

    if record.status == STATUS_PENDING_SYNC {
        if let Err(category) = enqueue_record(base, id, config) {
            log::warn!("bug-report {id}: enqueue failed ({category})");
        }
        record = load_record(base, id)?.unwrap_or(record);
    }

    if record.is_terminal() {
        return Ok(record.to_status());
    }
    let Some(job_id) = record.job_id.clone() else {
        return Ok(record.to_status());
    };

    match run_queue(config, &["status", job_id.as_str()], None) {
        Ok(stdout) => match parse_status_output(&stdout) {
            Some(queue) => {
                let _guard = RECORD_LOCK.lock().unwrap_or_else(|e| e.into_inner());
                // Re-read under the lock so we don't clobber a concurrent update.
                let mut current = load_record(base, id)?.unwrap_or(record);
                apply_queue_status(&mut current, queue);
                if save_record(base, &current).is_err() {
                    log::warn!("bug-report {id}: status save failed");
                }
                Ok(current.to_status())
            }
            None => {
                log::warn!("bug-report {id}: status failed (bad-output) job {job_id}");
                Ok(record.to_status())
            }
        },
        Err(category) => {
            log::warn!("bug-report {id}: status failed ({category}) job {job_id}");
            Ok(record.to_status())
        }
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

fn app_base_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))
}

/// Save a bug report locally and return immediately; enqueueing to GitHub
/// (via `issue-queue`) happens in the background.
pub async fn submit_bug_report(
    app: tauri::AppHandle,
    id: String,
    description: String,
    context: HashMap<String, String>,
    attachments: Vec<BugReportAttachmentInput>,
) -> Result<BugReportStatus, String> {
    let id = validate_report_id(&id)?;
    let description = validate_description(&description)?;
    // Validate everything before writing anything.
    let attachments = validate_attachments(&attachments)?;
    let base = app_base_dir(&app)?;

    let platform = format!("{}/{}", std::env::consts::OS, std::env::consts::ARCH);
    let reported_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    let record = {
        let base = base.clone();
        let id = id.clone();
        let created_at = reported_at.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let context = build_context(
                &context,
                crate::app_version(),
                &platform,
                host_os_release(),
                &created_at,
            );
            create_or_get_record(&base, &id, &description, context, &created_at, &attachments)
        })
        .await
        .map_err(|e| format!("Bug report task failed: {e}"))??
    };

    // Retry any pending-sync records too, but never block the caller.
    if record.status == STATUS_PENDING_SYNC {
        let report_id = record.id.clone();
        tauri::async_runtime::spawn_blocking(move || match QueueConfig::from_env() {
            Ok(config) => sync_pending(&base, Some(&report_id), &config),
            Err(category) => log::warn!("bug-report {report_id}: enqueue skipped ({category})"),
        });
    }
    Ok(record.to_status())
}

/// Current status of a report; refreshes it from the queue when possible and
/// falls back to the last known local status if the queue is unavailable.
pub async fn get_bug_report_status(
    app: tauri::AppHandle,
    id: String,
) -> Result<BugReportStatus, String> {
    let id = validate_report_id(&id)?;
    let base = app_base_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || match QueueConfig::from_env() {
        Ok(config) => refresh_status(&base, &id, &config),
        Err(category) => {
            log::warn!("bug-report {id}: status refresh skipped ({category})");
            let record =
                load_record(&base, &id)?.ok_or_else(|| "Bug report not found".to_string())?;
            Ok(record.to_status())
        }
    })
    .await
    .map_err(|e| format!("Bug report task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "123e4567-e89b-42d3-a456-426614174000";

    fn client(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn title_uses_first_non_empty_line() {
        assert_eq!(
            build_issue_title("\n  \n  Sidebar flickers on resize \nmore detail"),
            "Bug: Sidebar flickers on resize"
        );
    }

    #[test]
    fn title_truncates_at_word_boundary() {
        let desc = "the quick brown fox jumps over the lazy dog and keeps running far away";
        let title = build_issue_title(desc);
        assert!(title.chars().count() <= MAX_TITLE_CHARS);
        assert!(title.ends_with('…'));
        let kept = title.trim_start_matches("Bug: ").trim_end_matches('…');
        assert!(desc.starts_with(kept));
        assert!(
            desc[kept.len()..].starts_with(' '),
            "must cut on a word boundary: {title}"
        );
    }

    #[test]
    fn title_without_spaces_hard_cuts() {
        let title = build_issue_title(&"x".repeat(200));
        assert_eq!(title.chars().count(), MAX_TITLE_CHARS);
        assert!(title.ends_with('…'));
    }

    #[test]
    fn body_has_description_details_table_and_provenance() {
        let ctx = build_context(
            &client(&[("view", "chat"), ("theme", "dark")]),
            "1.2.3",
            "linux/x86_64",
            "Debian GNU/Linux 12 (kernel 6.1.0)",
            "2026-01-01T00:00:00Z",
        );
        let body = build_issue_body("It crashes when I click save", &ctx, ID, 0);
        assert!(body.starts_with("It crashes when I click save\n\n---\n"));
        assert!(body.contains("<details><summary>Reported from Jean</summary>"));
        assert!(body.contains("| Field | Value |"));
        assert!(body.contains(&format!("| localReport | {ID} |")));
        assert!(body.trim_end().ends_with("</details>"));
        let pos = |needle: &str| body.find(needle).unwrap();
        assert!(pos("| appVersion |") < pos("| platform |"));
        assert!(pos("| platform |") < pos("| osRelease |"));
        assert!(pos("| osRelease |") < pos("| reportedAt |"));
        assert!(!body.contains(SCREENSHOTS_TOKEN));
        assert!(!body.contains("| screenshots |"));
        assert!(pos("| reportedAt |") < pos("| view |"));
        assert!(pos("| view |") < pos("| theme |"));
    }

    #[test]
    fn context_drops_unknown_keys_and_server_facts_win() {
        let ctx = build_context(
            &client(&[
                ("appVersion", "9.9.9-evil"),
                ("platform", "spoofed"),
                ("osRelease", "spoofed"),
                ("reportedAt", "spoofed"),
                ("secretToken", "hunter2"),
                ("backend", "claude"),
            ]),
            "1.2.3",
            "linux/x86_64",
            "Debian 12",
            "2026-01-01T00:00:00Z",
        );
        assert_eq!(ctx.get("appVersion").map(String::as_str), Some("1.2.3"));
        assert_eq!(
            ctx.get("platform").map(String::as_str),
            Some("linux/x86_64")
        );
        assert_eq!(ctx.get("backend").map(String::as_str), Some("claude"));
        assert_eq!(ctx.get("osRelease").map(String::as_str), Some("Debian 12"));
        assert_eq!(
            ctx.get("reportedAt").map(String::as_str),
            Some("2026-01-01T00:00:00Z")
        );
        assert!(!ctx.contains_key("secretToken"));
    }

    #[test]
    fn sanitizer_strips_escapes_collapses_and_caps() {
        assert_eq!(
            sanitize_context_value("  <b>a|b</b>\n\n c\t d  "),
            "ba\\|b/b c d"
        );
        let long = sanitize_context_value(&"y".repeat(1000));
        assert_eq!(long.chars().count(), MAX_CONTEXT_VALUE_CHARS);
        // Cap landing between `\` and `|` must not leave a dangling escape.
        let tricky = format!("{}|z", "a".repeat(MAX_CONTEXT_VALUE_CHARS - 1));
        let out = sanitize_context_value(&tricky);
        assert!(!out.ends_with('\\'));
        assert!(out.chars().count() <= MAX_CONTEXT_VALUE_CHARS);
    }

    #[test]
    fn repo_validation_falls_back_to_default() {
        assert_eq!(resolve_repo(Some("acme/widget.rs")), "acme/widget.rs");
        assert_eq!(resolve_repo(None), DEFAULT_REPO);
        for bad in ["", "noslash", "a/b/c", "a b/c", "a/b;rm", "/x", "x/"] {
            assert_eq!(resolve_repo(Some(bad)), DEFAULT_REPO, "{bad:?}");
        }
    }

    #[test]
    fn timeout_defaults_and_clamps() {
        assert_eq!(resolve_timeout(None), Duration::from_secs(5));
        assert_eq!(resolve_timeout(Some("0")), Duration::from_secs(5));
        assert_eq!(resolve_timeout(Some("abc")), Duration::from_secs(5));
        assert_eq!(resolve_timeout(Some("12")), Duration::from_secs(12));
        assert_eq!(resolve_timeout(Some("9999")), Duration::from_secs(60));
    }

    #[test]
    fn uuid_validation_rejects_garbage() {
        assert_eq!(validate_report_id(ID).unwrap(), ID);
        assert_eq!(validate_report_id(&ID.to_uppercase()).unwrap(), ID);
        for bad in [
            "",
            "not-a-uuid",
            "../../etc/passwd",
            "123e4567e89b42d3a456426614174000",
            "{123e4567-e89b-42d3-a456-426614174000}",
            "123e4567-e89b-42d3-a456-42661417400/",
        ] {
            assert!(validate_report_id(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn description_length_is_counted_in_chars() {
        assert!(validate_description("too short").is_err());
        assert!(validate_description("  eleven chars  ").is_ok());
        // 10 multi-byte chars is enough even though bytes > 10.
        assert!(validate_description(&"é".repeat(10)).is_ok());
        assert!(validate_description(&"é".repeat(MAX_DESCRIPTION_CHARS)).is_ok());
        assert!(validate_description(&"é".repeat(MAX_DESCRIPTION_CHARS + 1)).is_err());
    }

    #[test]
    fn enqueue_output_parsing() {
        let ok = format!(r#"{{"status":"queued","id":"{ID}"}}"#);
        assert_eq!(parse_enqueue_output(&ok).as_deref(), Some(ID));
        assert_eq!(
            parse_enqueue_output(&format!("{ok}\n")).as_deref(),
            Some(ID)
        );
        assert!(parse_enqueue_output(r#"{"error":"db locked"}"#).is_none());
        assert!(parse_enqueue_output(r#"{"status":"queued","id":"42"}"#).is_none());
        assert!(parse_enqueue_output(&format!(r#"{{"status":"error","id":"{ID}"}}"#)).is_none());
        assert!(parse_enqueue_output("not json").is_none());
    }

    #[test]
    fn status_output_maps_into_record() {
        let q = parse_status_output(
            r#"{"status":"filed","url":"https://github.com/Josephkready/jean/issues/7","number":7}"#,
        )
        .unwrap();
        let mut record = BugReportRecord {
            id: ID.into(),
            description: "d".into(),
            context: BTreeMap::new(),
            created_at: "t".into(),
            status: STATUS_PENDING.into(),
            job_id: Some(ID.into()),
            issue_url: None,
            issue_number: None,
            attachments: Vec::new(),
        };
        apply_queue_status(&mut record, q);
        let status = record.to_status();
        assert_eq!(status.status, "filed");
        assert_eq!(status.issue_number, Some(7));
        assert!(status.issue_url.unwrap().ends_with("/issues/7"));
        assert!(record.is_terminal());

        assert_eq!(
            parse_status_output(r#"{"status":"retry"}"#).unwrap().status,
            "retry"
        );
        assert!(parse_status_output(r#"{"status":"weird"}"#).is_none());
        assert!(parse_status_output("garbage").is_none());
    }

    #[test]
    fn queue_output_parsers_are_total_and_gated() {
        let valid_status =
            r#"{"status":"filed","url":"https://github.com/a/b/issues/1","number":1}"#;
        let valid_enqueue = format!(r#"{{"status":"queued","id":"{ID}"}}"#);
        let alphabet: Vec<char> = "{}[]\":,0123456789abcdefstatusqueuedidurlnumber -\\é\n"
            .chars()
            .collect();
        let mut seed: u64 = 0x9E37_79B9_7F4A_7C15;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        let mut inputs: Vec<String> = Vec::new();
        for source in [valid_status, valid_enqueue.as_str()] {
            for cut in 0..=source.len() {
                if source.is_char_boundary(cut) {
                    inputs.push(source[..cut].to_string());
                }
            }
        }
        for _ in 0..2000 {
            let len = (next() % 64) as usize;
            let s: String = (0..len)
                .map(|_| alphabet[(next() % alphabet.len() as u64) as usize])
                .collect();
            inputs.push(s);
        }
        for input in &inputs {
            if let Some(q) = parse_status_output(input) {
                assert!(QUEUE_STATUSES.contains(&q.status.as_str()), "{input:?}");
            }
            if let Some(job) = parse_enqueue_output(input) {
                assert_eq!(
                    Uuid::parse_str(&job).unwrap().hyphenated().to_string(),
                    job,
                    "{input:?}"
                );
            }
        }
        assert!(parse_status_output(valid_status).is_some());
        assert!(parse_enqueue_output(&valid_enqueue).is_some());
    }

    #[test]
    fn second_submit_with_same_id_does_not_create_another_record() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = BTreeMap::new();
        let first = create_or_get_record(
            dir.path(),
            ID,
            "first description text",
            ctx.clone(),
            "t1",
            &[],
        )
        .unwrap();
        assert_eq!(first.status, STATUS_PENDING_SYNC);
        let second =
            create_or_get_record(dir.path(), ID, "DIFFERENT description text", ctx, "t2", &[])
                .unwrap();
        assert_eq!(second.description, "first description text");
        assert_eq!(second.created_at, "t1");

        let files: Vec<_> = std::fs::read_dir(reports_dir(dir.path()))
            .unwrap()
            .flatten()
            .collect();
        assert_eq!(files.len(), 1);
        assert_eq!(list_pending_sync(dir.path()), vec![ID.to_string()]);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let file_mode = std::fs::metadata(record_path(dir.path(), ID))
                .unwrap()
                .permissions()
                .mode();
            let dir_mode = std::fs::metadata(reports_dir(dir.path()))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(file_mode & 0o777, 0o600);
            assert_eq!(dir_mode & 0o777, 0o700);
        }
    }

    #[cfg(unix)]
    fn fake_queue(dir: &Path, script: &str) -> (QueueConfig, PathBuf) {
        use std::os::unix::fs::PermissionsExt;
        let counter = dir.join("calls");
        let bin = dir.join("fake-issue-queue");
        std::fs::write(
            &bin,
            format!(
                "#!/bin/sh\necho x >> '{}'\nprintf '%s\\n' \"$@\" > '{}'\ncat >/dev/null\n{script}\n",
                counter.display(),
                dir.join("argv").display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        let config = QueueConfig {
            bin: bin.display().to_string(),
            repo: DEFAULT_REPO.to_string(),
            db: dir.join("queue.db"),
            timeout: Duration::from_secs(1),
        };
        (config, counter)
    }

    #[cfg(unix)]
    fn setup_record(dir: &Path) -> PathBuf {
        let base = dir.join("data");
        create_or_get_record(
            &base,
            ID,
            "a long enough description",
            BTreeMap::new(),
            "t1",
            &[],
        )
        .unwrap();
        base
    }

    #[cfg(unix)]
    fn calls(counter: &Path) -> usize {
        std::fs::read_to_string(counter).map_or(0, |s| s.lines().count())
    }

    #[cfg(unix)]
    #[test]
    fn enqueue_timeout_leaves_record_uncertain_and_is_not_retried() {
        let dir = tempfile::tempdir().unwrap();
        let base = setup_record(dir.path());
        let (config, counter) = fake_queue(dir.path(), "sleep 5");
        assert_eq!(enqueue_record(&base, ID, &config), Err("timeout"));
        assert_eq!(
            load_record(&base, ID).unwrap().unwrap().status,
            STATUS_UNCERTAIN
        );
        assert!(list_pending_sync(&base).is_empty());
        sync_pending(&base, Some(ID), &config);
        assert_eq!(calls(&counter), 1);
        let status = refresh_status(&base, ID, &config).unwrap();
        assert_eq!(status.status, STATUS_UNCERTAIN);
        assert_eq!(calls(&counter), 1);
    }

    #[cfg(unix)]
    #[test]
    fn enqueue_nonzero_exit_restores_pending_sync() {
        let dir = tempfile::tempdir().unwrap();
        let base = setup_record(dir.path());
        let (config, _) = fake_queue(dir.path(), "exit 2");
        assert_eq!(enqueue_record(&base, ID, &config), Err("nonzero-exit"));
        let record = load_record(&base, ID).unwrap().unwrap();
        assert_eq!(record.status, STATUS_PENDING_SYNC);
        assert_eq!(list_pending_sync(&base), vec![ID.to_string()]);
    }

    #[cfg(unix)]
    #[test]
    fn enqueue_success_records_job_id() {
        let dir = tempfile::tempdir().unwrap();
        let base = setup_record(dir.path());
        let job = "223e4567-e89b-42d3-a456-426614174000";
        let (config, _) = fake_queue(
            dir.path(),
            &format!("echo '{{\"status\":\"queued\",\"id\":\"{job}\"}}'"),
        );
        assert_eq!(enqueue_record(&base, ID, &config), Ok(()));
        let record = load_record(&base, ID).unwrap().unwrap();
        assert_eq!(record.status, STATUS_PENDING);
        assert_eq!(record.job_id.as_deref(), Some(job));
    }

    // ---- attachments -------------------------------------------------------

    fn png() -> Vec<u8> {
        let mut b = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        b.extend_from_slice(b"png-body");
        b
    }

    fn input(name: &str, bytes: &[u8]) -> BugReportAttachmentInput {
        BugReportAttachmentInput {
            name: name.to_string(),
            data: base64::engine::general_purpose::STANDARD.encode(bytes),
        }
    }

    fn validated_png(name: &str) -> ValidatedAttachment {
        ValidatedAttachment {
            name: name.to_string(),
            mime: "image/png",
            bytes: png(),
        }
    }

    #[test]
    fn attachment_validation_rejects_bad_input() {
        let four: Vec<_> = (0..4).map(|_| input("a.png", &png())).collect();
        assert_eq!(
            validate_attachments(&four).unwrap_err(),
            "Up to 3 screenshots per report"
        );
        let mut big = png();
        big.resize(MAX_ATTACHMENT_BYTES + 1, 0);
        assert_eq!(
            validate_attachments(&[input("a.png", &big)]).unwrap_err(),
            "Screenshot is too large (max 2 MB)"
        );
        let mut exact = png();
        exact.resize(MAX_ATTACHMENT_BYTES, 0);
        assert!(validate_attachments(&[input("a.png", &exact)]).is_ok());
        assert_eq!(
            validate_attachments(&[input("a.png", b"<svg onload=alert(1)>")]).unwrap_err(),
            "Unsupported image type"
        );
        let bad = BugReportAttachmentInput {
            name: "a.png".into(),
            data: "!!not base64!!".into(),
        };
        assert_eq!(
            validate_attachments(&[bad]).unwrap_err(),
            "Invalid screenshot data"
        );
        // One bad file among good ones rejects the whole set.
        assert!(validate_attachments(&[input("a.png", &png()), input("b.png", b"nope")]).is_err());
    }

    #[test]
    fn image_types_are_sniffed_by_magic_bytes() {
        let mut webp = b"RIFF\0\0\0\0WEBPVP8 ".to_vec();
        webp.extend_from_slice(&[0; 4]);
        let cases: [(&[u8], &str, &str); 5] = [
            (&[0xFF, 0xD8, 0xFF, 0xE0, 0], "image/jpeg", "jpg"),
            (&png(), "image/png", "png"),
            (b"GIF87a....", "image/gif", "gif"),
            (b"GIF89a....", "image/gif", "gif"),
            (&webp, "image/webp", "webp"),
        ];
        for (bytes, mime, ext) in cases {
            assert_eq!(sniff_image_type(bytes), Some((mime, ext)));
        }
        assert_eq!(sniff_image_type(b"RIFF\0\0\0\0WAVEfmt "), None);
        assert_eq!(sniff_image_type(&[0xFF, 0xD8]), None);
        assert_eq!(sniff_image_type(b""), None);
    }

    #[test]
    fn attachment_names_are_sanitized_and_extension_forced() {
        let ok = |raw: &str, ext: &str| sanitize_attachment_name(raw, ext);
        assert_eq!(ok("../../etc/passwd", "png"), "passwd.png");
        assert_eq!(ok("..\\..\\win\\evil.exe", "jpg"), "evil.jpg");
        assert_eq!(ok("shot.jpg", "png"), "shot.png");
        assert_eq!(ok("my shot (1).png", "png"), "my-shot--1-.png");
        assert_eq!(ok("a..b...c.gif", "gif"), "a.b.c.gif");
        assert_eq!(ok("", "webp"), "screenshot.webp");
        assert_eq!(ok("..", "png"), "screenshot.png");
        assert_eq!(ok("dir/", "png"), "screenshot.png");
        let long = ok(&format!("{}.png", "x".repeat(300)), "png");
        assert_eq!(long.chars().count(), MAX_ATTACHMENT_NAME_CHARS);
        assert!(long.ends_with(".png"));
        for hostile in ["../x", "a/b", "\\x", ".hidden", "x\0y"] {
            let n = ok(hostile, "png");
            assert!(
                !n.contains('/') && !n.contains('\\') && !n.contains(".."),
                "{n}"
            );
            assert!(!n.starts_with('.'), "{n}");
        }
    }

    #[test]
    fn new_record_stores_attachments_and_existing_id_ignores_them() {
        let dir = tempfile::tempdir().unwrap();
        let first = create_or_get_record(
            dir.path(),
            ID,
            "first description text",
            BTreeMap::new(),
            "t1",
            &[validated_png("shot.png")],
        )
        .unwrap();
        assert_eq!(
            first.attachments,
            vec![StoredAttachment {
                name: "shot.png".into(),
                mime: "image/png".into(),
                file: "1-shot.png".into(),
            }]
        );
        let file = report_dir(dir.path(), ID).join("1-shot.png");
        assert_eq!(std::fs::read(&file).unwrap(), png());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode(&file), 0o600);
            assert_eq!(mode(&report_dir(dir.path(), ID)), 0o700);
        }

        let second = create_or_get_record(
            dir.path(),
            ID,
            "other",
            BTreeMap::new(),
            "t2",
            &[validated_png("a.png"), validated_png("b.png")],
        )
        .unwrap();
        assert_eq!(second.attachments, first.attachments);
        assert!(!report_dir(dir.path(), ID).join("2-b.png").exists());
        assert_eq!(
            load_record(dir.path(), ID).unwrap().unwrap().attachments,
            first.attachments
        );
    }

    #[test]
    fn records_without_attachments_field_still_load() {
        let json = format!(
            r#"{{"id":"{ID}","description":"d","context":{{}},"created_at":"t","status":"filed"}}"#
        );
        let record: BugReportRecord = serde_json::from_str(&json).unwrap();
        assert!(record.attachments.is_empty());
    }

    #[test]
    fn body_has_screenshots_token_only_with_attachments() {
        let ctx = BTreeMap::new();
        let with = build_issue_body("desc", &ctx, ID, 2);
        assert!(with.starts_with(&format!("desc\n\n{SCREENSHOTS_TOKEN}\n\n---\n")));
        assert!(with.contains("| screenshots | 2 |"));
        let without = build_issue_body("desc", &ctx, ID, 0);
        assert!(!without.contains(SCREENSHOTS_TOKEN));
        assert!(!without.contains("screenshots"));
        assert!(without.starts_with("desc\n\n---\n"));
    }

    // ---- context / os release ---------------------------------------------

    #[test]
    fn os_release_pretty_name_parsing() {
        let debian = "PRETTY_NAME=\"Debian GNU/Linux 12 (bookworm)\"\nNAME=\"Debian\"\n";
        assert_eq!(
            parse_os_release_pretty_name(debian).as_deref(),
            Some("Debian GNU/Linux 12 (bookworm)")
        );
        assert_eq!(
            parse_os_release_pretty_name("ID=x\nPRETTY_NAME='Alpine 3'\n").as_deref(),
            Some("Alpine 3")
        );
        assert_eq!(
            parse_os_release_pretty_name("PRETTY_NAME=Arch\n").as_deref(),
            Some("Arch")
        );
        assert_eq!(parse_os_release_pretty_name("PRETTY_NAME=\"\"\n"), None);
        assert_eq!(parse_os_release_pretty_name("NAME=Foo\n"), None);
        assert_eq!(
            format_linux_release(Some("Ubuntu 24.04"), Some("6.8.0-1\n")),
            "Ubuntu 24.04 (kernel 6.8.0-1)"
        );
        assert_eq!(format_linux_release(Some("Ubuntu"), None), "Ubuntu");
        assert_eq!(format_linux_release(None, None), "");
    }

    #[test]
    fn expanded_allowlist_passes_through_in_order_and_empty_os_release_is_omitted() {
        let pairs: Vec<(&str, String)> = CLIENT_CONTEXT_ALLOWLIST
            .iter()
            .map(|k| (*k, format!("v-{k}")))
            .collect();
        let borrowed: Vec<(&str, &str)> = pairs.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let ctx = build_context(&client(&borrowed), "1", "p", "", "t");
        for key in CLIENT_CONTEXT_ALLOWLIST {
            assert_eq!(ctx.get(key), Some(&format!("v-{key}")), "{key}");
        }
        assert!(!ctx.contains_key("osRelease"));
        let body = build_issue_body("desc", &ctx, ID, 0);
        let pos = |k: &str| body.find(&format!("| {k} |")).unwrap();
        assert!(pos("reportedAt") < pos("view"));
        assert!(pos("view") < pos("deviceType"));
        assert!(pos("deviceType") < pos("cliVersions"));
    }

    #[cfg(unix)]
    #[test]
    fn enqueue_with_attachments_passes_manifest_of_absolute_paths() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().join("data");
        create_or_get_record(
            &base,
            ID,
            "a long enough description",
            BTreeMap::new(),
            "t1",
            &[validated_png("one.png"), validated_png("two.png")],
        )
        .unwrap();
        let job = "223e4567-e89b-42d3-a456-426614174000";
        let (config, _) = fake_queue(
            dir.path(),
            &format!("echo '{{\"status\":\"queued\",\"id\":\"{job}\"}}'"),
        );
        assert_eq!(enqueue_record(&base, ID, &config), Ok(()));

        let argv = std::fs::read_to_string(dir.path().join("argv")).unwrap();
        let args: Vec<&str> = argv.lines().collect();
        let flag = args
            .iter()
            .position(|a| *a == "--attachments-manifest")
            .expect("manifest flag passed");
        let manifest_path = Path::new(args[flag + 1]);
        assert!(manifest_path.is_absolute());
        let entries: Vec<serde_json::Value> =
            serde_json::from_slice(&std::fs::read(manifest_path).unwrap()).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0]["name"], "one.png");
        assert_eq!(entries[1]["name"], "two.png");
        for entry in &entries {
            let path = Path::new(entry["path"].as_str().unwrap());
            assert!(path.is_absolute() && path.exists(), "{path:?}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn enqueue_without_attachments_omits_manifest_flag() {
        let dir = tempfile::tempdir().unwrap();
        let base = setup_record(dir.path());
        let job = "223e4567-e89b-42d3-a456-426614174000";
        let (config, _) = fake_queue(
            dir.path(),
            &format!("echo '{{\"status\":\"queued\",\"id\":\"{job}\"}}'"),
        );
        assert_eq!(enqueue_record(&base, ID, &config), Ok(()));
        let argv = std::fs::read_to_string(dir.path().join("argv")).unwrap();
        assert!(argv.lines().any(|a| a == "enqueue"));
        assert!(!argv.contains("--attachments-manifest"));
    }
}
