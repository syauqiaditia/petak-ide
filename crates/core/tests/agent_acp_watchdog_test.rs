use petak_core::agent::{
    AcpClient, SlotConfig, SlotEvent, SlotManager, SlotStatus,
};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

fn fake_agent_script_path() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .join("tests")
        .join("fixtures")
        .join("fake_agent.mjs")
}

fn make_fake_slot_config(id: &str, label: &str) -> SlotConfig {
    let script = fake_agent_script_path();
    SlotConfig {
        id: id.to_string(),
        label: label.to_string(),
        kind: "acp-custom".to_string(),
        engine: Some("acp-custom".to_string()),
        command: Some(format!("node {}", script.to_string_lossy())),
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
fn test_activity_watchdog_resets_timer_on_continuous_stream_chunks() {
    let temp = tempfile::tempdir().unwrap();
    let manager = SlotManager::with_defaults(Some(temp.path().to_path_buf()));

    let config = make_fake_slot_config("slot-stream", "Stream Agent");
    manager.add_slot(config).unwrap();

    // "slow" prompt streams chunks every 100ms for 20 chunks (~2000ms total).
    // An idle timeout of 400ms would fail if it were rigid / not activity-based.
    // Because activity arrives every 100ms (< 400ms), watchdog resets on every chunk and completes.
    let start = Instant::now();
    let prompt_res = manager
        .prompt_slot_with_watchdog("slot-stream", "slow prompt test", Duration::from_millis(400))
        .expect("Prompt should succeed because continuous stream chunks reset idle timer");

    let elapsed = start.elapsed();
    assert_eq!(prompt_res.stop_reason, "end_turn");
    assert!(
        elapsed >= Duration::from_millis(1500),
        "Expected multi-chunk streaming execution to take over 1.5s, took {:?}",
        elapsed
    );

    let slots = manager.list_slots();
    assert_eq!(slots[0].status, SlotStatus::Ready);
}

#[test]
fn test_watchdog_fires_timeout_when_zero_activity_exceeds_idle_duration() {
    let temp = tempfile::tempdir().unwrap();
    let manager = SlotManager::with_defaults(Some(temp.path().to_path_buf()));

    let config = make_fake_slot_config("slot-stuck", "Stuck Agent");
    manager.add_slot(config).unwrap();

    // "stuck" prompt sends 0 activity.
    let start = Instant::now();
    let res = manager.prompt_slot_with_watchdog(
        "slot-stuck",
        "stuck prompt test",
        Duration::from_millis(200),
    );

    let elapsed = start.elapsed();
    assert!(res.is_err(), "Expected timeout error for stuck prompt");
    let err_msg = res.unwrap_err();
    assert!(
        err_msg.contains("⚠️ Perintah terminal macet dibatalkan otomatis"),
        "Error message must contain self-healing signal, got: {}",
        err_msg
    );
    assert!(
        elapsed < Duration::from_millis(2500),
        "Timeout must trigger promptly without waiting for rigid 120s/300s, took {:?}",
        elapsed
    );
}

#[test]
fn test_cancel_cleanup_drains_pending_map_and_unblocks_callers() {
    let script = fake_agent_script_path();
    let args = vec![script.to_string_lossy().to_string()];
    let env = HashMap::new();

    let client = Arc::new(
        AcpClient::spawn("node", &args, &env, None, |_| {})
            .expect("AcpClient spawn should succeed"),
    );

    let _init = client
        .initialize(Duration::from_secs(5))
        .expect("initialize");

    // Spawn a background request that will never be answered by the fake agent
    let client_for_caller = Arc::clone(&client);
    let start = Instant::now();
    let caller_handle = thread::spawn(move || {
        client_for_caller.send_request("test/hang", Value::Null, Duration::from_secs(30))
    });

    // Wait until the request is registered in the pending map
    while client.pending_count() == 0 {
        if start.elapsed() > Duration::from_secs(3) {
            panic!("Timed out waiting for pending request to register");
        }
        thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(client.pending_count(), 1);

    // Trigger cancel cleanup: should terminate subprocesses, flush pipes, and drain pending map
    client.cancel_cleanup();

    assert_eq!(
        client.pending_count(),
        0,
        "Pending map must be drained after cancel cleanup"
    );

    // Caller must unblock immediately with error instead of hanging 30s
    let caller_res = caller_handle.join().unwrap();
    assert!(
        caller_res.is_err(),
        "Caller should have received cancelled error"
    );
    assert!(
        start.elapsed() < Duration::from_secs(3),
        "Caller must unblock promptly upon cancel cleanup"
    );
}

#[test]
fn test_self_healing_error_return_keeps_slot_alive_and_transitions_back_to_ready() {
    let temp = tempfile::tempdir().unwrap();
    let manager = SlotManager::with_defaults(Some(temp.path().to_path_buf()));

    let updates = Arc::new(Mutex::new(Vec::new()));
    let updates_clone = Arc::clone(&updates);

    manager.add_listener(move |event| {
        if let SlotEvent::Update { update, .. } = event {
            updates_clone.lock().unwrap().push(update);
        }
    });

    let config = make_fake_slot_config("slot-heal", "Healing Agent");
    manager.add_slot(config).unwrap();

    // Trigger stuck prompt with short idle watchdog
    let res = manager.prompt_slot_with_watchdog(
        "slot-heal",
        "stuck command test",
        Duration::from_millis(200),
    );

    // Verify self-healing error returned
    assert!(res.is_err());
    let err_str = res.unwrap_err();
    let expected_signal =
        "⚠️ Perintah terminal macet dibatalkan otomatis karena tidak ada aktivitas selama 5 menit. Mencoba pemulihan...";
    assert_eq!(err_str, expected_signal);

    // Verify slot remains Ready (not Crashed) and active_pid exists
    let slots = manager.list_slots();
    assert_eq!(slots[0].status, SlotStatus::Ready);
    assert!(slots[0].active_pid.is_some());

    // Verify history recorded the self-healing agent message
    let history = manager.get_slot_history("slot-heal").unwrap();
    assert!(history.len() >= 2);
    let last_chat = history.last().unwrap();
    assert_eq!(last_chat.role, "agent");
    assert_eq!(last_chat.content, expected_signal);
    assert_eq!(last_chat.stop_reason.as_deref(), Some("timeout"));

    // Verify update event emitted with recovery text chunk
    let received_updates = updates.lock().unwrap().clone();
    let has_recovery_chunk = received_updates.iter().any(|u| {
        u.get("sessionUpdate").and_then(|s| s.as_str()) == Some("agent_message_chunk")
            && u.get("content")
                .and_then(|c| c.get("text"))
                .and_then(|t| t.as_str())
                == Some(expected_signal)
    });
    assert!(
        has_recovery_chunk,
        "Update listener must receive self-healing recovery chunk"
    );

    // Verify subsequent prompt works immediately on the recovered slot
    let next_prompt = manager
        .prompt_slot("slot-heal", "normal follow up")
        .expect("Subsequent prompt must succeed on healed slot");
    assert_eq!(next_prompt.stop_reason, "end_turn");

    let final_slots = manager.list_slots();
    assert_eq!(final_slots[0].status, SlotStatus::Ready);
}

#[test]
fn test_terminate_child_subprocesses_kills_hanging_child() {
    let mut cmd = std::process::Command::new("sh");
    cmd.args(["-c", "sleep 60"]);
    let mut child = cmd.spawn().expect("spawn sleep");
    let pid = child.id();

    #[cfg(unix)]
    unsafe {
        assert_eq!(libc::kill(pid as i32, 0), 0);
    }

    petak_core::agent::acp::terminate_child_subprocesses(std::process::id());

    thread::sleep(Duration::from_millis(50));
    let status = child.wait().expect("child wait");
    assert!(!status.success());
}
