import { useEffect, useState } from 'react';
import { api, type AppInfo } from '../services/api';
import './Sidebar.css';
import './Settings.css';

type SidebarProps = {
  isCollapsed: boolean;
  onToggle: () => void;
};

function Sidebar({ isCollapsed, onToggle }: SidebarProps) {
  console.log(`[Sidebar] render collapsed=${isCollapsed}`);
  const [activeSection, setActiveSection] = useState('actions');
  const [notifications] = useState<any[]>([]); // 実際の通知がない場合は空配列
  const [fav, setFav] = useState<AppInfo[]>([])

  useEffect(()=>{
    let mounted = true
  const load = async ()=>{ try { const a = await api.getFavoriteApps(); if(mounted) setFav(a) } catch { if(mounted) setFav([]) } }
    load()
  const onFav = ()=> load()
  window.addEventListener('sis:favorites-updated', onFav)
  // Desktop側からのアプリ一覧更新でも反映
  const onAppsChange = ()=> load()
  window.addEventListener('sis:apps-refreshed', onAppsChange)
  return ()=>{ mounted=false; window.removeEventListener('sis:favorites-updated', onFav); window.removeEventListener('sis:apps-refreshed', onAppsChange) }
  },[])

  const unpin = async (name: string)=>{ const r=await api.removeFavoriteApp(name); if(r.ok){ const list=await api.getFavoriteApps(); setFav(list); window.dispatchEvent(new Event('sis:favorites-updated')) } }

  // このコンポーネントは見た目のみを担い、開閉は親に委ねる

  const sections = [
  { id: 'pinned', icon: 'PIN', label: 'ピン留め', count: fav.length },
  { id: 'actions', icon: 'SYS', label: 'システム', count: 0 },
    { id: 'notifications', icon: '!', label: 'お知らせ', count: notifications.length },
    { id: 'tasks', icon: 'T', label: 'タスク', count: 0 },
  ];

  return (
    <aside 
      className={`futuristic-sidebar ${isCollapsed ? 'collapsed' : ''}`}
    >
      {/* 折りたたみ時にだけ表示される薄いクリックハンドル。親で pointer-events: none の場合でも
          このハンドルは z-index を上げ pointer-events を受け付ける設計 */}
      {isCollapsed && (
        <div
          className="sidebar-collapsed-handle"
          role="button"
          aria-label="Open sidebar"
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
        />
      )}
      <div className="sidebar-header">
        <button
          className="sidebar-toggle"
          tabIndex={0}
          aria-expanded={!isCollapsed}
          onClick={(e) => {
            // クリック伝播を抑え、確実にトグル動作だけを行う
            e.preventDefault();
            e.stopPropagation();
            onToggle();
          }}
        >
          <span className="toggle-icon">{isCollapsed ? '»' : '«'}</span>
        </button>
        {!isCollapsed && (
          <div className="sidebar-title">
            <span className="title-text">システム</span>
            <span className="title-subtitle">コントロール</span>
          </div>
        )}
      </div>

      <nav className="sidebar-nav">
        {sections.map((section) => (
          <div
            key={section.id}
            className={`nav-item ${activeSection === section.id ? 'active' : ''}`}
            onClick={() => setActiveSection(section.id)}
          >
            <div className="nav-icon-container">
              <span className="nav-icon">{section.icon}</span>
              {section.count > 0 && (
                <span className="nav-badge">{section.count}</span>
              )}
            </div>
            {!isCollapsed && (
              <div className="nav-content">
                <span className="nav-text">{section.label}</span>
                {section.count > 0 && (
                  <span className="nav-count">{section.count}件</span>
                )}
              </div>
            )}
            <div className="nav-glow"></div>
          </div>
        ))}
      </nav>

      {/* システムコントロール */}
      {!isCollapsed && activeSection === 'actions' && (
        <SystemControls />
      )}

      {/* ピン留め */}
      {!isCollapsed && activeSection === 'pinned' && (
        <div className="sidebar-content">
          <div className="content-header"><h3>ピン留めアプリ</h3></div>
          <div className="notifications-list">
            {fav.filter(a=>a.icon_data_url).length===0 && (
              <div className="empty-state"><p>ピン留めはありません。アプリ一覧で右クリック→「ピン留め」で登録。</p></div>
            )}
            {fav.filter(a=>a.icon_data_url).map((a)=> (
              <div key={a.name} className="notification-item" style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}} onClick={()=> a.exec && api.launchApp(a.exec!)} title="クリックで起動、解除でピン留めを外す">
                <img src={a.icon_data_url} alt="" style={{width:20,height:20,borderRadius:4}} />
                <div className="notification-content">
                  <div className="notification-title">{a.name}</div>
                </div>
                <button className="qa-btn" onClick={(e)=>{ e.stopPropagation(); unpin(a.name!) }} style={{marginLeft:'auto'}}>解除</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isCollapsed && activeSection === 'notifications' && (
        <div className="sidebar-content">
          <div className="content-header">
            <h3>最新の通知</h3>
          </div>
          <div className="notifications-list">
            {notifications.length === 0 ? (
              <div className="empty-state">
                <p>新しい通知はありません</p>
              </div>
            ) : (
              notifications.map((notification) => (
                <div key={notification.id} className="notification-item">
                  <div className="notification-content">
                    <div className="notification-title">{notification.title}</div>
                    <div className="notification-message">{notification.message}</div>
                    <div className="notification-time">{notification.time}</div>
                  </div>
                  <div className="notification-indicator"></div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {!isCollapsed && activeSection === 'tasks' && (
        <div className="sidebar-content">
          <div className="content-header">
            <h3>アクティブなタスク</h3>
          </div>
          <div className="tasks-list">
            <div className="empty-state">
              <p>アクティブなタスクはありません</p>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

export default Sidebar;

function SystemControls() {
  const [volume, setVolume] = useState(50)
  const [brightness, setBrightness] = useState(80)
  const [network, setNetwork] = useState(true)
  const [bluetooth, setBluetooth] = useState(true)
  const [loggingEnabled, setLoggingEnabled] = useState(false)

  useEffect(() => {
    let mounted = true
    ;(async()=>{
      try {
        const s = await api.getSettings().catch(()=>({}))
        if (!mounted) return
        setLoggingEnabled(!!(s as any)?.logging_enabled)
      } catch {}
      try {
        const st = await api.controlCenterState()
        if (!mounted || !st) return
        if (typeof st.volume === 'number') setVolume(st.volume)
        if (typeof st.brightness === 'number') setBrightness(st.brightness)
        if (typeof st.network === 'boolean') setNetwork(st.network)
        if (typeof st.bluetooth === 'boolean') setBluetooth(st.bluetooth)
      } catch {}
    })()
    return () => { mounted = false }
  }, [])

  const setVol = async (v:number)=>{ setVolume(v); const r = await api.setVolume(v); if(!r.ok) alert('音量の変更に失敗') }
  const setBrt = async (v:number)=>{ setBrightness(v); const r = await api.setBrightness(v); if(!r.ok) alert('輝度の変更に失敗') }
  const toggleNet = async ()=>{ const n=!network; setNetwork(n); const r=await api.networkSet(n); if(!r.ok) alert('ネットワーク切替に失敗') }
  const toggleBt = async ()=>{ const n=!bluetooth; setBluetooth(n); const r=await api.bluetoothSet(n); if(!r.ok) alert('Bluetooth切替に失敗') }

  return (
    <div className="sidebar-content">
      <div className="content-header"><h3>システムコントロール</h3></div>
      <div className="control-grid">
        <div className="control-item">
          <label className="setting-label">音量</label>
          <div className="slider-container">
            <input type="range" min={0} max={100} value={volume} onChange={e=>setVol(parseInt(e.target.value))} className="game-slider" />
            <span className="slider-value">{volume}%</span>
          </div>
        </div>
        <div className="control-item">
          <label className="setting-label">輝度</label>
          <div className="slider-container">
            <input type="range" min={0} max={100} value={brightness} onChange={e=>setBrt(parseInt(e.target.value))} className="game-slider" />
            <span className="slider-value">{brightness}%</span>
          </div>
        </div>
        <div className="control-item">
          <label className="setting-label">ネットワーク</label>
          <button className={`game-btn toggle ${network?'active':''}`} onClick={toggleNet}>{network?'オン':'オフ'}</button>
        </div>
        <div className="control-item">
          <label className="setting-label">Bluetooth</label>
          <button className={`game-btn toggle ${bluetooth?'active':''}`} onClick={toggleBt}>{bluetooth?'オン':'オフ'}</button>
        </div>
      </div>
      <div className="power-controls">
        <button className="game-btn danger small" onClick={async()=>{ if(!confirm('ログアウトします。よろしいですか？')) return; await api.powerAction('logout') }}>ログアウト</button>
        <button className="game-btn danger small" onClick={async()=>{ if(!confirm('再起動します。よろしいですか？')) return; await api.powerAction('reboot') }}>再起動</button>
        <button className="game-btn danger small" onClick={async()=>{ if(!confirm('電源を切ります。よろしいですか？')) return; await api.powerAction('shutdown') }}>シャットダウン</button>
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="setting-label">バックエンドログ</label>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <button className={`game-btn ${loggingEnabled?'primary':'secondary'}`} onClick={async()=>{
            const next = !loggingEnabled
            setLoggingEnabled(next)
            try {
              const s = await api.getSettings().catch(()=>({}))
              await api.setSettings({ ...(s as any), logging_enabled: next })
              try { await api.emitGlobalEvent('sis:settings-saved', { ...(s as any), logging_enabled: next }) } catch {}
            } catch {}
          }}>{loggingEnabled?'有効':'無効'}</button>
          <span style={{ fontSize: 12, opacity: .8 }}>~/.local/share/sis-ui/logs/backend.log</span>
          <button className="game-btn secondary" onClick={async()=>{ const text = await api.getBackendLog(200); alert(text || '(空)') }}>表示</button>
          <button className="game-btn secondary" onClick={async()=>{ await api.clearBackendLog() }}>クリア</button>
        </div>
      </div>
      <div className="quick-actions" style={{ marginTop: 12 }}>
        <button className="qa-btn" onClick={() => api.openPath('~')}>ホームを開く</button>
        <button className="qa-btn" onClick={()=>api.launchApp('gnome-terminal')}>ターミナル</button>
        <button className="qa-btn" onClick={async()=>{ const btn = document.activeElement as HTMLButtonElement | null; if(btn){ btn.disabled=true; const t=btn.innerText; btn.innerText='10秒後に撮影…'; setTimeout(async()=>{ await api.takeScreenshot(); if(btn){ btn.disabled=false; btn.innerText=t } }, 10000) } }}>スクリーンショット(10秒後)</button>
      </div>
    </div>
  )
}
