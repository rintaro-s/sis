// 軽量なAPIラッパー。Tauriが利用できればinvoke、なければモックを返す。
// 依存関係を避けるため静的importは使わず、ランタイム検出でinvokeを取得します。
type TauriInvoke = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>

function getTauriInvokeFromWindow(): TauriInvoke | null {
  const w = globalThis as Record<string, unknown>
  const tauri = w.__TAURI__ as
    | { core?: { invoke?: TauriInvoke }; tauri?: { invoke?: TauriInvoke } }
    | undefined
  const v2 = tauri?.core?.invoke
  const v1 = tauri?.tauri?.invoke
  return v2 ?? v1 ?? null
}

let cachedInvoke: TauriInvoke | null = null
async function resolveInvoke(): Promise<TauriInvoke | null> {
  if (cachedInvoke) return cachedInvoke
  // 公式API（v2）を優先し、失敗したらwindow注入を試す
  try {
    const mod = await import('@tauri-apps/api/core')
    if (typeof mod.invoke === 'function') {
      cachedInvoke = mod.invoke as TauriInvoke
      return cachedInvoke
    }
  } catch { /* ignore */ }
  const injected = getTauriInvokeFromWindow()
  if (injected) { cachedInvoke = injected; return cachedInvoke }
  return null
}

let tauriReadyPromise: Promise<void> | null = null
async function waitForTauri(timeoutMs = 3000): Promise<void> {
  if (getTauriInvokeFromWindow()) return
  if (!tauriReadyPromise) {
    tauriReadyPromise = new Promise<void>((resolve) => {
      const start = Date.now()
      const tick = () => {
        if (getTauriInvokeFromWindow()) return resolve()
        if (Date.now() - start >= timeoutMs) return resolve()
        setTimeout(tick, 50)
      }
      tick()
    })
  }
  await tauriReadyPromise
}

export type SystemInfo = {
  cpuUsage: number
  memUsage: number
  downloadSpeed: number
  uploadSpeed: number
}

export type AppInfo = { name: string; exec?: string; icon_data_url?: string }


async function safeInvoke<T = unknown>(cmd: string, payload?: Record<string, unknown>): Promise<T> {
  let inv = await resolveInvoke()
  if (!inv) {
    await waitForTauri(3000)
    inv = await resolveInvoke()
  }
  if (!inv) throw new Error('invoke-unavailable')
  return inv<T>(cmd, payload)
}

export const api = {
  /** CSSのbackground-imageに安全に使えるURLへ変換（ローカルパス→convertFileSrc） */
  async cssUrlForPath(input: string): Promise<string> {
    const v = (input || '').trim()
    if (!v) return ''
    // すでに url(...) 指定ならそのまま
    if (/^url\(/i.test(v)) return v
    // http/https はそのまま
    if (/^https?:\/\//i.test(v)) return `url('${v}')`
    try {
      const core = await import('@tauri-apps/api/core')
      const url = core.convertFileSrc(v)
      return `url('${url}')`
    } catch {
      // フォールバック: file:// スキーム
      const url = v.startsWith('file://') ? v : `file://${v}`
      return `url('${url}')`
    }
  },
  async getSystemInfo(): Promise<SystemInfo> {
  const raw = await safeInvoke<string>('get_system_info')
  const parsed = JSON.parse(raw) as SystemInfo
  return parsed
  },

  /** .desktop からアプリ一覧を収集（アイコン解決込み、最大500件）
   * 対象: system, user, snap, flatpak の .desktop
   */
  async listApplications(): Promise<AppInfo[]> {
  // バックエンドの get_recent_apps はフルスキャン実装（名称は互換維持）
  try { return await safeInvoke<AppInfo[]>('get_recent_apps') } catch { return [] }
  },

  /** 開いているウィンドウ一覧（wmctrl依存） */
  async getOpenWindows(): Promise<{ id: string; wclass: string; title: string; icon_data_url?: string }[]> {
    try {
      const text = await safeInvoke<string>('run_safe_command', { cmdline: 'wmctrl -lx 2>/dev/null' })
      const lines = (text||'').split(/\r?\n/).filter(Boolean)
      const wins: { id: string; wclass: string; title: string; icon_data_url?: string }[] = []
      const re = /^(\S+)\s+\S+\s+\S+\s+(\S+)\s+(.*)$/
      for (const line of lines) {
        const m = line.match(re)
        if (!m) continue
        const [, id, wclass, titleRaw] = m
        const title = (titleRaw || '').trim()
        if (!title) continue
        wins.push({ id, wclass, title })
      }
      return wins
    } catch { return [] }
  },

  async focusWindow(id: string): Promise<{ ok: boolean }>{
    try { await safeInvoke<string>('run_safe_command', { cmdline: `wmctrl -ia ${id} 2>/dev/null || true` }); return { ok: true } } catch { return { ok: false } }
  },
  /** XDGユーザーディレクトリ（日本語環境含む）を取得 */
  async getXdgUserDirs(): Promise<{ desktop?: string; documents?: string; downloads?: string; pictures?: string; music?: string; videos?: string }>{
    try {
      const cmd = `bash -lc "file=\"$HOME/.config/user-dirs.dirs\"; if [ -f \"$file\" ]; then set -a; . \"$file\"; set +a; fi; \
        printf 'desktop:%s\\n' \"\${XDG_DESKTOP_DIR:-$HOME/Desktop}\"; \
        printf 'documents:%s\\n' \"\${XDG_DOCUMENTS_DIR:-$HOME/Documents}\"; \
        printf 'downloads:%s\\n' \"\${XDG_DOWNLOAD_DIR:-$HOME/Downloads}\"; \
        printf 'pictures:%s\\n' \"\${XDG_PICTURES_DIR:-$HOME/Pictures}\"; \
        printf 'music:%s\\n' \"\${XDG_MUSIC_DIR:-$HOME/Music}\"; \
        printf 'videos:%s\\n' \"\${XDG_VIDEOS_DIR:-$HOME/Videos}\";"`
      const text = await safeInvoke<string>('run_safe_command', { cmdline: cmd })
      const out: Record<string, string> = {}
      for (const line of (text || '').split(/\r?\n/)) {
        const [k, v] = line.split(':')
        if (!k || !v) continue
        const p = v.trim()
        out[k] = p
      }
      return out
    } catch {
      return {}
    }
  },

  /** 指定ディレクトリの項目を列挙（簡易） */
  async listDir(path: string): Promise<{ name: string; path: string; is_dir: boolean }[]>{
    try {
      const pjson = JSON.stringify(path)
      const cmd = `bash -lc "p=${pjson}; if [[ \"$p\" == ~* ]]; then p=\"\${p/#~/$HOME}\"; fi; \
        if [ -d \"$p\" ]; then \
          find \"$p\" -maxdepth 1 -mindepth 1 -print0 | while IFS= read -r -d '' f; do \
            name=\"\$(basename \"$f\")\"; \
            if [ -d \"$f\" ]; then echo \"$name|$f|1\"; else echo \"$name|$f|0\"; fi; \
          done; \
        fi"`
      const text = await safeInvoke<string>('run_safe_command', { cmdline: cmd })
      const items: { name: string; path: string; is_dir: boolean }[] = []
      for (const line of (text || '').split(/\r?\n/)) {
        if (!line) continue
        const [name, pth, d] = line.split('|')
        if (!name || !pth) continue
        items.push({ name, path: pth, is_dir: d === '1' })
      }
      return items
    } catch {
      return []
    }
  },
  /** Snap の .desktop を簡易スキャンして {name, exec} を返す（最大200件） */
  async scanSnapApps(): Promise<AppInfo[]> {
    try {
      const res = await safeInvoke<string>('run_safe_command', { cmdline: 'bash -lc "for f in /var/lib/snapd/desktop/applications/*.desktop; do n=$(grep -m1 ^Name= \"$f\" | sed \"s/^Name=//\"); e=$(grep -m1 ^Exec= \"$f\" | sed \"s/^Exec=//\"); echo \"$n|$e\"; done 2>/dev/null | head -n 200"' })
      const lines = (res || '').split(/\r?\n/).filter(Boolean)
      const apps: AppInfo[] = []
      for (const line of lines) {
        const [name, exec] = line.split('|')
        if (!name) continue
        apps.push({ name, exec })
      }
      return apps
    } catch {
      return []
    }
  },

  /** 最近開いたファイル（GTKの recently-used.xbel から最大50件を抽出） */
  async getRecentFiles(limit = 24): Promise<{ name: string; path: string }[]> {
    try {
      const lim = Math.max(1, Math.min(50, limit))
      const cmd = `bash -lc "recent=\"$HOME/.local/share/recently-used.xbel\"; if [ -f \"$recent\" ]; then grep -ao 'file://[^\"\n]*' \"$recent\" | sed 's|file://||' | head -n ${lim}; fi"`
      const text = await safeInvoke<string>('run_safe_command', { cmdline: cmd })
      const paths = (text || '').split(/\r?\n/).filter(Boolean)
      return paths.map((p) => ({ name: p.split('/').pop() || p, path: p }))
    } catch {
      return []
    }
  },

  async controlCenterState(): Promise<{ volume: number; brightness: number; network: boolean; bluetooth: boolean }>{
    return await safeInvoke('control_center_state')
  },

  async setVolume(volume: number): Promise<{ ok: boolean }> {
  try { await safeInvoke('set_volume', { volume }); return { ok: true } }
  catch { return { ok: false } }
  },

  async getRecentApps(): Promise<AppInfo[]> {
  try { return await safeInvoke<AppInfo[]>('get_recent_apps') }
  catch { return [] }
  },

  async resolveWindowApp(wclass: string, title: string): Promise<AppInfo> {
    return await safeInvoke<AppInfo>('resolve_window_app', { wclass, title })
  },

  async recordLaunchGuess(exec: string, name: string, icon_data_url?: string): Promise<{ ok: boolean }> {
    try { await safeInvoke('record_launch_guess', { exec, name, icon_data_url }); return { ok: true } } catch { return { ok: false } }
  },

  async getLaunchHistory(limit = 20): Promise<AppInfo[]> {
    try { return await safeInvoke<AppInfo[]>('get_launch_history', { limit }) }
    catch { return [] }
  },

  async getFolderCounts(): Promise<{ pictures: number; documents: number; videos: number; downloads: number; music: number; others: number }>{
    try {
      return await safeInvoke('get_folder_counts')
    } catch {
      return { pictures: 0, documents: 0, videos: 0, downloads: 0, music: 0, others: 0 }
    }
  },

  async listDesktopItems(): Promise<{ name: string; path: string; is_dir: boolean }[]> {
    try { return await safeInvoke('list_desktop_items') } catch { return [] }
  },

  async listDocumentsItems(): Promise<{ name: string; path: string; is_dir: boolean }[]> {
    try { return await safeInvoke('list_documents_items') } catch { return [] }
  },

  async setWallpaper(path: string): Promise<{ ok: boolean; message?: string }>{
    try { const msg = await safeInvoke<string>('set_wallpaper', { path }); return { ok: true, message: msg } }
    catch (e) { return { ok: false, message: (e as Error)?.message } }
  },

  async getSettings(): Promise<any> { try { return await safeInvoke('get_settings') } catch { return {} } },
  async setSettings(s: any): Promise<{ ok: boolean; message?: string }>{
    try { const msg = await safeInvoke<string>('set_settings', { new_s: s }); return { ok: true, message: msg } }
    catch (e) { return { ok: false, message: (e as Error)?.message } }
  },
  async tryStartLmStudio(): Promise<{ ok: boolean; message?: string }>{
    try { const msg = await safeInvoke<string>('try_start_lmstudio'); return { ok: true, message: msg } }
    catch (e) { return { ok: false, message: (e as Error)?.message } }
  },
  async reorderFavoriteApps(names: string[]): Promise<{ ok: boolean; message?: string }>{
    try { const msg = await safeInvoke<string>('reorder_favorite_apps', { names }); return { ok: true, message: msg } }
    catch (e) { return { ok: false, message: (e as Error)?.message } }
  },

  async getFavoriteApps(): Promise<AppInfo[]> {
  try { return await safeInvoke<AppInfo[]>('get_favorite_apps') }
  catch { return [] }
  },

  async addFavoriteApp(app: AppInfo): Promise<{ ok: boolean }> {
  try { await safeInvoke('add_favorite_app', { app }); return { ok: true } }
  catch { return { ok: false } }
  },

  async removeFavoriteApp(appName: string): Promise<{ ok: boolean }> {
  try { await safeInvoke('remove_favorite_app', { appName }); return { ok: true } }
  catch { return { ok: false } }
  },

  async takeScreenshot(): Promise<{ ok: boolean }> {
  try { await safeInvoke('take_screenshot'); return { ok: true } }
  catch { return { ok: false } }
  },

  async playPauseMusic(): Promise<{ ok: boolean }> {
  try { await safeInvoke('play_pause_music'); return { ok: true } }
  catch { return { ok: false } }
  },

  async nextTrack(): Promise<{ ok: boolean }> {
  try { await safeInvoke('next_track'); return { ok: true } }
  catch { return { ok: false } }
  },

  async previousTrack(): Promise<{ ok: boolean }> {
  try { await safeInvoke('previous_track'); return { ok: true } }
  catch { return { ok: false } }
  },

  async organizeFile(filePath: string): Promise<{ ok: boolean; path: string }> {
  try { await safeInvoke('organize_file', { filePath }); return { ok: true, path: filePath } }
  catch { return { ok: false, path: filePath } }
  },

  async organizeLatestDownload(): Promise<{ ok: boolean; message?: string }> {
    try {
      const msg = await safeInvoke<string>('organize_latest_download')
      return { ok: true, message: msg }
    } catch (e) {
      return { ok: false, message: (e as Error)?.message }
    }
  },

  async setBrightness(percent: number): Promise<{ ok: boolean; message?: string }> {
    try {
      const msg = await safeInvoke<string>('set_brightness', { percent: Math.max(0, Math.min(100, Math.floor(percent))) })
      return { ok: true, message: msg }
    } catch (e) {
      return { ok: false, message: (e as Error)?.message }
    }
  },

  async launchApp(exec: string): Promise<{ ok: boolean; message?: string }> {
    try {
      const msg = await safeInvoke<string>('launch_app', { exec })
      return { ok: true, message: msg }
    } catch (e) {
      return { ok: false, message: (e as Error)?.message }
    }
  },

  async overlayStatus(): Promise<boolean> {
    try {
      return await safeInvoke<boolean>('overlay_status')
    } catch {
      return false
    }
  },

  async overlayStart(): Promise<{ ok: boolean; message?: string }> {
    try {
      const msg = await safeInvoke<string>('overlay_start')
      return { ok: true, message: msg }
    } catch (e) {
      return { ok: false, message: (e as Error)?.message }
    }
  },

  async overlayStop(): Promise<{ ok: boolean; message?: string }> {
    try {
      const msg = await safeInvoke<string>('overlay_stop')
      return { ok: true, message: msg }
    } catch (e) {
      return { ok: false, message: (e as Error)?.message }
    }
  },

  async networkSet(enable: boolean): Promise<{ ok: boolean; message?: string }> {
    try {
      const msg = await safeInvoke<string>('network_set', { enable })
      return { ok: true, message: msg }
    } catch (e) {
      return { ok: false, message: (e as Error)?.message }
    }
  },

  async bluetoothSet(enable: boolean): Promise<{ ok: boolean; message?: string }> {
    try {
      const msg = await safeInvoke<string>('bluetooth_set', { enable })
      return { ok: true, message: msg }
    } catch (e) {
      return { ok: false, message: (e as Error)?.message }
    }
  },

  async powerAction(action: 'shutdown' | 'reboot' | 'logout'): Promise<{ ok: boolean; message?: string }> {
    try {
      const msg = await safeInvoke<string>('power_action', { action })
      return { ok: true, message: msg }
    } catch (e) {
      return { ok: false, message: (e as Error)?.message }
    }
  },

  async llmQuery(prompt: string): Promise<{ ok: boolean; text?: string; message?: string }> {
    try {
      const text = await safeInvoke<string>('llm_query', { prompt })
      return { ok: true, text }
    } catch (e) {
      return { ok: false, message: (e as Error)?.message }
    }
  },

  async llmQueryRemote(baseUrl: string, prompt: string, apiKey?: string, model?: string): Promise<{ ok: boolean; text?: string; message?: string }>{
    try {
      const text = await safeInvoke<string>('llm_query_remote', { baseUrl, apiKey, model, prompt })
      return { ok: true, text }
    } catch (e) {
      return { ok: false, message: (e as Error)?.message }
    }
  },

  async llmDownloadHf(modelId: string): Promise<{ ok: boolean; path?: string; message?: string }>{
    try {
      const path = await safeInvoke<string>('llm_download_hf', { modelId })
      return { ok: true, path }
    } catch (e) {
      return { ok: false, message: (e as Error)?.message }
    }
  },

  async listLocalModels(): Promise<string[]>{
    try { return await safeInvoke<string[]>('list_local_models') }
    catch { return [] }
  },

  async runSafeCommand(cmdline: string): Promise<{ ok: boolean; text?: string; message?: string }> {
    try {
      const text = await safeInvoke<string>('run_safe_command', { cmdline })
      return { ok: true, text }
    } catch (e) {
      return { ok: false, message: (e as Error)?.message }
    }
  },

  async openPath(path: string): Promise<{ ok: boolean; message?: string }>{
    try {
      let pth = (path || '').trim()
      if (pth.startsWith('~')) {
        try {
          const { homeDir } = await import('@tauri-apps/api/path')
          const home = await homeDir()
          pth = home.replace(/\/?$/, '/') + pth.slice(2)
        } catch {
          // fallback via echo $HOME
          try {
            const r = await this.runSafeCommand('echo $HOME')
            const home = (r.text || '').trim()
            if (home) pth = home.replace(/\/?$/, '/') + pth.slice(2)
          } catch { /* ignore */ }
        }
      }
      if (pth.startsWith('file://')) { pth = pth.replace(/^file:\/\//, '') }
      const esc = pth.replace(/'/g, "'\\''")
      const cmd = `xdg-open '${esc}' >/dev/null 2>&1 & disown; echo OK`
      const text = await safeInvoke<string>('run_safe_command', { cmdline: cmd })
      return { ok: (text||'').includes('OK') }
    } catch (e) {
      return { ok: false, message: (e as Error)?.message }
    }
  },

  // 画像ファイル選択（zenity/kdialog→ブラウザinput）
  async pickImageFile(): Promise<string | null> {
    // Try native dialogs via zenity or kdialog
    try {
      const cmd = `sh -lc '(
        zenity --file-selection --title="壁紙を選択" --file-filter="画像 | *.png *.jpg *.jpeg *.gif *.webp *.bmp *.svg" 2>/dev/null || \
        kdialog --getopenfilename "$HOME" "*.png *.jpg *.jpeg *.gif *.webp *.bmp *.svg|画像" 2>/dev/null
      ) | sed -n 1p'`
      const text = await safeInvoke<string>('run_safe_command', { cmdline: cmd })
      const p = (text || '').split(/\r?\n/)[0]?.trim()
      if (p) return p
    } catch { /* ignore */ }

    // Browser fallback: <input type="file">
    return await new Promise<string | null>((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) return resolve(null)
        const url = URL.createObjectURL(file)
        resolve(url)
      }
      input.click()
    })
  },

  async clamavScan(path: string): Promise<{ ok: boolean; text?: string; message?: string }> {
    try {
      const text = await safeInvoke<string>('clamav_scan', { path })
      return { ok: true, text }
    } catch (e) {
      return { ok: false, message: (e as Error)?.message }
    }
  },

  async kdeconnectList(): Promise<{ ok: boolean; text?: string; message?: string }> {
    try {
      const text = await safeInvoke<string>('kdeconnect_list')
      return { ok: true, text }
    } catch (e) {
      return { ok: false, message: (e as Error)?.message }
    }
  },

  async getBackendLog(limit?: number): Promise<string> {
    try { return await safeInvoke<string>('get_backend_log', { limit }) } catch { return '' }
  },
  async clearBackendLog(): Promise<{ ok: boolean; message?: string }> {
    try { const msg = await safeInvoke<string>('clear_backend_log'); return { ok: true, message: msg } } catch (e) { return { ok: false, message: (e as Error)?.message } }
  },

  async runWithSudo(cmdline: string, password: string): Promise<{ ok: boolean; text?: string; message?: string }> {
    try {
      const text = await safeInvoke<string>('run_with_sudo', { cmdline, password })
      return { ok: true, text }
    } catch (e) {
      return { ok: false, message: (e as Error)?.message }
    }
  },

  // Ubuntu固有のシステム機能
  async ubuntuUpdateSystem(): Promise<{ ok: boolean; message?: string }> {
    try {
      const msg = await safeInvoke<string>('ubuntu_update_system')
      return { ok: true, message: msg }
    } catch (e) {
      return { ok: false, message: (e as Error)?.message }
    }
  },

  async ubuntuInstallPackage(packageName: string): Promise<{ ok: boolean; message?: string }> {
    try {
      const msg = await safeInvoke<string>('ubuntu_install_package', { packageName })
      return { ok: true, message: msg }
    } catch (e) {
      return { ok: false, message: (e as Error)?.message }
    }
  },

  async ubuntuSystemSettings(): Promise<{ ok: boolean; message?: string }> {
    try {
      const msg = await safeInvoke<string>('ubuntu_system_settings')
      return { ok: true, message: msg }
    } catch (e) {
      return { ok: false, message: (e as Error)?.message }
    }
  },

  async ubuntuSoftwareCenter(): Promise<{ ok: boolean; message?: string }> {
    try {
      const msg = await safeInvoke<string>('ubuntu_software_center')
      return { ok: true, message: msg }
    } catch (e) {
      return { ok: false, message: (e as Error)?.message }
    }
  },

  async ubuntuSetTheme(theme: 'light' | 'dark'): Promise<{ ok: boolean; message?: string }> {
    try {
      const msg = await safeInvoke<string>('ubuntu_set_theme', { theme })
      return { ok: true, message: msg }
    } catch (e) {
      return { ok: false, message: (e as Error)?.message }
    }
  },

  async trackRecentFiles(): Promise<{ ok: boolean; files?: { name: string; path: string; timestamp: number }[] }> {
    try {
      const files = await safeInvoke<{ name: string; path: string; timestamp: number }[]>('track_recent_files')
      return { ok: true, files }
    } catch (e) {
      return { ok: false }
    }
  },

  async getDetailedSystemInfo(): Promise<{
    os: string;
    kernel: string;
    uptime: string;
    cpu: string;
    memory: { total: string; used: string; available: string };
    disk: { total: string; used: string; available: string };
  }> {
    try {
      return await safeInvoke('get_detailed_system_info')
    } catch {
  // フォールバック: 基本的なシステム情報を手動で取得
      try {
        const osResult = await this.runSafeCommand('lsb_release -d 2>/dev/null | cut -f2 || uname -o 2>/dev/null || echo "Unknown"')
        const kernelResult = await this.runSafeCommand('uname -r 2>/dev/null || echo "Unknown"')
        const uptimeResult = await this.runSafeCommand('uptime -p 2>/dev/null || echo "Unknown"')
        const cpuResult = await this.runSafeCommand('grep "model name" /proc/cpuinfo 2>/dev/null | head -1 | cut -d: -f2 | sed "s/^ *//" || echo "Unknown"')
        const memResult = await this.runSafeCommand('free -h 2>/dev/null | grep "Mem:" | awk "{print $3\"|\"$2\"|\"$7}" || echo "Unknown|Unknown|Unknown"')
        const diskResult = await this.runSafeCommand('df -h / 2>/dev/null | tail -1 | awk "{print $3\"|\"$2\"|\"$4}" || echo "Unknown|Unknown|Unknown"')
        
        const memParts = (memResult.text || 'Unknown|Unknown|Unknown').split('|')
        const diskParts = (diskResult.text || 'Unknown|Unknown|Unknown').split('|')
        
        return {
          os: (osResult.text || 'Unknown').trim(),
          kernel: (kernelResult.text || 'Unknown').trim(),
          uptime: (uptimeResult.text || 'Unknown').trim(),
          cpu: (cpuResult.text || 'Unknown').trim(),
          memory: { 
            used: memParts[0]?.trim() || 'N/A', 
            total: memParts[1]?.trim() || 'N/A', 
            available: memParts[2]?.trim() || 'N/A' 
          },
          disk: { 
            used: diskParts[0]?.trim() || 'N/A', 
            total: diskParts[1]?.trim() || 'N/A', 
            available: diskParts[2]?.trim() || 'N/A' 
          }
        }
  } catch {
        return {
          os: 'Ubuntu Linux (推定)',
          kernel: 'N/A',
          uptime: 'N/A',
          cpu: 'N/A',
          memory: { total: 'N/A', used: 'N/A', available: 'N/A' },
          disk: { total: 'N/A', used: 'N/A', available: 'N/A' }
        }
      }
    }
  },
}

export type Api = typeof api
