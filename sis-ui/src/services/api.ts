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
  // Try official API first (Tauri v2 recommended)
  try {
    const mod = await import('@tauri-apps/api/core')
    if (typeof mod.invoke === 'function') {
      cachedInvoke = mod.invoke as TauriInvoke
      return cachedInvoke
    }
  } catch {
    // ignore
  }
  // Fallback to window.__TAURI__ injection
  const w = getTauriInvokeFromWindow()
  if (w) { cachedInvoke = w; return cachedInvoke }
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
  async getSystemInfo(): Promise<SystemInfo> {
  const raw = await safeInvoke<string>('get_system_info')
  const parsed = JSON.parse(raw) as SystemInfo
  return parsed
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

  async getFolderCounts(): Promise<{ pictures: number; documents: number; videos: number; downloads: number; music: number; others: number }>{
    try {
      return await safeInvoke('get_folder_counts')
    } catch {
      return { pictures: 0, documents: 0, videos: 0, downloads: 0, music: 0, others: 0 }
    }
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

  async runSafeCommand(cmdline: string): Promise<{ ok: boolean; text?: string; message?: string }> {
    try {
      const text = await safeInvoke<string>('run_safe_command', { cmdline })
      return { ok: true, text }
    } catch (e) {
      return { ok: false, message: (e as Error)?.message }
    }
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

  async runWithSudo(cmdline: string, password: string): Promise<{ ok: boolean; text?: string; message?: string }> {
    try {
      const text = await safeInvoke<string>('run_with_sudo', { cmdline, password })
      return { ok: true, text }
    } catch (e) {
      return { ok: false, message: (e as Error)?.message }
    }
  },
}

export type Api = typeof api
