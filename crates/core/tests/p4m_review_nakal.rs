// Reviewer adversarial probes for P4.M (fs ops + local history + git per-path).
mod common;

use common::gitrepo::TestRepo;
use petak_core::exec::SystemExec;
use petak_core::{fsops, git, local_history};
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::symlink;
use tempfile::TempDir;

#[test]
fn rename_onto_existing_errors_and_keeps_both() {
    let t = TempDir::new().unwrap();
    let r = t.path();
    fs::write(r.join("a.txt"), "AAA").unwrap();
    fs::write(r.join("b.txt"), "BBB").unwrap();
    assert!(fsops::rename(r, "a.txt", "b.txt").is_err());
    assert_eq!(fs::read_to_string(r.join("a.txt")).unwrap(), "AAA");
    assert_eq!(fs::read_to_string(r.join("b.txt")).unwrap(), "BBB");
}

#[test]
fn rename_bad_names_rejected() {
    let t = TempDir::new().unwrap();
    let r = t.path();
    fs::write(r.join("a.txt"), "A").unwrap();
    for bad in ["..", "", ".", "../x", "/etc/x"] {
        assert!(fsops::rename(r, "a.txt", bad).is_err(), "rename to {bad:?} must fail");
    }
    assert!(r.join("a.txt").exists());
}

// Case-sensitive FS (Linux): a.txt and A.txt are two different files.
// Renaming a.txt -> A.txt must NOT silently overwrite the existing A.txt.
#[test]
#[cfg(target_os = "linux")]
fn case_only_rename_does_not_clobber_distinct_file() {
    let t = TempDir::new().unwrap();
    let r = t.path();
    fs::write(r.join("a.txt"), "lower").unwrap();
    fs::write(r.join("A.txt"), "UPPER").unwrap();
    let res = fsops::rename(r, "a.txt", "A.txt");
    let upper = fs::read_to_string(r.join("A.txt")).unwrap();
    assert!(res.is_err(), "must refuse, got Ok and A.txt now = {upper:?}");
    assert_eq!(upper, "UPPER");
}

#[test]
fn move_folder_into_itself_rejected() {
    let t = TempDir::new().unwrap();
    let r = t.path();
    fs::create_dir_all(r.join("d/sub")).unwrap();
    assert!(fsops::move_into(r, &["d"], "d").is_err());
    assert!(fsops::move_into(r, &["d"], "d/sub").is_err());
    assert!(r.join("d/sub").is_dir());
}

// Renaming a symlink must rename the LINK, not the file it points to.
#[test]
#[cfg(unix)]
fn rename_symlink_renames_link_not_target() {
    let t = TempDir::new().unwrap();
    let r = t.path();
    fs::write(r.join("target.txt"), "T").unwrap();
    symlink(r.join("target.txt"), r.join("link.txt")).unwrap();
    fsops::rename(r, "link.txt", "link2.txt").unwrap();
    assert!(r.join("target.txt").exists(), "target file was renamed instead of the link");
    assert!(fs::symlink_metadata(r.join("link2.txt")).unwrap().file_type().is_symlink());
}

// Deleting a symlink must trash the link, never the target.
#[test]
#[cfg(unix)]
fn trash_resolves_symlink_to_link_itself() {
    let t = TempDir::new().unwrap();
    let r = t.path();
    fs::write(r.join("target.txt"), "T").unwrap();
    symlink(r.join("target.txt"), r.join("link.txt")).unwrap();
    let p = fsops::resolve_in_root(r, "link.txt").unwrap();
    assert!(
        p.ends_with("link.txt"),
        "resolve_in_root followed the link -> fs_trash/rename would act on {p:?}"
    );
}

// Empty rel resolves to project root; fs_trash([""]) would trash the whole project.
#[test]
fn empty_rel_is_not_a_valid_target_for_destructive_ops() {
    let t = TempDir::new().unwrap();
    let r = t.path();
    let p = fsops::resolve_in_root(r, "");
    let p2 = fsops::resolve_in_root(r, ".");
    assert!(
        p.is_err() && p2.is_err(),
        "'' / '.' resolve to root ({:?}); trash/rename guard missing",
        p
    );
}

#[test]
#[cfg(unix)]
fn symlink_dir_escape_rejected_for_create() {
    let t = TempDir::new().unwrap();
    let out = TempDir::new().unwrap();
    symlink(out.path(), t.path().join("esc")).unwrap();
    assert!(fsops::create_file(t.path(), "esc/pwn.txt", None).is_err());
    assert!(!out.path().join("pwn.txt").exists());
}

#[test]
fn lh_dedup_and_folder_lists_deleted() {
    let t = TempDir::new().unwrap();
    let s = t.path();
    assert!(local_history::snapshot(s, "lib/a.dart", b"x", "save").unwrap().is_some());
    assert!(local_history::snapshot(s, "lib/a.dart", b"x", "save").unwrap().is_none());
    assert!(local_history::snapshot(s, "lib/a.dart", b"x", "external").unwrap().is_none());
    local_history::snapshot(s, "lib/gone.dart", b"bye", "before_delete").unwrap();
    let l = local_history::list(s, "lib").unwrap();
    assert!(l.iter().any(|e| e.path == "lib/gone.dart"));
    // prefix must not match sibling "lib2"
    local_history::snapshot(s, "lib2/z.dart", b"z", "save").unwrap();
    assert!(local_history::list(s, "lib").unwrap().iter().all(|e| !e.path.starts_with("lib2")));
}

#[test]
fn rollback_then_undo_via_lh() {
    let repo = TestRepo::new();
    let exec = SystemExec;
    let store = TempDir::new().unwrap();
    repo.write_file("f.txt", "v1\n");
    repo.commit("c1");
    repo.write_file("f.txt", "v2 local edit\n");
    let before = fs::read(repo.path().join("f.txt")).unwrap();
    let e = local_history::snapshot(store.path(), "f.txt", &before, "before_rollback")
        .unwrap()
        .unwrap();
    git::rollback_paths(&exec, repo.path(), &["f.txt"]).unwrap();
    assert_eq!(fs::read_to_string(repo.path().join("f.txt")).unwrap(), "v1\n");
    let back = local_history::read(store.path(), &e.id).unwrap();
    fs::write(repo.path().join("f.txt"), &back).unwrap();
    assert_eq!(fs::read_to_string(repo.path().join("f.txt")).unwrap(), "v2 local edit\n");
}

#[test]
fn follow_after_rename_via_fsops() {
    let repo = TestRepo::new();
    let exec = SystemExec;
    repo.write_file("old.dart", "a\nb\nc\nd\n");
    repo.commit("c1");
    fsops::rename(repo.path(), "old.dart", "new.dart").unwrap();
    repo.git(&["add", "-A"]);
    repo.commit("c2 rename");
    let h = git::path_history(&exec, repo.path(), "new.dart", true, 0, 0).unwrap();
    assert_eq!(h.len(), 2);
}

// Ref coming from UI goes straight to argv: a ref starting with '-' becomes a git option.
#[test]
fn git_ref_option_injection_rejected() {
    let repo = TestRepo::new();
    let exec = SystemExec;
    repo.write_file("f.txt", "1\n");
    repo.commit("c1");
    repo.write_file("f.txt", "2\n");
    let out = TempDir::new().unwrap();
    let pwn = out.path().join("pwn");
    let evil = format!("--output={}", pwn.display());
    let _ = git::diff_path_vs_ref(&exec, repo.path(), &evil, "f.txt");
    assert!(!pwn.exists(), "git diff wrote arbitrary file via ref option injection");
}
