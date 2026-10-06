use std::sync::Mutex;
use tauri::{Emitter, Manager};
use petak_core::exec::Exec;
use super::*;

pub enum ActiveRun {
    Flutter(std::sync::Arc<Mutex<petak_core::run::FlutterRun>>),
    Gradle {
        device_id: String,
        app_id: Option<String>,
        proc: Option<std::sync::Arc<Mutex<Box<dyn petak_core::exec::Proc>>>>,
    },
}


pub struct RunStateInner {
    pub next_run_id: std::sync::atomic::AtomicU32,
    pub runs: Mutex<std::collections::HashMap<u32, ActiveRun>>,
    pub logcat: Mutex<Option<petak_core::run::Logcat>>,
    pub device_watcher: Mutex<Option<Box<dyn petak_core::exec::Proc>>>,
    pub cached_devices: Mutex<Vec<petak_core::run::Device>>,
    pub spawned_emulators: Mutex<Vec<Box<dyn petak_core::exec::Proc>>>,
}


#[derive(Clone)]
pub struct RunState {
    pub inner: std::sync::Arc<RunStateInner>,
}

impl Default for RunState {
    fn default() -> Self {
        Self {
            inner: std::sync::Arc::new(RunStateInner {
                next_run_id: std::sync::atomic::AtomicU32::new(1),
                runs: Mutex::new(std::collections::HashMap::new()),
                logcat: Mutex::new(None),
                device_watcher: Mutex::new(None),
                cached_devices: Mutex::new(Vec::new()),
                spawned_emulators: Mutex::new(Vec::new()),
            }),
        }
    }
}

impl RunState {
    pub fn shutdown_all(&self) {
        if let Ok(mut runs) = self.inner.runs.lock() {
            for (_, run) in runs.drain() {
                match run {
                    ActiveRun::Flutter(fr) => {
                        if let Ok(mut f) = fr.lock() {
                            let _ = f.stop();
                        }
                    }
                    ActiveRun::Gradle { proc, device_id, app_id } => {
                        if let Some(p) = proc {
                            if let Ok(mut pr) = p.lock() {
                                let _ = pr.kill();
                            }
                        }
                        if let Some(aid) = app_id {
                            let adb = petak_core::run::resolve_adb_binary();
                            let mut c = std::process::Command::new(&adb);
                            petak_core::toolchain::apply_env(&mut c);
                            let _ = c.args(["-s", &device_id, "shell", "am", "force-stop", &aid])
                                .status();
                        }
                    }
                }
            }
        }

        if let Ok(mut lc) = self.inner.logcat.lock() {
            if let Some(mut logcat) = lc.take() {
                let _ = logcat.stop();
            }
        }

        if let Ok(mut watcher) = self.inner.device_watcher.lock() {
            if let Some(mut proc) = watcher.take() {
                let _ = proc.kill();
            }
        }

        if let Ok(mut emus) = self.inner.spawned_emulators.lock() {
            for mut emu in emus.drain(..) {
                let _ = emu.kill();
            }
        }
    }
}


fn ensure_device_watcher(app: &tauri::AppHandle, state: &RunState) {
    let mut watcher_guard = match state.inner.device_watcher.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    if watcher_guard.is_some() {
        return;
    }

    let (tx, rx) = std::sync::mpsc::channel::<Vec<petak_core::run::Device>>();
    let spawn = petak_core::exec::SystemSpawn;
    match petak_core::run::watch_devices(&spawn, tx) {
        Ok(proc) => {
            *watcher_guard = Some(proc);
            drop(watcher_guard);

            let app_handle = app.clone();
            let state_clone = state.clone();
            std::thread::spawn(move || {
                while let Ok(devices) = rx.recv() {
                    if let Ok(mut cached) = state_clone.inner.cached_devices.lock() {
                        *cached = devices.clone();
                    }
                    let _ = app_handle.emit("devices-changed", devices);
                }
            });
        }
        Err(e) => {
            eprintln!("Warning: could not start device watcher: {}", e);
        }
    }

    // Background 3s periodic poll for changes (covers iOS devicectl & simctl)
    let app_poll = app.clone();
    std::thread::spawn(move || {
        let mut last_snap: Option<Vec<petak_core::run::DeviceInfo>> = None;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(3));
            let exec = petak_core::exec::SystemExec;
            let current = petak_core::run::devices_snapshot(&exec);
            let changed = match &last_snap {
                Some(prev) => prev != &current.devices,
                None => true,
            };
            if changed {
                last_snap = Some(current.devices.clone());
                let _ = app_poll.emit("devices-changed", &current.devices);
            }
        }
    });
}


#[tauri::command]
pub async fn toolchain_detect(root: String) -> Result<petak_core::run::Toolchain, String> {
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::toolchain::invalidate_effective_path();
        let exec = petak_core::exec::SystemExec;
        let root_trimmed = root.trim();
        let root_path = if root_trimmed.is_empty() {
            std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
        } else {
            std::path::PathBuf::from(root_trimmed)
        };
        Ok(petak_core::run::detect(&root_path, &exec))
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn toolchain_get_config() -> Result<petak_core::toolchain::ToolchainConfig, String> {
    Ok(petak_core::toolchain::load_config())
}


#[tauri::command]
pub async fn toolchain_save_config(config: petak_core::toolchain::ToolchainConfig) -> Result<(), String> {
    petak_core::toolchain::save_config(&config).map_err(|e| e.to_string())?;
    petak_core::toolchain::invalidate_effective_path();
    Ok(())
}


#[tauri::command]
pub async fn devices_list(
    app: tauri::AppHandle,
    state: tauri::State<'_, RunState>,
) -> Result<Vec<petak_core::run::Device>, String> {
    ensure_device_watcher(&app, &state);

    let cached = state
        .inner
        .cached_devices
        .lock()
        .map(|c| c.clone())
        .unwrap_or_default();

    if !cached.is_empty() {
        return Ok(cached);
    }

    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let adb = petak_core::run::resolve_adb_binary();
        if let Ok(out) = exec.run(std::path::Path::new("."), &adb, &["devices", "-l"], &[], None) {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                return petak_core::run::parse_adb_devices(&stdout);
            }
        }
        Vec::new()
    })
    .await
    .map_err(|e| e.to_string())
}


#[tauri::command]
pub async fn devices_watch(
    app: tauri::AppHandle,
    state: tauri::State<'_, RunState>,
) -> Result<(), String> {
    ensure_device_watcher(&app, &state);
    if let Ok(cached) = state.inner.cached_devices.lock() {
        if !cached.is_empty() {
            let _ = app.emit("devices-changed", cached.clone());
        }
    }
    Ok(())
}


#[tauri::command]
pub async fn devices_refresh(
    app: tauri::AppHandle,
    state: tauri::State<'_, RunState>,
) -> Result<Vec<petak_core::run::DeviceInfo>, String> {
    ensure_device_watcher(&app, &state);

    let devs = tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let snap = petak_core::run::devices_snapshot(&exec);
        snap.devices
    })
    .await
    .map_err(|e| e.to_string())?;

    let _ = app.emit("devices-changed", &devs);
    Ok(devs)
}


#[tauri::command]
pub async fn avd_list() -> Result<Vec<petak_core::run::Avd>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        Ok(petak_core::run::list_avds(&exec))
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn emulator_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, RunState>,
    avd: String,
    headless: Option<bool>,
) -> Result<(), String> {
    let is_headless = headless.unwrap_or(true);
    avd_start(app, state, avd, None, None, Some(is_headless)).await
}


#[tauri::command]
pub async fn run_configs_load(root: String) -> Result<petak_core::run::RunConfigFile, String> {
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::run::load_run_config(std::path::Path::new(&root))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn run_configs_save(
    root: String,
    file: petak_core::run::RunConfigFile,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::run::save_run_config(std::path::Path::new(&root), &file)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEventPayload {
    pub run_id: u32,
    pub event: petak_core::run::RunEvent,
}


#[tauri::command]
pub async fn run_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, RunState>,
    root: String,
    config: petak_core::run::RunConfig,
    device_id: String,
) -> Result<u32, String> {
    let run_id = state
        .inner
        .next_run_id
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst);

    let (event_tx, event_rx) = std::sync::mpsc::channel();
    let app_handle = app.clone();

    std::thread::spawn(move || {
        while let Ok(event) = event_rx.recv() {
            let _ = app_handle.emit(
                "run-event",
                RunEventPayload {
                    run_id,
                    event,
                },
            );
        }
    });

    match config.kind {
        petak_core::run::RunKind::Flutter => {
            let check_dev_id = device_id.clone();
            let runnable_id = tauri::async_runtime::spawn_blocking(move || {
                let exec = petak_core::exec::SystemExec;
                let snapshot = petak_core::run::devices_snapshot(&exec);
                let runnable = petak_core::run::check_device_runnable(&snapshot, &check_dev_id)?;
                Ok::<String, String>(runnable.flutter_id.clone().unwrap_or(check_dev_id))
            })
            .await
            .map_err(|e| e.to_string())??;

            let spawn = petak_core::exec::SystemSpawn;
            let root_path = std::path::PathBuf::from(&root);
            let dev_id = runnable_id;
            let cfg = config.clone();

            let flutter_run = tauri::async_runtime::spawn_blocking(move || {
                petak_core::run::FlutterRun::start(&spawn, &root_path, &cfg, &dev_id, event_tx)
                    .map_err(|e| e.to_string())
            })
            .await
            .map_err(|e| e.to_string())??;

            if let Ok(mut runs) = state.inner.runs.lock() {
                runs.insert(
                    run_id,
                    ActiveRun::Flutter(std::sync::Arc::new(Mutex::new(flutter_run))),
                );
            }
            Ok(run_id)
        }
        petak_core::run::RunKind::Gradle => {
            let root_path = std::path::PathBuf::from(&root);
            let module = config.module.clone().unwrap_or_else(|| ":app".to_string());
            let variant = config.variant.clone().unwrap_or_else(|| "debug".to_string());
            let dev_id = device_id.clone();

            let resolved_app_id = config
                .application_id
                .clone()
                .or_else(|| petak_core::run::find_application_id(&root_path));
            let resolved_activity = config
                .activity
                .clone()
                .or_else(|| petak_core::run::find_launcher_activity(&root_path));

            if let Ok(mut runs) = state.inner.runs.lock() {
                runs.insert(
                    run_id,
                    ActiveRun::Gradle {
                        device_id: dev_id.clone(),
                        app_id: resolved_app_id.clone(),
                        proc: None,
                    },
                );
            }

            std::thread::spawn(move || {
                let spawn = petak_core::exec::SystemSpawn;
                let exec = petak_core::exec::SystemExec;

                let _ = event_tx.send(petak_core::run::RunEvent::State {
                    state: petak_core::run::AppState::Installing,
                });

                match petak_core::run::install(&spawn, &root_path, &module, &variant, event_tx.clone()) {
                    Ok(()) => {
                        let _ = event_tx.send(petak_core::run::RunEvent::Output {
                            stream: petak_core::run::OutputStream::Stdout,
                            line: "Gradle install finished. Launching activity...".to_string(),
                        });

                        match petak_core::run::launch(
                            &exec,
                            &dev_id,
                            resolved_app_id.as_deref(),
                            resolved_activity.as_deref(),
                            Some(&root_path),
                        ) {
                            Ok(()) => {
                                let pid = resolved_app_id
                                    .as_deref()
                                    .and_then(|id| petak_core::run::pidof(&exec, &dev_id, id).ok().flatten());

                                let _ = event_tx.send(petak_core::run::RunEvent::AppStarted {
                                    app_id: resolved_app_id.clone(),
                                    devtools_uri: None,
                                    vm_service_uri: None,
                                    pid,
                                });

                                let _ = event_tx.send(petak_core::run::RunEvent::State {
                                    state: petak_core::run::AppState::Running,
                                });
                            }
                            Err(e) => {
                                let _ = event_tx.send(petak_core::run::RunEvent::Output {
                                    stream: petak_core::run::OutputStream::Stderr,
                                    line: format!("Failed to launch Android activity: {}", e),
                                });
                                let _ = event_tx.send(petak_core::run::RunEvent::Stopped {
                                    code: Some(1),
                                });
                            }
                        }
                    }
                    Err(e) => {
                        let _ = event_tx.send(petak_core::run::RunEvent::Output {
                            stream: petak_core::run::OutputStream::Stderr,
                            line: format!("Gradle install failed: {}", e),
                        });
                        let _ = event_tx.send(petak_core::run::RunEvent::Stopped {
                            code: Some(1),
                        });
                    }
                }
            });

            Ok(run_id)
        }
    }
}


#[tauri::command]
pub async fn run_reload(
    state: tauri::State<'_, RunState>,
    run_id: u32,
    full: bool,
) -> Result<petak_core::run::ReloadResult, String> {
    let run_handle = {
        let guard = state.inner.runs.lock().map_err(|e| e.to_string())?;
        match guard.get(&run_id) {
            Some(ActiveRun::Flutter(fr)) => fr.clone(),
            Some(ActiveRun::Gradle { .. }) => {
                return Err("Hot reload is only supported for Flutter applications".to_string());
            }
            None => return Err(format!("Run session {} not found", run_id)),
        }
    };

    tauri::async_runtime::spawn_blocking(move || {
        let mut flutter = run_handle.lock().map_err(|e| e.to_string())?;
        flutter.reload(full).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn run_stop(
    state: tauri::State<'_, RunState>,
    run_id: u32,
) -> Result<(), String> {
    let run_opt = {
        let mut guard = state.inner.runs.lock().map_err(|e| e.to_string())?;
        guard.remove(&run_id)
    };

    if let Some(run) = run_opt {
        match run {
            ActiveRun::Flutter(fr) => {
                tauri::async_runtime::spawn_blocking(move || {
                    let mut flutter = fr.lock().map_err(|e| e.to_string())?;
                    flutter.stop().map_err(|e| e.to_string())
                })
                .await
                .map_err(|e| e.to_string())??;
            }
            ActiveRun::Gradle { proc, device_id, app_id } => {
                tauri::async_runtime::spawn_blocking(move || {
                    if let Some(p) = proc {
                        if let Ok(mut pr) = p.lock() {
                            let _ = pr.kill();
                        }
                    }
                    if let Some(aid) = app_id {
                        let adb = petak_core::run::resolve_adb_binary();
                        let mut c = std::process::Command::new(&adb);
                        petak_core::toolchain::apply_env(&mut c);
                        let _ = c.args(["-s", &device_id, "shell", "am", "force-stop", &aid])
                            .status();
                    }
                    Ok::<(), String>(())
                })
                .await
                .map_err(|e| e.to_string())??;
            }
        }
    }
    Ok(())
}


#[tauri::command]
pub async fn run_hot_restart(
    state: tauri::State<'_, RunState>,
    run_id: u32,
) -> Result<petak_core::run::ReloadResult, String> {
    run_reload(state, run_id, true).await
}


#[tauri::command]
pub async fn run_restart_connection(
    app: tauri::AppHandle,
    state: tauri::State<'_, RunState>,
) -> Result<(), String> {
    if let Ok(mut guard) = state.inner.device_watcher.lock() {
        if let Some(mut proc) = guard.take() {
            let _ = proc.kill();
        }
    }
    ensure_device_watcher(&app, &state);
    let _ = devices_refresh(app, state).await;
    Ok(())
}


#[tauri::command]
pub async fn run_restart_daemon(
    app: tauri::AppHandle,
    state: tauri::State<'_, RunState>,
    run_id: Option<u32>,
) -> Result<(), String> {
    let runs_to_stop: Vec<(u32, ActiveRun)> = {
        let mut guard = state.inner.runs.lock().map_err(|e| e.to_string())?;
        if let Some(id) = run_id {
            guard.remove(&id).map(|r| vec![(id, r)]).unwrap_or_default()
        } else {
            guard.drain().collect()
        }
    };

    for (id, run) in runs_to_stop {
        match run {
            ActiveRun::Flutter(fr) => {
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    if let Ok(mut flutter) = fr.lock() {
                        let _ = flutter.stop();
                    }
                })
                .await;
            }
            ActiveRun::Gradle { proc, device_id, app_id } => {
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    if let Some(p) = proc {
                        if let Ok(mut pr) = p.lock() {
                            let _ = pr.kill();
                        }
                    }
                    if let Some(aid) = app_id {
                        let adb = petak_core::run::resolve_adb_binary();
                        let mut c = std::process::Command::new(&adb);
                        petak_core::toolchain::apply_env(&mut c);
                        let _ = c.args(["-s", &device_id, "shell", "am", "force-stop", &aid])
                            .status();
                    }
                })
                .await;
            }
        }
        let _ = app.emit(
            "run-event",
            RunEventPayload {
                run_id: id,
                event: petak_core::run::RunEvent::Stopped { code: Some(0) },
            },
        );
    }

    run_restart_connection(app, state).await
}


#[tauri::command]
pub async fn logcat_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, RunState>,
    device_id: String,
    app_id: Option<String>,
) -> Result<(), String> {
    {
        let mut lc_guard = state.inner.logcat.lock().map_err(|e| e.to_string())?;
        if let Some(mut existing) = lc_guard.take() {
            let _ = existing.stop();
        }
    }

    let dev_id = device_id.clone();
    let app_handle = app.clone();
    let state_inner = state.inner.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let pid = if let Some(ref aid) = app_id {
            if let Ok(p) = aid.parse::<u32>() {
                Some(p)
            } else if !aid.trim().is_empty() {
                let exec = petak_core::exec::SystemExec;
                let mut resolved = None;
                for _ in 0..5 {
                    if let Ok(Some(p)) = petak_core::run::pidof(&exec, &dev_id, aid) {
                        resolved = Some(p);
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(150));
                }
                resolved
            } else {
                None
            }
        } else {
            None
        };

        let (tx, rx) = std::sync::mpsc::channel::<Vec<petak_core::run::LogLine>>();
        let spawn = petak_core::exec::SystemSpawn;
        let logcat = petak_core::run::Logcat::start(&spawn, &dev_id, pid, tx)
            .map_err(|e| e.to_string())?;

        if let Ok(mut lc_guard) = state_inner.logcat.lock() {
            *lc_guard = Some(logcat);
        }

        std::thread::spawn(move || {
            while let Ok(batch) = rx.recv() {
                let _ = app_handle.emit("logcat-batch", batch);
            }
        });

        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn logcat_stop(state: tauri::State<'_, RunState>) -> Result<(), String> {
    let mut lc_guard = state.inner.logcat.lock().map_err(|e| e.to_string())?;
    if let Some(mut lc) = lc_guard.take() {
        let _ = lc.stop();
    }
    Ok(())
}


#[tauri::command]
pub async fn gradle_sync(root: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        petak_core::run::sync(&exec, std::path::Path::new(&root))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn gradle_status(
    app: tauri::AppHandle,
    root: String,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let running = petak_core::run::gradle_daemon_running(&exec, std::path::Path::new(&root))
            .map_err(|e| e.to_string())?;
        let _ = app.emit("gradle-daemon", serde_json::json!({ "running": running }));
        Ok(running)
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn gradle_stop(
    app: tauri::AppHandle,
    root: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        petak_core::run::gradle_stop(&exec, std::path::Path::new(&root))
            .map_err(|e| e.to_string())?;
        let _ = app.emit("gradle-daemon", serde_json::json!({ "running": false }));
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}


pub fn is_direct_adb_serial(s: &str) -> bool {
    let trimmed = s.trim();
    trimmed.starts_with("emulator-")
        || trimmed.starts_with("usb:")
        || trimmed.starts_with("adb-")
        || trimmed.contains("._adb-tls")
        || trimmed.contains(':')
}


fn append_emulator_log(line: &str) {
    petak_core::run::append_emulator_log(line);
}

// ──────────── Batch 2 commands ────────────


#[tauri::command]
pub async fn devices_snapshot() -> Result<petak_core::run::DevicesSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        Ok(petak_core::run::devices_snapshot(&exec))
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn avd_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, RunState>,
    name: String,
    cold: Option<bool>,
    wipe_data: Option<bool>,
    headless: Option<bool>,
) -> Result<(), String> {
    let _state_inner = state.inner.clone();
    let app_clone = app.clone();
    let avd_name = name.clone();
    let is_cold = cold.unwrap_or(false);
    let is_wipe = wipe_data.unwrap_or(false);

    tauri::async_runtime::spawn_blocking(move || {
        let is_headless = headless.unwrap_or(true);

        append_emulator_log(&format!("Starting AVD '{}' (cold={}, wipe={}, headless={})", avd_name, is_cold, is_wipe, is_headless));

        // 1. Emit booting status
        let _ = app_clone.emit(
            "emulator-status",
            serde_json::json!({
                "id": avd_name,
                "state": "booting"
            }),
        );

        let emu_bin = petak_core::run::resolve_emulator_binary();
        append_emulator_log(&format!("Resolved emulator binary: {}", emu_bin));

        // 2. Spawn detached process
        let mut child = match petak_core::run::spawn_emulator_detached(
            &avd_name,
            is_cold,
            is_wipe,
            is_headless,
        ) {
            Ok(c) => {
                append_emulator_log(&format!("Successfully spawned detached emulator PID: {:?}", c.id()));
                c
            }
            Err(e) => {
                let err_msg = format!("Gagal menjalankan emulator: {}", e);
                append_emulator_log(&format!("Failed to spawn emulator '{}': {}", avd_name, err_msg));
                let _ = app_clone.emit(
                    "emulator-status",
                    serde_json::json!({
                        "id": avd_name,
                        "state": "failed",
                        "error": err_msg
                    }),
                );
                return Err(err_msg);
            }
        };

        // 3. Monitor child stderr and boot status in background thread
        let app_mon = app_clone.clone();
        let mon_avd = avd_name.clone();
        std::thread::spawn(move || {
            use std::io::BufRead;
            let mut stderr_lines: std::collections::VecDeque<String> =
                std::collections::VecDeque::with_capacity(30);
            let mut booted = false;
            let mut found_serial: Option<String> = None;
            let start_time = std::time::Instant::now();

            if let Some(stderr) = child.stderr.take() {
                let reader = std::io::BufReader::new(stderr);
                let (tx_line, rx_line) = std::sync::mpsc::channel();
                std::thread::spawn(move || {
                    for line in reader.lines().flatten() {
                        if tx_line.send(line).is_err() {
                            break;
                        }
                    }
                });

                while start_time.elapsed() < std::time::Duration::from_secs(120) {
                    while let Ok(line) = rx_line.try_recv() {
                        append_emulator_log(&format!("[stderr] {}", line));
                        if stderr_lines.len() >= 30 {
                            stderr_lines.pop_front();
                        }
                        stderr_lines.push_back(line);
                    }

                    // Check if child exited prematurely
                    if let Ok(Some(status)) = child.try_wait() {
                        if !status.success()
                            || start_time.elapsed() < std::time::Duration::from_secs(10)
                        {
                            let collected: Vec<String> = stderr_lines.into_iter().collect();
                            let err_text = if collected.is_empty() { format!("Emulator exited with {}", status) } else { collected.join("\n") };
                            append_emulator_log(&format!("Emulator child exited with failure {}: {}", status, err_text));
                            let _ = app_mon.emit(
                                "emulator-status",
                                serde_json::json!({
                                    "id": mon_avd,
                                    "state": "failed",
                                    "error": err_text
                                }),
                            );
                            return;
                        }
                    }

                    // Poll adb devices to find the emulator serial
                    let adb = petak_core::run::resolve_adb_binary();
                    if let Ok(out) = std::process::Command::new(&adb).args(["devices"]).output() {
                        let text = String::from_utf8_lossy(&out.stdout);
                        for l in text.lines() {
                            let parts: Vec<&str> = l.split_whitespace().collect();
                            if parts.len() >= 2 && parts[0].starts_with("emulator-") && parts[1] == "device" {
                                let serial = parts[0];
                                found_serial = Some(serial.to_string());
                                if let Some(pid) = petak_core::run::get_emulator_pid(&mon_avd) {
                                    petak_core::run::record_emulator_pid(serial, pid);
                                }

                                // Check boot completed
                                if let Ok(boot_out) = std::process::Command::new(&adb)
                                    .args(["-s", serial, "shell", "getprop", "sys.boot_completed"])
                                    .output()
                                {
                                    let val = String::from_utf8_lossy(&boot_out.stdout).trim().to_string();
                                    if val == "1" {
                                        booted = true;
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    if booted {
                        break;
                    }

                    std::thread::sleep(std::time::Duration::from_millis(1500));
                }
            }

            if booted || found_serial.is_some() || start_time.elapsed() >= std::time::Duration::from_secs(15) {
                append_emulator_log(&format!("AVD '{}' is running (serial: {:?})", mon_avd, found_serial));
                let mut status_payload = serde_json::json!({
                    "id": mon_avd,
                    "state": "running"
                });
                let mut ready_payload = serde_json::json!({
                    "id": mon_avd,
                    "kind": "android-avd"
                });
                if let Some(ref ser) = found_serial {
                    if let Some(obj) = status_payload.as_object_mut() {
                        obj.insert("serial".to_string(), serde_json::Value::String(ser.clone()));
                    }
                    if let Some(obj) = ready_payload.as_object_mut() {
                        obj.insert("serial".to_string(), serde_json::Value::String(ser.clone()));
                    }
                }
                let _ = app_mon.emit("emulator-status", status_payload);
                let _ = app_mon.emit("device-ready", ready_payload);
            } else {
                let collected: Vec<String> = stderr_lines.into_iter().collect();
                let err_text = if collected.is_empty() { "Timeout menunggu emulator booting".to_string() } else { collected.join("\n") };
                append_emulator_log(&format!("AVD '{}' failed/timed out: {}", mon_avd, err_text));
                let _ = app_mon.emit(
                    "emulator-status",
                    serde_json::json!({
                        "id": mon_avd,
                        "state": "failed",
                        "error": err_text
                    }),
                );
            }
        });

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn avd_stop(name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        petak_core::run::avd_stop(&exec, &name).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn avd_wipe(name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::run::avd_wipe(&name).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn avd_delete(name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::run::avd_delete(&name).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn sim_boot(app: tauri::AppHandle, udid: String) -> Result<(), String> {
    let app_clone = app.clone();
    let udid_clone = udid.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = app_clone.emit(
            "emulator-status",
            serde_json::json!({
                "id": udid_clone,
                "state": "booting"
            }),
        );
        let exec = petak_core::exec::SystemExec;
        petak_core::run::simctl_boot(&exec, &udid_clone).map_err(|e| e.to_string())?;
        let _ = app_clone.emit(
            "emulator-status",
            serde_json::json!({
                "id": udid_clone,
                "state": "running"
            }),
        );
        let _ = app_clone.emit(
            "device-ready",
            serde_json::json!({
                "id": udid_clone,
                "kind": "ios-sim"
            }),
        );
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn sim_shutdown(app: tauri::AppHandle, udid: String) -> Result<(), String> {
    let app_clone = app.clone();
    let udid_clone = udid.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let res = petak_core::run::simctl_shutdown(&exec, &udid_clone).map_err(|e| e.to_string());
        let _ = app_clone.emit(
            "emulator-status",
            serde_json::json!({
                "id": udid_clone,
                "state": "stopped"
            }),
        );
        res
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn sim_open_app() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::run::open_simulator_app().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn kotlin_ls_status() -> Result<petak_core::toolchain::KotlinLsStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(petak_core::toolchain::kotlin_ls_status())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn kotlin_ls_install(app: tauri::AppHandle) -> Result<(), String> {
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::toolchain::kotlin_ls_install(|stage, percent, message| {
            let _ = app_clone.emit(
                "kotlin-ls-progress",
                serde_json::json!({
                    "stage": stage,
                    "percent": percent,
                    "message": message,
                }),
            );
            let _ = app_clone.emit(
                "kls-install-progress",
                serde_json::json!({
                    "stage": stage,
                    "pct": percent,
                    "message": message,
                    "error": if stage == "error" { Some(message) } else { None },
                }),
            );
        })
    })
    .await
    .map_err(|e| e.to_string())??;

    if let Some(reg) = app.try_state::<AppRegistry>() {
        let _ = reg.restart(Some(petak_core::lsp::Lang::Kotlin));
    }
    Ok(())
}


#[tauri::command]
pub async fn kls_install(app: tauri::AppHandle) -> Result<(), String> {
    kotlin_ls_install(app).await
}


#[tauri::command]
pub async fn adb_pair(host: String, port: u16, code: String) -> Result<String, String> {
    let exec = petak_core::run::ProcessExec;
    match petak_core::run::adb_pair(&exec, &host, port, &code) {
        Ok(res) => {
            if res.success {
                Ok(res.message)
            } else {
                Err(res.message)
            }
        }
        Err(e) => Err(e.to_string()),
    }
}


#[tauri::command]
pub async fn adb_connect(host: String, port: u16) -> Result<String, String> {
    let exec = petak_core::run::ProcessExec;
    petak_core::run::adb_connect(&exec, &host, port).map_err(|e| e.to_string())
}

// ──────────── Batch 12 Wi-Fi QR Pairing mDNS Discovery ────────────


#[tauri::command]
pub async fn adb_find_pairing_service(service_name: String) -> Result<Option<(String, u16)>, String> {
    let exec = petak_core::run::ProcessExec;
    petak_core::run::adb_find_pairing_service(&exec, &service_name).map_err(|e| e.to_string())
}


