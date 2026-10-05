use std::sync::Mutex;
use tauri::{Emitter, Manager};
use petak_core::exec::Exec;
use super::common::*;

pub struct MirrorState {
    pub sessions: Mutex<std::collections::HashMap<String, petak_core::mirror::session::MirrorSession>>,
}

impl Default for MirrorState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(std::collections::HashMap::new()),
        }
    }
}


#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorFramePayload {
    pub serial: String,
    pub data: String,
}


#[tauri::command]
pub async fn mirror_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, MirrorState>,
    serial: String,
    max_size: Option<u16>,
) -> Result<petak_core::mirror::session::MirrorInfo, String> {
    let exec = petak_core::exec::SystemExec;
    let resolved_serial = if is_direct_adb_serial(&serial) {
        serial.clone()
    } else {
        petak_core::run::resolve_running_avd_serial(&exec, &serial).unwrap_or_else(|| {
            if let Ok(out) = exec.run(
                std::path::Path::new("."),
                &petak_core::run::resolve_adb_binary(),
                &["devices"],
                &[],
                None,
            ) {
                let s = String::from_utf8_lossy(&out.stdout);
                for line in s.lines() {
                    let line = line.trim();
                    if line.starts_with("emulator-") && line.contains("device") && !line.contains("offline") {
                        if let Some(id) = line.split_whitespace().next() {
                            return id.to_string();
                        }
                    }
                }
            }
            serial.clone()
        })
    };
    let serial_for_start = resolved_serial.clone();
    let max = max_size.unwrap_or_else(|| {
        if resolved_serial.starts_with("emulator-") {
            800
        } else {
            1080
        }
    });

    // Clean up any existing active session for this device first
    if let Ok(mut sessions) = state.sessions.lock() {
        let removed = sessions.remove(&resolved_serial).or_else(|| sessions.remove(&serial));
        drop(removed);
    }

    let (info, session, frame_rx, status_rx) =
        tauri::async_runtime::spawn_blocking(move || {
            petak_core::mirror::session::MirrorSession::start(&serial_for_start, max)
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??;

    // Status event forwarder
    let app_status = app.clone();
    let serial_for_status = serial.clone();
    let actual_status_serial = resolved_serial.clone();
    std::thread::spawn(move || {
        while let Ok(status) = status_rx.recv() {
            let _ = app_status.emit(
                "mirror-status",
                serde_json::json!({ "serial": serial_for_status, "status": status }),
            );
            if actual_status_serial != serial_for_status {
                let _ = app_status.emit(
                    "mirror-status",
                    serde_json::json!({ "serial": actual_status_serial, "status": status }),
                );
            }
        }
    });

    // Frame forwarder: high-performance base64 binary streaming
    let app_frame = app.clone();
    let serial_for_frame = serial.clone();
    let actual_frame_serial = resolved_serial.clone();
    std::thread::spawn(move || {
        use base64::Engine;
        let mut last_config_b64: Option<String> = None;
        while let Ok(packet) = frame_rx.recv() {
            let is_config = !packet.is_empty() && packet[0] == 0;
            let is_key = !packet.is_empty() && packet[0] == 1;

            let b64 = base64::engine::general_purpose::STANDARD.encode(&packet);

            if is_config {
                last_config_b64 = Some(b64.clone());
            } else if is_key {
                if let Some(cfg) = &last_config_b64 {
                    let _ = app_frame.emit(
                        "mirror-frame",
                        MirrorFramePayload {
                            serial: serial_for_frame.clone(),
                            data: cfg.clone(),
                        },
                    );
                    if actual_frame_serial != serial_for_frame {
                        let _ = app_frame.emit(
                            "mirror-frame",
                            MirrorFramePayload {
                                serial: actual_frame_serial.clone(),
                                data: cfg.clone(),
                            },
                        );
                    }
                }
            }

            let _ = app_frame.emit(
                "mirror-frame",
                MirrorFramePayload {
                    serial: serial_for_frame.clone(),
                    data: b64,
                },
            );
            if actual_frame_serial != serial_for_frame {
                let _ = app_frame.emit(
                    "mirror-frame",
                    MirrorFramePayload {
                        serial: actual_frame_serial.clone(),
                        data: base64::engine::general_purpose::STANDARD.encode(&packet),
                    },
                );
            }
        }
    });

    if let Ok(mut sessions) = state.sessions.lock() {
        sessions.insert(resolved_serial.clone(), session);
    }

    Ok(info)
}


#[tauri::command]
pub fn mirror_log(tag: String, message: String) -> Result<(), String> {
    petak_core::mirror::trace::log(&tag, &message);
    Ok(())
}


#[tauri::command]
pub async fn mirror_stop(
    state: tauri::State<'_, MirrorState>,
    serial: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let target = serial.trim();
    if target == "all" || target.is_empty() {
        sessions.clear();
        return Ok(());
    }

    let removed = if let Some(s) = sessions.remove(target) {
        Some(s)
    } else {
        let exec = petak_core::exec::SystemExec;
        let alt = if is_direct_adb_serial(target) {
            None
        } else {
            petak_core::run::resolve_running_avd_serial(&exec, target)
        };
        let found_key = alt.as_ref().and_then(|a| {
            if sessions.contains_key(a) {
                Some(a.clone())
            } else {
                None
            }
        }).or_else(|| {
            sessions.keys().find(|k| {
                *k == target
                    || k.eq_ignore_ascii_case(target)
                    || (!target.is_empty() && (k.starts_with(target) || target.starts_with(k.as_str())))
                    || (!is_direct_adb_serial(k) && petak_core::run::resolve_running_avd_serial(&exec, k).as_deref() == Some(target))
                    || alt.as_deref() == Some(k.as_str())
            }).cloned()
        });
        found_key.and_then(|k| sessions.remove(&k))
    };
    // Drop kills the server process + removes forward
    drop(removed);
    Ok(())
}


#[tauri::command]
pub async fn mirror_input(
    state: tauri::State<'_, MirrorState>,
    serial: String,
    event: Option<petak_core::mirror::control::InputEvent>,
    ev: Option<petak_core::mirror::control::InputEvent>,
) -> Result<(), String> {
    let input_ev = event.or(ev).ok_or_else(|| "missing input event".to_string())?;
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(session) = sessions.get(&serial) {
        session.send_input(&input_ev).map_err(|e| e.to_string())
    } else {
        let exec = petak_core::exec::SystemExec;
        let alt = if is_direct_adb_serial(&serial) {
            None
        } else {
            petak_core::run::resolve_running_avd_serial(&exec, &serial)
        };
        let found = alt.as_ref().and_then(|a| sessions.get(a)).or_else(|| {
            sessions.iter().find(|(k, _)| {
                *k == &serial
                    || k.eq_ignore_ascii_case(&serial)
                    || (!serial.is_empty() && (k.starts_with(&serial) || serial.starts_with(k.as_str())))
                    || (!is_direct_adb_serial(k) && petak_core::run::resolve_running_avd_serial(&exec, k).as_deref() == Some(&serial))
            }).map(|(_, v)| v)
        });
        if let Some(session) = found {
            session.send_input(&input_ev).map_err(|e| e.to_string())
        } else {
            Err(format!("No mirror session for {}", serial))
        }
    }
}


#[tauri::command]
pub async fn mirror_screenshot(
    serial: String,
    path: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let resolved = if is_direct_adb_serial(&serial) {
            serial
        } else {
            petak_core::run::resolve_running_avd_serial(&exec, &serial).unwrap_or(serial)
        };
        petak_core::mirror::session::take_screenshot(&exec, &resolved, path.as_deref())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn mirror_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, MirrorState>,
    device_id: String,
    max_size: Option<u16>,
) -> Result<petak_core::mirror::session::MirrorInfo, String> {
    mirror_start(app, state, device_id, max_size).await
}


#[tauri::command]
pub async fn mirror_permission_status(
    device_id: Option<String>,
) -> Result<petak_core::mirror::MirrorPermissionStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(petak_core::mirror::check_screen_capture_permission(
            device_id.as_deref(),
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn open_screen_recording_settings() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::mirror::open_screen_recording_settings().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn mirror_camera_permission() -> Result<petak_core::mirror::CameraPermissionStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(petak_core::mirror::check_camera_permission())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn open_privacy_camera() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::mirror::open_privacy_camera().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


