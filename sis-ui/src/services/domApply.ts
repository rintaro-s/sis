export type Appearance = {
  dockOpacity?: number
  dockBlur?: number
  dockIcon?: number
  appIcon?: number
}

export function resolveThemePref(theme?: string): 'light' | 'dark' {
  const pref = theme || 'system'
  if (pref === 'system') {
    const dark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    return dark ? 'dark' : 'light'
  }
  return (pref === 'light') ? 'light' : 'dark'
}

export function applyThemeToDom(theme?: string) {
  const applied = resolveThemePref(theme)
  try { document.body.setAttribute('data-theme', applied==='light'?'light':'dark') } catch {}
  try { localStorage.setItem('sis-theme', applied) } catch {}
  return applied
}

export function applyAppearanceToDom(ap?: Appearance) {
  const r = (v:number, min:number, max:number)=>Math.max(min, Math.min(max, Number(v)))
  const op = r(Number(ap?.dockOpacity ?? 0.95), 0, 1)
  const bl = r(Number(ap?.dockBlur ?? 20), 0, 60)
  const di = r(Number(ap?.dockIcon ?? 56), 32, 96)
  const ai = r(Number(ap?.appIcon ?? 80), 48, 128)
  document.documentElement.style.setProperty('--sis-dock-opacity', String(op))
  document.documentElement.style.setProperty('--sis-dock-blur', `${bl}px`)
  document.documentElement.style.setProperty('--sis-dock-icon', `${di}px`)
  document.documentElement.style.setProperty('--sis-app-icon', `${ai}px`)
  return { op, bl, di, ai }
}

export async function applyWallpaperToDom(wallpaper: string | undefined, cssUrlForPath: (v:string)=>Promise<string>) {
  if (!wallpaper) {
    document.documentElement.style.removeProperty('--desktop-wallpaper')
    return ''
  }
  try {
    const cssVal = await cssUrlForPath(wallpaper)
    document.documentElement.style.setProperty('--desktop-wallpaper', cssVal)
    return cssVal
  } catch {
    const v = wallpaper.trim()
    const cssVal = /^url\(/i.test(v) ? v : `url('${v}')`
    document.documentElement.style.setProperty('--desktop-wallpaper', cssVal)
    return cssVal
  }
}

export async function applyAllToDom(settings: any, helpers: { cssUrlForPath: (v:string)=>Promise<string> }) {
  console.log('[domApply] Applying settings:', settings)
  // Ignore stale updates using monotonically increasing revision
  const inc = (settings && typeof settings.rev === 'number') ? settings.rev : (Number(settings?.rev) || 0)
  if (typeof (window as any).__sis_settings_rev === 'number' && inc <= (window as any).__sis_settings_rev) {
    console.log('[domApply] Ignoring stale update, rev:', inc, 'current:', (window as any).__sis_settings_rev)
    return
  }
  ;(window as any).__sis_settings_rev = inc
  console.log('[domApply] Applying theme:', settings?.theme)
  applyThemeToDom(settings?.theme)
  console.log('[domApply] Applying appearance:', settings?.appearance)
  applyAppearanceToDom(settings?.appearance)
  console.log('[domApply] Applying wallpaper:', settings?.wallpaper)
  await applyWallpaperToDom(settings?.wallpaper, helpers.cssUrlForPath)
  console.log('[domApply] Applied all')
}

let systemThemeWatcherBound = false
export function ensureSystemThemeWatcher() {
  if (systemThemeWatcherBound) return
  systemThemeWatcherBound = true
  try {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = () => {
        // Re-evaluate theme when user prefers-color-scheme changes
        applyThemeToDom('system')
      }
      // modern browsers
      if (typeof mq.addEventListener === 'function') mq.addEventListener('change', handler)
      else if (typeof (mq as any).addListener === 'function') (mq as any).addListener(handler)
    }
  } catch {}
}
