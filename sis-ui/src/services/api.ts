// 軽量なAPIラッパー。Tauriが利用できればinvoke、なければモックを返す。
// 依存関係を避けるため静的importは使わず、ランタイム検出でinvokeを取得します。
type TauriInvoke = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>

function getTauriInvoke(): TauriInvoke | null {
  const w = globalThis as Record<string, unknown>
  const tauri = w.__TAURI__ as
    | { core?: { invoke?: TauriInvoke }; tauri?: { invoke?: TauriInvoke } }
    | undefined
  const v2 = tauri?.core?.invoke
  const v1 = tauri?.tauri?.invoke
  return v2 ?? v1 ?? null
}

export type SystemInfo = {
  cpuUsage: number
  memUsage: number
  downloadSpeed: number
  uploadSpeed: number
}

export type AppInfo = { name: string; exec?: string }

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms))

async function safeInvoke<T = unknown>(cmd: string, payload?: Record<string, unknown>): Promise<T> {
  const inv = getTauriInvoke()
  if (!inv) throw new Error('invoke-unavailable')
  return inv<T>(cmd, payload)
}

export const api = {
  async getSystemInfo(): Promise<SystemInfo> {
    try {
      const raw = await safeInvoke<string>('get_system_info')
      const parsed = JSON.parse(raw) as SystemInfo
      return parsed
    } catch {
      // モック
      await delay(200)
      return {
        cpuUsage: 37.2,
        memUsage: 62,
        downloadSpeed: 0,
        uploadSpeed: 0,
      }
    }
  },

  async setVolume(volume: number): Promise<{ ok: boolean }> {
    try {
      await safeInvoke('set_volume', { volume })
      return { ok: true }
    } catch {
      await delay(100)
      return { ok: true }
    }
  },

  async getRecentApps(): Promise<AppInfo[]> {
    try {
      return await safeInvoke<AppInfo[]>('get_recent_apps')
    } catch {
      await delay(150)
      return [
  { name: 'ブラウザ', exec: 'xdg-open https://example.com' },
  { name: 'ターミナル', exec: 'xfce4-terminal' },
  { name: '設定', exec: 'xfce4-settings-manager' },
      ]
    }
  },

  async getFavoriteApps(): Promise<AppInfo[]> {
    try {
      return await safeInvoke<AppInfo[]>('get_favorite_apps')
    } catch {
      await delay(150)
      return [
        { name: 'メモ' },
        { name: '音楽' },
      ]
    }
  },

  async addFavoriteApp(app: AppInfo): Promise<{ ok: boolean }> {
    try {
      await safeInvoke('add_favorite_app', { app })
      return { ok: true }
    } catch {
      await delay(120)
      return { ok: true }
    }
  },

  async removeFavoriteApp(appName: string): Promise<{ ok: boolean }> {
    try {
      await safeInvoke('remove_favorite_app', { appName })
      return { ok: true }
    } catch {
      await delay(120)
      return { ok: true }
    }
  },

  async takeScreenshot(): Promise<{ ok: boolean }> {
    try {
      await safeInvoke('take_screenshot')
      return { ok: true }
    } catch {
      await delay(100)
      return { ok: true }
    }
  },

  async playPauseMusic(): Promise<{ ok: boolean }> {
    try {
      await safeInvoke('play_pause_music')
      return { ok: true }
    } catch {
      await delay(100)
      return { ok: true }
    }
  },

  async nextTrack(): Promise<{ ok: boolean }> {
    try {
      await safeInvoke('next_track')
      return { ok: true }
    } catch {
      await delay(100)
      return { ok: true }
    }
  },

  async previousTrack(): Promise<{ ok: boolean }> {
    try {
      await safeInvoke('previous_track')
      return { ok: true }
    } catch {
      await delay(100)
      return { ok: true }
    }
  },

  async organizeFile(filePath: string): Promise<{ ok: boolean; path: string }> {
    try {
      await safeInvoke('organize_file', { filePath })
      return { ok: true, path: filePath }
    } catch {
      await delay(200)
      return { ok: true, path: filePath }
    }
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
}

export type Api = typeof api
