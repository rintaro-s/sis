import { useEffect, useState } from 'react';
import { api, type AppInfo } from '../services/api';
import './Sidebar.css';

type SidebarProps = {
  isCollapsed: boolean;
  onToggle: () => void;
};

function Sidebar({ isCollapsed, onToggle }: SidebarProps) {
  const [activeSection, setActiveSection] = useState('actions');
  const [notifications] = useState<any[]>([]); // 実際の通知がない場合は空配列
  const [fav, setFav] = useState<AppInfo[]>([])

  useEffect(()=>{
    let mounted = true
    const load = async ()=>{ try { const a = await api.getFavoriteApps(); if(mounted) setFav(a) } catch { if(mounted) setFav([]) } }
    load()
    const onFav = ()=> load()
    window.addEventListener('sis:favorites-updated', onFav)
    return ()=>{ mounted=false; window.removeEventListener('sis:favorites-updated', onFav) }
  },[])

  const unpin = async (name: string)=>{ const r=await api.removeFavoriteApp(name); if(r.ok){ const list=await api.getFavoriteApps(); setFav(list) } }

  const sections = [
    { id: 'pinned', icon: 'PIN', label: 'ピン留め', count: fav.length },
    { id: 'actions', icon: 'ACT', label: 'クイック', count: 0 },
    { id: 'notifications', icon: '!', label: 'お知らせ', count: notifications.length },
    { id: 'tasks', icon: 'T', label: 'タスク', count: 0 },
  ];

  return (
    <aside className={`futuristic-sidebar ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <button className="sidebar-toggle" onClick={onToggle}>
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

      {/* クイックアクション */}
      {!isCollapsed && activeSection === 'actions' && (
        <div className="sidebar-content">
          <div className="content-header">
            <h3>クイックアクション</h3>
          </div>
          <div className="quick-actions">
            <button className="qa-btn" onClick={() => window.dispatchEvent(new Event('sis:open-settings'))}>
              設定を開く
            </button>
            <button
              className="qa-btn"
              onClick={async () => {
                const btn = document.activeElement as HTMLButtonElement | null
                if (btn) { btn.disabled = true; btn.innerText = '10秒後に撮影…'; }
                setTimeout(async () => {
                  await api.takeScreenshot();
                  if (btn) { btn.disabled = false; btn.innerText = 'スクリーンショット(10秒後)'; }
                }, 10000);
              }}
            >
              スクリーンショット(10秒後)
            </button>
            <button className="qa-btn" onClick={() => api.openPath('~')}>
              ファイルを開く
            </button>
            <button className="qa-btn" onClick={()=>api.launchApp('gnome-terminal')}>ターミナルを起動</button>
            <button className="qa-btn" onClick={async()=>{ if(!confirm('再起動します。よろしいですか？')) return; await api.powerAction('reboot') }}>再起動</button>
            <button className="qa-btn danger" onClick={async()=>{ if(!confirm('電源を切ります。よろしいですか？')) return; await api.powerAction('shutdown') }}>電源オフ</button>
          </div>
        </div>
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
