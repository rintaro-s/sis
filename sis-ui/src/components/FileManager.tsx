import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import './FileManager.css';

type DirInfo = { path: string, name: string, count?: number }

function FileManager() {
  const [home, setHome] = useState<string>('~')
  const [dirs, setDirs] = useState<Record<string,string>>({})
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [section, setSection] = useState<'overview'|'browse'|'actions'>('overview')
  const [currentPath, setCurrentPath] = useState<string>('')
  const [entries, setEntries] = useState<Array<{name:string, path:string, kind:'file'|'dir'}>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(()=>{ (async()=>{
    try {
      const s = await api.getSettings().catch(()=>({}))
      const x = await api.getXdgUserDirs().catch(()=>({}))
      const merged = { ...(s.user_dirs||{}), ...(x||{}) }
      setDirs(merged as any)
      setHome(merged.home||'~')
    } catch {}
  })() },[])

  useEffect(()=>{ if(section!=='browse' || !currentPath) return; (async()=>{
    setLoading(true); setError('')
    try {
      const list = await api.listDir(currentPath)
      setEntries(list.map(i=>({ name: i.name, path: i.path, kind: i.is_dir ? 'dir' : 'file' })))
    } catch { setError('読み込みに失敗しました') } finally { setLoading(false) }
  })() },[section, currentPath])

  useEffect(()=>{ (async()=>{
    const keys = ['desktop','documents','downloads','music','pictures','videos']
    const r: Record<string, number> = {}
    await Promise.all(keys.map(async k=>{ const p = dirs[k]; if(!p) return; try { const l = await api.listDir(p); r[k] = l.length } catch {} }))
    setCounts(r)
  })() },[dirs])

  const overviewItems: DirInfo[] = useMemo(()=>{
    const items: DirInfo[] = []
    const order = ['desktop','documents','downloads','music','pictures','videos']
    order.forEach(k=>{ const p = (dirs as any)[k]; if(p) items.push({ path:p, name:k, count:counts[k] }) })
    return items
  }, [dirs, counts])

  const open = async (p:string)=>{ await api.openPath(p) }

  const browse = (p:string)=>{ setCurrentPath(p); setSection('browse') }

  return (
    <div className="fm-root">
      <div className="ba-nav">
        <button className={`ba-nav-btn ${section==='overview'?'active':''}`} onClick={()=>setSection('overview')}>概要</button>
        <button className={`ba-nav-btn ${section==='actions'?'active':''}`} onClick={()=>setSection('actions')}>操作</button>
        <div className="ba-nav-spacer"/>
        <button className={`ba-nav-btn ${section==='browse'?'active':''}`} disabled={section!=='browse'} onClick={()=>setSection('browse')}>ブラウズ</button>
      </div>

      {section==='overview' && (
        <div className="folders-overview">
          <div className="overview-grid">
            {overviewItems.map(item=> (
              <div key={item.path} className="folder-card">
                <div className="folder-meta">
                  <div className="folder-name">{item.name}</div>
                  <div className="folder-count">{typeof item.count==='number'?`${item.count} 件`:''}</div>
                </div>
                <div className="folder-actions">
                  <button className="game-btn primary" onClick={()=>open(item.path)}>開く</button>
                  <button className="game-btn secondary" onClick={()=>browse(item.path)}>中を見る</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {section==='actions' && (
        <div className="quick-actions">
          <div className="action-grid">
            <button className="game-btn" onClick={()=>browse(dirs.desktop||home)}>デスクトップへ</button>
            <button className="game-btn" onClick={()=>browse(dirs.downloads||home)}>ダウンロードへ</button>
            <button className="game-btn" onClick={()=>browse(dirs.documents||home)}>ドキュメントへ</button>
            <button className="game-btn" onClick={()=>browse(dirs.pictures||home)}>ピクチャへ</button>
            <button className="game-btn" onClick={()=>browse(dirs.music||home)}>ミュージックへ</button>
            <button className="game-btn" onClick={()=>browse(dirs.videos||home)}>ビデオへ</button>
          </div>
        </div>
      )}

      {section==='browse' && (
        <div className="browser-view">
          <div className="browser-header">
            <div className="current-path">{currentPath||home}</div>
            <div className="browser-actions">
              <button className="game-btn secondary" onClick={()=>setSection('overview')}>戻る</button>
              <button className="game-btn" onClick={()=>open(currentPath||home)}>システムで開く</button>
            </div>
          </div>
          <div className="browser-list">
            {loading && <div className="browser-status">読み込み中</div>}
            {error && <div className="browser-status error">{error}</div>}
            {!loading && !error && entries.map(e=> (
              <div key={e.path} className={`entry ${e.kind}`} onDoubleClick={()=> e.kind==='dir'? browse(e.path) : open(e.path)}>
                {e.kind === 'file' && /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(e.name) ? (
                  <div className="entry-preview">
                    <img 
                      src="" 
                      alt={e.name} 
                      style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 4 }} 
                      onLoad={async (ev) => {
                        try {
                          const img = ev.target as HTMLImageElement;
                          const dataUrl = await api.fileToDataUrl(e.path);
                          img.src = dataUrl;
                        } catch {
                          // fallback to icon
                          (ev.target as HTMLImageElement).style.display = 'none';
                        }
                      }}
                      onError={(ev) => {
                        (ev.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                ) : (
                  <span className="entry-icon">{e.kind === 'dir' ? '📁' : '📄'}</span>
                )}
                <span className="entry-name">{e.name}</span>
                <span className="entry-kind">{e.kind==='dir'?'フォルダ':'ファイル'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default FileManager