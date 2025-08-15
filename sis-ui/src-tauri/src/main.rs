#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use sysinfo::System;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use std::path::{Path, PathBuf};
use std::fs;
use mime_guess;
use tauri::Manager;
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use std::sync::atomic::{AtomicBool, Ordering};
use cfg_if::cfg_if;
use std::process::Command;
use serde::{Serialize, Deserialize};

struct NetworkStats {
    last_received_bytes: u64,
    last_transmitted_bytes: u64,
    last_update_time: Instant,
}

// Global overlay running flag
static OVERLAY_RUNNING: AtomicBool = AtomicBool::new(false);

#[tauri::command]
fn get_system_info(_system: tauri::State<System>, _network_stats: tauri::State<Arc<Mutex<NetworkStats>>>) -> String {
    // Create a fresh snapshot locally to avoid borrowing the managed System stored in state
    let mut sys = sysinfo::System::new_all();
    sys.refresh_all();

    // sysinfo v0.36 uses global_cpu_usage()
    let cpu_usage = sys.global_cpu_usage();
    let mem_usage = if sys.total_memory() > 0 {
        ((sys.used_memory() as f64 / sys.total_memory() as f64) * 100.0) as u64
    } else { 0 };

    // Network speed calculation is environment specific and sysinfo API changed; return 0 for now
    let download_speed = 0u64;
    let upload_speed = 0u64;

    format!("{{\"cpuUsage\":{},\"memUsage\":{},\"downloadSpeed\":{},\"uploadSpeed\":{}}}", cpu_usage, mem_usage, download_speed, upload_speed)
}

#[tauri::command]
fn organize_file(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File does not exist: {}", file_path));
    }

    let mime_type = mime_guess::from_path(path).first_or_octet_stream();
    // Resolve user directories under $HOME with sensible defaults
    let home = dirs::home_dir().ok_or_else(|| "cannot-detect-home".to_string())?;
    let mut target_dir: PathBuf = home.join("Downloads").join("Others"); // Default to Others

    if mime_type.type_() == "image" {
        target_dir = home.join("Pictures");
    } else if mime_type.type_() == "video" {
        target_dir = home.join("Videos");
    } else if mime_type.type_() == "audio" {
        target_dir = home.join("Music");
    } else if mime_type.type_() == "text" || mime_type.subtype() == "pdf" {
        target_dir = home.join("Documents");
    } else if mime_type.type_() == "application" && (mime_type.subtype() == "zip" || mime_type.subtype() == "x-tar" || mime_type.subtype() == "x-rar-compressed") {
        target_dir = home.join("Archives");
    }

    if !target_dir.exists() { fs::create_dir_all(&target_dir).map_err(|e| format!("Failed to create directory {:?}: {}", target_dir, e))?; }

    let file_name = path.file_name().ok_or("Invalid file name")?;
    let dest_path = target_dir.join(file_name);

    fs::rename(path, &dest_path).map_err(|e| format!("Failed to move file from {} to {:?}: {}", file_path, dest_path, e))?;

    Ok(format!("File {} organized to {:?}", file_path, dest_path))
}

#[tauri::command]
fn set_volume(volume: u32) -> Result<String, String> {
    let output = Command::new("pactl")
        .arg("set-sink-volume")
        .arg("@DEFAULT_SINK@")
        .arg(format!("{}%", volume))
        .output();

    match output {
        Ok(output) => {
            if output.status.success() {
                Ok(format!("Volume set to {}%", volume))
            } else {
                Err(format!("Failed to set volume: {}", String::from_utf8_lossy(&output.stderr)))
            }
        }
    Err(e) => Err(format!("Failed to execute pactl: {}", e)),
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AppInfo {
    name: String,
    exec: String,
}

#[tauri::command]
fn get_recent_apps() -> Result<Vec<AppInfo>, String> {
    let mut apps = Vec::new();
    let mut app_dirs: Vec<PathBuf> = vec![
        PathBuf::from("/usr/share/applications"),
        PathBuf::from("/usr/local/share/applications"),
    ];
    if let Some(home) = dirs::home_dir() {
        app_dirs.push(home.join(".local/share/applications"));
    }

    for path in app_dirs.iter() {
        if path.exists() && path.is_dir() {
            for entry in fs::read_dir(path).map_err(|e| format!("Failed to read directory {:?}: {}", path, e))? {
                let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
                let path = entry.path();
                if path.is_file() && path.extension().map_or(false, |ext| ext == "desktop") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        let name = content.lines()
                            .find(|line| line.starts_with("Name="))
                            .and_then(|line| line.strip_prefix("Name="))
                            .unwrap_or("Unknown").to_string();
                        let mut exec = content.lines()
                            .find(|line| line.starts_with("Exec="))
                            .and_then(|line| line.strip_prefix("Exec="))
                            .unwrap_or("").to_string();
                        // Strip desktop entry field codes like %U, %u, %f, %F etc.
                        for code in ["%U", "%u", "%F", "%f", "%i", "%c", "%k"].iter() {
                            exec = exec.replace(code, "");
                        }
                        
                        if !name.is_empty() && !exec.is_empty() {
                            apps.push(AppInfo { name, exec });
                        }
                    }
                }
            }
        }
    }
    Ok(apps)
}

#[tauri::command]
fn get_favorite_apps(_app_handle: tauri::AppHandle) -> Result<Vec<AppInfo>, String> {
    // Use a simple, predictable path under the user's home directory to avoid AppHandle API differences
    let home = dirs::home_dir().ok_or_else(|| "cannot-detect-home".to_string())?;
    let dir = home.join(".local").join("share").join("sis-ui");
    let path = dir.join("favorites.json");
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read favorites.json: {}", e))?;
        let apps: Vec<AppInfo> = serde_json::from_str(&content).map_err(|e| format!("Failed to parse favorites.json: {}", e))?;
        Ok(apps)
    } else {
        Ok(Vec::new())
    }
}

#[tauri::command]
fn add_favorite_app(_app_handle: tauri::AppHandle, app: AppInfo) -> Result<String, String> {
    let home = dirs::home_dir().ok_or_else(|| "cannot-detect-home".to_string())?;
    let dir = home.join(".local").join("share").join("sis-ui");
    if !dir.exists() { fs::create_dir_all(&dir).map_err(|e| format!("Failed to create dir: {}", e))?; }
    let path = dir.join("favorites.json");
    let mut apps = get_favorite_apps(_app_handle).unwrap_or_else(|_| Vec::new());

    if !apps.iter().any(|a| a.name == app.name) {
        apps.push(app);
        let content = serde_json::to_string_pretty(&apps).map_err(|e| format!("Failed to serialize favorites: {}", e))?;
        fs::write(&path, content).map_err(|e| format!("Failed to write favorites.json: {}", e))?;
        Ok("App added to favorites".to_string())
    } else {
        Err("App already in favorites".to_string())
    }
}

#[tauri::command]
fn remove_favorite_app(_app_handle: tauri::AppHandle, app_name: String) -> Result<String, String> {
    let home = dirs::home_dir().ok_or_else(|| "cannot-detect-home".to_string())?;
    let dir = home.join(".local").join("share").join("sis-ui");
    let path = dir.join("favorites.json");
    let mut apps = get_favorite_apps(_app_handle).unwrap_or_else(|_| Vec::new());

    let initial_len = apps.len();
    apps.retain(|app| app.name != app_name);

    if apps.len() < initial_len {
        let content = serde_json::to_string_pretty(&apps).map_err(|e| format!("Failed to serialize favorites: {}", e))?;
        fs::write(&path, content).map_err(|e| format!("Failed to write favorites.json: {}", e))?;
        Ok("App removed from favorites".to_string())
    } else {
        Err("App not found in favorites".to_string())
    }
}

#[tauri::command]
fn take_screenshot() -> Result<String, String> {
    let output = Command::new("gnome-screenshot")
        .arg("--clipboard") // Copy to clipboard
        .output();

    match output {
        Ok(output) => {
            if output.status.success() {
                Ok("Screenshot taken and copied to clipboard".to_string())
            } else {
                Err(format!("Failed to take screenshot: {}", String::from_utf8_lossy(&output.stderr)))
            }
        }
    Err(e) => Err(format!("Failed to execute gnome-screenshot: {}", e)),
    }
}

#[tauri::command]
fn play_pause_music() -> Result<String, String> {
    let output = Command::new("playerctl").arg("play-pause").output();
    match output {
        Ok(output) => {
            if output.status.success() {
                Ok("Music play/pause toggled".to_string())
            } else {
                Err(format!("Failed to toggle play/pause: {}", String::from_utf8_lossy(&output.stderr)))
            }
        }
    Err(e) => Err(format!("Failed to execute playerctl: {}", e)),
    }
}

#[tauri::command]
fn next_track() -> Result<String, String> {
    let output = Command::new("playerctl").arg("next").output();
    match output {
        Ok(output) => {
            if output.status.success() {
                Ok("Next track".to_string())
            } else {
                Err(format!("Failed to go to next track: {}", String::from_utf8_lossy(&output.stderr)))
            }
        }
    Err(e) => Err(format!("Failed to execute playerctl: {}", e)),
    }
}

#[tauri::command]
fn previous_track() -> Result<String, String> {
    let output = Command::new("playerctl").arg("previous").output();
    match output {
        Ok(output) => {
            if output.status.success() {
                Ok("Previous track".to_string())
            } else {
                Err(format!("Failed to go to previous track: {}", String::from_utf8_lossy(&output.stderr)))
            }
        }
        Err(e) => Err(format!("Failed to execute playerctl: {}", e)),
    }
}

#[tauri::command]
fn set_brightness(percent: u32) -> Result<String, String> {
    let clamped = if percent > 100 { 100 } else { percent };
    // Try brightnessctl first
    let out = Command::new("brightnessctl")
        .arg("set")
        .arg(format!("{}%", clamped))
        .output();
    match out {
        Ok(o) => {
            if o.status.success() {
                return Ok(format!("Brightness set to {}%", clamped));
            }
        }
        Err(_) => {}
    }
    // Fallback to xbacklight if available
    let out2 = Command::new("xbacklight")
        .arg("-set")
        .arg(format!("{}", clamped))
        .output();
    match out2 {
        Ok(o) => {
            if o.status.success() { Ok(format!("Brightness set to {}% (xbacklight)", clamped)) } else { Err(String::from_utf8_lossy(&o.stderr).to_string()) }
        }
        Err(e) => Err(format!("Failed to set brightness: {}", e)),
    }
}

#[tauri::command]
fn launch_app(exec: String) -> Result<String, String> {
    if exec.trim().is_empty() {
        return Err("empty-exec".into());
    }
    // Strip desktop entry codes just in case
    let mut cmdline = exec.clone();
    for code in ["%U", "%u", "%F", "%f", "%i", "%c", "%k"].iter() {
        cmdline = cmdline.replace(code, "");
    }
    // Run via shell to support quoted args; spawn and detach
    match Command::new("sh").arg("-c").arg(cmdline).spawn() {
        Ok(_child) => Ok("launched".into()),
        Err(e) => Err(format!("failed-to-launch: {}", e)),
    }
}

fn main() {
    let system = System::new_all();
    let network_stats = Arc::new(Mutex::new(NetworkStats {
        last_received_bytes: 0,
        last_transmitted_bytes: 0,
        last_update_time: Instant::now(),
    }));

    tauri::Builder::default()
        .manage(system)
        .manage(network_stats)
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // get window (webview) in a Tauri-compatible way
            // Prefer get_webview_window (returns Option<Window>), fallback to AppHandle.get_window if present
            let window = app.get_webview_window("main").or_else(|| {
                // attempt to get via handle (use get_webview_window for AppHandle compatibility)
                app.handle().get_webview_window("main")
            });
            let _window = window.expect("main window not found");

            // Tauri v2 global shortcut registration API takes only the shortcut string
            let gs = app.handle().global_shortcut();
            if let Err(e) = gs.register("Super") {
                println!("warning: failed to register global shortcut: {:?}", e);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_system_info,
            organize_file,
            set_volume,
            set_brightness,
            get_recent_apps,
            get_favorite_apps,
            add_favorite_app,
            remove_favorite_app,
            take_screenshot,
            play_pause_music,
            next_track,
            previous_track,
            launch_app,
            overlay_start,
            overlay_stop,
            overlay_status
        ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[tauri::command]
fn overlay_status() -> Result<bool, String> {
    Ok(OVERLAY_RUNNING.load(Ordering::SeqCst))
}

#[tauri::command]
fn overlay_start() -> Result<String, String> {
    if OVERLAY_RUNNING.swap(true, Ordering::SeqCst) {
        return Ok("overlay-already-running".into());
    }

    cfg_if! {
        if #[cfg(feature = "overlay_raylib")] {
            std::thread::spawn(|| {
                use raylib::prelude::*;
                let (mut rl, thread) = raylib::init().size(800, 450).title("SIST Overlay").build();
                rl.set_target_fps(60);
                while OVERLAY_RUNNING.load(Ordering::SeqCst) && !rl.window_should_close() {
                    let mut d = rl.begin_drawing(&thread);
                    d.clear_background(Color::Color { r: 0, g: 0, b: 0, a: 0 });
                    // 半透明の円形HUD仮描画
                    d.draw_circle(400, 225, 120.0, Color::new(255, 255, 255, 28));
                    d.draw_circle_lines(400, 225, 160.0, Color::new(180, 200, 255, 120));
                    d.draw_text("Halo HUD", 330, 212, 20, Color::new(200, 220, 255, 200));
                }
                OVERLAY_RUNNING.store(false, Ordering::SeqCst);
            });
            Ok("overlay-started".into())
        } else {
            OVERLAY_RUNNING.store(false, Ordering::SeqCst);
            Err("overlay feature not enabled. build with --features overlay_raylib".into())
        }
    }
}

#[tauri::command]
fn overlay_stop() -> Result<String, String> {
    OVERLAY_RUNNING.store(false, Ordering::SeqCst);
    Ok("overlay-stopped".into())
}