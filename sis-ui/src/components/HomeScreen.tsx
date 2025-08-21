
import FileManager from './FileManager';
import AppStore from './AppStore';
import { useEffect, useState } from 'react';
import { api, type AppInfo } from '../services/api';
import './HomeScreen.css';
import './HomeScreen.css';

function HomeScreen() {
  const [tab, setTab] = useState<'all'|'recent'>('all')
  const [recent, setRecent] = useState<AppInfo[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [desktopItems, setDesktopItems] = useState<{name:string; path:string; is_dir:boolean}[]>([])
  useEffect(()=>{ api.getLaunchHistory(24).then(setRecent).catch(()=>{}) },[])
  useEffect(()=>{ if (drawerOpen) api.listDesktopItems().then(setDesktopItems).catch(()=>{}) }, [drawerOpen])
  return (
    <div className="home-screen">
      <div className="dashboard-grid two-columns">
        <div className="panel left" style={{ position: 'relative' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <h3 style={{ margin: 0 }}>ファイル管理</h3>
            <button onClick={()=>setDrawerOpen(v=>!v)}>{drawerOpen?'デスクトップを隠す':'デスクトップを表示'}</button>
          </div>
          {drawerOpen && (
            <div style={{ position:'absolute', top:36, right:-8, width: 320, maxHeight: 360, overflow:'auto', background:'var(--bg-panel)', border:'1px solid rgba(0,0,0,.08)', borderRadius: 12, boxShadow:'var(--shadow-depth)', padding: 8 }}>
              <div style={{ fontSize:12, opacity:.8, margin:'4px 6px' }}>デスクトップ</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:6 }}>
                {desktopItems.map((it, i)=> (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 8px', borderRadius:8, cursor:'pointer' }}
                       onClick={()=> api.launchApp(`xdg-open "${it.path}"`)}
                       onContextMenu={(e)=>{ e.preventDefault(); if(!it.is_dir) api.setWallpaper(it.path) }}
                  >
                    <span style={{ opacity:.7 }}>{it.is_dir?'📁':'📄'}</span>
                    <span style={{ whiteSpace:'nowrap', textOverflow:'ellipsis', overflow:'hidden' }}>{it.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ marginTop: drawerOpen? 410 : 8 }}>
            <FileManager />
          </div>
        </div>
        <div className="panel right">
          <div className="apps-header">
            <h3>アプリ</h3>
            <div className="tabs">
              <button className={tab==='all'?'active':''} onClick={()=>setTab('all')}>すべて</button>
              <button className={tab==='recent'?'active':''} onClick={()=>setTab('recent')}>最近</button>
            </div>
          </div>
          {tab==='all' ? <AppStore /> : (
            <div style={{padding:'8px 0'}}>
              <div className="app-grid">
                {(recent||[]).map((app: any, idx: number)=>(
                  <div key={idx} className="app-card" onClick={()=> app.exec && api.launchApp(app.exec)}>
                    <img src={app.icon_data_url || '/src/assets/icons/icon_app_default.svg'} alt={app.name} />
                    <span>{app.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default HomeScreen;
