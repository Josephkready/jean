pub(crate) mod acp_permissions;
pub(crate) mod antigravity;
pub(crate) mod claude;
pub(crate) mod claude_host;
pub(crate) mod claude_permissions;
pub(crate) mod coalesce;
pub(crate) mod codex;
pub(crate) mod codex_server;
pub(crate) mod commandcode;
mod commands;
pub(crate) mod context_instructions;
pub(crate) mod cursor;
pub mod detached;
pub(crate) mod devin;
mod devin_permissions;
mod devin_protocol;
pub(crate) mod grok;
pub(crate) mod handoff;
pub mod jean_mcp;
pub(crate) mod kimi;
mod mcp_auth;
pub mod mcp_external;
pub(crate) mod muse;
mod naming;
mod native_history;
pub(crate) mod opencode;
pub(crate) mod pi;
pub mod registry;
pub mod run_log;
pub mod search;
pub mod storage;
pub mod tail;
pub mod types;
pub mod wakeup;

pub(crate) use commands::default_model_for_backend;
pub use commands::*;
pub use mcp_auth::*;
pub use native_history::*;
pub use storage::{preserve_base_sessions, restore_base_sessions, with_sessions_mut};

use std::sync::atomic::{AtomicUsize, Ordering};

/// Injected when the parallel-execution magic prompt is cleared. Omitting the
/// fan-out prompt is not enough: the model still spawns Task sub-agents unless
/// it is told not to.
pub const NO_SUBAGENT_INSTRUCTION: &str = "### Sub-agent policy\n\
- Do NOT spawn sub-agents (Task calls) unless the user explicitly asks for one. Handle research, exploration, and implementation inline in this turn.\n\
- A task that has several parts, or is described as thorough or multi-angle, is still a single inline task — not a reason to fan out.";

/// Fan-out text when parallel prompting is on, otherwise the explicit stop.
/// A non-empty prompt is the user's (or the default) sub-agent policy.
pub(crate) fn subagent_policy_text(parallel_execution_prompt: Option<&str>) -> String {
    parallel_execution_prompt
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| NO_SUBAGENT_INSTRUCTION.to_string())
}

pub(crate) fn push_trimmed_prompt(parts: &mut Vec<String>, prompt: Option<&str>) {
    if let Some(prompt) = prompt.map(str::trim).filter(|prompt| !prompt.is_empty()) {
        parts.push(prompt.to_string());
    }
}

/// Sub-agent policy, then the global prompt. User-authored global text is later
/// in the assembled instructions, so it has the last word.
pub(crate) fn push_subagent_policy_before_global(
    parts: &mut Vec<String>,
    parallel_execution_prompt: Option<&str>,
    global_prompt: String,
) {
    parts.push(subagent_policy_text(parallel_execution_prompt));
    if !global_prompt.trim().is_empty() {
        parts.push(global_prompt);
    }
}

#[cfg(test)]
mod tests {
    // Issue #31: chat system prompts no longer request an end-of-turn recap.
    // The instruction constant is gone; this guards the shared prompt pieces
    // Jean assembles for every backend from reintroducing it.
    #[test]
    fn shared_system_prompt_pieces_do_not_request_a_recap_issue_31() {
        let mut parts = Vec::new();
        super::push_subagent_policy_before_global(&mut parts, None, "Global rule.".to_string());
        let text = parts.join("\n\n");
        assert!(!text.contains("End-of-turn recap"));
        assert!(!text.contains("end your response with a final markdown section"));
    }

    #[test]
    fn disabled_subagent_prompting_forbids_unrequested_task_calls() {
        let policy = super::subagent_policy_text(None);
        assert!(policy.contains("Do NOT spawn sub-agents"));
        assert!(policy.contains("unless the user explicitly asks"));
        assert_eq!(policy, super::subagent_policy_text(Some("  ")));
        assert_eq!(policy, super::NO_SUBAGENT_INSTRUCTION);
    }

    #[test]
    fn enabled_subagent_prompting_uses_the_parallel_prompt_verbatim() {
        let prompt = "Use two Task agents for this research.";
        assert_eq!(super::subagent_policy_text(Some(prompt)), prompt);
        assert_eq!(
            super::subagent_policy_text(Some("  Use two Task agents.  ")),
            "Use two Task agents."
        );
    }

    #[test]
    fn subagent_policy_is_emitted_before_a_custom_global_prompt() {
        let mut off = vec!["Respond to the user in French.".to_string()];
        super::push_subagent_policy_before_global(
            &mut off,
            None,
            "Custom rule: do spawn a Task agent for research.".to_string(),
        );
        let off_text = off.join("\n\n");
        let policy = off_text.find("Do NOT spawn sub-agents").unwrap();
        let custom = off_text.find("Custom rule: do spawn a Task agent").unwrap();
        assert!(policy < custom);

        let mut on = Vec::new();
        super::push_subagent_policy_before_global(
            &mut on,
            Some("Fan out with Task agents."),
            "Custom global prompt.".to_string(),
        );
        assert_eq!(on[0], "Fan out with Task agents.");
        assert_eq!(on[1], "Custom global prompt.");
    }
}

/// Global counter for active file tailers (sessions being streamed)
static ACTIVE_TAILER_COUNT: once_cell::sync::Lazy<AtomicUsize> =
    once_cell::sync::Lazy::new(|| AtomicUsize::new(0));

pub fn increment_tailer_count() {
    ACTIVE_TAILER_COUNT.fetch_add(1, Ordering::Relaxed);
}

pub fn decrement_tailer_count() {
    ACTIVE_TAILER_COUNT.fetch_sub(1, Ordering::Relaxed);
}
