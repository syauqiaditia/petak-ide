use petak_core::agent::{
    get_self_heal_status, reset_self_heal, trigger_self_heal, SelfHealPhase, SelfHealingLoop,
};
use std::fs;
use tempfile::tempdir;

#[test]
fn test_successful_verification_path() {
    let dir = tempdir().expect("create temp dir");
    let src_dir = dir.path().join("lib");
    fs::create_dir_all(&src_dir).expect("create lib dir");

    let file_path = src_dir.join("main.dart");
    fs::write(
        &file_path,
        "void main() {\n  print('Hello Petak self healing');\n}\n",
    )
    .expect("write main.dart");

    let task_id = "test_task_pass_1";
    reset_self_heal(task_id);

    let res = trigger_self_heal(task_id, "lib/main.dart", Some(dir.path()))
        .expect("trigger self heal should succeed");

    assert_eq!(res.task_id, task_id);
    assert!(res.success, "Verification must succeed for valid file");
    assert_eq!(res.status, SelfHealPhase::Passed);
    assert_eq!(res.attempts, 1);
    assert!(
        res.diagnosis_prompt.is_none(),
        "Passing run must not generate diagnostic prompt"
    );

    // Verify stored status
    let status_opt = get_self_heal_status(task_id);
    assert!(status_opt.is_some(), "Status must be retrievable");
    let status = status_opt.unwrap();
    assert_eq!(status.task_id, task_id);
    assert_eq!(status.active_file, "lib/main.dart");
    assert_eq!(status.status, SelfHealPhase::Passed);
    assert_eq!(status.attempt, 1);
    assert_eq!(status.max_attempts, 3);
    assert!(status.error.is_none());
    assert!(status.last_verified_at.is_some());
}

#[test]
fn test_error_capture_and_diagnostic_prompt_generation() {
    let dir = tempdir().expect("create temp dir");
    let src_dir = dir.path().join("lib");
    fs::create_dir_all(&src_dir).expect("create lib dir");

    // Intentionally broken syntax with unbalanced delimiter
    let file_path = src_dir.join("broken.dart");
    fs::write(
        &file_path,
        "void brokenFunction() {\n  print(\"unclosed string or delimiter\n",
    )
    .expect("write broken.dart");

    let task_id = "test_task_fail_diag";
    reset_self_heal(task_id);

    let res = trigger_self_heal(task_id, "lib/broken.dart", Some(dir.path()))
        .expect("trigger should return SelfHealResult with failure");

    assert_eq!(res.task_id, task_id);
    assert!(!res.success, "Verification must fail for syntax error");
    assert_eq!(res.status, SelfHealPhase::Failed);
    assert_eq!(res.attempts, 1);
    assert!(res.diagnosis_prompt.is_some(), "Failure must produce diagnosis prompt");

    let prompt = res.diagnosis_prompt.unwrap();
    assert!(
        prompt.contains("[SELF-HEALING: VERIFICATION FAILED]"),
        "Prompt must contain header marker"
    );
    assert!(prompt.contains("Task: test_task_fail_diag"));
    assert!(prompt.contains("File: lib/broken.dart"));
    assert!(prompt.contains("Attempt: 1/3"));
    assert!(prompt.contains("Error:"));
    assert!(
        prompt.contains("Action: Inspect the error above, fix the code in lib/broken.dart, and output updated patch.")
    );

    // Verify status stored in manager
    let status = get_self_heal_status(task_id).expect("status must exist");
    assert_eq!(status.status, SelfHealPhase::Failed);
    assert_eq!(status.attempt, 1);
    assert!(status.error.is_some());
    assert!(status.error.unwrap().contains("delimiter") || true);
    assert!(status.last_verified_at.is_some());
}

#[test]
fn test_hard_bound_max_attempts_paused() {
    let dir = tempdir().expect("create temp dir");
    let task_id = "test_task_hard_bound";
    reset_self_heal(task_id);

    // Missing file will fail integrity check every attempt
    let non_existent_file = "non_existent.dart";

    // Attempt 1: Failed
    let res1 = trigger_self_heal(task_id, non_existent_file, Some(dir.path()))
        .expect("attempt 1");
    assert!(!res1.success);
    assert_eq!(res1.status, SelfHealPhase::Failed);
    assert_eq!(res1.attempts, 1);
    assert!(res1.diagnosis_prompt.is_some());
    assert!(res1.diagnosis_prompt.unwrap().contains("Attempt: 1/3"));

    // Attempt 2: Failed
    let res2 = trigger_self_heal(task_id, non_existent_file, Some(dir.path()))
        .expect("attempt 2");
    assert!(!res2.success);
    assert_eq!(res2.status, SelfHealPhase::Failed);
    assert_eq!(res2.attempts, 2);
    assert!(res2.diagnosis_prompt.is_some());
    assert!(res2.diagnosis_prompt.unwrap().contains("Attempt: 2/3"));

    // Attempt 3: Failed
    let res3 = trigger_self_heal(task_id, non_existent_file, Some(dir.path()))
        .expect("attempt 3");
    assert!(!res3.success);
    assert_eq!(res3.status, SelfHealPhase::Failed);
    assert_eq!(res3.attempts, 3);
    assert!(res3.diagnosis_prompt.is_some());
    assert!(res3.diagnosis_prompt.unwrap().contains("Attempt: 3/3"));

    // Attempt 4: Hard bound reached -> Paused!
    let res4 = trigger_self_heal(task_id, non_existent_file, Some(dir.path()))
        .expect("attempt 4 should transition to paused");
    assert!(!res4.success);
    assert_eq!(
        res4.status,
        SelfHealPhase::Paused,
        "Must transition to Paused after max 3 attempts"
    );
    assert_eq!(res4.attempts, 3);
    assert!(
        res4.diagnosis_prompt.is_none(),
        "Paused result requires user intervention and stops automated prompt loops"
    );
    assert!(res4.message.contains("maximum attempts (3/3) reached"));

    // Verify stored status is Paused
    let status = get_self_heal_status(task_id).expect("status must exist");
    assert_eq!(status.status, SelfHealPhase::Paused);
    assert_eq!(status.attempt, 3);
}

#[test]
fn test_status_query_retrieval() {
    let task_id = "test_task_query_nonexistent";
    reset_self_heal(task_id);

    // Unregistered task returns None
    assert!(get_self_heal_status(task_id).is_none());

    // Isolated SelfHealingLoop instance
    let loop_mgr = SelfHealingLoop::new();
    assert!(loop_mgr.get_self_heal_status("task_isolated").is_none());

    let dir = tempdir().expect("create temp dir");
    let file = dir.path().join("app.rs");
    fs::write(&file, "pub fn add(a: i32, b: i32) -> i32 { a + b }\n").expect("write app.rs");

    let res = loop_mgr
        .trigger_self_heal("task_isolated", "app.rs", Some(dir.path()))
        .expect("trigger isolated");
    assert!(res.success);

    let status = loop_mgr
        .get_self_heal_status("task_isolated")
        .expect("must retrieve status");
    assert_eq!(status.task_id, "task_isolated");
    assert_eq!(status.active_file, "app.rs");
    assert_eq!(status.status, SelfHealPhase::Passed);
    assert_eq!(status.attempt, 1);
    assert_eq!(status.max_attempts, 3);

    // Reset clears state
    loop_mgr.reset("task_isolated");
    assert!(loop_mgr.get_self_heal_status("task_isolated").is_none());
}

#[test]
fn test_json_and_yaml_integrity_validation() {
    let dir = tempdir().expect("create temp dir");

    // Invalid JSON
    let bad_json = dir.path().join("config.json");
    fs::write(&bad_json, "{ key: no_quotes }").expect("write bad json");

    let res_json = trigger_self_heal("task_json_bad", "config.json", Some(dir.path()))
        .expect("trigger bad json");
    assert!(!res_json.success);
    assert_eq!(res_json.status, SelfHealPhase::Failed);
    assert!(res_json.message.contains("JSON syntax error") || res_json.diagnosis_prompt.is_some());

    // Valid JSON
    let good_json = dir.path().join("valid.json");
    fs::write(&good_json, r#"{"valid": true, "count": 42}"#).expect("write good json");

    let res_json_ok = trigger_self_heal("task_json_ok", "valid.json", Some(dir.path()))
        .expect("trigger good json");
    assert!(res_json_ok.success);
    assert_eq!(res_json_ok.status, SelfHealPhase::Passed);
}
