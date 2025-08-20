import { useEffect, useState } from 'react';
import './AppStore.css';
import { api } from '../services/api';
import { IconApp } from '../assets/icons';

export type AppInfo = { name: string; exec?: string; icon_data_url?: string }

function AppStore() {
  const [apps, setApps] = useState<AppInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let mounted = true
    api.getRecentApps()
      .then((list) => {
        if (!mounted) return
        setApps(list.filter((a) => a.exec && a.exec.trim() !== ''))
      })
      .catch((e) => setError(e?.message || 'アプリ一覧を取得できません'))
    return () => { mounted = false }
  }, [])

  const launch = async (app: AppInfo) => {
    if (!app.exec) return
    const r = await api.launchApp(app.exec)
    if (!r.ok) alert(`${app.name} を起動できません`)
  }

  const visible = showAll ? apps : apps.filter(a => !!a.icon_data_url)

  return (
    <div className="app-store">
      <h3>アプリ</h3>
      <div className="app-toolbar">
        <label className="toggle">
          <input
            type="checkbox"
            checked={showAll}
            onChange={() => setShowAll(v => !v)}
          />
          <span>アイコン無しも表示</span>
        </label>
      </div>
      {error && <div className="hint">{error}</div>}
      <div className="app-grid">
        {visible.length === 0 ? (
          <div className="hint">起動可能なアプリが見つかりません</div>
        ) : (
          visible.slice(0, 48).map((app, index) => (
            <div key={index} className="app-card" onClick={() => launch(app)}>
              <img src={app.icon_data_url || IconApp} alt={app.name} />
              <span>{app.name}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default AppStore;
