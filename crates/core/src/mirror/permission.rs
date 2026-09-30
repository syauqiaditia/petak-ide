use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorPermissionStatus {
    pub granted: bool,
    pub restart_needed: bool,
    pub kind: String, // "simulator" | "physical"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[cfg(target_os = "macos")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
}

/// Check screen recording permission status.
pub fn check_screen_capture_permission(device_id: Option<&str>) -> MirrorPermissionStatus {
    let kind = if let Some(id) = device_id {
        if crate::mirror::ios::is_ios_simulator(id) {
            "simulator"
        } else {
            "physical"
        }
    } else {
        "simulator"
    };

    #[cfg(target_os = "macos")]
    let granted = unsafe { CGPreflightScreenCaptureAccess() };

    #[cfg(not(target_os = "macos"))]
    let granted = true;

    // Check restart needed flag
    let restart_needed = if !granted {
        if let Some(data_dir) = dirs::data_dir() {
            data_dir
                .join("Petak")
                .join("mirror_permission_claimed.flag")
                .exists()
        } else {
            false
        }
    } else {
        // If granted, clean up flag if it exists
        if let Some(data_dir) = dirs::data_dir() {
            let flag = data_dir
                .join("Petak")
                .join("mirror_permission_claimed.flag");
            if flag.exists() {
                let _ = std::fs::remove_file(flag);
            }
        }
        false
    };

    let notes = if kind == "physical" {
        Some("iPhone fisik memerlukan: 1) Kabel USB tersambung; 2) Layar iPhone terbuka (unlocked); 3) Pilih 'Percayai Komputer Ini' ('Trust This Computer') di layar iPhone. Mode saat ini adalah view-only.".to_string())
    } else if !granted {
        Some("Izin Screen Recording (Perekaman Layar) diperlukan di macOS System Settings > Privacy & Security > Screen Recording.".to_string())
    } else {
        None
    };

    MirrorPermissionStatus {
        granted,
        restart_needed,
        kind: kind.to_string(),
        notes,
    }
}

pub fn record_permission_claimed() -> std::io::Result<()> {
    if let Some(data_dir) = dirs::data_dir() {
        let petak_dir = data_dir.join("Petak");
        std::fs::create_dir_all(&petak_dir)?;
        std::fs::write(petak_dir.join("mirror_permission_claimed.flag"), "claimed")?;
    }
    Ok(())
}

pub fn open_screen_recording_settings() -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
            .spawn()?;
    }
    let _ = record_permission_claimed();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_permission_status_simulator_vs_physical() {
        let sim_status =
            check_screen_capture_permission(Some("E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90"));
        assert_eq!(sim_status.kind, "simulator");

        let phys_status = check_screen_capture_permission(Some("00008101-001234567890"));
        assert_eq!(phys_status.kind, "physical");
        assert!(phys_status.notes.as_deref().unwrap().contains("USB"));
    }

    #[test]
    fn test_record_permission_claimed_flag() {
        let tmp = tempfile::tempdir().unwrap();
        let flag = tmp.path().join("flag.txt");
        std::fs::write(&flag, "claimed").unwrap();
        assert!(flag.exists());
    }
}
