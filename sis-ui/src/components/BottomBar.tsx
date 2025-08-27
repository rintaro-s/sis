import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import './BottomBar.css';

function BottomBar() {
  const [openWindows, setOpenWindows] = useState<{ id: string; wclass: string; title: string; icon_data_url?: string }[]>([]);
  const [pinned, setPinned] = useState<any[]>([])
  const [hoveredApp, setHoveredApp] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
        const load = async () => {
      try {
        const wins = await api.getOpenWindows().catch(()=>[])
        if (!mounted) return
        // SIS関連のウィンドウはDockから除外
        const w = wins.filter(w=>{
          const t = (w.title||'').toLowerCase();
          const c = (w.wclass||'').toLowerCase();
          if (!t) return false
          return !(
            t.includes('sis desktop') || t.includes('sis dock') || t.includes('sis sidebar') || t.includes('sis topbar') || t.includes('sis settings') ||
            c.includes('sis')
          )
        })
        setOpenWindows(w as any)
        try { const fav = await api.getFavoriteApps(); setPinned(fav||[]) } catch {}
      } catch {}
    }
    load()
    const iv = setInterval(load, 3000)
    const onFav = ()=> load()
    window.addEventListener('sis:favorites-updated', onFav)
    return ()=>{ mounted = false; clearInterval(iv); window.removeEventListener('sis:favorites-updated', onFav) }
  }, []);

  const launchApp = async (app: any) => {
    if (!app) return
    if (app.exec) await api.launchApp(app.exec)
  };

  const focusWin = async (id: string) => { await api.focusWindow(id) }

  // Dock表示: 起動中とピン留めのみ（最近使用したアプリは非表示）
  const openIcons = useMemo(() => openWindows.map(w=>({ key:w.id, title:w.title, icon:w.icon_data_url, type:'win' as const })), [openWindows])

  return (
  <div
      className="futuristic-dock crystal"
      style={{ fontSize: 'clamp(10px, 1.2vw, 14px)' }}
      onMouseLeave={() => setHoveredApp(null)}
      onBlur={() => setHoveredApp(null)}
      onMouseDownCapture={()=> setHoveredApp(null)}
    >
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
  <div className="app-icon-container" style={{ width: 'clamp(36px, 3.6vw, 64px)', height: 'clamp(36px, 3.6vw, 64px)' }}>
              <img 
                src={item.icon || '/vite.svg'} 
                alt={item.title}
        className="app-icon"
  style={{ width: '92%', height: '92%' }}
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

      <div className="dock-right">
        {/* ピン留め（固定表示） */}
  {pinned.map((a:any)=>(
          <div key={a.name} className="dock-app" onClick={()=> a.exec && api.launchApp(a.exec)} onMouseEnter={()=> setHoveredApp(a.name)} onMouseLeave={()=> setHoveredApp(null)}>
            <div className="app-icon-container" style={{ width: 'clamp(32px, 3vw, 56px)', height: 'clamp(32px, 3vw, 56px)' }}>
              <img src={a.icon_data_url || '/vite.svg'} alt={a.name} className="app-icon" style={{ width: '92%', height: '92%' }} />
            </div>
            {hoveredApp === a.name && (
              <div className="app-tooltip">
                {a.name}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default BottomBar;
