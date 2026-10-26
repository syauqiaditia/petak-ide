use petak_core::agent::{
    format_history_envelope, ChatMessage, SlotConfig, SlotEvent, SlotManager,
};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

fn fake_agent_script_path() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .join("tests")
        .join("fixtures")
        .join("fake_agent.mjs")
}

fn make_slot_config(id: &str, label: &str, no_load_session: bool) -> SlotConfig {
    let script = fake_agent_script_path();
    let flag = if no_load_session { " --no-load-session" } else { "" };
    SlotConfig {
        id: id.to_string(),
        label: label.to_string(),
        kind: "acp-custom".to_string(),
        engine: Some("acp-custom".to_string()),
        command: Some(format!("node {}{}", script.to_string_lossy(), flag)),
        hermes_profile: None,
        model: Some("fake-model-alpha".to_string()),
        fallback_model: Some("fake-model-beta".to_string()),
        permission: "ask".to_string(),
        cwd: "project".to_string(),
        role: None,
        custom_whitelist: None,
    }
}

#[test]
fn test_session_load_payload_and_resume_when_supported() {
    let temp = tempfile::tempdir().unwrap();
    let manager = SlotManager::with_defaults(Some(temp.path().to_path_buf()));

    let config = make_slot_config("slot-resume-supported", "Resume Agent", false);
    manager.add_slot(config).unwrap();

    // Initial prompt without session_id
    let res1 = manager
        .prompt_slot("slot-resume-supported", "Halo pertama")
        .expect("First prompt should succeed");
    assert_eq!(res1.stop_reason, "end_turn");

    let initial_slots = manager.list_slots();
    let initial_session = initial_slots[0].session_id.clone().expect("Initial session_id exists");

    // Second prompt targeting a specific persisted session
    let target_session_id = "persisted-session-xyz-123";
    let prior_history = vec![
        ChatMessage {
            id: "msg-1".to_string(),
            timestamp: 1000,
            role: "user".to_string(),
            content: "Halo pertama".to_string(),
            stop_reason: None,
            metadata: None,
        },
        ChatMessage {
            id: "msg-2".to_string(),
            timestamp: 1001,
            role: "agent".to_string(),
            content: "Hai juga!".to_string(),
            stop_reason: Some("end_turn".to_string()),
            metadata: None,
        },
    ];

    let res2 = manager
        .prompt_slot_session(
            "slot-resume-supported",
            "Halo kedua",
            Some(target_session_id),
            Some(&prior_history),
        )
        .expect("Second prompt with session_load should succeed");
    assert_eq!(res2.stop_reason, "end_turn");

    // Verify session_id was updated to target_session_id
    let updated_slots = manager.list_slots();
    let active_session = updated_slots[0].session_id.clone().expect("Active session exists");
    assert_eq!(active_session, target_session_id);
    assert_ne!(active_session, initial_session);
}

#[test]
fn test_fallback_envelope_transcript_when_load_session_unsupported() {
    let temp = tempfile::tempdir().unwrap();
    let manager = SlotManager::with_defaults(Some(temp.path().to_path_buf()));

    let received_chunks = Arc::new(Mutex::new(Vec::new()));
    let received_clone = Arc::clone(&received_chunks);

    manager.add_listener(move |event| {
        if let SlotEvent::Update { update, .. } = event {
            if let Some(text) = update
                .get("content")
                .and_then(|c| c.get("text"))
                .and_then(|t| t.as_str())
            {
                received_clone.lock().unwrap().push(text.to_string());
            }
        }
    });

    // Slot configured with --no-load-session
    let config = make_slot_config("slot-no-load", "No Load Agent", true);
    manager.add_slot(config).unwrap();

    let prior_history = vec![
        ChatMessage {
            id: "msg-1".to_string(),
            timestamp: 1000,
            role: "user".to_string(),
            content: "Konteks lama pertanyaan".to_string(),
            stop_reason: None,
            metadata: None,
        },
        ChatMessage {
            id: "msg-2".to_string(),
            timestamp: 1001,
            role: "agent".to_string(),
            content: "Konteks lama jawaban".to_string(),
            stop_reason: Some("end_turn".to_string()),
            metadata: None,
        },
    ];

    let res = manager
        .prompt_slot_session(
            "slot-no-load",
            "Pertanyaan baru saat ini",
            Some("session-fallback-target"),
            Some(&prior_history),
        )
        .expect("Prompt should succeed using fallback envelope");
    assert_eq!(res.stop_reason, "end_turn");

    // Verify received echo contains the formatted envelope
    let chunks = received_chunks.lock().unwrap().clone();
    let full_echo = chunks.join("");

    assert!(
        full_echo.contains("[Prior Conversation History]"),
        "Echo should contain start of prior conversation envelope: {}",
        full_echo
    );
    assert!(
        full_echo.contains("User: Konteks lama pertanyaan"),
        "Echo should contain prior user message: {}",
        full_echo
    );
    assert!(
        full_echo.contains("Agent: Konteks lama jawaban"),
        "Echo should contain prior agent message: {}",
        full_echo
    );
    assert!(
        full_echo.contains("[End Prior Conversation History]"),
        "Echo should contain end of prior conversation envelope: {}",
        full_echo
    );
    assert!(
        full_echo.contains("Pertanyaan baru saat ini"),
        "Echo should contain current prompt text: {}",
        full_echo
    );
}

#[test]
fn test_slot_history_synchronization_integrity() {
    let temp = tempfile::tempdir().unwrap();
    let manager = SlotManager::with_defaults(Some(temp.path().to_path_buf()));

    let config = make_slot_config("slot-history-sync", "Sync History Agent", false);
    manager.add_slot(config).unwrap();

    let prior_history = vec![
        ChatMessage {
            id: "msg-1".to_string(),
            timestamp: 1000,
            role: "user".to_string(),
            content: "Pesan satu".to_string(),
            stop_reason: None,
            metadata: None,
        },
        ChatMessage {
            id: "msg-2".to_string(),
            timestamp: 1001,
            role: "agent".to_string(),
            content: "Balasan satu".to_string(),
            stop_reason: Some("end_turn".to_string()),
            metadata: None,
        },
        ChatMessage {
            id: "msg-3".to_string(),
            timestamp: 1002,
            role: "user".to_string(),
            content: "Pesan dua".to_string(),
            stop_reason: None,
            metadata: None,
        },
        ChatMessage {
            id: "msg-4".to_string(),
            timestamp: 1003,
            role: "agent".to_string(),
            content: "Balasan dua".to_string(),
            stop_reason: Some("end_turn".to_string()),
            metadata: None,
        },
    ];

    manager
        .prompt_slot_session(
            "slot-history-sync",
            "Pesan ketiga sekarang",
            Some("persisted-history-sess"),
            Some(&prior_history),
        )
        .expect("Prompt with history sync should succeed");

    let history = manager
        .get_slot_history("slot-history-sync")
        .expect("Slot history should be available");

    // 4 prior messages + 1 new user prompt + 1 new agent response = 6 messages
    assert_eq!(
        history.len(),
        6,
        "Expected 6 messages in synced history, found {}",
        history.len()
    );

    assert_eq!(history[0].role, "user");
    assert_eq!(history[0].content, "Pesan satu");

    assert_eq!(history[1].role, "agent");
    assert_eq!(history[1].content, "Balasan satu");

    assert_eq!(history[2].role, "user");
    assert_eq!(history[2].content, "Pesan dua");

    assert_eq!(history[3].role, "agent");
    assert_eq!(history[3].content, "Balasan dua");

    assert_eq!(history[4].role, "user");
    assert_eq!(history[4].content, "Pesan ketiga sekarang");

    assert_eq!(history[5].role, "agent");
}

#[test]
fn test_format_history_envelope_formatting() {
    let empty_history: Vec<ChatMessage> = Vec::new();
    let res_empty = format_history_envelope(&empty_history, "Halo");
    assert_eq!(res_empty, "Halo");

    let history = vec![
        ChatMessage {
            id: "1".to_string(),
            timestamp: 1,
            role: "user".to_string(),
            content: "Halo Petak".to_string(),
            stop_reason: None,
            metadata: None,
        },
        ChatMessage {
            id: "2".to_string(),
            timestamp: 2,
            role: "agent".to_string(),
            content: "Halo juga!".to_string(),
            stop_reason: None,
            metadata: None,
        },
    ];

    let envelope = format_history_envelope(&history, "Bisa bantu refactor?");
    let expected = "[Prior Conversation History]\nUser: Halo Petak\nAgent: Halo juga!\n[End Prior Conversation History]\n\nBisa bantu refactor?";
    assert_eq!(envelope, expected);
}
