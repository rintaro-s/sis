import { useEffect, useState } from 'react';
import { api, type AppInfo } from '../services/api';
import './HomeScreen.css';

function HomeScreen() {
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [favorites, setFavorites] = useState<AppInfo[]>([]);
  const [desktopFiles, setDesktopFiles] = useState<{ name: string; path: string; is_dir?: boolean }[]>([]);
  const [currentTime, setCurrentTime] = useState(new Date());

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

    loadData();
    const interval = setInterval(loadData, 8000);
    
    return () => {
      mounted = false;
      clearInterval(interval);
      clearInterval(tick)
    };
  }, []);

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

  return (
    <div className="futuristic-home">
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
          <div className="welcome-visual">
            <div className="hologram-circle"></div>
            <div className="data-streams">
              <div className="stream"></div>
              <div className="stream"></div>
              <div className="stream"></div>
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
                  ) : /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(file.name) ? (
                    <img src={"file://" + file.path} alt="preview" onError={(e)=>{ (e.target as HTMLImageElement).style.display='none' }} />
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
