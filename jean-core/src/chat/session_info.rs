//! "Copy session info": resolve a session's backend resume id and the on-disk
//! transcript files so another agent can read the conversation (issue #10).
//!
//! Only paths that exist are returned. Backends whose history is not a plain
//! file (OpenCode SQLite, Cursor, Grok, Kimi, Devin, Muse, Command Code) still
//! report their resume id plus Jean's own run logs, which exist for every
//! backend.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;

use super::types::{Backend, SessionMetadata};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub session_id: String,
    pub name: String,
    pub backend: String,
    pub model: Option<String>,
    /// The backend's own resume id (Claude session id, Codex thread id, ...).
    pub backend_session_id: Option<String>,
    pub worktree_path: String,
    /// Native backend transcript files that exist on disk.
    pub transcript_paths: Vec<String>,
    /// Jean's run-log directory for this session (JSONL per run), if present.
    pub run_log_dir: Option<String>,
}

/// Directories searched for backend transcripts. Injectable for tests.
#[derive(Debug, Clone, Default)]
pub(crate) struct TranscriptRoots {
    /// Candidate `CLAUDE_CONFIG_DIR`s, most specific first.
    pub claude_config_dirs: Vec<PathBuf>,
    pub codex_home: Option<PathBuf>,
    pub pi_sessions: Option<PathBuf>,
}

/// Claude stores projects under a slug of the cwd where every
/// non-alphanumeric character (`/`, `.`, `_`, ...) becomes `-`.
pub(crate) fn claude_project_slug(path: &str) -> String {
    path.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

pub(crate) fn backend_session_id(meta: &SessionMetadata) -> Option<String> {
    let id = match meta.backend {
        Backend::Claude => &meta.claude_session_id,
        Backend::Codex => &meta.codex_thread_id,
        Backend::Opencode => &meta.opencode_session_id,
        Backend::Cursor => &meta.cursor_chat_id,
        Backend::Pi => &meta.pi_session_id,
        Backend::Commandcode => &meta.commandcode_session_id,
        Backend::Grok => &meta.grok_session_id,
        Backend::Kimi => &meta.kimi_session_id,
        Backend::Devin => &meta.devin_session_id,
        Backend::Antigravity => &meta.antigravity_session_id,
        Backend::Muse => &meta.muse_session_id,
    };
    id.as_ref()
        .filter(|s| !s.trim().is_empty())
        .filter(|s| !s.contains(['/', '\\']) && !s.contains(".."))
        .cloned()
}

fn find_file(root: &Path, matches: &dyn Fn(&str) -> bool, depth: usize, out: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(e) => {
            log::debug!("Cannot read {}: {e}", root.display());
            return;
        }
    };
    for entry in entries.flatten() {
        // Stop as soon as one match is found; callers only need one transcript.
        if !out.is_empty() {
            return;
        }
        let path = entry.path();
        if path.is_dir() {
            if depth > 0 {
                find_file(&path, matches, depth - 1, out);
            }
        } else if path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(matches)
        {
            out.push(path);
        }
    }
}

pub(crate) fn resolve_transcripts(
    backend: &Backend,
    id: &str,
    worktree_path: &str,
    roots: &TranscriptRoots,
) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = Vec::new();
    match backend {
        Backend::Claude => {
            let file = format!("{id}.jsonl");
            let slug = claude_project_slug(worktree_path);
            for dir in &roots.claude_config_dirs {
                // Stop once a config dir yielded a transcript; skip remaining scans.
                if !found.is_empty() {
                    break;
                }
                let direct = dir.join("projects").join(&slug).join(&file);
                if direct.is_file() {
                    found.push(direct);
                    continue;
                }
                // The cwd may differ (e.g. worktree moved); scan project dirs.
                find_file(&dir.join("projects"), &|n| n == file, 1, &mut found);
            }
        }
        Backend::Codex => {
            if let Some(home) = &roots.codex_home {
                let suffix = format!("-{id}.jsonl");
                find_file(
                    &home.join("sessions"),
                    &|n| n.starts_with("rollout-") && n.ends_with(&suffix),
                    4,
                    &mut found,
                );
            }
        }
        Backend::Pi => {
            if let Some(root) = &roots.pi_sessions {
                let suffix = format!("_{id}.jsonl");
                find_file(root, &|n| n.ends_with(&suffix), 2, &mut found);
            }
        }
        _ => {}
    }
    found.sort();
    found.dedup();
    found
}

fn default_roots(meta: &SessionMetadata) -> TranscriptRoots {
    let home = dirs::home_dir();
    let mut claude_config_dirs: Vec<PathBuf> = Vec::new();
    // Account profiles run Claude with their own CLAUDE_CONFIG_DIR.
    for run in meta.runs.iter().rev() {
        if let Some(dir) =
            super::claude::custom_profile_config_dir(run.custom_profile_name.as_deref())
        {
            claude_config_dirs.push(PathBuf::from(dir));
        }
    }
    if let Ok(dir) = std::env::var("CLAUDE_CONFIG_DIR") {
        if !dir.trim().is_empty() {
            claude_config_dirs.push(PathBuf::from(dir));
        }
    }
    if let Some(home) = &home {
        claude_config_dirs.push(home.join(".claude"));
    }
    let mut seen = std::collections::HashSet::new();
    claude_config_dirs.retain(|p| seen.insert(p.clone()));

    TranscriptRoots {
        claude_config_dirs,
        codex_home: std::env::var("CODEX_HOME")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .map(PathBuf::from)
            .or_else(|| home.as_ref().map(|h| h.join(".codex"))),
        pi_sessions: home.map(|h| h.join(".pi").join("agent").join("sessions")),
    }
}

fn build_info(
    meta: &SessionMetadata,
    worktree_path: &str,
    run_log_dir: Option<PathBuf>,
    roots: &TranscriptRoots,
) -> SessionInfo {
    let backend_id = backend_session_id(meta);
    let transcript_paths = backend_id
        .as_deref()
        .map(|id| resolve_transcripts(&meta.backend, id, worktree_path, roots))
        .unwrap_or_default()
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    SessionInfo {
        session_id: meta.id.clone(),
        name: meta.name.clone(),
        backend: serde_json::to_value(&meta.backend)
            .ok()
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_default(),
        model: meta.selected_model.clone(),
        backend_session_id: backend_id,
        worktree_path: worktree_path.to_string(),
        transcript_paths,
        run_log_dir: run_log_dir
            .filter(|p| p.is_dir())
            .map(|p| p.to_string_lossy().to_string()),
    }
}

/// Resolve everything another agent needs to read this session.
pub async fn get_session_info(
    app: AppHandle,
    session_id: String,
    worktree_path: Option<String>,
) -> Result<SessionInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        session_info_blocking(app, session_id, worktree_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn session_info_blocking(
    app: AppHandle,
    session_id: String,
    worktree_path: Option<String>,
) -> Result<SessionInfo, String> {
    let meta = super::storage::load_metadata(&app, &session_id)?
        .ok_or_else(|| format!("Session not found: {session_id}"))?;
    // Callers that do not know the path (menus) let the backend resolve it.
    let worktree_path = match worktree_path.filter(|p| !p.trim().is_empty()) {
        Some(p) => p,
        None => match crate::projects::storage::load_projects_data(&app) {
            Ok(data) => data
                .find_worktree(&meta.worktree_id)
                .map(|w| w.path.clone())
                .unwrap_or_default(),
            Err(e) => {
                log::warn!("Worktree lookup failed for session {session_id}: {e}");
                String::new()
            }
        },
    };
    if worktree_path.is_empty() {
        log::warn!(
            "No worktree path for session {session_id}; Claude transcript lookup will be skipped"
        );
    }
    let run_log_dir = match super::storage::get_session_dir(&app, &session_id) {
        Ok(dir) => Some(dir),
        Err(e) => {
            log::warn!("Run log dir unavailable for session {session_id}: {e}");
            None
        }
    };
    let roots = default_roots(&meta);
    let info = build_info(&meta, &worktree_path, run_log_dir, &roots);
    log::debug!(
        "Session info for {session_id}: backend={} backend_session_id={:?} transcripts={}",
        info.backend,
        info.backend_session_id,
        info.transcript_paths.len()
    );
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, "{}\n").unwrap();
    }

    #[test]
    fn claude_slug_replaces_slashes_and_dots() {
        assert_eq!(
            claude_project_slug("/home/u/repos/jean/.worktrees/a_b"),
            "-home-u-repos-jean--worktrees-a-b"
        );
    }

    #[test]
    fn claude_transcript_found_in_account_config_dir_only_when_present() {
        let tmp = tempfile::tempdir().unwrap();
        let account = tmp.path().join("acct");
        let default = tmp.path().join("default");
        touch(&account.join("projects/-w-x/abc.jsonl"));
        let roots = TranscriptRoots {
            claude_config_dirs: vec![account.clone(), default],
            ..Default::default()
        };
        let got = resolve_transcripts(&Backend::Claude, "abc", "/w/x", &roots);
        assert_eq!(got, vec![account.join("projects/-w-x/abc.jsonl")]);
    }

    #[test]
    fn claude_transcript_falls_back_to_scanning_project_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        touch(&tmp.path().join("projects/-other-cwd/abc.jsonl"));
        let roots = TranscriptRoots {
            claude_config_dirs: vec![tmp.path().to_path_buf()],
            ..Default::default()
        };
        assert_eq!(
            resolve_transcripts(&Backend::Claude, "abc", "/w/x", &roots).len(),
            1
        );
    }

    #[test]
    fn codex_rollout_is_looked_up_by_thread_id() {
        let tmp = tempfile::tempdir().unwrap();
        let hit = tmp
            .path()
            .join("sessions/2026/10/30/rollout-2026-10-30T01-02-03-thr-1.jsonl");
        touch(&hit);
        touch(&tmp.path().join("sessions/2026/10/30/rollout-x-thr-2.jsonl"));
        let roots = TranscriptRoots {
            codex_home: Some(tmp.path().to_path_buf()),
            ..Default::default()
        };
        assert_eq!(
            resolve_transcripts(&Backend::Codex, "thr-1", "/w", &roots),
            vec![hit]
        );
    }

    #[test]
    fn codex_lookup_does_not_match_unrelated_rollouts() {
        let tmp = tempfile::tempdir().unwrap();
        let hit = tmp
            .path()
            .join("sessions/2026/10/30/rollout-2026-10-30T01-02-03-thr-1.jsonl");
        touch(&hit);
        touch(
            &tmp.path()
                .join("sessions/2026/10/30/rollout-2026-10-30T01-02-04-x-1.jsonl"),
        );
        let roots = TranscriptRoots {
            codex_home: Some(tmp.path().to_path_buf()),
            ..Default::default()
        };
        assert_eq!(
            resolve_transcripts(&Backend::Codex, "thr-1", "/w", &roots),
            vec![hit]
        );
        assert!(resolve_transcripts(&Backend::Codex, "zzz", "/w", &roots).is_empty());
    }

    #[test]
    fn pi_session_file_is_looked_up_by_id_suffix() {
        let tmp = tempfile::tempdir().unwrap();
        let hit = tmp.path().join("--w--/2026-10-10T00-00-00-000Z_pid1.jsonl");
        touch(&hit);
        let roots = TranscriptRoots {
            pi_sessions: Some(tmp.path().to_path_buf()),
            ..Default::default()
        };
        assert_eq!(
            resolve_transcripts(&Backend::Pi, "pid1", "/w", &roots),
            vec![hit]
        );
    }

    #[test]
    fn missing_files_and_unsupported_backends_yield_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let roots = TranscriptRoots {
            claude_config_dirs: vec![tmp.path().to_path_buf()],
            codex_home: Some(tmp.path().to_path_buf()),
            pi_sessions: Some(tmp.path().to_path_buf()),
        };
        for backend in [
            Backend::Claude,
            Backend::Codex,
            Backend::Pi,
            Backend::Opencode,
        ] {
            assert!(resolve_transcripts(&backend, "nope", "/w", &roots).is_empty());
        }
    }
}
