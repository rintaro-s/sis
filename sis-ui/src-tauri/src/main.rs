#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri::Manager;

use sysinfo::System;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use std::path::{Path, PathBuf};
use std::fs;
use mime_guess;
use tauri::Emitter;
use std::sync::atomic::{AtomicBool, Ordering};
use cfg_if::cfg_if;
use std::process::{Command, Stdio};
use serde::{Serialize, Deserialize};
use base64::Engine;
use serde_json;
use std::collections::{HashSet, HashMap};
use serde_json::json;
use std::env;
use std::io::Write as _;
use std::io::Read as _;
use once_cell::sync::Lazy;
use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
use regex;
// Use crate root re-exports for size/position types

// Best-effort: on X11 sessions misconfigured to 800x600, bump primary output to the largest available mode
fn adjust_x11_resolution_if_tiny() {
    // Only on X11 and if xrandr is available
    let is_x11 = std::env::var("WAYLAND_DISPLAY").is_err() && std::env::var("DISPLAY").is_ok();
    if !is_x11 { return; }
    if !which("xrandr") { return; }

    let xr = match run_out("sh", &["-lc", "xrandr -q 2>/dev/null"]) {
        Some(s) => s,
        None => return,
    };

    // Find primary (or first connected) output, its current mode, and the largest candidate mode
    let mut chosen_output: Option<String> = None;
    let mut current_w: i32 = 0;
    let mut current_h: i32 = 0;
    let mut best_w: i32 = 0;
    let mut best_h: i32 = 0;
    let mut in_current_block = false;

    for line in xr.lines() {
        let l = line.trim_end();
        // Output header line example:
        // eDP-1 connected primary 1920x1200+0+0 ...
        // HDMI-1 connected 1024x768+0+0 ...
        if !l.starts_with(' ') {
            in_current_block = false;
            if l.contains(" connected") {
                // pick primary when present; otherwise first connected
                let is_primary = l.contains(" primary ") || l.ends_with(" primary");
                let name = l.split_whitespace().next().unwrap_or("").to_string();
                if chosen_output.is_none() || is_primary {
                    chosen_output = Some(name);
                    // parse current WxH from header (before '+')
                    if let Some((pre, _)) = l.split_once('+') {
                        if let Some((w, h)) = pre.split_whitespace().last().and_then(|tok| tok.split_once('x')) {
                            current_w = w.parse::<i32>().unwrap_or(0);
                            current_h = h.parse::<i32>().unwrap_or(0);
                        }
                    }
                    // reset best for this block; we'll scan indented mode lines next
                    best_w = current_w.max(0);
                    best_h = current_h.max(0);
                    in_current_block = true;
                }
            }
            continue;
        }
        if !in_current_block { continue; }
        // Mode lines are indented and start with e.g. "  1920x1080 60.00*+ 59.94"
        let t = l.trim_start();
        if let Some(tok) = t.split_whitespace().next() {
            if let Some((w, h)) = tok.split_once('x') {
                if let (Ok(wi), Ok(hi)) = (w.parse::<i32>(), h.parse::<i32>()) {
                    // pick the largest area; tie-breaker by width
                    let area = wi.saturating_mul(hi);
                    let best_area = best_w.saturating_mul(best_h);
                    if area > best_area || (area == best_area && wi > best_w) {
                        best_w = wi;
                        best_h = hi;
                    }
                }
            }
        }
    }

    // If the current is tiny (<= 1024x768) and we found a larger mode, switch it
    if let Some(out_name) = chosen_output {
        let cur_area = current_w.saturating_mul(current_h);
        let best_area = best_w.saturating_mul(best_h);
        let is_tiny = current_w <= 1024 && current_h <= 768;
        let is_improvement = best_area > cur_area && best_w >= 1024 && best_h >= 768;
        if is_tiny && is_improvement {
            let cmd = format!("xrandr --output {} --mode {}x{}", out_name, best_w, best_h);
            log_append("INFO", &format!("x11 tiny screen detected ({}x{}); switching via: {}", current_w, current_h, cmd));
            let _ = std::process::Command::new("sh").arg("-lc").arg(&cmd).status();
            // Give WM a moment to recompute workarea
            std::thread::sleep(std::time::Duration::from_millis(300));
        } else {
            log_append("INFO", &format!("x11 screen size ok ({}x{}), best candidate ({}x{})", current_w, current_h, best_w, best_h));
        }
    }
}

struct NetworkStats {
    last_received_bytes: u64,
    last_transmitted_bytes: u64,
    last_update_time: Instant,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct WindowInfo {
    id: String,
    wclass: String,
    title: String,
    icon_data_url: Option<String>,
}

// Global overlay running flag
static OVERLAY_RUNNING: AtomicBool = AtomicBool::new(false);

// Global WM_CLASS to AppInfo mapping cache
static WM_CLASS_CACHE: Lazy<Mutex<HashMap<String, AppInfo>>> = Lazy::new(|| Mutex::new(HashMap::new()));

fn build_wmclass_cache() {
    let mut cache = WM_CLASS_CACHE.lock().unwrap();
    cache.clear();
    
    let app_dirs = build_app_dirs();
    for path in app_dirs.iter() {
        if path.exists() && path.is_dir() {
            if let Ok(read) = fs::read_dir(path) {
                for entry in read.flatten() {
                    let p = entry.path();
                    if p.is_file() && p.extension().map_or(false, |e| e=="desktop") {
                        if let Ok(content) = fs::read_to_string(&p) {
                            if desktop_hidden_or_settings(&content) { continue; }
                            let (name, exec, icon_raw, swm) = parse_desktop_fields(&content);
                            if name.is_empty() || exec.is_empty() || !validate_exec(&exec) { continue; }
                            
                            let icon_path = resolve_icon_path(&icon_raw);
                            let icon_data_url = icon_path.as_ref().and_then(|p| to_data_url(p));
                            let app_info = AppInfo { name: name.clone(), exec, icon_data_url };
                            
                            // Cache by multiple keys
                            if !swm.is_empty() {
                                let swm_l = swm.to_lowercase();
                                cache.insert(swm_l.clone(), app_info.clone());
                                // Also cache parts
                                let parts: Vec<&str> = swm_l.split('.').collect();
                                if parts.len() > 1 {
                                    cache.insert(parts[0].to_string(), app_info.clone());
                                    cache.insert(parts[parts.len()-1].to_string(), app_info.clone());
                                }
                            }
                            
                            // Cache by exec basename
                            let exec_base = app_info.exec.split_whitespace().next().unwrap_or("");
                            let exec_bn = std::path::Path::new(exec_base).file_name()
                                .and_then(|s| s.to_str()).unwrap_or(exec_base).to_lowercase();
                            if !exec_bn.is_empty() {
                                cache.insert(exec_bn, app_info.clone());
                            }
                            
                            // Cache by name (lowercase)
                            cache.insert(name.to_lowercase(), app_info);
                        }
                    }
                }
            }
        }
    }
}

fn run_out(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd).args(args).output().ok()?;
    if !out.status.success() { return None; }
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

fn parse_xprop_numbers(s: &str) -> Vec<u64> {
    let mut nums = Vec::new();
    for token in s.split(|c: char| c == ',' || c.is_whitespace()) {
        let t = token.trim();
        if t.is_empty() { continue; }
        if let Some(hex) = t.strip_prefix("0x") {
            if let Ok(v) = u64::from_str_radix(hex, 16) { nums.push(v); }
        } else if let Ok(v) = t.parse::<u64>() {
            nums.push(v);
        }
    }
    nums
}

fn net_wm_icon_png_data_url(window_id: &str) -> Option<String> {
    if !which("xprop") { return None; }
    let raw = run_out("xprop", &["-id", window_id, "_NET_WM_ICON"])?;
    if !raw.contains("_NET_WM_ICON") { return None; }
    let nums = parse_xprop_numbers(&raw);
    if nums.len() < 3 { return None; }
    // Parse sequences of [w,h, w*h pixels...]; choose the largest
    let mut i = 0usize;
    let mut best: Option<(u32,u32,Vec<u8>)> = None;
    while i + 2 < nums.len() {
        let w = nums[i] as usize; let h = nums[i+1] as usize; i += 2;
        if w == 0 || h == 0 { break; }
        let need = w.saturating_mul(h);
        if i + need > nums.len() { break; }
        // convert ARGB -> RGBA
        let mut rgba = Vec::with_capacity(need*4);
        for j in 0..need {
            let v = nums[i + j] as u32;
            let a = ((v >> 24) & 0xFF) as u8;
            let r = ((v >> 16) & 0xFF) as u8;
            let g = ((v >> 8) & 0xFF) as u8;
            let b = (v & 0xFF) as u8;
            rgba.extend_from_slice(&[r,g,b,a]);
        }
        i += need;
        let is_better = match &best { Some((bw,bh,_)) => (w*h) > ((*bw as usize)*(*bh as usize)), None => true };
        if is_better {
            best = Some((w as u32, h as u32, rgba));
        }
    }
    let (w, h, rgba) = best?;
    let buf: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_vec(w, h, rgba)?;
    let img = DynamicImage::ImageRgba8(buf);
    let png_bytes: Vec<u8> = {
        let mut cursor = std::io::Cursor::new(Vec::<u8>::new());
        if img.write_to(&mut cursor, ImageFormat::Png).is_err() { return None; }
        cursor.into_inner()
    };
    log_append("INFO", &format!("net_wm_icon: window={} size={}x{} bytes={}", window_id, w, h, png_bytes.len()));
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
    Some(format!("data:image/png;base64,{}", b64))
}

fn xprop_window_pid(window_id: &str) -> Option<u32> {
    if !which("xprop") { return None; }
    let raw = run_out("xprop", &["-id", window_id, "_NET_WM_PID"])?;
    for line in raw.lines() {
        if let Some(rest) = line.split('=').nth(1) {
            if let Ok(v) = rest.trim().parse::<u32>() { return Some(v); }
        }
    }
    None
}

fn xprop_window_wm_class(window_id: &str) -> Option<String> {
    if !which("xprop") { return None; }
    let raw = run_out("xprop", &["-id", window_id, "WM_CLASS"]) ?;
    // Example: WM_CLASS(STRING) = "code", "Code"
    for line in raw.lines() {
        if let Some(rest) = line.split('=').nth(1) {
            let s = rest.trim();
            // take first token inside quotes before comma
            // e.g. "code", "Code" -> code.Code
            let parts: Vec<&str> = s.split(',').collect();
            if !parts.is_empty() {
                let left = parts[0].trim().trim_matches('"');
                let right = if parts.len() > 1 { parts[1].trim().trim_matches('"') } else { "" };
                let combined = if !right.is_empty() { format!("{}.{}", left, right) } else { left.to_string() };
                if !combined.is_empty() { return Some(combined); }
            }
        }
    }
    None
}

fn read_proc_comm(pid: u32) -> Option<String> {
    let p = format!("/proc/{}/comm", pid);
    std::fs::read_to_string(p).ok().map(|s| s.trim().to_string())
}

fn read_proc_environ(pid: u32) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let path = format!("/proc/{}/environ", pid);
    if let Ok(mut f) = fs::File::open(&path) {
        let mut bytes = Vec::new();
        if f.read_to_end(&mut bytes).is_ok() {
            for chunk in bytes.split(|b| *b == 0u8) {
                if let Some(eq) = chunk.iter().position(|b| *b == b'=') {
                    let k = String::from_utf8_lossy(&chunk[..eq]).to_string();
                    let v = String::from_utf8_lossy(&chunk[eq+1..]).to_string();
                    if !k.is_empty() { map.insert(k, v); }
                }
            }
        }
    }
    map
}

fn search_snap_desktop_icon(prefix: &str) -> Option<std::path::PathBuf> {
    use std::fs;
    let dir = std::path::Path::new("/var/lib/snapd/desktop/icons");
    if !dir.exists() { return None; }
    if let Ok(read) = fs::read_dir(dir) {
        for e in read.flatten() {
            let p = e.path();
            if let Some(name) = p.file_name().and_then(|s| s.to_str()) {
                let lname = name.to_lowercase();
                if (lname.starts_with(&prefix.to_lowercase())) && (lname.ends_with(".png") || lname.ends_with(".svg")) {
                    if p.exists() { return Some(p); }
                }
            }
        }
    }
    None
}

fn find_desktop_by_prefix(dir: &Path, prefix: &str) -> Option<PathBuf> {
    if !dir.exists() { return None; }
    if let Ok(read) = fs::read_dir(dir) {
        for e in read.flatten() {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) == Some("desktop") {
                if let Some(name) = p.file_name().and_then(|s| s.to_str()) {
                    if name.to_lowercase().starts_with(&prefix.to_lowercase()) { return Some(p); }
                }
            }
        }
    }
    None
}

fn icon_from_desktop_file(path: &Path) -> Option<PathBuf> {
    if !path.exists() { return None; }
    if let Ok(content) = fs::read_to_string(path) {
        if let Some(icon_raw) = content.lines().find(|l| l.starts_with("Icon=")).and_then(|l| l.splitn(2,'=').nth(1)) {
            let icon_raw = icon_raw.trim();
            if let Some(p) = resolve_icon_path(icon_raw) { return Some(p); }
            // snap desktop icons fallback dir
            for ext in ["png","svg"] {
                let p = PathBuf::from("/var/lib/snapd/desktop/icons").join(format!("{}.{}", icon_raw, ext));
                if p.exists() { return Some(p); }
            }
        }
    }
    None
}

fn read_proc_exe(pid: u32) -> Option<PathBuf> {
    let p = format!("/proc/{}/exe", pid);
    fs::read_link(p).ok()
}

fn try_snap_icon_from_env(envs: &HashMap<String,String>) -> Option<PathBuf> {
    let snap_name = envs.get("SNAP_NAME").or_else(|| envs.get("SNAP_INSTANCE_NAME")).cloned();
    let snap = snap_name?;
    // Try desktop entry under snapd applications
    let apps_dir = PathBuf::from("/var/lib/snapd/desktop/applications");
    if apps_dir.exists() {
        if let Ok(read) = fs::read_dir(&apps_dir) {
            for e in read.flatten() {
                let p = e.path();
                if p.extension().and_then(|s| s.to_str()) == Some("desktop") {
                    let fname = p.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
                    if fname.starts_with(&format!("{}_", snap)) || fname.starts_with(&format!("{}.", snap)) || fname.starts_with(&snap) {
                        if let Ok(content) = fs::read_to_string(&p) {
                            if let Some(icon_raw) = content.lines().find(|l| l.starts_with("Icon=")).and_then(|l| l.splitn(2,'=').nth(1)) {
                                let icon_raw = icon_raw.trim();
                                if let Some(pp) = resolve_icon_path(icon_raw) { return Some(pp); }
                            }
                        }
                    }
                }
            }
        }
    }
    // Try meta/gui under mounted snap path
    if let Some(snap_mnt) = envs.get("SNAP") {
        let base = PathBuf::from(snap_mnt).join("meta").join("gui");
        for name in [format!("{}.png", snap), format!("{}.svg", snap), "icon.png".into(), "icon.svg".into()] {
            let p = base.join(&name);
            if p.exists() { return Some(p); }
        }
    }
    None
}

fn try_flatpak_icon_from_env(envs: &HashMap<String,String>) -> Option<PathBuf> {
    if let Some(id) = envs.get("FLATPAK_ID") {
        if let Some(p) = resolve_icon_path(id) { return Some(p); }
    }
    None
}

fn try_appimage_icon_for_exe(exe: &Path) -> Option<PathBuf> {
    let p = exe;
    if p.extension().and_then(|s| s.to_str()).map(|s| s.eq_ignore_ascii_case("AppImage")).unwrap_or(false) {
        let png = p.with_extension("png");
        if png.exists() { return Some(png); }
        let svg = p.with_extension("svg");
        if svg.exists() { return Some(svg); }
    }
    None
}

fn fallback_icon_from_pid(pid: u32) -> Option<String> {
    let envs = read_proc_environ(pid);
    if let Some(p) = try_snap_icon_from_env(&envs) { log_append("INFO", &format!("icon from snap env: pid={} path={}", pid, p.to_string_lossy())); return to_data_url(&p); }
    if let Some(p) = try_flatpak_icon_from_env(&envs) { log_append("INFO", &format!("icon from flatpak env: pid={} path={}", pid, p.to_string_lossy())); return to_data_url(&p); }
    if let Some(exe) = read_proc_exe(pid) {
        if let Some(p) = try_appimage_icon_for_exe(&exe) { log_append("INFO", &format!("icon from AppImage: pid={} path={}", pid, p.to_string_lossy())); return to_data_url(&p); }
        if let Some(name) = exe.file_name().and_then(|s| s.to_str()) {
            if let Some(p) = resolve_icon_path(name) { log_append("INFO", &format!("icon from exec name: pid={} name={} path={}", pid, name, p.to_string_lossy())); return to_data_url(&p); }
            if let Some((stem, _)) = name.rsplit_once('.') {
                if let Some(p) = resolve_icon_path(stem) { log_append("INFO", &format!("icon from exec stem: pid={} stem={} path={}", pid, stem, p.to_string_lossy())); return to_data_url(&p); }
            }
        }
    }
    None
}

fn guess_icon_candidates(wclass: &str, title: &str, exe: Option<&std::path::Path>, comm: Option<&str>) -> Vec<String> {
    use std::collections::HashSet;
    let wl = wclass.to_lowercase();
    let tl = title.to_lowercase();
    let mut set: HashSet<String> = HashSet::new();
    let mut add = |s: &str| { if !s.is_empty() { set.insert(s.to_string()); }};

    // Tokenize WM_CLASS like "evince.Evince" or "gnome-terminal-server.Gnome-terminal"
    for part in wl.split(|c: char| c == '.' || c == ' ' || c == '-' || c == '_') {
        if part.len() >= 3 { add(part); }
    }

    // Exec/comm basenames
    if let Some(p) = exe { if let Some(name) = p.file_name().and_then(|s| s.to_str()) { add(&name.to_lowercase()); add(name); }}
    if let Some(c) = comm { add(&c.to_lowercase()); add(c); }

    // Browsers
    if tl.contains("vivaldi") { add("vivaldi"); }
    if tl.contains("firefox") || wl.contains("firefox") { add("firefox"); }
    if tl.contains("chromium") { add("chromium"); }
    if tl.contains("google chrome") || wl.contains("chrome") { add("google-chrome"); add("chrome"); }

    // Editors/IDE
    if tl.contains("visual studio code") || wl.contains("code") { add("code"); add("visual-studio-code"); }

    // Calculator (日本語: 電卓)
    if tl.contains("電卓") || tl.contains("calculator") { add("gnome-calculator"); add("calculator"); }

    // PDF viewers
    if tl.ends_with(".pdf") || wl.contains("evince") || tl.contains("evince") {
        add("org.gnome.Evince"); add("evince"); add("document-viewer");
    }
    if wl.contains("atril") || tl.contains("atril") { add("atril"); add("org.mate.atril"); }
    if wl.contains("xreader") || tl.contains("xreader") { add("xreader"); }
    if wl.contains("okular") || tl.contains("okular") { add("okular"); }

    // Terminals
    let is_terminal_title = tl.contains("terminal") || tl.contains(": ~") || (tl.contains("@") && tl.contains(": "));
    if is_terminal_title || wl.contains("terminal") {
        add("org.gnome.Terminal"); add("gnome-terminal"); add("utilities-terminal"); add("terminal");
        add("xfce4-terminal"); add("konsole"); add("kitty"); add("Alacritty"); add("alacritty");
    }

    // LM Studio
    if wl.contains("lm") && wl.contains("studio") || tl.contains("lm studio") { add("lm-studio"); add("lmstudio"); }

    // Generic fallbacks
    add("application-x-executable");
    add("application-default-icon");
    add("applications-system");

    // Return in insertion order approximation
    set.into_iter().collect()
}

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

#[derive(Debug, Serialize, Deserialize, Clone)]
struct LaunchHistoryEntry {
    name: String,
    exec: String,
    icon_data_url: Option<String>,
    last_launched: Option<u64>, // epoch seconds
}

fn history_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".local").join("share").join("sis-ui"))
}

fn history_path() -> Option<PathBuf> {
    history_dir().map(|d| d.join("launch_history.json"))
}

fn read_launch_history() -> Vec<LaunchHistoryEntry> {
    if let Some(p) = history_path() {
        if p.exists() {
            if let Ok(s) = fs::read_to_string(p) {
                if let Ok(v) = serde_json::from_str::<Vec<LaunchHistoryEntry>>(&s) {
                    return v;
                }
            }
        }
    }
    Vec::new()
}

fn write_launch_history(mut entries: Vec<LaunchHistoryEntry>) {
    if let Some(dir) = history_dir() {
        let _ = fs::create_dir_all(&dir);
        if let Some(path) = history_path() {
            // keep up to 200 recent unique entries
            if entries.len() > 200 { entries.truncate(200); }
            if let Ok(s) = serde_json::to_string_pretty(&entries) {
                let _ = fs::write(path, s);
            }
        }
    }
}

fn record_launch_from_exec(exec: &str, name_hint: Option<&str>, icon_data_url: Option<String>) {
    let mut entries = read_launch_history();
    let key = exec.trim().to_string();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs());
    // de-dup by exec
    entries.retain(|e| e.exec != key);
    let name = name_hint.map(|s| s.to_string()).unwrap_or_else(|| {
        std::path::Path::new(&key)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&key)
            .to_string()
    });
    entries.insert(0, LaunchHistoryEntry{ name, exec: key, icon_data_url, last_launched: now});
    write_launch_history(entries);
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
    if let Some(n) = name { return n }
    // fallback: GenericName or Comment
    for key in ["GenericName[ja]","GenericName[en]","GenericName","Comment[ja]","Comment[en]","Comment"] {
        if let Some(line) = content.lines().find(|l| l.starts_with(key)) {
            if let Some(v) = line.splitn(2, '=').nth(1) { return v.trim().to_string(); }
        }
    }
    "Unknown".to_string()
}

fn resolve_icon_path(raw: &str) -> Option<std::path::PathBuf> {
    use std::path::PathBuf;
    if raw.trim().is_empty() { return None; }
    let p = Path::new(raw);
    if p.is_absolute() && p.exists() { return Some(p.to_path_buf()); }
    let exts = ["png", "svg", "xpm"]; // webkit supports png/svg well
    let sizes = ["512x512","256x256","128x128","64x64","48x48","32x32","24x24","16x16"];
    let themes = ["hicolor","Papirus","Adwaita","Yaru","Numix","Humanity"];

    // Build search roots
    let mut roots: Vec<PathBuf> = vec![];
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".local/share/icons"));
        roots.push(home.join(".icons"));
        roots.push(home.join(".local/share/flatpak/exports/share/icons"));
    }
    roots.push(PathBuf::from("/usr/share/icons"));
    roots.push(PathBuf::from("/usr/share/pixmaps"));
    roots.push(PathBuf::from("/var/lib/flatpak/exports/share/icons"));
    roots.push(PathBuf::from("/var/lib/snapd/desktop/icons"));
    // Add theme roots explicitly
    for theme in themes.iter() {
        if let Some(home) = dirs::home_dir() {
            roots.push(home.join(format!(".icons/{theme}")));
            roots.push(home.join(format!(".local/share/icons/{theme}")));
        }
        roots.push(PathBuf::from(format!("/usr/share/icons/{theme}")));
    }

    for base in roots {
        // If base looks like a theme root (ends with a known theme), search sizes and scalable
        let is_theme_root = base.file_name().and_then(|s| s.to_str()).map(|s| themes.contains(&s)).unwrap_or(false);
        if is_theme_root {
            // sized icons
            for size in &sizes {
                for ext in &exts {
                    let p1 = base.join(size).join("apps").join(format!("{}.{}", raw, ext));
                    if p1.exists() { return Some(p1); }
                }
            }
            // scalable svg
            let psvg = base.join("scalable").join("apps").join(format!("{}.svg", raw));
            if psvg.exists() { return Some(psvg); }
            // theme/apps flat
            for ext in &exts {
                let p3 = base.join("apps").join(format!("{}.{}", raw, ext));
                if p3.exists() { return Some(p3); }
            }
        } else {
            // generic base: try each theme under it
            for theme in themes.iter() {
                let troot = base.join(theme);
                for size in &sizes {
                    for ext in &exts {
                        let p1 = troot.join(size).join("apps").join(format!("{}.{}", raw, ext));
                        if p1.exists() { return Some(p1); }
                    }
                }
                let psvg = troot.join("scalable").join("apps").join(format!("{}.svg", raw));
                if psvg.exists() { return Some(psvg); }
                for ext in &exts {
                    let p3 = troot.join("apps").join(format!("{}.{}", raw, ext));
                    if p3.exists() { return Some(p3); }
                }
            }
            // also try flat files in generic base
            for ext in &exts {
                let p2 = base.join(format!("{}.{}", raw, ext));
                if p2.exists() { return Some(p2); }
            }
            // and apps subdir without theme
            for ext in &exts {
                let p3 = base.join("apps").join(format!("{}.{}", raw, ext));
                if p3.exists() { return Some(p3); }
            }
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
    // XDG_DATA_HOME (default ~/.local/share)
    if let Ok(xdg_home) = std::env::var("XDG_DATA_HOME") {
        app_dirs.push(PathBuf::from(xdg_home).join("applications"));
    } else if let Some(home) = dirs::home_dir() { app_dirs.push(home.join(".local/share/applications")); }
    // XDG_DATA_DIRS (colon separated)
    if let Ok(xdg_dirs) = std::env::var("XDG_DATA_DIRS") {
        for d in xdg_dirs.split(':') { if !d.is_empty() { app_dirs.push(PathBuf::from(d).join("applications")); } }
    } else {
        app_dirs.push(PathBuf::from("/usr/local/share/applications"));
        app_dirs.push(PathBuf::from("/usr/share/applications"));
    }
    if let Some(home) = dirs::home_dir() {
        app_dirs.push(home.join(".local/share/flatpak/exports/share/applications"));
        app_dirs.push(home.join(".local/share/applications/wine"));
        app_dirs.push(home.join(".local/share/applications/steam"));
    }
    app_dirs.push(PathBuf::from("/var/lib/flatpak/exports/share/applications"));
    app_dirs.push(PathBuf::from("/var/lib/snapd/desktop/applications"));

    for path in app_dirs.iter() {
        if !(path.exists() && path.is_dir()) { continue; }
        let read = match fs::read_dir(path) { Ok(r) => r, Err(e) => { log_append("WARN", &format!("skip dir {:?}: {}", path, e)); continue; } };
        for entry in read {
            let entry = match entry { Ok(e) => e, Err(e) => { log_append("WARN", &format!("skip entry err: {}", e)); continue; } };
            let path = entry.path();
            if !(path.is_file() && path.extension().map_or(false, |ext| ext == "desktop")) { continue; }
            let content = match fs::read_to_string(&path) { Ok(s) => s, Err(e) => { log_append("WARN", &format!("read desktop failed {:?}: {}", path, e)); continue; } };
            if desktop_hidden_or_settings(&content) { continue; }
            let name = parse_localized_name(&content);
            let mut exec = content.lines()
                .find(|line| line.starts_with("Exec="))
                .and_then(|line| line.strip_prefix("Exec=")).unwrap_or("").to_string();
            let icon_raw = content.lines()
                .find(|line| line.starts_with("Icon="))
                .and_then(|line| line.strip_prefix("Icon=")).unwrap_or("").trim().to_string();
            for code in ["%U","%u","%F","%f","%i","%c","%k"].iter() { exec = exec.replace(code, ""); }
            if name.is_empty() || exec.is_empty() { continue; }
            // 緩める: validate_exec に失敗しても候補として掲載（起動は失敗する可能性あり）
            let icon_path = resolve_icon_path(&icon_raw);
            let icon_data_url = icon_path.as_ref().and_then(|p| to_data_url(p));
            apps.push(AppInfo { name, exec, icon_data_url });
        }
    }
    // Merge AppImage candidates from common folders
    if let Some(home) = dirs::home_dir() {
        let mut extra = scan_appimages(&[home.join("Applications"), home.join("Downloads")]);
        merge_apps(&mut apps, &mut extra);
    }
    // Merge launch history (includes once-opened AppImage etc.)
    let mut hist = read_launch_history()
        .into_iter()
        .filter_map(|e| {
            let exec_first = e.exec.split_whitespace().next().unwrap_or("").to_string();
            // include only if executable still exists or command is resolvable
            let p = Path::new(&exec_first);
            if p.is_absolute() && p.exists() { Some(AppInfo { name: e.name, exec: e.exec, icon_data_url: e.icon_data_url }) }
            else if which(&exec_first) { Some(AppInfo { name: e.name, exec: e.exec, icon_data_url: e.icon_data_url }) }
            else { None }
        })
        .collect::<Vec<_>>();
    merge_apps(&mut apps, &mut hist);
    if apps.is_empty() {
        log_append("WARN", "get_recent_apps: empty after scan; fallback to snap list");
        // very small fallback: snap desktop names via shell (best effort)
        if let Some(home) = dirs::home_dir() { let _ = home; }
    }
    Ok(apps)
}

fn icon_from_wmclass_shortcut(wclass: &str, title: &str) -> Option<String> {
    let wl = wclass.to_lowercase();
    let tl = title.to_lowercase();
    // Evince (PDF viewer)
    if wl.contains("evince") || tl.ends_with(".pdf") {
        if let Some(p) = resolve_icon_path("org.gnome.Evince") { log_append("INFO", &format!("wmclass shortcut: Evince -> {}", p.to_string_lossy())); return to_data_url(&p); }
        if let Some(p) = resolve_icon_path("evince") { log_append("INFO", &format!("wmclass shortcut: evince -> {}", p.to_string_lossy())); return to_data_url(&p); }
    }
    // GNOME Terminal
    if wl.contains("gnome-terminal") || tl.contains("terminal") {
        if let Some(p) = resolve_icon_path("org.gnome.Terminal") { log_append("INFO", &format!("wmclass shortcut: Terminal -> {}", p.to_string_lossy())); return to_data_url(&p); }
        if let Some(p) = resolve_icon_path("gnome-terminal") { log_append("INFO", &format!("wmclass shortcut: gnome-terminal -> {}", p.to_string_lossy())); return to_data_url(&p); }
        if let Some(p) = resolve_icon_path("utilities-terminal") { log_append("INFO", &format!("wmclass shortcut: utilities-terminal -> {}", p.to_string_lossy())); return to_data_url(&p); }
    }
    // Vivaldi (snap)
    if wl.contains("vivaldi") {
        // try snap desktop files
        let dir = Path::new("/var/lib/snapd/desktop/applications");
        if let Some(desktop) = find_desktop_by_prefix(dir, "vivaldi_") {
            if let Some(p) = icon_from_desktop_file(&desktop) { log_append("INFO", &format!("wmclass shortcut: vivaldi desktop icon -> {}", p.to_string_lossy())); return to_data_url(&p); }
        }
        // direct icon search by name
        if let Some(p) = search_snap_desktop_icon("vivaldi") { log_append("INFO", &format!("wmclass shortcut: vivaldi snap icon -> {}", p.to_string_lossy())); return to_data_url(&p); }
        if let Some(p) = resolve_icon_path("vivaldi") { log_append("INFO", &format!("wmclass shortcut: vivaldi -> {}", p.to_string_lossy())); return to_data_url(&p); }
    }
    None
}

fn merge_apps(dst: &mut Vec<AppInfo>, src: &mut Vec<AppInfo>) {
    let mut seen: HashSet<String> = dst.iter().map(|a| a.exec.clone()).collect();
    for a in src.drain(..) {
        if !seen.contains(&a.exec) {
            seen.insert(a.exec.clone());
            dst.push(a);
        }
    }
}

fn scan_appimages(dirs: &[PathBuf]) -> Vec<AppInfo> {
    let mut out = Vec::new();
    for d in dirs {
        if d.exists() && d.is_dir() {
            if let Ok(read) = fs::read_dir(d) {
                for e in read.flatten() {
                    let p = e.path();
                    if let Some(ext) = p.extension().and_then(|s| s.to_str()) {
                        if ext.eq_ignore_ascii_case("AppImage") {
                            let name = p.file_stem().and_then(|s| s.to_str()).unwrap_or("AppImage").to_string();
                            let exec = p.to_string_lossy().to_string();
                            // Try sibling icon (name.png/svg)
                            let icon = p.with_extension("png");
                            let icon_data_url = if icon.exists() { to_data_url(&icon) } else { None };
                            out.push(AppInfo { name, exec, icon_data_url });
                        }
                    }
                }
            }
        }
    }
    out
}

fn build_app_dirs() -> Vec<PathBuf> {
    let mut app_dirs: Vec<PathBuf> = vec![
        PathBuf::from("/usr/share/applications"),
        PathBuf::from("/usr/local/share/applications"),
    ];
    if let Ok(xdg_home) = std::env::var("XDG_DATA_HOME") {
        app_dirs.push(PathBuf::from(xdg_home).join("applications"));
    } else if let Some(home) = dirs::home_dir() {
        app_dirs.push(home.join(".local/share/applications"));
    }
    if let Ok(xdg_dirs) = std::env::var("XDG_DATA_DIRS") {
        for d in xdg_dirs.split(':') { if !d.is_empty() { app_dirs.push(PathBuf::from(d).join("applications")); }}
    } else {
        app_dirs.push(PathBuf::from("/usr/local/share/applications"));
        app_dirs.push(PathBuf::from("/usr/share/applications"));
    }
    if let Some(home) = dirs::home_dir() {
        app_dirs.push(home.join(".local/share/flatpak/exports/share/applications"));
        app_dirs.push(home.join(".local/share/applications/wine"));
        app_dirs.push(home.join(".local/share/applications/steam"));
    }
    app_dirs.push(PathBuf::from("/var/lib/flatpak/exports/share/applications"));
    app_dirs.push(PathBuf::from("/var/lib/snapd/desktop/applications"));
    app_dirs
}

fn parse_desktop_fields(content: &str) -> (String, String, String, String) {
    // returns (name, exec, icon_raw, startup_wmclass)
    let name = parse_localized_name(content);
    let mut exec = content.lines()
        .find(|line| line.starts_with("Exec="))
        .and_then(|line| line.strip_prefix("Exec=")).unwrap_or("").to_string();
    for code in ["%U","%u","%F","%f","%i","%c","%k"].iter() { exec = exec.replace(code, ""); }
    let icon_raw = content.lines().find(|l| l.starts_with("Icon=")).and_then(|l| l.splitn(2,'=').nth(1)).unwrap_or("").trim().to_string();
    let swm = content.lines().find(|l| l.starts_with("StartupWMClass=")).and_then(|l| l.splitn(2,'=').nth(1)).unwrap_or("").trim().to_string();
    (name, exec, icon_raw, swm)
}

fn desktop_hidden_or_settings(content: &str) -> bool {
    let hidden = content.lines().any(|l| l.trim() == "Hidden=true") || content.lines().any(|l| l.trim() == "NoDisplay=true");
    if hidden { return true; }
    if content.lines().any(|l| l.starts_with("X-GNOME-Settings-Panel")) { return true; }
    if content.lines().any(|l| l.starts_with("Exec=gnome-control-center")) { return true; }
    if content.lines().any(|l| l.starts_with("Exec=xfce4-settings-manager")) && content.contains("--dialog") { return true; }
    // Default-hide some system tools: Document Viewer, Startup Disk Creator, NVIDIA Settings, GNOME System Monitor, Workspace
    let name = parse_localized_name(content).to_lowercase();
    let exec = content.lines().find(|l| l.starts_with("Exec=")).and_then(|l| l.strip_prefix("Exec=")).unwrap_or("").to_lowercase();
    let deny_names = [
        "document viewer", "ドキュメントビューア", "startup disk creator",
        "nvidia x server settings", "nvidia settings", "system monitor",
        "workspace", "workspaces", "ワークスペース"
    ];
    if deny_names.iter().any(|k| name.contains(k)) { return true; }
    let deny_exec = ["gnome-system-monitor", "nvidia-settings", "usb-creator-gtk", "usb-creator-kde"];
    if deny_exec.iter().any(|k| exec.contains(k)) { return true; }
    false
}

fn normalize_wclass(wc: &str) -> (String, String, String) {
    let lower = wc.to_lowercase();
    let parts = lower.split('.');
    let first = parts.clone().next().unwrap_or("").to_string();
    let last = parts.last().unwrap_or("").to_string();
    (lower, first, last)
}

fn validate_exec(exec: &str) -> bool {
    // Extract plausible executable token from Exec line
    fn extract_exec_token(s: &str) -> Option<String> {
        let mut tokens = s.split_whitespace().peekable();
        let mut last_was_dash_c = false;
        while let Some(tok) = tokens.next() {
            let t = tok.trim_matches(['"', '\'', ' '].as_ref());
            if t.is_empty() { continue; }
            if t == "env" || t == "sh" || t == "bash" || t == "zsh" || t == "flatpak" { continue; }
            if t.starts_with('-') { last_was_dash_c = t == "-c" || t == "-lc"; continue; }
            if t.contains('=') { continue; } // environment assignment
            let mut candidate = t.to_string();
            if last_was_dash_c {
                // token may be a quoted command string; take the first word inside
                if let Some(space) = candidate.find(' ') { candidate.truncate(space); }
                candidate = candidate.trim_matches(['"', '\'', ' '].as_ref()).to_string();
            }
            if !candidate.is_empty() { return Some(candidate); }
        }
        None
    }
    if let Some(first) = extract_exec_token(exec) {
        let base = std::path::Path::new(&first).file_name().and_then(|s| s.to_str()).unwrap_or(&first);
        if base.is_empty() { return false; }
        which(base) || (Path::new(&first).is_absolute() && Path::new(&first).exists())
    } else { false }
}

fn match_desktop_to_window(wclass: &str, title: &str) -> Option<AppInfo> {
    let cache = WM_CLASS_CACHE.lock().unwrap();
    let (wcl, wcf, wclast) = normalize_wclass(wclass);
    
    // Try exact matches first
    if let Some(app) = cache.get(&wcl) { return Some(app.clone()); }
    if let Some(app) = cache.get(&wcf) { return Some(app.clone()); }
    if let Some(app) = cache.get(&wclast) { return Some(app.clone()); }
    
    // Try partial matches by title
    let title_l = title.to_lowercase();
    for (key, app) in cache.iter() {
        if title_l.contains(key) || key.contains(&title_l) {
            return Some(app.clone());
        }
    }
    
    None
}

#[tauri::command]
fn file_to_data_url(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !p.exists() { return Err("file-not-found".into()); }
    
    // Check if it's an image file
    let mime = mime_guess::from_path(&p).first_or_octet_stream();
    if mime.type_() != "image" {
        return Err("not-an-image".into());
    }
    
    match std::fs::read(&p) {
        Ok(bytes) => {
            let mime_str = mime.to_string();
            let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
            Ok(format!("data:{};base64,{}", mime_str, b64))
        }
        Err(e) => Err(format!("read-error: {}", e))
    }
}

#[tauri::command]
fn resolve_window_app(wclass: String, title: String) -> Result<AppInfo, String> {
    match match_desktop_to_window(&wclass, &title) { Some(app) => Ok(app), None => Err("not-found".into()) }
}

#[tauri::command]
fn resolve_window_icon(window_id: String, wclass: String, title: String) -> Result<AppInfo, String> {
    log_append("INFO", &format!("resolve_window_icon: id={} wclass={} title={}", window_id, wclass, title));
    // 1) Try cache-based .desktop matching first
    if let Some(app) = match_desktop_to_window(&wclass, &title) {
        if app.icon_data_url.is_some() { log_append("INFO", "cache hit with icon"); return Ok(app); }
    }
    // 2) Try _NET_WM_ICON directly
    if let Some(data_url) = net_wm_icon_png_data_url(&window_id) {
        let name = if !title.trim().is_empty() { title.clone() } else { wclass.clone() };
        log_append("INFO", "_NET_WM_ICON extracted");
        return Ok(AppInfo { name, exec: "".into(), icon_data_url: Some(data_url) });
    } else { log_append("INFO", "_NET_WM_ICON not present or parse failed"); }
    // 2a) Quick WM_CLASS-based shortcuts for common apps
    if let Some(data_url) = icon_from_wmclass_shortcut(&wclass, &title) {
        let name = if !title.trim().is_empty() { title.clone() } else { wclass.clone() };
        return Ok(AppInfo { name, exec: "".into(), icon_data_url: Some(data_url) });
    }
    // 3) Try PID -> process mapping -> icon
    if let Some(pid) = xprop_window_pid(&window_id) {
        if let Some(data_url) = fallback_icon_from_pid(pid) {
            let name = if !title.trim().is_empty() { title.clone() } else { wclass.clone() };
            let exec = read_proc_exe(pid).map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
            log_append("INFO", &format!("pid fallback icon resolved: pid={} exec={}", pid, exec));
            return Ok(AppInfo { name, exec, icon_data_url: Some(data_url) });
        }
        // 4) Heuristic guesses based on wmclass/title/exe/comm
        let exe = read_proc_exe(pid);
        let comm = read_proc_comm(pid);
        let candidates = guess_icon_candidates(&wclass, &title, exe.as_deref(), comm.as_deref());
        log_append("INFO", &format!("heuristic candidates: pid={} count={} first={} wclass={} title={}", pid, candidates.len(), candidates.get(0).cloned().unwrap_or_default(), wclass, title));
        for icon_name in candidates {
            log_append("INFO", &format!("heuristic try: pid={} name={}", pid, icon_name));
            if let Some(p) = resolve_icon_path(&icon_name) {
                if let Some(data) = to_data_url(&p) {
                    log_append("INFO", &format!("heuristic icon: pid={} name={} path={}", pid, icon_name, p.to_string_lossy()));
                    let exec = exe.as_ref().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
                    return Ok(AppInfo { name: title.clone(), exec, icon_data_url: Some(data) });
                }
            } else {
                log_append("INFO", &format!("heuristic miss: pid={} name={}", pid, icon_name));
            }
        }
    }
    // 5) Final heuristics without PID (e.g., when env lookup fails): use WM_CLASS/title only
    let candidates = guess_icon_candidates(&wclass, &title, None, None);
    log_append("INFO", &format!("heuristic candidates (no pid): count={} first={} wclass={} title={}", candidates.len(), candidates.get(0).cloned().unwrap_or_default(), wclass, title));
    for icon_name in candidates {
        log_append("INFO", &format!("heuristic try (no pid): name={}", icon_name));
        if let Some(p) = resolve_icon_path(&icon_name) {
            if let Some(data) = to_data_url(&p) {
                log_append("INFO", &format!("heuristic icon (no pid): name={} path={}", icon_name, p.to_string_lossy()));
                let name = if !title.trim().is_empty() { title.clone() } else { wclass.clone() };
                return Ok(AppInfo { name, exec: "".into(), icon_data_url: Some(data) });
            }
        }
    }
    log_append("WARN", "resolve_window_icon: not found");
    Err("not-found".into())
}

#[tauri::command]
fn get_open_windows_with_icons() -> Result<Vec<WindowInfo>, String> {
    // Collect windows via wmctrl and resolve icons server-side so logs show resolution path
    log_append("INFO", "get_open_windows_with_icons: start");
    let text = match run_out("sh", &["-lc", "wmctrl -lx 2>/dev/null"]) {
        Some(s) => s,
        None => { log_append("WARN", "get_open_windows_with_icons: wmctrl returned none"); return Ok(Vec::new()) },
    };
    let mut out: Vec<WindowInfo> = Vec::new();
    for line in text.lines() {
        // Format: ID DESKTOP HOSTNAME WM_CLASS TITLE
        // We match first token as id, then take next two tokens, then one token for wclass, rest as title
        let re = regex::Regex::new(r"^(\S+)\s+\S+\s+\S+\s+(\S+)\s+(.*)$").unwrap();
        if let Some(caps) = re.captures(line) {
            let id = caps.get(1).unwrap().as_str().to_string();
            let mut wclass = caps.get(2).unwrap().as_str().to_string();
            let title = caps.get(3).unwrap().as_str().trim().to_string();
            if title.is_empty() { continue; }
            // Improve WM_CLASS accuracy via xprop
            if let Some(xw) = xprop_window_wm_class(&id) {
                log_append("INFO", &format!("xprop WM_CLASS: id={} wm_class={}", id, xw));
                wclass = xw;
            }
            // Exclude SIS-owned windows from listing (avoid showing in Dock/app list)
            let wcl_l = wclass.to_lowercase();
            let ttl_l = title.to_lowercase();
            if ttl_l.contains("sis desktop") || ttl_l.contains("sis dock") || ttl_l.contains("sis sidebar") || ttl_l.contains("sis topbar") || ttl_l.contains("sis settings") {
                continue;
            }
            if wcl_l.contains("sis") {
                continue;
            }
            let mut icon: Option<String> = None;
            match resolve_window_icon(id.clone(), wclass.clone(), title.clone()) {
                Ok(app) => { icon = app.icon_data_url; log_append("INFO", &format!("get_open_windows_with_icons: icon ok id={} title={} has_icon={}", id, title, icon.is_some())); }
                Err(e) => { log_append("WARN", &format!("get_open_windows_with_icons: resolve failed id={} title={} err={}", id, title, e)); }
            }
            out.push(WindowInfo { id, wclass, title, icon_data_url: icon });
        }
    }
    log_append("INFO", &format!("get_open_windows_with_icons: done items={}", out.len()));
    Ok(out)
}

#[tauri::command]
fn record_launch_guess(exec: String, name: String, icon_data_url: Option<String>) -> Result<String, String> {
    if exec.trim().is_empty() || name.trim().is_empty() { return Err("invalid-args".into()); }
    record_launch_from_exec(&exec, Some(&name), icon_data_url);
    Ok("recorded".into())
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
    match Command::new("sh").arg("-c").arg(&cmdline).spawn() {
        Ok(_child) => {
            // best-effort: record into launch history
            let name_hint = std::path::Path::new(cmdline.split_whitespace().next().unwrap_or("")).file_stem().and_then(|s| s.to_str());
            record_launch_from_exec(&exec, name_hint, None);
            Ok("launched".into())
        },
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

    let mut builder = tauri::Builder::default();
    builder
        .manage(system)
        .manage(network_stats)
    .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // When a second instance is launched with flags, route to running instance
            let has_toggle_palette = argv.iter().any(|a| a == "--toggle-palette");
            let has_toggle_terminal = argv.iter().any(|a| a == "--toggle-terminal");
            if has_toggle_terminal { let _ = app.emit("sis:toggle-builtin-terminal", "toggle"); }
            else if has_toggle_palette { let _ = app.emit("super_key_pressed", "toggle"); }
            else { let _ = app.emit("super_key_pressed", "toggle"); }
        }))
        .setup(|app| {
            // 1) （早期）X11の誤設定解像度を修正
            adjust_x11_resolution_if_tiny();

            // 2) ウィンドウ生成（セーフモード対応）
            use tauri::{WebviewUrl, WebviewWindowBuilder};
            let args: Vec<String> = std::env::args().collect();
            let safe_mode = std::env::var("SIS_SAFE_MODE").ok().as_deref()==Some("1") || args.iter().any(|a| a=="--safe-mode");
            let url = WebviewUrl::App("/".into());
            if safe_mode {
                // 単一ウィンドウフルスクリーン（最小構成で確実に可視化）
                if app.get_webview_window("main").is_none() {
                    let _ = WebviewWindowBuilder::new(app, "main", url.clone())
                        .title("SIS UI")
                        .decorations(false)
                        .resizable(true)
                        .min_inner_size(1.0, 1.0)
                        .max_inner_size(100000.0, 100000.0)
                        .fullscreen(true)
                        .skip_taskbar(true)
                        .build();
                }
            } else {
                // マルチウィンドウ（Desktop/TopBar/Dock/Sidebar）。未生成なら生成。
                // 画面サイズの取得（X11）
                let read_wh = || -> (u32, u32) {
                    if let Some(out) = run_out("sh", &["-lc", "xdpyinfo 2>/dev/null | awk '/dimensions:/ {print $2}'"]) {
                        if let Some((w,h)) = out.split_once('x') {
                            if let (Ok(ww), Ok(hh)) = (w.trim().parse::<u32>(), h.trim().parse::<u32>()) { if ww>0 && hh>0 { return (ww, hh); }}
                        }
                    }
                    if let Some(out) = run_out("sh", &["-lc", "xrandr 2>/dev/null | awk '/current/ {for(i=1;i<=NF;i++){if($i==\"current\"){print $(i+1)\"x\"$(i+3); exit}}}'"]) {
                        if let Some((w,h)) = out.split_once('x') {
                            if let (Ok(ww), Ok(hh)) = (w.trim().parse::<u32>(), h.trim().parse::<u32>()) { if ww>0 && hh>0 { return (ww, hh); }}
                        }
                    }
                    (1920, 1080)
                };
                let (W, H) = read_wh();
                // Xorgかどうか（Wayland未検出かつDISPLAYがある）
                let is_x11_env = std::env::var("WAYLAND_DISPLAY").is_err() && std::env::var("DISPLAY").is_ok();
                let TOP: u32 = 48; let DOCK: u32 = 68; let SIDE: u32 = 280;
                if app.get_webview_window("desktop").is_none() {
                    let _ = WebviewWindowBuilder::new(app, "desktop", url.clone())
                        .title("SIS Desktop")
                        .decorations(false)
                        .resizable(true)
                        .min_inner_size(1.0, 1.0)
                        .max_inner_size(100000.0, 100000.0)
                        .fullscreen(true)
                        .skip_taskbar(true)
                        .inner_size(W as f64, H as f64)
                        .build();
                }
                // Xorg では GNOME のパネルと競合しやすいため TopBar は生成しない
                if !is_x11_env {
                    if app.get_webview_window("topbar").is_none() {
                        let _ = WebviewWindowBuilder::new(app, "topbar", url.clone())
                            .title("SIS TopBar")
                            .decorations(false)
                            .resizable(true)
                            .min_inner_size(1.0, 1.0)
                            .max_inner_size(100000.0, 100000.0)
                            .transparent(true)
                            .always_on_top(false)
                            .skip_taskbar(true)
                            .inner_size(W as f64, TOP as f64)
                            .build();
                    }
                }
                if app.get_webview_window("dock").is_none() {
                    let _ = WebviewWindowBuilder::new(app, "dock", url.clone())
                        .title("SIS Dock")
                        .decorations(false)
                        .resizable(true)
                        .min_inner_size(1.0, 1.0)
                        .max_inner_size(100000.0, 100000.0)
                        .transparent(true)
                        .always_on_top(false)
                        .skip_taskbar(true)
                        .inner_size(W as f64, DOCK as f64)
                        .build();
                }
                if app.get_webview_window("sidebar").is_none() {
                    let _ = WebviewWindowBuilder::new(app, "sidebar", url.clone())
                        .title("SIS Sidebar")
                        .decorations(false)
                        .resizable(true)
                        .min_inner_size(1.0, 1.0)
                        .max_inner_size(100000.0, 100000.0)
                        .transparent(true)
                        .always_on_top(false)
                        .skip_taskbar(true)
                        .inner_size(SIDE as f64, H as f64)
                        .build();
                }
            }

            // Build WM_CLASS cache on startup
            build_wmclass_cache();
            // Ensure windows are visible, titled, and configured
            for lbl in ["desktop", "topbar", "dock", "sidebar"] {
                if let Some(w) = app.get_webview_window(lbl) {
                    // Stable titles per window to let wmctrl/xprop find them
                    let title = match lbl {
                        "desktop" => "SIS Desktop",
                        "topbar" => "SIS TopBar",
                        "dock" => "SIS Dock",
                        "sidebar" => "SIS Sidebar",
                        _ => "SIS",
                    };
                    let _ = w.set_title(title);
                    let _ = w.set_decorations(false);
                    let _ = w.set_resizable(true);
                    // clear and widen min/max size constraints (X11 WM_NORMAL_HINTS)
                    let _ = w.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize::new(1.0, 1.0))));
                    let _ = w.set_max_size(Some(tauri::Size::Logical(tauri::LogicalSize::new(100000.0, 100000.0))));
                    // delayed retries to ensure GTK/WebKit don't clamp to 800x600 after map
                    let w_clone = w.clone();
                    std::thread::spawn(move || {
                        for _ in 0..5 {
                            let _ = w_clone.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize::new(1.0, 1.0))));
                            let _ = w_clone.set_max_size(Some(tauri::Size::Logical(tauri::LogicalSize::new(100000.0, 100000.0))));
                            std::thread::sleep(std::time::Duration::from_millis(120));
                        }
                    });
                    if lbl == "desktop" {
                        let _ = w.set_always_on_top(false);
                        let _ = w.set_fullscreen(true);
                    } else {
                        let _ = w.set_always_on_top(false);
                    }
                    // show later after geometry is applied
                    let _ = w.on_window_event(|ev| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = ev { api.prevent_close(); }
                    });
                }
            }
            // Force size/position by reading X display size (X11) or default fallback（セーフモードでは単一ウィンドウに委譲）
            let read_wh = || -> (i32, i32) {
                // Try xdpyinfo
                if let Some(out) = run_out("sh", &["-lc", "xdpyinfo 2>/dev/null | awk '/dimensions:/ {print $2}'"]) {
                    if let Some((w,h)) = out.split_once('x') {
                        if let (Ok(ww), Ok(hh)) = (w.trim().parse::<i32>(), h.trim().parse::<i32>()) { if ww>0 && hh>0 { return (ww, hh); }}
                    }
                }
                // Try xrandr
                if let Some(out) = run_out("sh", &["-lc", "xrandr 2>/dev/null | awk '/current/ {for(i=1;i<=NF;i++){if($i==\"current\"){print $(i+1)\"x\"$(i+3); exit}}}'"]) {
                    if let Some((w,h)) = out.split_once('x') {
                        if let (Ok(ww), Ok(hh)) = (w.trim().parse::<i32>(), h.trim().parse::<i32>()) { if ww>0 && hh>0 { return (ww, hh); }}
                    }
                }
                (1920, 1080)
            };
            let (screen_w, screen_h) = read_wh();
            let top_h: i32 = 48; let dock_h: i32 = 68; let side_w: i32 = 280;
            if app.get_webview_window("desktop").is_some() {
                if let Some(desk) = app.get_webview_window("desktop") {
                    let _ = desk.set_fullscreen(true);
                    let _ = desk.set_size(tauri::Size::Logical(tauri::LogicalSize::new(screen_w as f64, screen_h as f64)));
                    let _ = desk.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(0.0, 0.0)));
                    let _ = desk.show();
                }
                if let Some(top) = app.get_webview_window("topbar") {
                    let _ = top.set_size(tauri::Size::Logical(tauri::LogicalSize::new(screen_w as f64, top_h as f64)));
                    let _ = top.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(0.0, 0.0)));
                    let _ = top.show();
                }
                if let Some(dock) = app.get_webview_window("dock") {
                    let _ = dock.set_size(tauri::Size::Logical(tauri::LogicalSize::new(screen_w as f64, dock_h as f64)));
                    let _ = dock.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(0.0, (screen_h - dock_h).max(0) as f64)));
                    let _ = dock.show();
                }
                if let Some(side) = app.get_webview_window("sidebar") {
                    let _ = side.set_size(tauri::Size::Logical(tauri::LogicalSize::new(side_w as f64, (screen_h - top_h).max(0) as f64)));
                    let _ = side.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(0.0, top_h as f64)));
                    let _ = side.show();
                }
            } else if let Some(main) = app.get_webview_window("main") {
                let _ = main.set_fullscreen(true);
                let _ = main.set_size(tauri::Size::Logical(tauri::LogicalSize::new(screen_w as f64, screen_h as f64)));
                let _ = main.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(0.0, 0.0)));
                let _ = main.show();
            }

            // Handle first-instance CLI flags too（argsは先で取得済み）
            if args.iter().any(|a| a == "--toggle-terminal") {
                let _ = app.emit("sis:toggle-builtin-terminal", "toggle");
            } else if args.iter().any(|a| a == "--toggle-palette") {
                let _ = app.emit("super_key_pressed", "toggle");
            }
            // (Optional) Global shortcuts can be registered here if needed and supported by the compositor.
            // We intentionally skip handlers here to avoid build-time API mismatches; DE側カスタムショートカットやCLIトグルで補完します。
            // X11 の場合はウィンドウタイプ/層ヒントを付与（ベストエフォート）
                                    #[cfg(target_os = "linux")]
                                    {
                let is_x11 = std::env::var("WAYLAND_DISPLAY").is_err() && std::env::var("DISPLAY").is_ok();
                let multi_window = app.get_webview_window("desktop").is_some();
                if multi_window && is_x11 && which("wmctrl") && which("xprop") {
                                                    // Retry layout application in background to avoid race with window mapping
                                                    std::thread::spawn(|| {
                                                            for i in 0..8 {
                                                                    let _ = Command::new("sh").arg("-lc").arg(
                                                                            r#"
                                                                            get_wh() {
                                                                                if command -v xdpyinfo >/dev/null 2>&1; then
                                                                                    xdpyinfo | awk '/dimensions:/ {print $2}'
                                                                                elif command -v xrandr >/dev/null 2>&1; then
                                                                                    xrandr | awk '/current/ {for(i=1;i<=NF;i++){if($i=="current"){print $(i+1)"x"$(i+3); exit}}}'
                                                                                else
                                                                                    echo "1920x1080"
                                                                                fi
                                                                            }
                                                                            WH=$(get_wh)
                                                                            W=${WH%x*}
                                                                            H=${WH#*x}
                                                                            [ -z "$W" ] && W=1920; [ -z "$H" ] && H=1080
                                                                            TOP=48; DOCK=68; SIDE=280; HB=$((H-DOCK))
                                                                            # Desktop as DESKTOP type and fullscreen
                                                                            xprop -name 'SIS Desktop' -f _NET_WM_WINDOW_TYPE 32a -set _NET_WM_WINDOW_TYPE _NET_WM_WINDOW_TYPE_DESKTOP || true
                                                                            wmctrl -r 'SIS Desktop' -b add,sticky,below,fullscreen || true
                                                                            wmctrl -r 'SIS Desktop' -e 0,0,0,$W,$H || true
                                                                            xprop -name 'SIS Desktop' -f _NET_WM_STATE 32a -set _NET_WM_STATE _NET_WM_STATE_FULLSCREEN || true
                                                                            # TopBar: size/pos first, then dock + strut + partial
                                                                            # TopBar はXorgでは生成しないためスキップ
                                                                            # Dock dock + strut bottom + partial (bottom span across full width)
                                                                            wmctrl -r 'SIS Dock' -e 0,0,$HB,$W,$DOCK || true
                                                                            xprop -name 'SIS Dock' -f _NET_WM_WINDOW_TYPE 32a -set _NET_WM_WINDOW_TYPE _NET_WM_WINDOW_TYPE_DOCK || true
                                                                            xprop -name 'SIS Dock' -f _NET_WM_STRUT 32c -set _NET_WM_STRUT "0, 0, 0, $DOCK" || true
                                                                            xprop -name 'SIS Dock' -f _NET_WM_STATE 32a -set _NET_WM_STATE "_NET_WM_STATE_ABOVE, _NET_WM_STATE_SKIP_TASKBAR, _NET_WM_STATE_SKIP_PAGER" || true
                                                                            xprop -name 'SIS Dock' -f _NET_WM_STRUT_PARTIAL 32c -set _NET_WM_STRUT_PARTIAL "0, 0, 0, $DOCK, 0, 0, 0, 0, 0, 0, 0, $W" || true
                                                                            wmctrl -r 'SIS Dock' -b add,sticky,above,skip_taskbar,skip_pager || true
                                                                            wmctrl -r 'SIS Dock' -e 0,0,$HB,$W,$DOCK || true
                                                                            # Sidebar dock + strut left + partial（実測幅を優先）
                                                                            SB=$(xwininfo -name 'SIS Sidebar' 2>/dev/null | awk '/Width:/ {print $2; exit}')
                                                                            [ -z "$SB" ] && SB=$SIDE
                                                                            wmctrl -r 'SIS Sidebar' -e 0,0,$TOP,$SB,$((H-TOP)) || true
                                                                            xprop -name 'SIS Sidebar' -f _NET_WM_WINDOW_TYPE 32a -set _NET_WM_WINDOW_TYPE _NET_WM_WINDOW_TYPE_DOCK || true
                                                                            HANDLE=12
                                                                            xprop -name 'SIS Sidebar' -f _NET_WM_STRUT 32c -set _NET_WM_STRUT "$HANDLE, 0, 0, 0" || true
                                                                            xprop -name 'SIS Sidebar' -f _NET_WM_STATE 32a -set _NET_WM_STATE "_NET_WM_STATE_ABOVE, _NET_WM_STATE_SKIP_TASKBAR, _NET_WM_STATE_SKIP_PAGER" || true
                                                                            # STRUT_PARTIAL fields: left,right,top,bottom, left_start_y,left_end_y,right_start_y,right_end_y, top_start_x,top_end_x,bottom_start_x,bottom_end_x
                                                                            xprop -name 'SIS Sidebar' -f _NET_WM_STRUT_PARTIAL 32c -set _NET_WM_STRUT_PARTIAL "$HANDLE, 0, 0, 0, $TOP, $H, 0, 0, 0, 0, 0, 0" || true
                                                                            wmctrl -r 'SIS Sidebar' -b add,sticky,above,skip_taskbar,skip_pager || true
                                                                            wmctrl -r 'SIS Sidebar' -e 0,0,$TOP,$SB,$((H-TOP)) || true
                                                                            "#
                                                                    ).status();
                                                                    log_append("INFO", &format!("x11 layout applied attempt {}", i+1));
                                                                    std::thread::sleep(std::time::Duration::from_millis(180));
                                                            }
                                                    });
                                                    // Watchdog: ensure skip_taskbar/skip_pager/above persist for Dock/Sidebar/Settings for ~1min
                                                    std::thread::spawn(|| {
                                                        for _ in 0..60 {
                                                            let _ = Command::new("sh").arg("-lc").arg("wmctrl -r 'SIS Dock' -b add,skip_taskbar,skip_pager,above || true").status();
                                                            let _ = Command::new("sh").arg("-lc").arg("xprop -name 'SIS Dock' -f _NET_WM_STATE 32a -set _NET_WM_STATE '_NET_WM_STATE_ABOVE, _NET_WM_STATE_SKIP_TASKBAR, _NET_WM_STATE_SKIP_PAGER' || true").status();
                                                            let _ = Command::new("sh").arg("-lc").arg("wmctrl -r 'SIS Sidebar' -b add,skip_taskbar,skip_pager,above || true").status();
                                                            let _ = Command::new("sh").arg("-lc").arg("xprop -name 'SIS Sidebar' -f _NET_WM_STATE 32a -set _NET_WM_STATE '_NET_WM_STATE_ABOVE, _NET_WM_STATE_SKIP_TASKBAR, _NET_WM_STATE_SKIP_PAGER' || true").status();
                                                            let _ = Command::new("sh").arg("-lc").arg("wmctrl -r 'SIS Settings' -b add,skip_taskbar,skip_pager,above || true").status();
                                                            let _ = Command::new("sh").arg("-lc").arg("xprop -name 'SIS Settings' -f _NET_WM_STATE 32a -set _NET_WM_STATE '_NET_WM_STATE_ABOVE, _NET_WM_STATE_SKIP_TASKBAR, _NET_WM_STATE_SKIP_PAGER' || true").status();
                                                            std::thread::sleep(std::time::Duration::from_millis(1000));
                                                        }
                                                    });
                                        // Best-effort: size/position using current X display dimensions
                                        // Use xdpyinfo to fetch WxH; fall back to xrandr if needed
                                        let _ = Command::new("sh").arg("-lc").arg(
                                                r#"
                                                get_wh() {
                                                    if command -v xdpyinfo >/dev/null 2>&1; then
                                                        xdpyinfo | awk '/dimensions:/ {print $2}'
                                                    elif command -v xrandr >/dev/null 2>&1; then
                                                        xrandr | awk '/current/ {for(i=1;i<=NF;i++){if($i=="current"){print $(i+1)"x"$(i+3); exit}}}'
                                                    else
                                                        echo "0x0"
                                                    fi
                                                }
                                                WH=$(get_wh)
                                                W=${WH%x*}
                                                H=${WH#*x}
                                                if [ -z "$W" ] || [ -z "$H" ] || [ "$W" = "0" ] || [ "$H" = "0" ]; then
                                                    W=1920; H=1080
                                                fi
                                                TOP=48
                                                DOCK=68
                                                SIDE=280
                                                HB=$((H-DOCK))
                                                # Desktop full area
                                                wmctrl -r 'SIS Desktop' -b add,sticky,below,fullscreen,skip_taskbar,skip_pager || true
                                                wmctrl -r 'SIS Desktop' -e 0,0,0,$W,$H || true
                                                xprop -name 'SIS Desktop' -f _NET_WM_STATE 32a -set _NET_WM_STATE _NET_WM_STATE_FULLSCREEN || true
                                                # TopBar dock-type + strut top
                                                # TopBar はXorgでは生成しないためスキップ
                                                # Dock dock-type + strut bottom
                                                wmctrl -r 'SIS Dock' -b add,sticky,above,skip_taskbar,skip_pager || true
                                                xprop -name 'SIS Dock' -f _NET_WM_WINDOW_TYPE 32a -set _NET_WM_WINDOW_TYPE _NET_WM_WINDOW_TYPE_DOCK || true
                                                xprop -name 'SIS Dock' -f _NET_WM_STRUT 32c -set _NET_WM_STRUT "0, 0, 0, $DOCK" || true
                                                xprop -name 'SIS Dock' -f _NET_WM_STATE 32a -set _NET_WM_STATE "_NET_WM_STATE_ABOVE, _NET_WM_STATE_SKIP_TASKBAR, _NET_WM_STATE_SKIP_PAGER" || true
                                                wmctrl -r 'SIS Dock' -e 0,0,$HB,$W,$DOCK || true
                                                # Sidebar dock-type + left: reserve only thin handle (12px); position under top panel
                                                wmctrl -r 'SIS Sidebar' -b add,sticky,above,skip_taskbar,skip_pager || true
                                                xprop -name 'SIS Sidebar' -f _NET_WM_WINDOW_TYPE 32a -set _NET_WM_WINDOW_TYPE _NET_WM_WINDOW_TYPE_DOCK || true
                                                HANDLE=12
                                                xprop -name 'SIS Sidebar' -f _NET_WM_STRUT 32c -set _NET_WM_STRUT "$HANDLE, 0, 0, 0" || true
                                                xprop -name 'SIS Sidebar' -f _NET_WM_STATE 32a -set _NET_WM_STATE "_NET_WM_STATE_ABOVE, _NET_WM_STATE_SKIP_TASKBAR, _NET_WM_STATE_SKIP_PAGER" || true
                                                xprop -name 'SIS Sidebar' -f _NET_WM_STRUT_PARTIAL 32c -set _NET_WM_STRUT_PARTIAL "$HANDLE, 0, 0, 0, $TOP, $H, 0, 0, 0, 0, 0, 0" || true
                                                wmctrl -r 'SIS Sidebar' -e 0,0,$TOP,$SIDE,$((H-TOP)) || true
                                                # Raise overlays just in case
                                                wmctrl -a 'SIS TopBar' || true
                                                wmctrl -a 'SIS Dock' || true
                                                wmctrl -a 'SIS Sidebar' || true
                                                "#
                                        ).status();

                    // TopBar はXorgでは生成しないためスキップ

                    let _ = Command::new("sh").arg("-lc").arg("wmctrl -r 'SIS Dock' -b add,sticky,above,skip_taskbar,skip_pager || true").status();
                    let _ = Command::new("sh").arg("-lc").arg("xprop -name 'SIS Dock' -f _NET_WM_WINDOW_TYPE 32a -set _NET_WM_WINDOW_TYPE _NET_WM_WINDOW_TYPE_DOCK || true").status();
                    // Reserve bottom strut (height 68) with PARTIAL span over full width
                    let _ = Command::new("sh").arg("-lc").arg(
                        "xprop -name 'SIS Dock' -f _NET_WM_STRUT 32c -set _NET_WM_STRUT '0, 0, 0, 68' || true"
                    ).status();
                    let _ = Command::new("sh").arg("-lc").arg(
                        "xprop -name 'SIS Dock' -f _NET_WM_STRUT_PARTIAL 32c -set _NET_WM_STRUT_PARTIAL '0, 0, 0, 68, 0, 0, 0, 0, 0, 0, 0, $(xdpyinfo 2>/dev/null | awk \"/dimensions:/ {print $2}\" | awk -Fx '{print $1}')' || true"
                    ).status();
                    let _ = Command::new("sh").arg("-lc").arg(
                        "xprop -name 'SIS Dock' -f _NET_WM_STATE 32a -set _NET_WM_STATE '_NET_WM_STATE_ABOVE, _NET_WM_STATE_SKIP_TASKBAR, _NET_WM_STATE_SKIP_PAGER' || true"
                    ).status();
                    let _ = Command::new("sh").arg("-lc").arg("wmctrl -a 'SIS Dock' || true").status();

                    let _ = Command::new("sh").arg("-lc").arg("wmctrl -r 'SIS Desktop' -b add,sticky,below,fullscreen,skip_taskbar,skip_pager || true").status();
                    let _ = Command::new("sh").arg("-lc").arg("wmctrl -a 'SIS Desktop' || true").status();
                    // Sidebar (left, reserve only a thin handle regardless of expanded width)
                    let _ = Command::new("sh").arg("-lc").arg("wmctrl -r 'SIS Sidebar' -b add,sticky,above,skip_taskbar,skip_pager || true").status();
                    let _ = Command::new("sh").arg("-lc").arg("xprop -name 'SIS Sidebar' -f _NET_WM_WINDOW_TYPE 32a -set _NET_WM_WINDOW_TYPE _NET_WM_WINDOW_TYPE_DOCK || true").status();
                    let _ = Command::new("sh").arg("-lc").arg(
                        "HANDLE=12; xprop -name 'SIS Sidebar' -f _NET_WM_STRUT 32c -set _NET_WM_STRUT \"$HANDLE, 0, 0, 0\" || true"
                    ).status();
                    let _ = Command::new("sh").arg("-lc").arg(
                        "W=$(xdpyinfo 2>/dev/null | awk '/dimensions:/ {print $2}' | awk -Fx '{print $1}'); H=$(xdpyinfo 2>/dev/null | awk '/dimensions:/ {print $2}' | awk -Fx '{print $2}'); TOP=48; LSTART=$TOP; LEND=$((H-1)); HANDLE=12; xprop -name 'SIS Sidebar' -f _NET_WM_STRUT_PARTIAL 32c -set _NET_WM_STRUT_PARTIAL \"$HANDLE, 0, 0, 0, $LSTART, $LEND, 0, 0, 0, 0, 0, 0\" || true"
                    ).status();
                    let _ = Command::new("sh").arg("-lc").arg(
                        "xprop -name 'SIS Sidebar' -f _NET_WM_STATE 32a -set _NET_WM_STATE '_NET_WM_STATE_ABOVE, _NET_WM_STATE_SKIP_TASKBAR, _NET_WM_STATE_SKIP_PAGER' || true"
                    ).status();
                    let _ = Command::new("sh").arg("-lc").arg("wmctrl -a 'SIS Sidebar' || true").status();
                }
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
            get_launch_history,
            get_folder_counts,
            list_desktop_items,
            list_documents_items,
            set_wallpaper,
            get_settings,
            set_settings,
            try_start_lmstudio,
            get_favorite_apps,
            add_favorite_app,
            remove_favorite_app,
            reorder_favorite_apps,
            take_screenshot,
            play_pause_music,
            next_track,
            previous_track,
            launch_app,
            file_to_data_url,
            resolve_window_app,
            resolve_window_icon,
            get_open_windows_with_icons,
            record_launch_guess,
            overlay_start,
            overlay_stop,
            overlay_status,
            control_center_state,
            // Newly added commands to expose via invoke
            network_set,
            bluetooth_set,
            power_action,
            llm_query,
            llm_query_remote,
            llm_download_hf,
            list_local_models,
            run_safe_command,
            run_with_sudo,
            clamav_scan,
            kdeconnect_list
            ,open_settings_window
        ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[tauri::command]
fn open_settings_window(app_handle: tauri::AppHandle) -> Result<String, String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let label = "settings";
    if app_handle.get_webview_window(label).is_none() {
        let url = WebviewUrl::App("/".into());
        let _ = WebviewWindowBuilder::new(&app_handle, label, url)
            .title("SIS Settings")
            .decorations(true)
            .resizable(true)
            .skip_taskbar(true)
            .inner_size(980.0, 720.0)
            .build();
    }
    if let Some(w) = app_handle.get_webview_window(label) {
        let _ = w.set_title("SIS Settings");
        let _ = w.set_resizable(true);
        let _ = w.show();
    }
    // X11: 上に出し、Dock/Taskbar/Pagerからは非表示
    let is_x11 = std::env::var("WAYLAND_DISPLAY").is_err() && std::env::var("DISPLAY").is_ok();
    if is_x11 && which("wmctrl") && which("xprop") {
        let _ = Command::new("sh").arg("-lc").arg(
            "wmctrl -r 'SIS Settings' -b add,above,skip_taskbar,skip_pager || true"
        ).status();
        let _ = Command::new("sh").arg("-lc").arg(
            "xprop -name 'SIS Settings' -f _NET_WM_STATE 32a -set _NET_WM_STATE '_NET_WM_STATE_ABOVE, _NET_WM_STATE_SKIP_TASKBAR, _NET_WM_STATE_SKIP_PAGER' || true"
        ).status();
    }
    Ok("settings-shown".into())
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
    log_append("INFO", &format!("llm_query(local) prompt_len={}", prompt.len().min(2048)));
    let s = read_settings();
    if s.llm_mode.as_deref() != Some("local") {
        log_append("WARN", "llm_query called but local mode is not enabled");
        return Err("llm-local-mode-not-enabled".into());
    }
    let model_path = s.local_model_path.clone().ok_or_else(|| "local-model-path-not-set".to_string())?;
    let model = PathBuf::from(model_path);
    if !model.exists() { log_append("ERROR", "local model path not found"); return Err("local-model-not-found".into()); }
    let runner = PathBuf::from("LLM/llama_server");
    if !runner.exists() { log_append("ERROR", "llama_server binary missing"); return Err("llama_server-not-found: put binary at ./LLM/llama_server".into()); }
    match Command::new(runner).arg("--model").arg(model).arg("--prompt").arg(prompt).output() {
        Ok(o) => {
            if o.status.success() {
                let resp = String::from_utf8_lossy(&o.stdout).to_string();
                log_append("INFO", &format!("llm_query(local) ok bytes={}", resp.len()));
                Ok(resp)
            } else {
                let err = String::from_utf8_lossy(&o.stderr).to_string();
                log_append("ERROR", &format!("llm_query(local) failed: {}", err));
                Err(format!("llm-error: {}", err))
            }
        }
        Err(e) => { log_append("ERROR", &format!("llm runner spawn failed: {}", e)); Err(format!("failed-to-start-llm-runner: {}", e)) }
    }
}

fn models_dir() -> Option<PathBuf> { history_dir().map(|d| d.join("models")) }

fn sanitize_model_id(mid: &str) -> String {
    mid.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect()
}

#[tauri::command]
fn llm_download_hf(model_id: String) -> Result<String, String> {
    if !which("huggingface-cli") { return Err("huggingface-cli-not-found".into()); }
    let dir = models_dir().ok_or_else(|| "home-not-found".to_string())?;
    let _ = fs::create_dir_all(&dir);
    let target = dir.join(sanitize_model_id(&model_id));
    let target_str = target.to_string_lossy().to_string();
    let status = Command::new("huggingface-cli")
        .arg("download")
        .arg(&model_id)
        .arg("--local-dir").arg(&target_str)
        .status();
    match status {
        Ok(s) if s.success() => Ok(target_str),
        Ok(s) => Err(format!("download-failed: exit {}", s)),
        Err(e) => Err(format!("failed-to-run-hf-cli: {}", e))
    }
}

#[tauri::command]
fn list_local_models() -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    if let Some(d) = models_dir() {
        if d.exists() {
            if let Ok(read) = fs::read_dir(&d) {
                for e in read.flatten() {
                    let p = e.path();
                    if p.is_dir() {
                        if let Ok(r2) = fs::read_dir(&p) {
                            for f in r2.flatten() {
                                let fp = f.path();
                                if let Some(ext) = fp.extension().and_then(|s| s.to_str()) {
                                    if ext.eq_ignore_ascii_case("gguf") { out.push(fp.to_string_lossy().to_string()); }
                                }
                            }
                        }
                    } else if let Some(ext) = p.extension().and_then(|s| s.to_str()) { if ext.eq_ignore_ascii_case("gguf") { out.push(p.to_string_lossy().to_string()); } }
                }
            }
        }
    }
    Ok(out)
}

fn which(cmd: &str) -> bool {
    Command::new("sh")
        .arg("-c")
        .arg(format!("command -v {} >/dev/null 2>&1", cmd))
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn expand_user_path(input: &str) -> PathBuf {
    let s = input.trim();
    if s.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(&s[2..]);
        }
    }
    PathBuf::from(s)
}

#[tauri::command]
fn run_safe_command(cmdline: String) -> Result<String, String> {
    if cmdline.len() > 8000 { return Err("command-too-long".into()); }
    let trimmed = cmdline.trim();
    if trimmed.is_empty() { return Err("empty-cmd".into()); }
    // allowlist simple guard
    let first = trimmed.split_whitespace().next().unwrap_or("");
    let base = Path::new(first).file_name().and_then(|s| s.to_str()).unwrap_or(first);
    let allow = [
        "xdg-open","ls","cp","mv","mkdir","tar","zip","unzip",
        "playerctl","pactl","brightnessctl","nmcli","rfkill","gnome-screenshot",
    "kdeconnect-cli","clamscan","echo","wmctrl","xprop","zenity","kdialog","base64",
        "sh","bash","sed","xdotool"
    ];
    if !allow.contains(&base) { return Err(format!("command-not-allowed: {}", base)); }
    if trimmed.contains(" rm ") || trimmed.starts_with("rm ") || trimmed.contains(" sudo ") {
        return Err("unsafe-command-rejected".into());
    }
    log_append("INFO", &format!("run_safe_command: {}", trimmed));
    match Command::new("sh").arg("-c").arg(trimmed).output() {
        Ok(o) => {
            let code = o.status.code().unwrap_or(-1);
            let stdout_s = String::from_utf8_lossy(&o.stdout).to_string();
            let stderr_s = String::from_utf8_lossy(&o.stderr).to_string();
            let combined = if stdout_s.is_empty() {
                stderr_s.clone()
            } else if stderr_s.is_empty() {
                stdout_s.clone()
            } else {
                format!("{}\n{}", stdout_s, stderr_s)
            };
            if o.status.success() {
                let with_exit = if combined.trim().is_empty() { format!("[exit {}]", code) } else { format!("{}\n[exit {}]", combined, code) };
                log_append("INFO", &format!("run_safe_command ok exit={} bytes={}", code, with_exit.len()));
                Ok(with_exit)
            } else {
                let with_exit = if combined.trim().is_empty() { format!("[exit {}]", code) } else { format!("{}\n[exit {}]", combined, code) };
                log_append("ERROR", &format!("run_safe_command failed exit={} bytes={}", code, with_exit.len()));
                Err(with_exit)
            }
        }
        Err(e) => { log_append("ERROR", &format!("run_safe_command spawn error: {}", e)); Err(format!("failed-to-run: {}", e)) }
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
    if cmdline.len() > 8000 { return Err("command-too-long".into()); }
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
                let s = String::from_utf8_lossy(&out.stdout).to_string();
                log_append("INFO", &format!("run_with_sudo ok bytes={}", s.len()));
                Ok(s)
            } else {
                let e = String::from_utf8_lossy(&out.stderr).to_string();
                log_append("ERROR", &format!("run_with_sudo failed: {}", e));
                Err(e)
            }
        }
        Err(e) => { log_append("ERROR", &format!("wait sudo failed: {}", e)); Err(format!("failed-waiting-for-sudo: {}", e)) }
    }
}

fn read_network_enabled() -> bool {
    match Command::new("nmcli").arg("networking").output() {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_lowercase().contains("enabled"),
        Err(_) => true,
    }
}

fn read_bluetooth_enabled() -> bool {
    // Prefer bluetoothctl show
    if let Ok(o) = Command::new("bluetoothctl").arg("show").output() {
        let s = String::from_utf8_lossy(&o.stdout).to_lowercase();
        if s.contains("powered: yes") { return true; }
        if s.contains("powered: no") { return false; }
    }
    // Fallback rfkill
    match Command::new("rfkill").arg("list").arg("bluetooth").output() {
        Ok(o) => {
            let s = String::from_utf8_lossy(&o.stdout).to_lowercase();
            !(s.contains("soft blocked: yes") || s.contains("hard blocked: yes"))
        }
        Err(_) => true,
    }
}

fn read_volume_percent() -> u32 {
    if let Ok(o) = Command::new("pactl").arg("get-sink-volume").arg("@DEFAULT_SINK@").output() {
        let s = String::from_utf8_lossy(&o.stdout);
        // find last occurrence of % digits
        if let Some(idx) = s.rfind('%') {
            let start = s[..idx].rfind(|c: char| !c.is_ascii_digit()).map(|i| i+1).unwrap_or(0);
            let num = &s[start..idx];
            if let Ok(v) = num.trim().parse::<u32>() { return v.min(150); }
        }
    }
    50
}

fn read_brightness_percent() -> u32 {
    // brightnessctl info shows (XX%) sometimes
    if let Ok(o) = Command::new("brightnessctl").arg("info").output() {
        let s = String::from_utf8_lossy(&o.stdout);
        if let Some(p1) = s.find('(') { if let Some(p2) = s[p1+1..].find('%') { 
            let num = &s[p1+1..p1+1+p2]; if let Ok(v) = num.trim().parse::<u32>() { return v.min(100); }
        }}
    }
    // fallback xbacklight -get
    if let Ok(o) = Command::new("xbacklight").arg("-get").output() {
        let s = String::from_utf8_lossy(&o.stdout);
        if let Ok(f) = s.trim().split_whitespace().next().unwrap_or("0").parse::<f32>() { return f.round() as u32; }
    }
    80
}

#[derive(Debug, Serialize, Deserialize)]
struct ControlCenterState { volume: u32, brightness: u32, network: bool, bluetooth: bool }

#[tauri::command]
fn control_center_state() -> Result<ControlCenterState, String> {
    Ok(ControlCenterState{
        volume: read_volume_percent(),
        brightness: read_brightness_percent(),
        network: read_network_enabled(),
        bluetooth: read_bluetooth_enabled(),
    })
}

#[tauri::command]
fn get_launch_history(limit: Option<u32>) -> Result<Vec<AppInfo>, String> {
    let mut out: Vec<AppInfo> = Vec::new();
    let mut n = 0u32;
    for e in read_launch_history() {
        let exec_first = e.exec.split_whitespace().next().unwrap_or("").to_string();
        let p = Path::new(&exec_first);
        let ok = (p.is_absolute() && p.exists()) || which(&exec_first);
        if ok {
            out.push(AppInfo { name: e.name, exec: e.exec, icon_data_url: e.icon_data_url });
            n += 1;
            if let Some(lim) = limit { if n >= lim { break; } }
        }
    }
    Ok(out)
}

#[tauri::command]
fn llm_query_remote(base_url: String, api_key: Option<String>, model: Option<String>, prompt: String) -> Result<String, String> {
    let safe_url = if base_url.contains("localhost") { base_url.clone() } else { "(redacted)".into() };
    log_append("INFO", &format!("llm_query_remote url={} prompt_len={}", safe_url, prompt.len().min(2048)));
    let url = base_url;
    let model_name = model.unwrap_or_else(|| "lmstudio-community/Meta-Llama-3-8B-Instruct-GGUF".to_string());
    let body = json!({
        "model": model_name,
        "messages": [ { "role": "user", "content": prompt } ],
        "temperature": 0.7
    });
    let client = match reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build() {
        Ok(c) => c,
        Err(e) => return Err(format!("llm-client-error: {}", e)),
    };
    let mut req = client.post(&url).json(&body);
    if let Some(key) = api_key { if !key.is_empty() { req = req.bearer_auth(key); } }
    match req.send() {
        Ok(resp) => {
            if resp.status().is_success() {
                // cap payload size to avoid memory spike
                let val = match resp.json::<serde_json::Value>() {
                    Ok(v) => {
                        if let Some(text) = v["choices"][0]["message"]["content"].as_str() {
                            let s = text.to_string(); log_append("INFO", &format!("llm_query_remote ok len={}", s.len())); Ok(s)
                        } else if let Some(text) = v["choices"][0]["text"].as_str() {
                            let s = text.to_string(); log_append("INFO", &format!("llm_query_remote ok len={}", s.len())); Ok(s)
                        } else { let s = v.to_string(); log_append("INFO", &format!("llm_query_remote ok/raw len={}", s.len())); Ok(s) }
                    }
                    Err(e) => { log_append("ERROR", &format!("llm invalid json: {}", e)); Err(format!("llm-invalid-json: {}", e)) }
                }?;
                Ok(val)
            } else {
                let st = resp.status();
                let txt = resp.text().unwrap_or_default();
                log_append("ERROR", &format!("llm http error {}: {}", st, txt.chars().take(512).collect::<String>()));
                Err(format!("llm-http-{}: {}", st, txt))
            }
        }
        Err(e) => { log_append("ERROR", &format!("llm http send error: {}", e)); Err(format!("llm-http-error: {}", e)) }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct DesktopItem { name: String, path: String, is_dir: bool }

fn desktop_dirs() -> Vec<PathBuf> {
    let mut out = Vec::new();
    // Prefer user-configured path if provided
    if let Some(s) = Some(read_settings()) { if let Some(ud) = s.user_dirs.as_ref() {
        if let Some(v) = ud.get("desktop").and_then(|x| x.as_str()) {
            let p = expand_user_path(v);
            if p.exists() { out.push(p); }
        }
    }}
    if let Some(home) = dirs::home_dir() {
        out.push(home.join("Desktop"));
        out.push(home.join("デスクトップ"));
        out.push(home.join("desktop"));
        out.push(home.join("デスクトッブ")); // common typo fallback
    }
    // XDG user dirs: respect XDG_DESKTOP_DIR if set in user-dirs.dirs
    if let Some(home) = dirs::home_dir() {
        let cfg = home.join(".config/user-dirs.dirs");
        if cfg.exists() {
            if let Ok(s) = fs::read_to_string(&cfg) {
                for line in s.lines() {
                    if line.starts_with("XDG_DESKTOP_DIR=") {
                        let raw = line.split('=').nth(1).unwrap_or("").trim().trim_matches('"');
                        let path = raw.replace("$HOME", &home.to_string_lossy());
                        let p = PathBuf::from(path);
                        if p.exists() { out.push(p); }
                    }
                }
            }
        }
    }
    out
}

#[tauri::command]
fn list_desktop_items() -> Result<Vec<DesktopItem>, String> {
    let mut items: Vec<DesktopItem> = Vec::new();
    for d in desktop_dirs() {
        if d.exists() && d.is_dir() {
            if let Ok(read) = fs::read_dir(&d) {
                for e in read.flatten() {
                    let p = e.path();
                    let is_dir = p.is_dir();
                    let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
                    items.push(DesktopItem { name, path: p.to_string_lossy().to_string(), is_dir });
                }
            }
            break; // first existing desktop dir
        }
    }
    Ok(items)
}

#[tauri::command]
fn set_wallpaper(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !p.exists() { return Err("wallpaper-file-not-found".into()); }
    // Try GNOME / gsettings
    if which("gsettings") {
        let s = Command::new("gsettings")
            .arg("set").arg("org.gnome.desktop.background").arg("picture-uri")
            .arg(format!("file://{}", p.to_string_lossy()))
            .status();
        if s.map(|s| s.success()).unwrap_or(false) { return Ok("wallpaper-set".into()); }
    }
    // XFCE
    if which("xfconf-query") {
        let status = Command::new("sh").arg("-c").arg(format!(
            "for ch in $(xfconf-query -c xfce4-desktop -p /backdrop -l | grep image-path$); do xfconf-query -c xfce4-desktop -p $ch -s '{}'; done",
            p.to_string_lossy()
        )).status();
        if status.map(|s| s.success()).unwrap_or(false) { return Ok("wallpaper-set".into()); }
    }
    // Fallback: feh
    if which("feh") {
        let status = Command::new("feh").arg("--bg-fill").arg(&path).status();
        if status.map(|s| s.success()).unwrap_or(false) { return Ok("wallpaper-set".into()); }
    }
    Err("failed-to-set-wallpaper".into())
}

fn documents_dir() -> Option<PathBuf> {
    // Prefer user-configured path if provided
    if let Some(s) = Some(read_settings()) { if let Some(ud) = s.user_dirs.as_ref() {
        if let Some(v) = ud.get("documents").and_then(|x| x.as_str()) {
            let p = expand_user_path(v);
            if p.exists() { return Some(p); }
        }
    }}
    if let Some(home) = dirs::home_dir() {
        // XDG user dirs
        let cfg = home.join(".config/user-dirs.dirs");
        if cfg.exists() {
            if let Ok(s) = fs::read_to_string(&cfg) {
                for line in s.lines() {
                    if line.starts_with("XDG_DOCUMENTS_DIR=") {
                        let raw = line.split('=').nth(1).unwrap_or("").trim().trim_matches('"');
                        let path = raw.replace("$HOME", &home.to_string_lossy());
                        let p = PathBuf::from(path);
                        if p.exists() { return Some(p); }
                    }
                }
            }
        }
        let candidates = ["Documents","ドキュメント","documents"]; 
        for c in candidates { let p = home.join(c); if p.exists() { return Some(p); } }
    }
    None
}

#[tauri::command]
fn list_documents_items() -> Result<Vec<DesktopItem>, String> {
    let mut items: Vec<DesktopItem> = Vec::new();
    if let Some(d) = documents_dir() {
        if d.exists() && d.is_dir() {
            if let Ok(read) = fs::read_dir(&d) {
                for e in read.flatten() {
                    let p = e.path();
                    let is_dir = p.is_dir();
                    let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
                    items.push(DesktopItem { name, path: p.to_string_lossy().to_string(), is_dir });
                }
            }
        }
    }
    Ok(items)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct DeSettings {
    // UI appearance
    theme: Option<String>,            // "system" | "light" | "dark"
    wallpaper: Option<String>,        // path or data/url(...)
    // Frontendで使用する見た目設定一式（dockOpacity/dockBlur/dockIcon/appIcon など）
    appearance: Option<serde_json::Value>,
    llm_remote_url: Option<String>,
    llm_api_key: Option<String>,
    llm_model: Option<String>,
    llm_autostart_localhost: bool,
    llm_mode: Option<String>, // "lmstudio" | "local"
    hf_model_id: Option<String>,
    local_model_path: Option<String>,
    user_dirs: Option<serde_json::Value>, // { downloads, music, pictures, documents, videos, desktop }
    app_sort: Option<String>, // name|recent
    favorite_order: Option<Vec<String>>, // favorite app names
    logging_enabled: Option<bool>,    // backend log toggle
}

fn settings_dir() -> Option<PathBuf> { history_dir() }
fn settings_path() -> Option<PathBuf> { settings_dir().map(|d| d.join("config.json")) }

fn read_settings() -> DeSettings {
    if let Some(p) = settings_path() {
        if p.exists() {
            if let Ok(s) = fs::read_to_string(&p) {
                if let Ok(v) = serde_json::from_str::<DeSettings>(&s) { return v; }
            }
        }
    }
    DeSettings{ 
        theme: Some("system".into()),
        wallpaper: None,
    appearance: None,
        llm_remote_url: Some("http://localhost:1234/v1/chat/completions".into()),
        llm_api_key: None,
        llm_model: Some("qwen3-14b@q4_k_m".into()),
        llm_autostart_localhost: true,
        llm_mode: Some("lmstudio".into()),
        hf_model_id: None,
        local_model_path: None,
        user_dirs: None,
        app_sort: Some("name".into()),
        favorite_order: None,
        logging_enabled: Some(true),
    }
}

fn write_settings(s: &DeSettings) {
    if let Some(dir) = settings_dir() { let _ = fs::create_dir_all(&dir); }
    if let Some(p) = settings_path() {
        if let Ok(txt) = serde_json::to_string_pretty(&s) { let _ = fs::write(p, txt); }
    }
}

#[tauri::command]
fn get_settings() -> Result<DeSettings, String> { Ok(read_settings()) }

#[tauri::command]
fn set_settings(new_s: DeSettings) -> Result<String, String> {
    // Merge with existing settings to avoid dropping fields
    let mut cur = read_settings();
    // Primitive merge: prefer incoming if Some/true; keep existing otherwise
    if let Some(v) = new_s.theme { cur.theme = Some(v); }
    if let Some(v) = new_s.wallpaper { cur.wallpaper = Some(v); }
    if let Some(v) = new_s.appearance { cur.appearance = Some(v); }
    if let Some(v) = new_s.llm_remote_url { cur.llm_remote_url = Some(v); }
    if let Some(v) = new_s.llm_api_key { cur.llm_api_key = Some(v); }
    if let Some(v) = new_s.llm_model { cur.llm_model = Some(v); }
    cur.llm_autostart_localhost = new_s.llm_autostart_localhost || cur.llm_autostart_localhost;
    if let Some(v) = new_s.llm_mode { cur.llm_mode = Some(v); }
    if let Some(v) = new_s.hf_model_id { cur.hf_model_id = Some(v); }
    if let Some(v) = new_s.local_model_path { cur.local_model_path = Some(v); }
    if let Some(v) = new_s.user_dirs { cur.user_dirs = Some(v); }
    if let Some(v) = new_s.app_sort { cur.app_sort = Some(v); }
    if let Some(v) = new_s.favorite_order { cur.favorite_order = Some(v); }
    if let Some(v) = new_s.logging_enabled { cur.logging_enabled = Some(v); }
    write_settings(&cur);
    // Optional: auto-start LM Studio if localhost specified
    if cur.llm_autostart_localhost {
        if let Some(url) = &cur.llm_remote_url {
            if url.contains("localhost") || url.contains("127.0.0.1") {
                let _ = try_start_lmstudio();
            }
        }
    }
    Ok("settings-updated".into())
}

#[tauri::command]
fn try_start_lmstudio() -> Result<String, String> {
    // Best-effort: try to spawn lmstudio if available
    let candidates = ["lmstudio", "lm-studio", "LM Studio"];
    for c in candidates.iter() {
        if which(c) {
            let _ = Command::new(c).arg("--headless").spawn();
            return Ok("lmstudio-started".into())
        }
    }
    Err("lmstudio-not-found".into())
}

#[tauri::command]
fn reorder_favorite_apps(_app_handle: tauri::AppHandle, names: Vec<String>) -> Result<String, String> {
    // Reorder favorites.json according to provided names sequence
    let home = dirs::home_dir().ok_or_else(|| "cannot-detect-home".to_string())?;
    let dir = home.join(".local").join("share").join("sis-ui");
    let path = dir.join("favorites.json");
    let mut apps = get_favorite_apps(_app_handle.clone())?.into_iter().collect::<Vec<_>>();
    let pos = |n: &str| names.iter().position(|x| x==n).unwrap_or(usize::MAX);
    apps.sort_by_key(|a| pos(&a.name));
    let content = serde_json::to_string_pretty(&apps).map_err(|e| format!("Failed to serialize favorites: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("Failed to write favorites.json: {}", e))?;
    Ok("favorites-reordered".into())
}

fn logs_dir() -> Option<PathBuf> { history_dir().map(|d| d.join("logs")) }
fn backend_log_path() -> Option<PathBuf> { logs_dir().map(|d| d.join("backend.log")) }

fn log_append(level: &str, message: &str) {
    // Check settings toggle
    let s = read_settings();
    if !s.logging_enabled.unwrap_or(false) { return; }
    if let Some(dir) = logs_dir() { let _ = fs::create_dir_all(&dir); }
    if let Some(path) = backend_log_path() {
        let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let line = format!("{} [{}] {}\n", ts, level, message);
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
            let _ = f.write_all(line.as_bytes());
        }
    }
}

#[tauri::command]
fn get_backend_log(limit: Option<u32>) -> Result<String, String> {
    let path = backend_log_path().ok_or_else(|| "log-path-missing".to_string())?;
    if !path.exists() { return Ok(String::new()); }
    let content = std::fs::read_to_string(&path).map_err(|e| format!("read-log-failed: {}", e))?;
    if let Some(n) = limit {
        let lines: Vec<&str> = content.lines().collect();
        let start = lines.len().saturating_sub(n as usize);
        return Ok(lines[start..].join("\n"));
    }
    Ok(content)
}

#[tauri::command]
fn clear_backend_log() -> Result<String, String> {
    if let Some(path) = backend_log_path() {
        let _ = std::fs::write(path, b"");
    }
    Ok("cleared".into())
}

// expand_user_path is defined earlier