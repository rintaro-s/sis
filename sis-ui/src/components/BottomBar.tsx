
import { useEffect, useState } from 'react';
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
        // 既知アイコンが無い場合はバックエンドで.desktopに解決を試みる
        const winsWithIcons = await Promise.all(w.map(async (win)=>{
          const key = ((win.title||'').split(' - ').pop() || win.wclass || win.title || '').toLowerCase()
          let icon = knownIconByKey.get(key)
          if (!icon) {
            try {
              const app = await api.resolveWindowApp(win.wclass, win.title)
              if (app?.icon_data_url) icon = app.icon_data_url
              // 次回のために履歴へ記録
              if (app?.exec && app?.name) {
                await api.recordLaunchGuess(app.exec, app.name, app.icon_data_url)
              }
            } catch {}
          }
          return { ...win, icon_data_url: icon }
        }))
        setOpenWindows(winsWithIcons as any)
        // Dockではアイコンがあるもの優先、なければ末尾に推定を少数追加
  const withIcon = merged.filter(a=>!!a.icon_data_url)
        const withoutIcon = merged.filter(a=>!a.icon_data_url)
        const shortlist = [...withIcon.slice(0,5), ...withoutIcon.slice(0,2)]
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

  // Dock表示: 開いているウィンドウ + 最近5件（重複排除）
  const openIcons = openWindows.map(w=>({ key:w.id, title:w.title, icon:w.icon_data_url, type:'win' as const }))
  const recentIcons = recentApps
    .filter(a=>!openWindows.find(w=> (w.title||'').toLowerCase().includes((a.name||'').toLowerCase())))
    .map(a=>({ key:a.name, title:a.name, icon:a.icon_data_url, type:'app' as const, app:a }))
  const dockItems = [...openIcons, ...recentIcons]

  return (
    <div className="futuristic-dock crystal">
      {/* Dockアイコン（センタリング） */}
      <div className="dock-apps">
        {dockItems.map((item: any, index: number) => (
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
    </div>
  );
}

export default BottomBar;
