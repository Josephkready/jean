//! In-app "Report a bug" backend.
//!
//! Local-first: a report is persisted to `<app_data_dir>/bug-reports/<id>.json`
//! before anything else happens, and the command returns immediately. A
//! background task then hands the report to the host's shared `issue-queue`
//! CLI (a separate worker owns the GitHub token; Jean never talks to GitHub).
//!
//! Privacy: report text (description, title, body, argv, stdout/stderr) is never
//! logged. Logs carry only the report id, job id, repo and a content-free category.

use std::collections::{BTreeMap, HashMap};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::platform::silent_command;

const DEFAULT_REPO: &str = "Josephkready/jean";
const DEFAULT_TIMEOUT_SECS: u64 = 5;
const MAX_TIMEOUT_SECS: u64 = 60;
const MIN_DESCRIPTION_CHARS: usize = 10;
const MAX_DESCRIPTION_CHARS: usize = 8000;
const MAX_CONTEXT_VALUE_CHARS: usize = 300;
const MAX_TITLE_CHARS: usize = 72;
const MAX_SYNC_BATCH: usize = 20;
const MAX_QUEUE_OUTPUT_BYTES: u64 = 64 * 1024;

const STATUS_PENDING_SYNC: &str = "pending-sync";
const STATUS_PENDING: &str = "pending";
const QUEUE_STATUSES: [&str; 6] = ["pending", "filing", "retry", "filed", "failed", "uncertain"];

/// Client-supplied context keys we accept, in the order they are rendered.
const CLIENT_CONTEXT_ALLOWLIST: [&str; 13] = [
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
    "viewport",
    "theme",
    "clientVersion",
];
const SERVER_FACT_KEYS: [&str; 3] = ["appVersion", "platform", "reportedAt"];

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
    out.insert(
        "reportedAt".to_string(),
        sanitize_context_value(reported_at),
    );
    out
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
) -> String {
    let mut body = String::new();
    body.push_str(description);
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
            let record = load_record(base, &id).ok()??;
            (record.status == STATUS_PENDING_SYNC).then_some((record.created_at, id))
        })
        .collect();
    pending.sort();
    pending.into_iter().map(|(_, id)| id).collect()
}

/// Create the record unless one with this id already exists. Returns the
/// stored record either way (idempotent).
fn create_or_get_record(
    base: &Path,
    id: &str,
    description: &str,
    context: BTreeMap<String, String>,
    created_at: &str,
) -> Result<BugReportRecord, String> {
    let _guard = RECORD_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(existing) = load_record(base, id)? {
        return Ok(existing);
    }
    let record = BugReportRecord {
        id: id.to_string(),
        description: description.to_string(),
        context,
        created_at: created_at.to_string(),
        status: STATUS_PENDING_SYNC.to_string(),
        job_id: None,
        issue_url: None,
        issue_number: None,
    };
    save_record(base, &record)?;
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
    fn from_env() -> Self {
        let bin = std::env::var("JEAN_ISSUE_QUEUE_BIN")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "issue-queue".to_string());
        let repo = resolve_repo(std::env::var("JEAN_GITHUB_REPO").ok().as_deref());
        // The shared worker reads $HOME/.local/share/issue-queue/queue.db; issue-queue's
        // own default differs and jean-server has no ISSUE_QUEUE_DB, so always pin it.
        let db = std::env::var_os("ISSUE_QUEUE_DB")
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                dirs::home_dir()
                    .unwrap_or_default()
                    .join(".local/share/issue-queue/queue.db")
            });
        let timeout = resolve_timeout(std::env::var("JEAN_ISSUE_QUEUE_TIMEOUT").ok().as_deref());
        Self {
            bin,
            repo,
            db,
            timeout,
        }
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
    let reader = child.stdout.take().map(|stdout| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = stdout.take(MAX_QUEUE_OUTPUT_BYTES).read_to_end(&mut buf);
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
/// `pending-sync`. On any failure the record stays `pending-sync`.
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
    let body = build_issue_body(&record.description, &record.context, &record.id);
    let args = [
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
    let stdout = run_queue(config, &args, Some(body.into_bytes()))?;
    let job_id = parse_enqueue_output(&stdout).ok_or("bad-output")?;
    record.job_id = Some(job_id.clone());
    record.status = STATUS_PENDING.to_string();
    save_record(base, &record).map_err(|_| "save-failed")?;
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
    let mut record = load_record(base, id)?.ok_or_else(|| "Bug report not found".to_string())?;

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
) -> Result<BugReportStatus, String> {
    let id = validate_report_id(&id)?;
    let description = validate_description(&description)?;
    let base = app_base_dir(&app)?;

    let platform = format!("{}/{}", std::env::consts::OS, std::env::consts::ARCH);
    let reported_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let context = build_context(&context, crate::app_version(), &platform, &reported_at);

    let record = {
        let base = base.clone();
        let id = id.clone();
        let created_at = reported_at.clone();
        tauri::async_runtime::spawn_blocking(move || {
            create_or_get_record(&base, &id, &description, context, &created_at)
        })
        .await
        .map_err(|e| format!("Bug report task failed: {e}"))??
    };

    // Retry any pending-sync records too, but never block the caller.
    if record.status == STATUS_PENDING_SYNC {
        let report_id = record.id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            sync_pending(&base, Some(&report_id), &QueueConfig::from_env());
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
    tauri::async_runtime::spawn_blocking(move || {
        refresh_status(&base, &id, &QueueConfig::from_env())
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
            "2026-01-01T00:00:00Z",
        );
        let body = build_issue_body("It crashes when I click save", &ctx, ID);
        assert!(body.starts_with("It crashes when I click save\n\n---\n"));
        assert!(body.contains("<details><summary>Reported from Jean</summary>"));
        assert!(body.contains("| Field | Value |"));
        assert!(body.contains(&format!("| localReport | {ID} |")));
        assert!(body.trim_end().ends_with("</details>"));
        let pos = |needle: &str| body.find(needle).unwrap();
        assert!(pos("| appVersion |") < pos("| platform |"));
        assert!(pos("| platform |") < pos("| reportedAt |"));
        assert!(pos("| reportedAt |") < pos("| view |"));
        assert!(pos("| view |") < pos("| theme |"));
    }

    #[test]
    fn context_drops_unknown_keys_and_server_facts_win() {
        let ctx = build_context(
            &client(&[
                ("appVersion", "9.9.9-evil"),
                ("platform", "spoofed"),
                ("secretToken", "hunter2"),
                ("backend", "claude"),
            ]),
            "1.2.3",
            "linux/x86_64",
            "2026-01-01T00:00:00Z",
        );
        assert_eq!(ctx.get("appVersion").map(String::as_str), Some("1.2.3"));
        assert_eq!(
            ctx.get("platform").map(String::as_str),
            Some("linux/x86_64")
        );
        assert_eq!(ctx.get("backend").map(String::as_str), Some("claude"));
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
    fn second_submit_with_same_id_does_not_create_another_record() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = BTreeMap::new();
        let first =
            create_or_get_record(dir.path(), ID, "first description text", ctx.clone(), "t1")
                .unwrap();
        assert_eq!(first.status, STATUS_PENDING_SYNC);
        let second =
            create_or_get_record(dir.path(), ID, "DIFFERENT description text", ctx, "t2").unwrap();
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
}
