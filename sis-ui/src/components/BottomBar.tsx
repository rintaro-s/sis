import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import './BottomBar.css';

function BottomBar() {
  const [openWindows, setOpenWindows] = useState<{ id: string; wclass: string; title: string; icon_data_url?: string }[]>([]);
  const [recentApps, setRecentApps] = useState<any[]>([]);
  const [hoveredApp, setHoveredApp] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [wins, apps] = await Promise.all([
          api.getOpenWindows().catch(()=>[]),
          api.getRecentApps().catch(async()=>{
            // フォールバック: listApplicationsから先頭数件
            try { const la = await api.listApplications(); return la.slice(0,5) } catch { return [] }
          })
        ])
        if (!mounted) return
        const w = wins.filter(w=>!!w.title)
        console.log('Open windows:', w)
        console.log('Recent apps:', apps)
        setOpenWindows(w)

        // 未インデックスのアプリをウィンドウから推定し、最近候補に加える
        const appByName = new Map<string, any>()
        for (const a of apps || []) { if (a?.name) appByName.set((a.name||'').toLowerCase(), a) }
        const inferred: any[] = []
        for (const win of w) {
          const guessRaw = (win.title || '').split(' - ').pop() || win.wclass || win.title
          const guess = (guessRaw||'').toLowerCase()
          if (!guess) continue
          if (!appByName.has(guess)) inferred.push({ name: guessRaw, exec: undefined, icon_data_url: undefined })
        }
        // 開いているウィンドウに対して既知アプリのアイコンを紐づける
        const merged = [...(apps||[]), ...inferred]
        const knownIconByKey = new Map<string, string | undefined>()
        for (const a of apps || []) {
          const key = (a.name||'').toLowerCase()
          if (key) knownIconByKey.set(key, a.icon_data_url)
        }
        // Backend側で解決済みのicon_data_urlをそのまま採用
  setOpenWindows(w as any)
  // Dock用 最近: アイコンあり優先で最大5件
  const withIcon = merged.filter(a=>!!a.icon_data_url)
  const withoutIcon = merged.filter(a=>!a.icon_data_url)
  const shortlist = [...withIcon, ...withoutIcon].slice(0, 5)
  setRecentApps(shortlist)
      } catch {}
    }
    load()
    const iv = setInterval(load, 3000)
    return ()=>{ mounted = false; clearInterval(iv) }
  }, []);

  const launchApp = async (app: any) => {
    if (!app) return
    if (app.exec) await api.launchApp(app.exec)
  };

  const focusWin = async (id: string) => { await api.focusWindow(id) }

  // Dock表示: 起動中と最近で分割し、重複排除
  const openIcons = useMemo(() => openWindows.map(w=>({ key:w.id, title:w.title, icon:w.icon_data_url, type:'win' as const })), [openWindows])
  const recentIcons = useMemo(() => {
    const dup = new Set<string>()
    for (const w of openWindows) { const t=(w.title||'').toLowerCase(); if(t) dup.add(t) }
    return (recentApps||[])
      .filter(a=>!!a?.name)
      .filter(a=>!Array.from(dup).some(t=>t.includes((a.name||'').toLowerCase())))
      .map(a=>({ key:a.name, title:a.name, icon:a.icon_data_url, type:'app' as const, app:a }))
      .slice(0,5)
  }, [recentApps, openWindows])

  return (
    <div className="futuristic-dock crystal">
      {/* Dockアイコン（起動中） */}
      <div className="dock-apps">
        {openIcons.map((item: any, index: number) => (
          <div
            key={item.key}
            className="dock-app"
            onClick={() => item.type==='win' ? focusWin(item.key) : launchApp(item.app)}
            onMouseEnter={() => setHoveredApp(item.title)}
            onMouseLeave={() => setHoveredApp(null)}
            style={{ animationDelay: `${index * 0.1}s` }}
          >
            <div className="app-icon-container">
              <img 
                src={item.icon || '/vite.svg'} 
                alt={item.title}
                className="app-icon"
              />
            </div>
            {hoveredApp === item.title && (
              <div className="app-tooltip">
                {item.title}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* セパレーター */}
      <div className="dock-separator" aria-hidden="true"></div>

      {/* Dockアイコン（最近） */}
      <div className="dock-apps">
        {recentIcons.map((item: any, index: number) => (
          <div
            key={item.key}
            className="dock-app"
            onClick={() => item.type==='win' ? focusWin(item.key) : launchApp(item.app)}
            onMouseEnter={() => setHoveredApp(item.title)}
            onMouseLeave={() => setHoveredApp(null)}
            style={{ animationDelay: `${index * 0.1}s` }}
          >
            <div className="app-icon-container">
              <img 
                src={item.icon || '/vite.svg'} 
                alt={item.title}
                className="app-icon"
              />
            </div>
            {hoveredApp === item.title && (
              <div className="app-tooltip">
                {item.title}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* コントロールセンター起動 */}
      <div className="dock-right">
        <button className="quick-btn" title="コントロールセンター" onClick={()=>{
          window.dispatchEvent(new Event('sis:toggle-cc'))
        }}>⚙️</button>
      </div>
    </div>
  );
}

export default BottomBar;
