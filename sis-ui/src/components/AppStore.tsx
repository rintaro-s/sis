import { useEffect, useRef, useState } from 'react';
import './AppStore.css';
import { api } from '../services/api';
import { IconApp } from '../assets/icons';

export type AppInfo = { name: string; exec?: string; icon_data_url?: string }

function AppStore() {
  const [apps, setApps] = useState<AppInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [fav, setFav] = useState<AppInfo[]>([])
  const [sort, setSort] = useState<'name'|'recent'|'installed'>('name')
  const [settings, setSettings] = useState<any | null>(null)
  const dragIndex = useRef<number | null>(null)

  useEffect(() => {
    let mounted = true
  api.getRecentApps()
      .then((list) => {
        if (!mounted) return
        setApps(list.filter((a) => a.exec && a.exec.trim() !== ''))
      })
      .catch((e) => setError(e?.message || 'アプリ一覧を取得できません'))
  // Snap アプリもマージ
  api.scanSnapApps()
    .then((snap) => {
      if (!mounted) return
      setApps((prev) => {
        const map = new Map<string, AppInfo>()
        for (const a of [...prev, ...snap]) {
          const key = `${a.name}::${a.exec || ''}`
          if (!map.has(key)) map.set(key, a)
        }
        return Array.from(map.values())
      })
    })
    .catch(() => {})
  api.getFavoriteApps().then(setFav).catch(()=>setFav([]))
  api.getSettings().then((s)=>{ setSettings(s); if (s?.app_sort) setSort(s.app_sort) })
    return () => { mounted = false }
  }, [])

  const launch = async (app: AppInfo) => {
    if (!app.exec) return
    const r = await api.launchApp(app.exec)
    if (!r.ok) alert(`${app.name} を起動できません`)
  }

  const dedupe = (list: AppInfo[]) => {
    const m = new Map<string, AppInfo>()
    for (const a of list) {
      const key = `${a.name}::${a.exec || ''}`
      if (!m.has(key)) m.set(key, a)
    }
    return Array.from(m.values())
  }
  const bySort = (list: AppInfo[]) => {
    const xs = dedupe(list)
    if (sort==='name') return [...xs].sort((a,b)=>a.name.localeCompare(b.name))
    if (sort==='recent') return xs // getRecentAppsは既に近い順想定
    return xs
  }
  const visible = bySort(showAll ? apps : apps.filter(a => !!a.icon_data_url))

  const toggleFav = async (app: AppInfo) => {
    const exists = fav.some(f => f.name === app.name)
    if (exists) {
      const r = await api.removeFavoriteApp(app.name); if (r.ok) setFav(fav.filter(f=>f.name!==app.name))
    } else {
      const r = await api.addFavoriteApp(app); if (r.ok) setFav([...fav, app])
    }
  }

  const onSortChange = async (v: 'name'|'recent'|'installed') => {
    setSort(v)
    try {
      const s = settings || await api.getSettings()
      await api.setSettings({ ...s, app_sort: v })
      setSettings({ ...s, app_sort: v })
    } catch {}
  }

  const onFavDragStart = (index: number) => (e: React.DragEvent) => { dragIndex.current = index; e.dataTransfer.effectAllowed = 'move' }
  const onFavDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }
  const onFavDrop = (overIndex: number) => async (e: React.DragEvent) => {
    e.preventDefault()
    const from = dragIndex.current
    dragIndex.current = null
    if (from==null || from===overIndex) return
    const next = [...fav]
    const [m] = next.splice(from, 1)
    next.splice(overIndex, 0, m)
    setFav(next)
    // persist order by names
    await api.reorderFavoriteApps(next.map(x=>x.name))
  }

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
        <div style={{ marginLeft: 'auto', display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ fontSize:12, opacity:.8 }}>ソート:</span>
          <select value={sort} onChange={(e)=>onSortChange(e.target.value as any)}>
            <option value="name">名前</option>
            <option value="recent">最近</option>
          </select>
        </div>
      </div>
      {fav.length>0 && (
        <div style={{ margin:'6px 0 10px' }}>
          <div style={{ fontSize:12, opacity:.8, margin:'0 2px 6px' }}>お気に入り</div>
          <div className="app-grid" style={{ gridTemplateColumns:'repeat(8, minmax(0,1fr))' }}>
            {fav.map((app, index) => (
              <div key={index} className="app-card" draggable onDragStart={onFavDragStart(index)} onDragOver={onFavDragOver} onDrop={onFavDrop(index)} onClick={() => launch(app)} title="ドラッグで並び替え">
                <img src={app.icon_data_url || IconApp} alt={app.name} />
                <span>{app.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {error && <div className="hint">{error}</div>}
      <div className="app-grid">
        {visible.length === 0 ? (
          <div className="hint">起動可能なアプリが見つかりません</div>
        ) : (
          visible.slice(0, 48).map((app, index) => (
            <div key={index} className="app-card" onClick={() => launch(app)} onContextMenu={(e)=>{ e.preventDefault(); toggleFav(app) }} title="右クリックでお気に入り切替">
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
