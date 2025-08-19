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
use std::process::{Command, Stdio};
use serde::{Serialize, Deserialize};
use base64::Engine;

struct NetworkStats {
    last_received_bytes: u64,
    last_transmitted_bytes: u64,
    last_update_time: Instant,
}

// Global overlay running flag
static OVERLAY_RUNNING: AtomicBool = AtomicBool::new(false);

fn read_net_totals() -> (u64, u64) {
    // Sum rx/tx bytes from /proc/net/dev (Linux前提)
    if let Ok(s) = std::fs::read_to_string("/proc/net/dev") {
        let mut rx: u64 = 0;
        let mut tx: u64 = 0;
        for line in s.lines().skip(2) { // skip headers
            if let Some(colon) = line.find(":") {
                let rest = &line[colon + 1..];
                let parts: Vec<&str> = rest.split_whitespace().collect();
                if parts.len() >= 16 {
                    // parts[0]=rx_bytes, parts[8]=tx_bytes
                    if let Ok(v) = parts[0].parse::<u64>() { rx = rx.saturating_add(v); }
                    if let Ok(v) = parts[8].parse::<u64>() { tx = tx.saturating_add(v); }
                }
            }
        }
        return (rx, tx);
    }
    (0, 0)
}

#[tauri::command]
fn get_system_info(_system: tauri::State<System>, network_stats: tauri::State<Arc<Mutex<NetworkStats>>>) -> String {
    // Create a fresh snapshot locally to avoid borrowing the managed System stored in state
    let mut sys = sysinfo::System::new_all();
    sys.refresh_all();

    // sysinfo v0.36 uses global_cpu_usage()
    let cpu_usage = sys.global_cpu_usage();
    let mem_usage = if sys.total_memory() > 0 {
        ((sys.used_memory() as f64 / sys.total_memory() as f64) * 100.0) as u64
    } else { 0 };

    // Network speed: compute delta since last call
    let (rx, tx) = read_net_totals();
    let mut dl_mbps: f64 = 0.0;
    let mut ul_mbps: f64 = 0.0;
    {
        let mut ns = network_stats.lock().unwrap();
        let now = Instant::now();
        let dt = now.duration_since(ns.last_update_time).as_secs_f64();
        if ns.last_update_time != Instant::now() && dt > 0.2 && ns.last_received_bytes > 0 {
            let drx = rx.saturating_sub(ns.last_received_bytes) as f64; // bytes
            let dtx = tx.saturating_sub(ns.last_transmitted_bytes) as f64; // bytes
            dl_mbps = (drx / dt) / (1024.0 * 1024.0);
            ul_mbps = (dtx / dt) / (1024.0 * 1024.0);
        }
        ns.last_received_bytes = rx;
        ns.last_transmitted_bytes = tx;
        ns.last_update_time = now;
    }

    format!("{{\"cpuUsage\":{:.1},\"memUsage\":{},\"downloadSpeed\":{:.2},\"uploadSpeed\":{:.2}}}", cpu_usage, mem_usage, dl_mbps, ul_mbps)
}

#[tauri::command]
fn organize_file(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File does not exist: {}", file_path));
    }
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
fn organize_latest_download() -> Result<String, String> {
    // Find the most recently modified regular file in ~/Downloads and organize it
    let home = dirs::home_dir().ok_or_else(|| "cannot-detect-home".to_string())?;
    let downloads = home.join("Downloads");
    if !downloads.exists() { return Err("Downloads directory not found".into()); }

    let mut latest_path: Option<PathBuf> = None;
    let mut latest_mtime: Option<std::time::SystemTime> = None;

    let entries = fs::read_dir(&downloads).map_err(|e| format!("Failed to read Downloads: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if path.is_file() {
            if let Ok(meta) = entry.metadata() {
                if let Ok(modified) = meta.modified() {
                    match latest_mtime {
                        None => { latest_mtime = Some(modified); latest_path = Some(path); }
                        Some(prev) => if modified > prev { latest_mtime = Some(modified); latest_path = Some(path); }
                    }
                }
            }
        }
    }

    let target = latest_path.ok_or_else(|| "no-files-in-downloads".to_string())?;
    organize_file(target.to_string_lossy().to_string())
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
    icon_data_url: Option<String>,
}

fn parse_localized_name(content: &str) -> String {
    // Prefer Name[ja], then Name[en], then Name
    let mut name: Option<String> = None;
    for key in ["Name[ja]", "Name[en]"] {
        if let Some(line) = content.lines().find(|l| l.starts_with(key)) {
            if let Some(v) = line.splitn(2, '=').nth(1) { return v.trim().to_string(); }
        }
    }
    if let Some(line) = content.lines().find(|l| l.starts_with("Name=")) {
        if let Some(v) = line.splitn(2, '=').nth(1) { name = Some(v.trim().to_string()); }
    }
    name.unwrap_or_else(|| "Unknown".to_string())
}

fn resolve_icon_path(raw: &str) -> Option<std::path::PathBuf> {
    use std::path::PathBuf;
    if raw.trim().is_empty() { return None; }
    let p = Path::new(raw);
    if p.is_absolute() && p.exists() { return Some(p.to_path_buf()); }
    // Try common icon lookup paths
    let mut candidates: Vec<PathBuf> = vec![];
    let exts = ["png", "svg", "xpm"]; // webkit supports png/svg well
    let sizes = ["512x512","256x256","128x128","64x64","48x48","32x32","24x24","16x16"];
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local/share/icons"));
        candidates.push(home.join(".icons"));
    }
    candidates.push(PathBuf::from("/usr/share/icons"));
    candidates.push(PathBuf::from("/usr/share/pixmaps"));
    for base in candidates {
        // hicolor theme typical layout
        for size in &sizes {
            for ext in &exts {
                let p1 = base.join("hicolor").join(size).join("apps").join(format!("{}.{}", raw, ext));
                if p1.exists() { return Some(p1); }
            }
        }
        // flat under theme or pixmaps
        for ext in &exts {
            let p2 = base.join(format!("{}.{}", raw, ext));
            if p2.exists() { return Some(p2); }
        }
        // apps subdir without size
        for ext in &exts {
            let p3 = base.join("apps").join(format!("{}.{}", raw, ext));
            if p3.exists() { return Some(p3); }
        }
    }
    None
}

fn to_data_url(path: &Path) -> Option<String> {
    use std::fs::read;
    match read(path) {
        Ok(bytes) => {
            let mime = if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                match ext.to_ascii_lowercase().as_str() { "svg" => "image/svg+xml", "xpm" => "image/x-xpixmap", _ => "image/png" }
            } else { "image/png" };
            let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
            Some(format!("data:{};base64,{}", mime, b64))
        }
        Err(_) => None,
    }
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
                        let name = parse_localized_name(&content);
                        let mut exec = content.lines()
                            .find(|line| line.starts_with("Exec="))
                            .and_then(|line| line.strip_prefix("Exec="))
                            .unwrap_or("").to_string();
                        let icon_raw = content.lines()
                            .find(|line| line.starts_with("Icon="))
                            .and_then(|line| line.strip_prefix("Icon="))
                            .unwrap_or("").trim().to_string();
                        // Strip desktop entry field codes like %U, %u, %f, %F etc.
                        for code in ["%U", "%u", "%F", "%f", "%i", "%c", "%k"].iter() {
                            exec = exec.replace(code, "");
                        }
                        // Validate first token exists in PATH (basic runnable filter)
                        let mut tokens = exec.split_whitespace();
                        let mut first = tokens.next().unwrap_or("");
                        if first == "env" { first = tokens.next().unwrap_or(first); }
                        if !name.is_empty() && !exec.is_empty() {
                            let base = std::path::Path::new(first).file_name().and_then(|s| s.to_str()).unwrap_or(first);
                            if !base.is_empty() && which(base) {
                                let icon_path = resolve_icon_path(&icon_raw);
                                let icon_data_url = icon_path.as_ref().and_then(|p| to_data_url(p));
                                apps.push(AppInfo { name, exec, icon_data_url });
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(apps)
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct FolderCounts { pictures: u64, documents: u64, videos: u64, downloads: u64, music: u64, others: u64 }

#[tauri::command]
fn get_folder_counts() -> Result<FolderCounts, String> {
    let home = dirs::home_dir().ok_or_else(|| "cannot-detect-home".to_string())?;
    let mut counts = FolderCounts::default();
    let pairs = vec![
        ("pictures", home.join("Pictures")),
        ("documents", home.join("Documents")),
        ("videos", home.join("Videos")),
        ("downloads", home.join("Downloads")),
        ("music", home.join("Music")),
    ];
    for (key, dir) in pairs {
        let mut c = 0u64;
        if dir.exists() {
            if let Ok(read) = fs::read_dir(&dir) {
                for e in read.flatten() { if e.path().is_file() { c += 1; } }
            }
        }
        match key {
            "pictures" => counts.pictures = c,
            "documents" => counts.documents = c,
            "videos" => counts.videos = c,
            "downloads" => counts.downloads = c,
            "music" => counts.music = c,
            _ => {}
        }
    }
    // Others = files in ~/Downloads that don't fit simple mime categories (approx) → here use leftover count heuristic
    counts.others = 0;
    Ok(counts)
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
            organize_latest_download,
            set_brightness,
            get_recent_apps,
            get_folder_counts,
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
            overlay_status,
            // Newly added commands to expose via invoke
            network_set,
            bluetooth_set,
            power_action,
            llm_query,
            run_safe_command,
            run_with_sudo,
            clamav_scan,
            kdeconnect_list
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

#[tauri::command]
fn network_set(enable: bool) -> Result<String, String> {
    let cmd = if enable { "nmcli" } else { "nmcli" };
    let arg = if enable { vec!["networking", "on"] } else { vec!["networking", "off"] };
    let mut c = Command::new(cmd);
    for a in arg { c.arg(a); }
    match c.output() {
        Ok(o) => if o.status.success() { Ok(format!("networking {}", if enable { "on" } else { "off" })) } else { Err(String::from_utf8_lossy(&o.stderr).to_string()) },
        Err(e) => Err(format!("failed-to-run-nmcli: {}", e)),
    }
}

#[tauri::command]
fn bluetooth_set(enable: bool) -> Result<String, String> {
    // Try rfkill/block as a simple fallback
    let action = if enable { "unblock" } else { "block" };
    match Command::new("rfkill").arg(action).arg("bluetooth").output() {
        Ok(o) => if o.status.success() { Ok(format!("bluetooth {}", action)) } else { Err(String::from_utf8_lossy(&o.stderr).to_string()) },
        Err(e) => Err(format!("failed-to-run-rfkill: {}", e)),
    }
}

#[tauri::command]
fn power_action(action: String) -> Result<String, String> {
    // action: shutdown | reboot | logout
    match action.as_str() {
        "shutdown" => match Command::new("systemctl").arg("poweroff").spawn() { Ok(_) => Ok("shutting-down".into()), Err(e) => Err(format!("failed-to-shutdown: {}", e)) },
        "reboot" => match Command::new("systemctl").arg("reboot").spawn() { Ok(_) => Ok("rebooting".into()), Err(e) => Err(format!("failed-to-reboot: {}", e)) },
        "logout" => match Command::new("pkill").arg("-KILL").arg("-u").arg(std::env::var("USER").unwrap_or_else(|_| "".into())).spawn() { Ok(_) => Ok("logging-out".into()), Err(e) => Err(format!("failed-to-logout: {}", e)) },
        other => Err(format!("unsupported-action: {}", other)),
    }
}

#[tauri::command]
fn llm_query(prompt: String) -> Result<String, String> {
    // Expect model at ./LLM/gemma-3-12b-it-Q4_K_M.gguf and a local runner binary at ./LLM/llama_server
    let model = PathBuf::from("LLM/gemma-3-12b-it-Q4_K_M.gguf");
    if !model.exists() {
        return Err("model-not-found: place gemma-3-12b-it-Q4_K_M.gguf in ./LLM".into());
    }
    let runner = PathBuf::from("LLM/llama_server");
    if !runner.exists() {
        return Err("llama_server-not-found: put a compatible local runner binary at ./LLM/llama_server".into());
    }
    match Command::new(runner).arg("--model").arg(model).arg("--prompt").arg(prompt).output() {
        Ok(o) => {
            if o.status.success() { Ok(String::from_utf8_lossy(&o.stdout).to_string()) }
            else { Err(format!("llm-error: {}", String::from_utf8_lossy(&o.stderr))) }
        }
        Err(e) => Err(format!("failed-to-start-llm-runner: {}", e)),
    }
}

fn which(cmd: &str) -> bool {
    Command::new("sh")
        .arg("-c")
        .arg(format!("command -v {} >/dev/null 2>&1", cmd))
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[tauri::command]
fn run_safe_command(cmdline: String) -> Result<String, String> {
    let trimmed = cmdline.trim();
    if trimmed.is_empty() { return Err("empty-cmd".into()); }
    // allowlist simple guard
    let first = trimmed.split_whitespace().next().unwrap_or("");
    let base = Path::new(first).file_name().and_then(|s| s.to_str()).unwrap_or(first);
    let allow = [
        "xdg-open","ls","cp","mv","mkdir","tar","zip","unzip",
        "playerctl","pactl","brightnessctl","nmcli","rfkill","gnome-screenshot",
        "kdeconnect-cli","clamscan","echo"
    ];
    if !allow.contains(&base) { return Err(format!("command-not-allowed: {}", base)); }
    if trimmed.contains(" rm ") || trimmed.starts_with("rm ") || trimmed.contains(" sudo ") {
        return Err("unsafe-command-rejected".into());
    }
    match Command::new("sh").arg("-c").arg(trimmed).output() {
        Ok(o) => {
            if o.status.success() { Ok(String::from_utf8_lossy(&o.stdout).to_string()) }
            else { Err(String::from_utf8_lossy(&o.stderr).to_string()) }
        }
        Err(e) => Err(format!("failed-to-run: {}", e))
    }
}

#[tauri::command]
fn clamav_scan(path: String) -> Result<String, String> {
    if !which("clamscan") { return Err("clamscan-not-found".into()); }
    match Command::new("clamscan").arg("-i").arg("-r").arg(&path).output() {
        Ok(o) => Ok(String::from_utf8_lossy(&o.stdout).to_string()),
        Err(e) => Err(format!("failed-to-run-clamscan: {}", e)),
    }
}

#[tauri::command]
fn kdeconnect_list() -> Result<String, String> {
    if !which("kdeconnect-cli") { return Err("kdeconnect-cli-not-found".into()); }
    match Command::new("kdeconnect-cli").arg("--list-devices").output() {
        Ok(o) => Ok(String::from_utf8_lossy(&o.stdout).to_string()),
        Err(e) => Err(format!("failed-to-run-kdeconnect: {}", e)),
    }
}

#[tauri::command]
fn run_with_sudo(cmdline: String, password: String) -> Result<String, String> {
    // Very small wrapper to run a single command with sudo by providing the password via stdin.
    // Note: This is convenient but has security implications; prefer polkit or proper privilege separation in production.
    let trimmed = cmdline.trim();
    if trimmed.is_empty() { return Err("empty-cmd".into()); }

    // Build sudo -S -p '' sh -c '<cmdline>' so sudo reads password from stdin without prompt text
    let mut child = match Command::new("sh")
        .arg("-c")
        .arg(format!("sudo -S -p '' {}", trimmed))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => return Err(format!("failed-to-spawn-sudo: {}", e)),
    };

    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        // write password + newline
        if let Err(e) = stdin.write_all(format!("{}\n", password).as_bytes()) {
            return Err(format!("failed-to-write-password: {}", e));
        }
    }

    match child.wait_with_output() {
        Ok(out) => {
            if out.status.success() {
                Ok(String::from_utf8_lossy(&out.stdout).to_string())
            } else {
                Err(String::from_utf8_lossy(&out.stderr).to_string())
            }
        }
        Err(e) => Err(format!("failed-waiting-for-sudo: {}", e)),
    }
}