import { useEffect, useState } from 'react'
import { api } from '../services/api'
import './Settings.css'

const DEFAULT_SETTINGS = { 
  theme: 'system', 
  wallpaper: '', 
  user_dirs: { desktop: '', documents: '', downloads: '', music: '', pictures: '', videos: '' },
  appearance: {
    dockOpacity: 0.95,
    dockBlur: 20,
    dockIcon: 56,
    appIcon: 80
  }
}

function Settings() {
  const [settings, setSettings] = useState<any>({})
  const [draft, setDraft] = useState<any>({})
  const [isDirty, setIsDirty] = useState(false)
  const [volume, setVolume] = useState(50)
  const [brightness, setBrightness] = useState(80)
  const [network, setNetwork] = useState(true)
  const [bluetooth, setBluetooth] = useState(true)
  const [systemInfo, setSystemInfo] = useState<any>({})
  const [sudoPassword, setSudoPassword] = useState('')
  const [showSudoDialog, setShowSudoDialog] = useState(false)
  const [pendingAction, setPendingAction] = useState<string>('')
  const [loggingEnabled, setLoggingEnabled] = useState(false)

  useEffect(() => { (async()=>{
    try {
      const saved = await api.getSettings().catch(()=>DEFAULT_SETTINGS)
      const merged = { ...DEFAULT_SETTINGS, ...saved }
      try { const xdg = await api.getXdgUserDirs(); merged.user_dirs = { ...merged.user_dirs, ...xdg } } catch {}
  setSettings(merged); setDraft(JSON.parse(JSON.stringify(merged)))
  // 外観のCSS変数を反映
  try {
    const ap = merged.appearance || {}
    const r = (v:number, min:number, max:number)=>Math.max(min, Math.min(max, v))
    const op = r(Number(ap?.dockOpacity ?? 0.95), 0, 1)
    const bl = r(Number(ap?.dockBlur ?? 20), 0, 60)
    const di = r(Number(ap?.dockIcon ?? 56), 32, 96)
    const ai = r(Number(ap?.appIcon ?? 80), 48, 128)
    document.documentElement.style.setProperty('--sis-dock-opacity', String(op))
    document.documentElement.style.setProperty('--sis-dock-blur', `${bl}px`)
    document.documentElement.style.setProperty('--sis-dock-icon', `${di}px`)
    document.documentElement.style.setProperty('--sis-app-icon', `${ai}px`)
  } catch {}
  setLoggingEnabled(!!merged.logging_enabled)
  // ディレクトリ一覧能力チェックは不要
      
      // システム制御状態を取得
      try {
        const controlState = await api.controlCenterState()
        if (controlState) {
          if (typeof controlState.volume === 'number') setVolume(controlState.volume)
          if (typeof controlState.brightness === 'number') setBrightness(controlState.brightness)
          if (typeof controlState.network === 'boolean') setNetwork(controlState.network)
          if (typeof controlState.bluetooth === 'boolean') setBluetooth(controlState.bluetooth)
        }
      } catch (error) {
        console.warn('コントロールセンター状態の取得に失敗:', error)
        // デフォルト値を使用（ダミーではなく不明として扱う）
      }
      
      // システム情報を取得
      try {
        const detailedInfo = await api.getDetailedSystemInfo()
        setSystemInfo(detailedInfo)
      } catch (error) {
        console.warn('詳細システム情報の取得に失敗:', error)
        setSystemInfo({
          os: 'N/A',
          kernel: 'N/A',
          uptime: 'N/A',
          cpu: 'N/A',
          memory: { total: 'N/A', used: 'N/A', available: 'N/A' },
          disk: { total: 'N/A', used: 'N/A', available: 'N/A' }
        })
      }
    } catch { 
      setSettings(DEFAULT_SETTINGS); 
      setDraft(JSON.parse(JSON.stringify(DEFAULT_SETTINGS))) 
    }
  })() }, [])

  useEffect(()=>{ setIsDirty(JSON.stringify(settings)!==JSON.stringify(draft)) }, [settings, draft])

  // ディレクトリパスはXDG自動検出を使用

  // 保存時に壁紙の即時適用も行う
  const discard = () => { setDraft(JSON.parse(JSON.stringify(settings))); setIsDirty(false) }

  const setVol = async (v:number)=>{ setVolume(v); const r = await api.setVolume(v); if(!r.ok) alert('音量の変更に失敗') }
  const setBrt = async (v:number)=>{ setBrightness(v); const r = await api.setBrightness(v); if(!r.ok) alert('輝度の変更に失敗') }
  const toggleNet = async ()=>{ const n=!network; setNetwork(n); const r=await api.networkSet(n); if(!r.ok) alert('ネットワーク切替に失敗') }
  const toggleBt = async ()=>{ const n=!bluetooth; setBluetooth(n); const r=await api.bluetoothSet(n); if(!r.ok) alert('Bluetooth切替に失敗') }
  const power = async (a:'shutdown'|'reboot'|'logout')=>{ 
    const label = a==='shutdown'?'シャットダウン':a==='reboot'?'再起動':'ログアウト'
    if(!confirm(`${label}を実行します。よろしいですか？`)) return
    const r=await api.powerAction(a); if(!r.ok) alert('電源操作に失敗') 
  }

  const applyTheme = async (theme: string) => {
    setDraft((p:any)=>({...p, theme}))
    
    // システムのテーマも変更
    if (theme === 'light' || theme === 'dark') {
      const result = await api.ubuntuSetTheme(theme)
      if (!result.ok) {
        console.warn('システムテーマの変更に失敗:', result.message)
      }
    }
    
    // CSSクラスを即座に適用
  const applied = theme === 'system' ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme
  document.documentElement.className = applied === 'light' ? 'light-theme' : 'dark-theme'
  localStorage.setItem('sis-theme', applied)
  // 全ウィンドウへ通知
  try { await api.emitGlobalEvent('sis:apply-theme', { theme: applied }) } catch {}
  }
  const applyAppearance = (ap:any)=>{
    try {
      const r = (v:number, min:number, max:number)=>Math.max(min, Math.min(max, v))
      const op = r(Number(ap?.dockOpacity ?? 0.95), 0, 1)
      const bl = r(Number(ap?.dockBlur ?? 20), 0, 60)
      const di = r(Number(ap?.dockIcon ?? 56), 32, 96)
      const ai = r(Number(ap?.appIcon ?? 80), 48, 128)
      document.documentElement.style.setProperty('--sis-dock-opacity', String(op))
      document.documentElement.style.setProperty('--sis-dock-blur', `${bl}px`)
      document.documentElement.style.setProperty('--sis-dock-icon', `${di}px`)
  document.documentElement.style.setProperty('--sis-app-icon', `${ai}px`)
  // 全ウィンドウへ通知
  ;(async()=>{ try { await api.emitGlobalEvent('sis:appearance-changed', { dockOpacity: op, dockBlur: bl, dockIcon: di, appIcon: ai }) } catch {} })()
    } catch {}
  }

  const save = async () => { try { 
    await api.setSettings(draft); 
    setSettings(JSON.parse(JSON.stringify(draft))); 
    setIsDirty(false); 
    localStorage.setItem('sis-ui-settings-backup', JSON.stringify(draft))
    // 外観の即時反映
    applyAppearance(draft.appearance)
    // 壁紙の即時適用（CSS変数に設定）
    if (draft.wallpaper) {
      const v = draft.wallpaper.trim()
      const isUrlFunc = /^url\(/i.test(v)
      const cssVal = isUrlFunc ? v : `url('${v}')`
      document.documentElement.style.setProperty('--desktop-wallpaper', cssVal)
      try { await api.emitGlobalEvent('sis:wallpaper-changed', { css: cssVal }) } catch {}
    } else {
      document.documentElement.style.removeProperty('--desktop-wallpaper')
      try { await api.emitGlobalEvent('sis:wallpaper-changed', { css: '' }) } catch {}
    }
  } catch { alert('保存に失敗しました') } }

  const requestSudoAction = (action: string) => {
    setPendingAction(action)
    setShowSudoDialog(true)
  }

  const executeSudoAction = async () => {
    if (!sudoPassword || !pendingAction) return
    
    let command = ''
    switch (pendingAction) {
      case 'update':
        command = 'apt update && apt upgrade -y'
        break
      case 'settings':
        try {
          const r = await api.ubuntuSystemSettings()
          if (!r.ok) throw new Error(r.message)
        } catch {
          // フォールバック: gnome-control-center を直接起動
          await api.runSafeCommand('bash -lc "(gnome-control-center >/dev/null 2>&1 & disown) || (systemsettings5 >/dev/null 2>&1 & disown) || true"')
        }
        setShowSudoDialog(false); setSudoPassword(''); setPendingAction(''); return
      case 'software':
        try {
          const r = await api.ubuntuSoftwareCenter()
          if (!r.ok) throw new Error(r.message)
        } catch {
          // フォールバック: gnome-software などを起動
          await api.runSafeCommand('bash -lc "(gnome-software >/dev/null 2>&1 & disown) || (software-center >/dev/null 2>&1 & disown) || true"')
        }
        setShowSudoDialog(false); setSudoPassword(''); setPendingAction(''); return
      case 'probe-info':
        command = 'uname -a && lsb_release -a || true';
        break
    }
    
    if (command) {
      const result = await api.runWithSudo(command, sudoPassword)
      if (result.ok) {
        alert('操作が正常に完了しました')
      } else {
        alert('操作に失敗しました: ' + result.message)
      }
    }
    
    setShowSudoDialog(false)
    setSudoPassword('')
    setPendingAction('')
  }

  return (
    <div className="settings-container">
      <div className="settings-header">
        <div className="game-card large">
          <div className="game-card-header">
            <h2 className="game-card-title">システム設定</h2>
            <div className="settings-actions">
              {isDirty && (<>
                <button className="game-btn primary" onClick={save}>保存して終了</button>
                <button className="game-btn secondary" onClick={discard}>変更を破棄</button>
                <button className="game-btn secondary" onClick={async()=>{ 
                  await save(); 
                  // テーマをOSにも反映（Ubuntu/GNOME）
                  const t = (draft.theme||'system')
                  if (t==='light' || t==='dark') { await api.ubuntuSetTheme(t) }
                  // 軽い再起動: UI をリロード
                  setTimeout(()=>location.reload(), 200); 
                }}>保存して環境を再起動</button>
              </>)}
            </div>
          </div>
        </div>
      </div>

      <div className="settings-grid">
        <div className="game-card">
          <div className="game-card-header"><h3 className="game-card-title">システムコントロール</h3></div>
          <div className="settings-section">
            <div className="control-grid">
              <div className="control-item">
                <label className="setting-label">音量</label>
                <div className="slider-container">
                  <input type="range" min="0" max="100" value={volume} onChange={e=>setVol(Number(e.target.value))} className="game-slider" />
                  <span className="slider-value">{volume}%</span>
                </div>
              </div>
              <div className="control-item">
                <label className="setting-label">輝度</label>
                <div className="slider-container">
                  <input type="range" min="0" max="100" value={brightness} onChange={e=>setBrt(Number(e.target.value))} className="game-slider" />
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
              <button className="game-btn danger small" onClick={()=>power('logout')}>ログアウト</button>
              <button className="game-btn danger small" onClick={()=>power('reboot')}>再起動</button>
              <button className="game-btn danger small" onClick={()=>power('shutdown')}>シャットダウン</button>
            </div>
            <div style={{ marginTop: 12 }}>
              <label className="setting-label">バックエンドログ</label>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <button className={`game-btn ${loggingEnabled?'primary':'secondary'}`} onClick={async()=>{
                  const next = !loggingEnabled
                  setLoggingEnabled(next)
                  try { await api.setSettings({ ...settings, logging_enabled: next }); } catch {}
                }}>{loggingEnabled?'有効':'無効'}</button>
                <span style={{ fontSize: 12, opacity: .8 }}>場所: ~/.local/share/sis-ui/logs/backend.log</span>
                <button className="game-btn secondary" onClick={async()=>{
                  const text = await api.getBackendLog(200)
                  alert(text || '(空)')
                }}>表示</button>
                <button className="game-btn secondary" onClick={async()=>{ await api.clearBackendLog() }}>クリア</button>
              </div>
            </div>
          </div>
        </div>

        <div className="game-card">
          <div className="game-card-header"><h3 className="game-card-title">外観設定</h3></div>
          <div className="settings-section">
            <div className="setting-group">
              <label className="setting-label">テーマ</label>
              <div style={{ display:'flex', gap:8 }}>
                {['system','light','dark'].map(t=> (
                  <button key={t} className={`game-btn ${draft.theme===t?'primary':'secondary'}`} onClick={()=>applyTheme(t)}>{t==='system'?'システム':t==='light'?'ライト':'ダーク'}</button>
                ))}
              </div>
            </div>
            <div className="setting-group">
              <label className="setting-label">Dock 透明度</label>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <input type="range" min={0} max={1} step={0.01} value={draft.appearance?.dockOpacity ?? 0.95} onChange={(e)=>{ const v=parseFloat(e.target.value); setDraft((p:any)=>({ ...p, appearance:{ ...p.appearance, dockOpacity:v }})); applyAppearance({ ...draft.appearance, dockOpacity:v }) }} />
                <span style={{ width:40, textAlign:'right' }}>{Math.round(100*(draft.appearance?.dockOpacity ?? 0.95))}%</span>
              </div>
            </div>
            <div className="setting-group">
              <label className="setting-label">Dock ブラー(px)</label>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <input type="range" min={0} max={60} step={1} value={draft.appearance?.dockBlur ?? 20} onChange={(e)=>{ const v=parseInt(e.target.value); setDraft((p:any)=>({ ...p, appearance:{ ...p.appearance, dockBlur:v }})); applyAppearance({ ...draft.appearance, dockBlur:v }) }} />
                <span style={{ width:40, textAlign:'right' }}>{draft.appearance?.dockBlur ?? 20}px</span>
              </div>
            </div>
            <div className="setting-group">
              <label className="setting-label">Dock アイコンサイズ(px)</label>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <input type="range" min={32} max={96} step={2} value={draft.appearance?.dockIcon ?? 56} onChange={(e)=>{ const v=parseInt(e.target.value); setDraft((p:any)=>({ ...p, appearance:{ ...p.appearance, dockIcon:v }})); applyAppearance({ ...draft.appearance, dockIcon:v }) }} />
                <span style={{ width:40, textAlign:'right' }}>{draft.appearance?.dockIcon ?? 56}px</span>
              </div>
            </div>
            <div className="setting-group">
              <label className="setting-label">アプリ一覧のアイコン(px)</label>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <input type="range" min={48} max={128} step={4} value={draft.appearance?.appIcon ?? 80} onChange={(e)=>{ const v=parseInt(e.target.value); setDraft((p:any)=>({ ...p, appearance:{ ...p.appearance, appIcon:v }})); applyAppearance({ ...draft.appearance, appIcon:v }) }} />
                <span style={{ width:40, textAlign:'right' }}>{draft.appearance?.appIcon ?? 80}px</span>
              </div>
            </div>
            <div className="setting-group">
              <label className="setting-label">壁紙（SIS UI のみ適用）</label>
              <div style={{ display:'flex', gap:8 }}>
                <input type="text" className="game-input" value={draft.wallpaper||''} onChange={e=>setDraft((p:any)=>({...p, wallpaper:e.target.value}))} placeholder="/path/to/wallpaper.jpg または url(...)" />
                <button className="game-btn secondary" onClick={async()=>{
                  const picked = await api.pickImageFile(); 
                  if (!picked) return;
                  console.log('Picked wallpaper:', picked)
                  // 保存用には実パス/URL文字列、表示用にはCSS url(...) を使い分ける
                  setDraft((p:any)=>({ ...p, wallpaper: picked }))
                  const cssVal = await api.cssUrlForPath(picked)
                  console.log('CSS value:', cssVal)
                  document.documentElement.style.setProperty('--desktop-wallpaper', cssVal)
                  // 即時保存して次回起動時も反映
                  try { 
                    await api.setSettings({ ...draft, wallpaper: picked })
                    console.log('Wallpaper settings saved')
                  } catch (e) { 
                    console.error('Failed to save wallpaper settings:', e)
                  }
                }}>画像を選択</button>
                <button className="game-btn secondary" onClick={async()=>{
                  setDraft((p:any)=>({ ...p, wallpaper: '' }))
                  document.documentElement.style.removeProperty('--desktop-wallpaper')
                  try { await api.setSettings({ ...draft, wallpaper: '' }) } catch {}
                }}>クリア</button>
                <button className="game-btn primary" onClick={async()=>{
                  if (!draft.wallpaper) return
                  console.log('Applying wallpaper manually:', draft.wallpaper)
                  try {
                    const cssVal = await api.cssUrlForPath(draft.wallpaper)
                    console.log('Manual CSS value:', cssVal)
                    document.documentElement.style.setProperty('--desktop-wallpaper', cssVal)
                    await api.setSettings(draft)
                    console.log('Manual wallpaper applied and saved')
                  } catch (e) {
                    console.error('Failed to apply wallpaper:', e)
                    alert('壁紙の適用に失敗しました: ' + e)
                  }
                }}>適用</button>
              </div>
              <div style={{ fontSize:12, opacity:.7, marginTop:6 }}>注: OS全体の壁紙は変更しません。パス入力後は「適用」ボタンを押してください。</div>
            </div>
          </div>
        </div>

  {/* ディレクトリ設定は現状UIからは非表示（XDG自動検出を使用） */}

        <div className="game-card">
          <div className="game-card-header"><h3 className="game-card-title">LM Studio 接続設定</h3></div>
          <div className="settings-section">
            <div className="setting-group">
              <label className="setting-label">接続モード</label>
              <div style={{ display:'flex', gap:8 }}>
                {['lmstudio','local'].map(t=> (
                  <button key={t} className={`game-btn ${draft.llm_mode===t?'primary':'secondary'}`} onClick={()=>setDraft((p:any)=>({ ...p, llm_mode:t }))}>{t}</button>
                ))}
              </div>
            </div>
            <div className="setting-group">
              <label className="setting-label">LM Studio サーバーURL</label>
              <input type="text" className="game-input" value={draft.llm_remote_url||''} onChange={e=>setDraft((p:any)=>({ ...p, llm_remote_url:e.target.value }))} placeholder="http://localhost:1234/v1/chat/completions" />
            </div>
            <div className="setting-group">
              <label className="setting-label">モデル名</label>
              <input type="text" className="game-input" value={draft.llm_model||''} onChange={e=>setDraft((p:any)=>({ ...p, llm_model:e.target.value }))} placeholder="例: qwen3-14b@q4_k_m" />
            </div>
            <div className="setting-group">
              <label className="setting-label">APIキー（必要な場合）</label>
              <input type="password" className="game-input" value={draft.llm_api_key||''} onChange={e=>setDraft((p:any)=>({ ...p, llm_api_key:e.target.value }))} />
            </div>
            <div className="setting-group" style={{ display:'flex', alignItems:'center', gap:8 }}>
              <label className="setting-label">localhost の場合は自動起動を試行</label>
              <button className={`game-btn ${draft.llm_autostart_localhost?'primary':'secondary'}`} onClick={()=>setDraft((p:any)=>({ ...p, llm_autostart_localhost: !p.llm_autostart_localhost }))}>{draft.llm_autostart_localhost?'有効':'無効'}</button>
            </div>
            <div style={{ display:'flex', gap:8, marginTop:8 }}>
              <button className="game-btn primary" onClick={save}>保存</button>
              <button className="game-btn secondary" onClick={async()=>{ try { const s = await api.getSettings(); setDraft(s); } catch {} }}>再読込</button>
              <button className="game-btn secondary" onClick={()=>{
                const u = draft.llm_remote_url || 'http://localhost:1234/v1/chat/completions'
                alert(`現在の接続先: ${u}`)
              }}>接続先を確認</button>
            </div>
          </div>
        </div>

        <div className="game-card">
          <div className="game-card-header"><h3 className="game-card-title">Ubuntu システム管理</h3></div>
          <div className="settings-section">
            <div className="control-grid">
              <div className="control-item">
                <label className="setting-label">システム更新 (sudo)</label>
                <button className="game-btn primary" onClick={() => requestSudoAction('update')}>
                  更新を実行
                </button>
              </div>
              <div className="control-item">
                <label className="setting-label">システム設定</label>
                <button className="game-btn secondary" title="Ubuntuの設定アプリを開きます" onClick={() => requestSudoAction('settings')}>
                  設定を開く
                </button>
              </div>
              <div className="control-item">
                <label className="setting-label">ソフトウェア管理</label>
                <button className="game-btn secondary" title="ソフトウェアセンターを起動" onClick={() => requestSudoAction('software')}>
                  Software Center
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="game-card accent">
          <div className="game-card-header"><h3 className="game-card-title">詳細システム情報</h3></div>
          <div className="settings-section">
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label">OS</span>
                <span className="info-value">{systemInfo.os || 'Ubuntu Linux'}</span>
              </div>
              <div className="info-item">
                <span className="info-label">カーネル</span>
                <span className="info-value">{systemInfo.kernel || 'Unknown'}</span>
              </div>
              <div className="info-item">
                <span className="info-label">稼働時間</span>
                <span className="info-value">{systemInfo.uptime || 'Unknown'}</span>
              </div>
              <div className="info-item">
                <span className="info-label">CPU</span>
                <span className="info-value">{systemInfo.cpu || 'Unknown'}</span>
              </div>
              <div className="info-item">
                <span className="info-label">メモリ</span>
                <span className="info-value">
                  {systemInfo.memory ? `${systemInfo.memory.used} / ${systemInfo.memory.total}` : 'Unknown'}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">ディスク</span>
                <span className="info-value">
                  {systemInfo.disk ? `${systemInfo.disk.used} / ${systemInfo.disk.total}` : 'Unknown'}
                </span>
              </div>
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button className="game-btn secondary" onClick={async()=>{
                const info = await api.getDetailedSystemInfo();
                setSystemInfo(info);
              }}>再取得</button>
              <button className="game-btn secondary" onClick={()=>{ setPendingAction('probe-info'); setShowSudoDialog(true); }}>sudoで情報取得</button>
            </div>
          </div>
        </div>

        <div className="game-card accent">
          <div className="game-card-header"><h3 className="game-card-title">システム情報</h3></div>
          <div className="settings-section">
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label">OS</span>
                <span className="info-value">{systemInfo.os || 'N/A'}</span>
              </div>
              <div className="info-item">
                <span className="info-label">カーネル</span>
                <span className="info-value">{systemInfo.kernel || 'N/A'}</span>
              </div>
              <div className="info-item">
                <span className="info-label">稼働時間</span>
                <span className="info-value">{systemInfo.uptime || 'N/A'}</span>
              </div>
              <div className="info-item">
                <span className="info-label">CPU</span>
                <span className="info-value">{systemInfo.cpu || 'N/A'}</span>
              </div>
              <div className="info-item">
                <span className="info-label">メモリ使用量</span>
                <span className="info-value">
                  {systemInfo.memory ? `${systemInfo.memory.used} / ${systemInfo.memory.total}` : 'N/A'}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">ディスク使用量</span>
                <span className="info-value">
                  {systemInfo.disk ? `${systemInfo.disk.used} / ${systemInfo.disk.total}` : 'N/A'}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">UI バージョン</span>
                <span className="info-value">SIS-UI 0.1.0</span>
              </div>
              
              <div className="info-item">
                <span className="info-label">設定状態</span>
                <span className={`info-status ${isDirty?'modified':'saved'}`}>
                  {isDirty?'変更あり':'保存済み'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sudo権限要求ダイアログ */}
      {showSudoDialog && (
        <div className="modal-overlay">
          <div className="modal-content sudo-dialog">
            <h3>管理者権限が必要です</h3>
            <p>この操作には管理者権限が必要です。パスワードを入力してください。</p>
            <div className="setting-group">
              <label className="setting-label">パスワード</label>
              <input
                type="password"
                className="game-input"
                value={sudoPassword}
                onChange={(e) => setSudoPassword(e.target.value)}
                placeholder="sudo パスワード"
                onKeyPress={(e) => e.key === 'Enter' && executeSudoAction()}
              />
            </div>
            <div className="dialog-actions">
              <button className="game-btn secondary" onClick={() => {
                setShowSudoDialog(false)
                setSudoPassword('')
                setPendingAction('')
              }}>
                キャンセル
              </button>
              <button className="game-btn primary" onClick={executeSudoAction}>
                実行
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Settings
