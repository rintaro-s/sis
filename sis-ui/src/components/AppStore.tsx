import { useEffect, useState } from 'react';
import './AppStore.css';
import { api } from '../services/api';
import { IconApp } from '../assets/icons';

type AppInfo = { name: string; exec?: string }

function AppStore() {
  const [apps, setApps] = useState<AppInfo[]>([])
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="app-store">
      <h3>アプリ</h3>
      {error && <div className="hint">{error}</div>}
      <div className="app-grid">
        {apps.length === 0 ? (
          <div className="hint">起動可能なアプリが見つかりません</div>
        ) : (
          apps.slice(0, 16).map((app, index) => (
            <div key={index} className="app-card" onClick={() => launch(app)}>
              <img src={IconApp} alt={app.name} />
              <span>{app.name}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default AppStore;
