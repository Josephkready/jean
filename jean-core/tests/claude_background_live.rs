//! Live check against the real Claude CLI (run on demand, not in default CI).
//! JEAN_LIVE_CLAUDE=1 cargo test --manifest-path jean-core/Cargo.toml --test claude_background_live -- --ignored
use std::io::Write;
use std::process::{Command, Stdio};

#[test]
#[ignore = "live: needs the Claude CLI on PATH and JEAN_LIVE_CLAUDE=1"]
fn background_bash_task_continues_turn_until_exit() {
    if std::env::var("JEAN_LIVE_CLAUDE").ok().as_deref() != Some("1") {
        return;
    }
    let mut command = Command::new("claude");
    // A parent Claude Code/Jean session exports CLAUDE_CODE_* vars (notably
    // CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1) that would remove run_in_background.
    for (key, _) in std::env::vars() {
        if key.starts_with("CLAUDE_CODE_") {
            command.env_remove(key);
        }
    }
    let mut child = command
        .args([
            "--print",
            "--output-format",
            "stream-json",
            "--input-format",
            "stream-json",
            "--verbose",
            "--model",
            "claude-haiku-5-5",
            "--permission-mode",
            "bypassPermissions",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn claude");
    {
        let mut stdin = child.stdin.take().expect("stdin");
        let prompt = serde_json::json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": "Run this Bash command with run_in_background set to true: sleep 2 && echo BG_DONE. Do not wait or poll. Reply 'started' and end your turn. When you get the notification that it finished, reply with the output."
            }
        });
        writeln!(stdin, "{prompt}").expect("write prompt");
    }
    let output = child.wait_with_output().expect("wait for claude");
    let text = String::from_utf8_lossy(&output.stdout);
    let events: Vec<serde_json::Value> = text
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    let backgrounded = events
        .iter()
        .any(|e| e["subtype"] == "task_started" && e["is_backgrounded"] == true);
    let results = events.iter().filter(|e| e["type"] == "result").count();
    assert!(
        backgrounded,
        "no backgrounded task_started event in CLI output"
    );
    assert!(
        results >= 2,
        "expected a follow-up turn after the background task, got {results} result(s)"
    );
}
