import { useEffect, useState } from 'react';
import { api, type AppInfo } from '../services/api';
import './HomeScreen.css';
import './Settings.css';

function HomeScreen() {
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [favorites, setFavorites] = useState<AppInfo[]>([]);
  const [desktopFiles, setDesktopFiles] = useState<{ name: string; path: string; is_dir?: boolean }[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [currentTime, setCurrentTime] = useState(new Date());
  const [theme, setTheme] = useState<'system'|'light'|'dark'>('system')
  const [wallpaper, setWallpaper] = useState<string>('')

  useEffect(() => {
    let mounted = true;
    const tick = setInterval(()=>{ if(mounted) setCurrentTime(new Date()) }, 1000)
    
    const loadData = async () => {
      try {
        // アプリ一覧
        const list = await api.listApplications();
        // 現在開いているウィンドウから未インデックスを推定
        let merged = list
        try {
          const wins = await api.getOpenWindows()
          const names = new Set(merged.map(a=>a.name))
          const inferred: AppInfo[] = []
          for (const w of wins) {
            const guess = (w.title || '').split(' - ').pop() || w.wclass || w.title
            if (guess && !names.has(guess)) {
              inferred.push({ name: guess })
              names.add(guess)
            }
          }
          if (inferred.length) merged = [...merged, ...inferred]
        } catch {}
        // 重複除去（名前/exec単位、アイコン付きやexecありを優先）
        const byKey = new Map<string, AppInfo>()
        const norm = (s?: string) => (s||'').toLowerCase().trim()
        for (const a of merged) {
          const key = a.exec ? `exec:${norm(a.exec)}` : `name:${norm(a.name)}`
          const prev = byKey.get(key)
          if (!prev) { byKey.set(key, a); continue }
          const pick = (a.icon_data_url ? 2 : 0) + (a.exec ? 1 : 0)
          const prevScore = (prev.icon_data_url ? 2 : 0) + (prev.exec ? 1 : 0)
          if (pick > prevScore) byKey.set(key, a)
        }
        const deduped = Array.from(byKey.values())
        if (mounted) setApps(deduped);
        // お気に入り
        const fav = await api.getFavoriteApps();
        if (mounted) setFavorites(fav);

        // デスクトップ表示（バックエンドに委譲）
        try {
          const items = await api.listDesktopItems().catch(()=>[])
          if (mounted) setDesktopFiles(items.map(i=>({ name: i.name, path: i.path, is_dir: i.is_dir })))
        } catch {}
      } catch (error) {
        console.error('データの読み込みに失敗:', error);
      }
    };

  loadData().then(()=>{ try { window.dispatchEvent(new Event('sis:apps-refreshed')) } catch {} })
    const interval = setInterval(loadData, 8000);
    
    return () => {
      mounted = false;
      clearInterval(interval);
      clearInterval(tick)
    };
  }, []);

  // 初期設定読み込み（テーマ/外観/壁紙）
  useEffect(() => {
    let mounted = true
    ;(async()=>{
      try {
        const s = await api.getSettings().catch(()=>({})) as any
        if (!mounted) return
        if (s?.theme) setTheme(s.theme)
        if (typeof s?.wallpaper === 'string') setWallpaper(s.wallpaper)
      } catch {}
    })()
    return ()=>{ mounted = false }
  }, [])

  // デスクトップ画像のサムネを data URL 化して読み込み安定性を向上
  useEffect(() => {
    let cancelled = false
    ;(async()=>{
      const need = desktopFiles
        .filter(f=>!f.is_dir && /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name))
        .filter(f=>!thumbs[f.path])
      if (need.length === 0) return
      const entries: Array<[string,string]> = []
      for (const f of need.slice(0, 40)) { // 上限を抑制
        try {
          const url = await api.fileToDataUrl(f.path)
          if (url && url.startsWith('data:')) {
            entries.push([f.path, url])
            console.log('Generated thumb for', f.path, url.slice(0, 50) + '...')
          } else {
            console.warn('Invalid data URL for', f.path, url)
          }
        } catch (err) {
          console.warn('Failed to load preview for', f.path, err)
          // フォールバック: convertFileSrc → file:// の順に試す
          try {
            const core = await import('@tauri-apps/api/core')
            const url = core.convertFileSrc(f.path)
            if (url) {
              entries.push([f.path, url])
              console.log('Fallback thumb for', f.path, url)
            }
            continue
          } catch {}
          try {
            const fileUrl = f.path.startsWith('file://') ? f.path : `file://${f.path}`
            entries.push([f.path, fileUrl])
            console.log('File URL thumb for', f.path, fileUrl)
          } catch {}
        }
      }
      if (!cancelled && entries.length) {
        setThumbs(prev=>{ const next={...prev}; for (const [k,v] of entries) next[k]=v; return next })
      }
    })()
    return ()=>{ cancelled = true }
  }, [desktopFiles])

  const openFile = (path: string) => { api.openPath(path) };

  const launchApp = (exec: string) => { api.launchApp(exec) };

  const isFav = (a: AppInfo) => favorites.some(f=>f.name===a.name)
  const togglePin = async (a: AppInfo)=>{
    if (isFav(a)) { await api.removeFavoriteApp(a.name!) } else { await api.addFavoriteApp(a) }
  const fav = await api.getFavoriteApps(); setFavorites(fav)
  // サイドバーへ更新通知
  window.dispatchEvent(new Event('sis:favorites-updated'))
  }

  // 設定はSidebarのクイックアクションに移動

  const applyTheme = async (t: 'system'|'light'|'dark') => {
    setTheme(t)
    const applied = t === 'system'
      ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : t
    try { document.body.setAttribute('data-theme', applied==='light'?'light':'dark') } catch {}
    localStorage.setItem('sis-theme', applied)
    try { await api.setSettings({ ...(await api.getSettings().catch(()=>({} as any))), theme: t }) } catch {}
    try { await api.emitGlobalEvent('sis:apply-theme', { theme: applied }) } catch {}
  }

  const pickWallpaper = async () => {
    const picked = await api.pickImageFile()
    if (!picked) return
    setWallpaper(picked)
    try { await api.setSettings({ ...(await api.getSettings().catch(()=>({} as any))), wallpaper: picked }) } catch {}
    try {
      const cssVal = await api.cssUrlForPath(picked)
      document.documentElement.style.setProperty('--desktop-wallpaper', cssVal)
      try { await api.emitGlobalEvent('sis:wallpaper-changed', { css: cssVal }) } catch {}
    } catch {}
  }

  const clearWallpaper = async () => {
    setWallpaper('')
    try { await api.setSettings({ ...(await api.getSettings().catch(()=>({} as any))), wallpaper: '' }) } catch {}
    document.documentElement.style.removeProperty('--desktop-wallpaper')
    try { await api.emitGlobalEvent('sis:wallpaper-changed', { css: '' }) } catch {}
  }

  return (
    <div className="futuristic-home" style={{ paddingBottom: 'var(--sis-dock-height, 68px)' }}>
  {/* 壁紙はApp側で一元適用 */}
      
      {/* ウェルカムセクション */}
      <div className="welcome-section">
        <div className="welcome-card">
          <div className="welcome-content">
            <h1 className="welcome-title">
              <span className="title-main">おかえりなさい</span>
              <span className="title-sub">Smart Interface System</span>
            </h1>
            <div className="welcome-time">
              {currentTime.toLocaleDateString('ja-JP', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long'
              })} - {currentTime.toLocaleTimeString('ja-JP', {
                hour: '2-digit',
                minute: '2-digit'
              })}
            </div>
          </div>
          <div className="welcome-visual" style={{ minWidth: 320 }}>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <div className="setting-group">
                <label className="setting-label">テーマ</label>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  {(['system','light','dark'] as const).map(t => (
                    <button key={t} className={`game-btn ${theme===t?'primary':'secondary'}`} onClick={()=>applyTheme(t)}>{t==='system'?'システム':t==='light'?'ライト':'ダーク'}</button>
                  ))}
                </div>
              </div>
              <div className="setting-group">
                <label className="setting-label">壁紙</label>
                <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                  <input type="text" className="game-input" placeholder="/path/to/wallpaper.jpg または url(...)" value={wallpaper} onChange={async (e)=>{
                    const v = e.target.value; setWallpaper(v)
                  }} style={{ minWidth: 180 }} />
                  <button className="game-btn secondary" onClick={pickWallpaper}>画像を選択</button>
                  <button className="game-btn secondary" onClick={clearWallpaper}>クリア</button>
                  <button className="game-btn primary" onClick={async()=>{
                    if (!wallpaper) return
                    try {
                      const cssVal = await api.cssUrlForPath(wallpaper)
                      document.documentElement.style.setProperty('--desktop-wallpaper', cssVal)
                      try { await api.emitGlobalEvent('sis:wallpaper-changed', { css: cssVal }) } catch {}
                      try { await api.setSettings({ ...(await api.getSettings().catch(()=>({} as any))), wallpaper }) } catch {}
                    } catch (e) {
                      alert('壁紙の適用に失敗しました')
                    }
                  }}>適用</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* メインダッシュボード */}
      <div className="dashboard-grid">
        {/* アプリ一覧 */}
        <div className="dashboard-card apps-card">
          <div className="card-header">
            <h3 className="card-title">
              <span className="card-icon">APP</span>
              アプリケーション一覧
            </h3>
            <div className="card-badge">{apps.length}</div>
          </div>
          <div className="apps-grid">
            {(() => {
              const favSet = new Set(favorites.map(f=>f.name))
              const list = (apps.filter(a=>a.icon_data_url).length ? apps.filter(a=>a.icon_data_url) : apps)
              const sorted = [...list].sort((a,b)=>{
                const af = favSet.has(a.name!); const bf = favSet.has(b.name!)
                if (af!==bf) return af? -1 : 1
                return (a.name||'').localeCompare(b.name||'')
              })
              return sorted
            })()
              .map((app, index) => (
              <div
                key={index}
                className="app-item"
                onClick={() => app.exec && launchApp(app.exec)}
                onContextMenu={(e)=>{ e.preventDefault(); togglePin(app) }}
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <div className="app-icon-wrapper">
                  {app.icon_data_url ? (
                    <img 
                      src={app.icon_data_url} 
                      alt={app.name}
                      className="app-icon"
                    />
                  ) : (
                    <div className="app-icon" style={{display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,opacity:.7}}>APP</div>
                  )}
                  <div className="app-glow"></div>
                </div>
                <span className="app-name">{app.name}{isFav(app)?' •':''}</span>
              </div>
            ))}
          </div>
        </div>

        {/* デスクトップ */}
        <div className="dashboard-card files-card">
          <div className="card-header">
            <h3 className="card-title">
              <span className="card-icon">FILE</span>
              デスクトップ
            </h3>
            <div className="card-badge">{desktopFiles.length}</div>
          </div>
          <div className="files-grid">
            {desktopFiles.map((file, index) => (
              <div
                key={file.path}
                className="file-card"
                onClick={() => openFile(file.path)}
                title={file.path}
                style={{ animationDelay: `${index * 0.03}s` }}
              >
                <div className="file-thumb">
                  {file.is_dir ? (
                    <div className="file-glyph">📁</div>
                  ) : /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name) ? (
                    <img
                      src={thumbs[file.path] || ('file://' + file.path)}
                      alt="preview"
                      loading="lazy"
                      decoding="async"
                      onError={(e)=>{ 
                        const img = e.target as HTMLImageElement
                        const current = img.getAttribute('data-fallback') || ''
                        if (!current && !thumbs[file.path]) {
                          console.log('No thumb for', file.path, 'trying fallback')
                          try {
                            img.setAttribute('data-fallback', 'convert')
                            import('@tauri-apps/api/core').then(mod=>{ try { img.src = mod.convertFileSrc(file.path); console.log('Convert fallback for', file.path) } catch { img.src = 'file://' + file.path } })
                          } catch {
                            img.setAttribute('data-fallback', 'file')
                            img.src = 'file://' + file.path
                            console.log('File URL fallback for', file.path)
                          }
                        } else { 
                          console.warn('Image error for', file.path, 'no more fallback')
                          img.style.display='none' 
                        }
                      }}
                    />
                  ) : /\.(mp4|webm|ogg|mov|m4v)$/i.test(file.name) ? (
                    <video 
                      muted 
                      preload="metadata" 
                      src={'file://' + file.path}
                      style={{ width:'100%', height:'100%', objectFit:'cover' }}
                      onLoadedMetadata={(e)=>{ const v=e.currentTarget; v.currentTime = Math.min(0.1, (v.duration||1)/10) }}
                      onError={async (e)=>{ 
                        const v = e.currentTarget as HTMLVideoElement
                        try {
                          const mod = await import('@tauri-apps/api/core')
                          v.src = mod.convertFileSrc(file.path)
                        } catch {
                          v.style.display='none'
                        }
                      }}
                    />
                  ) : /\.(txt|md|log)$/i.test(file.name) ? (
                    <div className="file-glyph" style={{fontSize:10, lineHeight:1.2, padding:6, textAlign:'left', width:'100%', height:'100%', overflow:'hidden'}}>
                      <span style={{opacity:.7}}>TXT</span>
                    </div>
                  ) : /\.(mp3|wav|flac|aac|m4a|ogg)$/i.test(file.name) ? (
                    <div className="file-glyph">🎵</div>
                  ) : /\.(pdf)$/i.test(file.name) ? (
                    <div className="file-glyph">📕</div>
                  ) : (
                    <div className="file-glyph">📄</div>
                  )}
                </div>
                <div className="file-label" title={file.name}>{file.name}</div>
              </div>
            ))}
          </div>
        </div>

  {/* システム情報カードはTopBarに集約するため削除（レイアウト圧迫を回避） */}

      </div>
    </div>
  );
}

export default HomeScreen
