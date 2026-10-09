use petak_core::agent::{SlotConfig, SlotEvent, SlotManager, SlotStatus, DEFAULT_IDLE_TIMEOUT};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

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
fn test_lazy_spawn_no_process_before_prompt() {
    let temp = tempfile::tempdir().unwrap();
    let manager = SlotManager::with_defaults(Some(temp.path().to_path_buf()));

    let config = make_fake_slot_config("slot-lazy", "Lazy Agent");
    manager.add_slot(config).unwrap();

    let slots = manager.list_slots();
    assert_eq!(slots.len(), 1);
    assert_eq!(slots[0].id, "slot-lazy");
    assert_eq!(slots[0].status, SlotStatus::Idle);
    assert!(
        slots[0].active_pid.is_none(),
        "No child process should be spawned on slot registration"
    );
    assert!(slots[0].session_id.is_none());
}

#[test]
fn test_prompt_and_stream_updates_and_capabilities() {
    let temp = tempfile::tempdir().unwrap();
    let manager = SlotManager::with_defaults(Some(temp.path().to_path_buf()));

    let updates = Arc::new(Mutex::new(Vec::new()));
    let updates_clone = Arc::clone(&updates);

    manager.add_listener(move |event| {
        if let SlotEvent::Update {
            slot_id, update, ..
        } = event
        {
            updates_clone.lock().unwrap().push((slot_id, update));
        }
    });

    let config = make_fake_slot_config("slot-prompt", "Prompt Agent");
    manager.add_slot(config).unwrap();

    // Lazy spawn triggered on prompt
    let prompt_res = manager
        .prompt_slot("slot-prompt", "test prompt hello")
        .unwrap();
    assert_eq!(prompt_res.stop_reason, "end_turn");
    assert!(prompt_res.usage.is_some());

    // Verify stream updates received
    let received_updates = updates.lock().unwrap().clone();
    assert!(
        received_updates.len() >= 3,
        "Expected at least 3 stream updates (chunks + usage), got {}",
        received_updates.len()
    );

    let has_chunk = received_updates.iter().any(|(_, u)| {
        u.get("sessionUpdate").and_then(|v| v.as_str()) == Some("agent_message_chunk")
    });
    let has_usage = received_updates
        .iter()
        .any(|(_, u)| u.get("sessionUpdate").and_then(|v| v.as_str()) == Some("usage_update"));

    assert!(has_chunk, "Stream updates must include agent_message_chunk");
    assert!(has_usage, "Stream updates must include usage_update");

    // Verify capabilities populated from initialize and session/new
    let slots = manager.list_slots();
    let slot = &slots[0];
    assert_eq!(slot.status, SlotStatus::Ready);
    assert!(slot.active_pid.is_some());
    assert!(slot.session_id.is_some());
    assert!(slot.capabilities.load_session);
    assert!(slot.capabilities.supports_set_model);
    assert_eq!(
        slot.capabilities.current_model.as_deref(),
        Some("fake-model-alpha")
    );
    assert_eq!(slot.capabilities.available_models.len(), 2);
    assert!(slot.capabilities.supports_usage);

    // Verify history ring buffer recorded user and assistant messages
    let history = manager.get_slot_history("slot-prompt").unwrap();
    assert!(history.len() >= 2);
    assert_eq!(history[0].role, "user");
    assert_eq!(history[0].content, "test prompt hello");
    assert_eq!(history[1].role, "agent");
    assert_eq!(history[1].stop_reason.as_deref(), Some("end_turn"));
}

#[test]
fn test_cancel_slot() {
    let temp = tempfile::tempdir().unwrap();
    let manager = Arc::new(SlotManager::with_defaults(Some(temp.path().to_path_buf())));

    let config = make_fake_slot_config("slot-cancel", "Cancel Agent");
    manager.add_slot(config).unwrap();

    let manager_for_thread = Arc::clone(&manager);
    let prompt_handle =
        thread::spawn(move || manager_for_thread.prompt_slot("slot-cancel", "slow prompt test"));

    // Wait until prompt is actually running in Busy state
    let start_wait = std::time::Instant::now();
    while start_wait.elapsed() < Duration::from_secs(3) {
        if manager.list_slots()[0].status == SlotStatus::Busy {
            break;
        }
        thread::sleep(Duration::from_millis(20));
    }

    // Cancel prompt
    manager.cancel_slot("slot-cancel").unwrap();

    let result = prompt_handle.join().unwrap().unwrap();
    assert_eq!(result.stop_reason, "cancelled");

    let slots = manager.list_slots();
    assert_eq!(slots[0].status, SlotStatus::Ready);
}

#[test]
fn test_kill_and_restart_slot() {
    let temp = tempfile::tempdir().unwrap();
    let manager = SlotManager::with_defaults(Some(temp.path().to_path_buf()));

    let config = make_fake_slot_config("slot-kill", "Kill Agent");
    manager.add_slot(config).unwrap();

    // Start slot explicitly
    let summary1 = manager.start_slot("slot-kill").unwrap();
    assert_eq!(summary1.status, SlotStatus::Ready);
    let pid1 = summary1.active_pid.unwrap();

    // Stop / kill slot
    manager.stop_slot("slot-kill").unwrap();
    let slots_stopped = manager.list_slots();
    assert_eq!(slots_stopped[0].status, SlotStatus::Stopped);
    assert!(slots_stopped[0].active_pid.is_none());

    // Restart slot
    let summary2 = manager.restart_slot("slot-kill").unwrap();
    assert_eq!(summary2.status, SlotStatus::Ready);
    let pid2 = summary2.active_pid.unwrap();

    assert_ne!(
        pid1, pid2,
        "Restarting slot must spawn a new child process with new PID"
    );
}

#[test]
fn test_idle_reap() {
    let temp = tempfile::tempdir().unwrap();
    // Configure idle timeout = 100ms for fast test
    let manager = SlotManager::new(
        Some(temp.path().to_path_buf()),
        3,
        Duration::from_millis(100),
    );

    let config = make_fake_slot_config("slot-idle", "Idle Agent");
    manager.add_slot(config).unwrap();

    // Start slot
    manager.start_slot("slot-idle").unwrap();
    assert_eq!(manager.list_slots()[0].status, SlotStatus::Ready);
    assert!(manager.list_slots()[0].active_pid.is_some());

    // Sleep 150ms to exceed idle timeout
    thread::sleep(Duration::from_millis(150));

    let reaped = manager.tick_idle_reap();
    assert_eq!(reaped, vec!["slot-idle".to_string()]);

    let slots_after = manager.list_slots();
    assert_eq!(slots_after[0].status, SlotStatus::Stopped);
    assert!(slots_after[0].active_pid.is_none());
}

#[test]
fn test_active_slot_limit_enforcement() {
    let temp = tempfile::tempdir().unwrap();
    // Max 2 active slots
    let manager = SlotManager::new(Some(temp.path().to_path_buf()), 2, DEFAULT_IDLE_TIMEOUT);

    let s1 = make_fake_slot_config("s1", "Agent 1");
    let s2 = make_fake_slot_config("s2", "Agent 2");
    let s3 = make_fake_slot_config("s3", "Agent 3");

    manager.add_slot(s1).unwrap();
    manager.add_slot(s2).unwrap();
    manager.add_slot(s3).unwrap();

    // Start s1 and s2
    manager.start_slot("s1").unwrap();
    thread::sleep(Duration::from_millis(50));
    manager.start_slot("s2").unwrap();

    let slots = manager.list_slots();
    let active_count = slots.iter().filter(|s| s.active_pid.is_some()).count();
    assert_eq!(active_count, 2);

    // Starting s3 should automatically reap/stop s1 (the oldest idle Ready slot)
    manager.start_slot("s3").unwrap();

    let slots_after = manager.list_slots();
    let s1_state = slots_after.iter().find(|s| s.id == "s1").unwrap();
    let s2_state = slots_after.iter().find(|s| s.id == "s2").unwrap();
    let s3_state = slots_after.iter().find(|s| s.id == "s3").unwrap();

    assert_eq!(
        s1_state.status,
        SlotStatus::Stopped,
        "Oldest slot s1 should be reaped to enforce limit"
    );
    assert_eq!(s2_state.status, SlotStatus::Ready);
    assert_eq!(s3_state.status, SlotStatus::Ready);

    let active_after = slots_after
        .iter()
        .filter(|s| s.active_pid.is_some())
        .count();
    assert_eq!(active_after, 2, "Active count must strictly remain <= 2");
}

#[test]
fn test_hermes_acp_real_session_new_only() {
    // Check if hermes is available
    let check = std::process::Command::new("hermes")
        .arg("acp")
        .arg("--check")
        .output();

    let Ok(out) = check else {
        println!("hermes binary not found, skipping real hermes acp test");
        return;
    };

    if !out.status.success() {
        println!("hermes acp --check failed, skipping real hermes acp test");
        return;
    }

    let temp = tempfile::tempdir().unwrap();
    let env_map = std::collections::HashMap::new();

    let client = petak_core::agent::AcpClient::spawn(
        "hermes",
        &["acp".to_string()],
        &env_map,
        Some(temp.path()),
        |_update| {},
    )
    .expect("spawn real hermes acp");

    assert!(client.is_alive());
    assert!(client.pid().is_some());

    // 1. Handshake initialize
    let init_res = client
        .initialize(Duration::from_secs(15))
        .expect("initialize real hermes acp");
    assert_eq!(init_res.protocol_version, 1);
    assert_eq!(
        init_res.agent_info.as_ref().map(|i| i.name.as_str()),
        Some("hermes-agent")
    );
    assert!(init_res.agent_capabilities.load_session);

    // 2. Handshake session/new ONLY (no prompt, 0 cost)
    let sess_res = client
        .session_new(&temp.path().to_string_lossy(), &[], Duration::from_secs(15))
        .expect("session/new real hermes acp");

    assert!(!sess_res.session_id.is_empty(), "sessionId must be valid");
    assert!(sess_res.models.is_some(), "hermes must advertise models");

    let models = sess_res.models.unwrap();
    assert!(
        models.current_model_id.is_some(),
        "hermes session/new must provide currentModelId"
    );
    assert!(
        !models.available_models.is_empty(),
        "hermes session/new must provide availableModels"
    );

    println!(
        "Verified real Hermes ACP session: id={}, model={:?}",
        sess_res.session_id, models.current_model_id
    );

    // Clean shutdown
    client.kill().expect("kill real hermes acp");
}

#[test]
fn test_permission_modes_with_fake_agent() {
    let temp = tempfile::tempdir().unwrap();
    let manager = Arc::new(SlotManager::with_defaults(Some(temp.path().to_path_buf())));

    // 1. Read mode: denied immediately
    let mut read_cfg = make_fake_slot_config("slot-read", "Read Slot");
    read_cfg.permission = "read".to_string();
    manager.add_slot(read_cfg).unwrap();

    let resp_read = manager.prompt_slot("slot-read", "perm:cargo test").unwrap();
    let meta = resp_read.meta.unwrap();
    let perm_res = meta
        .get("permResult")
        .and_then(|r| r.get("outcome"))
        .and_then(|o| o.get("outcome"))
        .and_then(|s| s.as_str());
    let perm_err = meta.get("permError");
    assert!(
        perm_res == Some("denied") || perm_err.is_some(),
        "Read mode must deny execution"
    );

    // 2. Full mode: approved immediately
    let mut full_cfg = make_fake_slot_config("slot-full", "Full Slot");
    full_cfg.permission = "full".to_string();
    manager.add_slot(full_cfg).unwrap();

    let resp_full = manager
        .prompt_slot("slot-full", "perm:dangerous command")
        .unwrap();
    let meta_full = resp_full.meta.unwrap();
    let perm_res_full = meta_full
        .get("permResult")
        .and_then(|r| r.get("outcome"))
        .and_then(|o| o.get("outcome"))
        .and_then(|s| s.as_str());
    assert_eq!(perm_res_full, Some("approved"));

    // 3. Auto mode: allowed command approved without asking
    let mut auto_cfg = make_fake_slot_config("slot-auto", "Auto Slot");
    auto_cfg.permission = "auto".to_string();
    manager.add_slot(auto_cfg).unwrap();

    let resp_auto = manager.prompt_slot("slot-auto", "perm:cargo test").unwrap();
    let meta_auto = resp_auto.meta.unwrap();
    let perm_res_auto = meta_auto
        .get("permResult")
        .and_then(|r| r.get("outcome"))
        .and_then(|o| o.get("outcome"))
        .and_then(|s| s.as_str());
    assert_eq!(perm_res_auto, Some("approved"));

    // 4. Ask mode: requires response from user
    let mut ask_cfg = make_fake_slot_config("slot-ask", "Ask Slot");
    ask_cfg.permission = "ask".to_string();
    manager.add_slot(ask_cfg).unwrap();

    let mgr_clone = Arc::clone(&manager);
    let prompt_handle =
        thread::spawn(move || mgr_clone.prompt_slot("slot-ask", "perm:custom action"));

    // Wait for pending permission request
    let mut req_id = String::new();
    for _ in 0..50 {
        let pending = manager.permission_manager().list_pending();
        if let Some(r) = pending.first() {
            req_id = r.request_id.clone();
            break;
        }
        thread::sleep(Duration::from_millis(20));
    }
    assert!(
        !req_id.is_empty(),
        "Pending permission request should be present"
    );

    // Respond allow
    manager.permission_manager().respond(&req_id, true).unwrap();

    let resp_ask = prompt_handle.join().unwrap().unwrap();
    let meta_ask = resp_ask.meta.unwrap();
    let perm_res_ask = meta_ask
        .get("permResult")
        .and_then(|r| r.get("outcome"))
        .and_then(|o| o.get("outcome"))
        .and_then(|s| s.as_str());
    assert_eq!(perm_res_ask, Some("approved"));
}

#[test]
fn test_permission_requested_event_emission() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().to_path_buf();
    let manager = Arc::new(SlotManager::new(Some(root), 5, Duration::from_secs(60)));

    let mut ask_cfg = make_fake_slot_config("slot-ask-event", "Ask Slot Event");
    ask_cfg.permission = "ask".to_string();
    manager.add_slot(ask_cfg).unwrap();

    let captured_events = Arc::new(std::sync::Mutex::new(Vec::new()));
    let cap_clone = Arc::clone(&captured_events);
    manager.add_listener(move |event| {
        if let SlotEvent::PermissionRequested {
            slot_id,
            request_id,
            tool_call,
        } = event
        {
            let mut list = cap_clone.lock().unwrap();
            list.push((slot_id, request_id, tool_call));
        }
    });

    let mgr_clone = Arc::clone(&manager);
    let prompt_handle =
        thread::spawn(move || mgr_clone.prompt_slot("slot-ask-event", "perm:rm -rf /test"));

    // Wait for event to arrive
    let mut req_id = String::new();
    for _ in 0..100 {
        let list = captured_events.lock().unwrap();
        if let Some((slot, id, tc)) = list.first() {
            assert_eq!(slot, "slot-ask-event");
            assert!(id.starts_with("perm_"));
            assert!(
                tc.get("command").is_some()
                    || tc.get("arguments").is_some()
                    || tc.get("tool").is_some()
            );
            req_id = id.clone();
            break;
        }
        drop(list);
        thread::sleep(Duration::from_millis(20));
    }

    assert!(
        !req_id.is_empty(),
        "SlotEvent::PermissionRequested must be emitted to listener"
    );

    // Respond allow using the captured request_id
    manager.permission_manager().respond(&req_id, true).unwrap();

    let resp = prompt_handle.join().unwrap().unwrap();
    let meta = resp.meta.unwrap();
    let perm_res = meta
        .get("permResult")
        .and_then(|r| r.get("outcome"))
        .and_then(|o| o.get("outcome"))
        .and_then(|s| s.as_str());
    assert_eq!(perm_res, Some("approved"));
}

#[test]
fn test_proposal_workflow_with_fake_agent() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().to_path_buf();
    let file_path = root.join("demo.txt");
    std::fs::write(&file_path, "initial line 1\ninitial line 2\n").unwrap();

    let manager = Arc::new(SlotManager::with_defaults(Some(root.clone())));

    let mut cfg = make_fake_slot_config("slot-prop", "Proposal Slot");
    cfg.permission = "ask".to_string();
    manager.add_slot(cfg).unwrap();

    // 1. Agent sends write proposal
    let mgr_clone = Arc::clone(&manager);
    let handle = thread::spawn(move || {
        mgr_clone.prompt_slot(
            "slot-prop",
            "write:demo.txt:initial line 1\nmodified line 2\n",
        )
    });

    // Wait for proposal to appear in buffer
    let mut prop_id = String::new();
    for _ in 0..50 {
        let proposals = manager.proposal_buffer().list_proposals(Some("slot-prop"));
        if let Some(p) = proposals.first() {
            prop_id = p.id.clone();
            break;
        }
        thread::sleep(Duration::from_millis(20));
    }
    assert!(!prop_id.is_empty(), "Proposal should be created");

    // Accept proposal
    manager
        .proposal_buffer()
        .accept_proposal(&prop_id, None)
        .unwrap();

    let prompt_res = handle.join().unwrap().unwrap();
    let meta = prompt_res.meta.unwrap();
    assert!(meta.get("writeResult").is_some());

    // Verify file written to disk
    let disk_content = std::fs::read_to_string(&file_path).unwrap();
    assert_eq!(disk_content, "initial line 1\nmodified line 2\n");
}

#[test]
fn test_team_json_apply_and_roundtrip() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().to_path_buf();

    let manager = SlotManager::with_defaults(Some(root.clone()));

    let s1 = make_fake_slot_config("slot-1", "Slot One");
    let s2 = make_fake_slot_config("slot-2", "Slot Two");

    let team = petak_core::agent::TeamConfig {
        version: 1,
        slots: vec![s1.clone(), s2.clone()],
        obsidian_vault_path: None,
    };

    // Apply team
    manager.apply_team(&team).unwrap();
    let slots = manager.list_slots();
    assert_eq!(slots.len(), 2);
    assert_eq!(slots[0].id, "slot-1");
    assert_eq!(slots[1].id, "slot-2");

    // Save and load
    let saved_path = manager.save_team(&team).unwrap();
    assert!(saved_path.is_file());

    let (loaded, _) = manager.load_team();
    assert_eq!(loaded.version, 1);
    assert_eq!(loaded.slots.len(), 2);
    assert_eq!(loaded.slots[0].id, "slot-1");
}
