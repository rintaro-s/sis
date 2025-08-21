
import { useEffect, useState } from 'react';
import { api } from '../services/api';
import './Settings.css';

function Settings() {
  const [volume, setVolume] = useState(50)
  const [brightness, setBrightness] = useState(80)
  const [network, setNetwork] = useState(true)
  const [bluetooth, setBluetooth] = useState(true)
  const [logPanelOpen, setLogPanelOpen] = useState<null | 'backend' | 'frontend'>(null)
  const [backendLog, setBackendLog] = useState('')

  useEffect(() => {
    // preload control center state
    api.controlCenterState().then((s) => {
      if (!s) return
      if (typeof s.volume === 'number') setVolume(s.volume)
      if (typeof s.brightness === 'number') setBrightness(s.brightness)
      if (typeof s.network === 'boolean') setNetwork(s.network)
      if (typeof s.bluetooth === 'boolean') setBluetooth(s.bluetooth)
    }).catch(()=>{})
  }, [])

  const applyVolume = async (v: number) => {
    setVolume(v)
    const r = await api.setVolume(v)
    if (!r.ok) alert('音量変更に失敗しました')
  }
  const applyBrightness = async (v: number) => {
    setBrightness(v)
    const r = await api.setBrightness(v)
    if (!r.ok) alert('輝度変更に失敗しました')
  }
  const toggleNetwork = async () => {
    const next = !network
    setNetwork(next)
    const r = await api.networkSet(next)
    if (!r.ok) alert('ネットワーク切替に失敗しました')
  }
  const toggleBluetooth = async () => {
    const next = !bluetooth
    setBluetooth(next)
    const r = await api.bluetoothSet(next)
    if (!r.ok) alert('Bluetooth切替に失敗しました')
  }
  const power = async (action: 'shutdown' | 'reboot' | 'logout') => {
    const r = await api.powerAction(action)
    if (!r.ok) alert('電源操作に失敗しました')
  }

  // theme selector (no auto-force on open)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (document.body.dataset.theme as any) || 'dark')
  useEffect(() => { document.body.dataset.theme = theme }, [theme])
  // LLM / 設定ストレージ
  const [settings, setSettings] = useState<any | null>(null)
  const [advOpen, setAdvOpen] = useState(false)
  const [localModels, setLocalModels] = useState<string[]>([])

  useEffect(() => { api.getSettings().then(setSettings) }, [])
  useEffect(() => { api.listLocalModels().then(setLocalModels) }, [])

  const saveSettings = async (patch: any) => {
    const next = { ...(settings||{}), ...patch }
    setSettings(next)
    await api.setSettings(next)
  }

  const llmMode = settings?.llm_mode ?? 'lmstudio'
  const isLocalMode = llmMode === 'local'
  const appSort = settings?.app_sort ?? 'name'

  return (
    <div className="settings">
      <h3>設定</h3>
      <div className="setting-item">
        <span>バックログ</span>
        <label className="switch">
          <input type="checkbox" checked={!!settings?.logging_enabled} onChange={(e)=>saveSettings({ logging_enabled: e.target.checked })} />
          <span className="slider round"></span>
        </label>
      </div>
      <div className="setting-item">
        <span>テーマ</span>
        <div className="theme-selector">
          <button className={`theme-button ${theme==='dark'?'active':''}`} onClick={()=>setTheme('dark')}>ダーク</button>
          <button className={`theme-button ${theme==='light'?'active':''}`} onClick={()=>setTheme('light')}>ライト</button>
        </div>
      </div>
      <div className="setting-item">
        <span>音量</span>
  <input type="range" min="0" max="100" value={volume} className="range-slider" onChange={(e) => applyVolume(Number(e.target.value))} />
      </div>
      <div className="setting-item">
        <span>輝度</span>
  <input type="range" min="0" max="100" value={brightness} className="range-slider" onChange={(e) => applyBrightness(Number(e.target.value))} />
      </div>
      <div className="setting-item">
        <span>ネットワーク</span>
        <label className="switch">
          <input type="checkbox" checked={network} onChange={toggleNetwork} />
          <span className="toggle-slider"></span>
        </label>
      </div>
      <div className="setting-item">
        <span>Bluetooth</span>
        <label className="switch">
          <input type="checkbox" checked={bluetooth} onChange={toggleBluetooth} />
          <span className="toggle-slider"></span>
        </label>
      </div>
      <div className="setting-item">
        <span>アプリの並び順</span>
        <div className="theme-selector">
          <button className={`theme-button ${appSort==='name'?'active':''}`} onClick={()=>saveSettings({ app_sort: 'name' })}>名前</button>
          <button className={`theme-button ${appSort==='recent'?'active':''}`} onClick={()=>saveSettings({ app_sort: 'recent' })}>最近</button>
        </div>
      </div>
      <div className="setting-item">
        <span>ディレクトリのパス</span>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, width: '100%' }}>
          {['desktop','documents','downloads','pictures','music','videos'].map((k)=>{
            const val = settings?.user_dirs?.[k] ?? ''
            return (
              <>
                <label key={k+':label'} style={{ alignSelf: 'center' }}>{k}</label>
                <input key={k+':input'} value={val} placeholder={`~/`+k}
                  onChange={(e)=>saveSettings({ user_dirs: { ...(settings?.user_dirs||{}), [k]: e.target.value } })} />
              </>
            )
          })}
        </div>
      </div>
      <div className="setting-item">
        <span>LLM（LM Studio/ローカルGGUF）</span>
        <div className="theme-selector">
          <button className={`theme-button ${llmMode==='lmstudio'?'active':''}`} onClick={()=>saveSettings({ llm_mode: 'lmstudio' })}>LM Studio</button>
          <button className={`theme-button ${llmMode==='local'?'active':''}`} onClick={()=>saveSettings({ llm_mode: 'local' })}>ローカル</button>
        </div>
        <div style={{ marginTop: 6 }}>
          <button className="theme-button" onClick={()=>setAdvOpen(v=>!v)}>{advOpen?'拡張設定を閉じる':'拡張設定を表示'}</button>
        </div>
        {advOpen && (
          <>
            {llmMode==='lmstudio' && (
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, marginTop: 8 }}>
                <label>エンドポイント</label>
                <input value={settings?.llm_remote_url||''} placeholder="http://localhost:1234/v1/chat/completions" onChange={(e)=>saveSettings({ llm_remote_url: e.target.value })} />
                <label>モデル</label>
                <input value={settings?.llm_model||''} placeholder="qwen3-14b@q4_k_m" onChange={(e)=>saveSettings({ llm_model: e.target.value })} />
                <label>APIキー</label>
                <input value={settings?.llm_api_key||''} placeholder="必要な場合のみ" onChange={(e)=>saveSettings({ llm_api_key: e.target.value })} />
                <label>localhostなら自動起動</label>
                <label className="switch">
                  <input type="checkbox" checked={!!settings?.llm_autostart_localhost} onChange={(e)=>saveSettings({ llm_autostart_localhost: e.target.checked })} />
                  <span className="toggle-slider"></span>
                </label>
                <div></div>
                <button className="theme-button" onClick={async()=>{ const r = await api.tryStartLmStudio(); alert(r.message||'') }}>LM Studio 起動</button>
              </div>
            )}
            {isLocalMode && (
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, marginTop: 8 }}>
                <label>HFモデルID</label>
                <input value={settings?.hf_model_id||''} placeholder="TheBloke/Qwen-2-7B-GGUF" onChange={(e)=>saveSettings({ hf_model_id: e.target.value })} />
                <div></div>
                <button className="theme-button" onClick={async()=>{
                  if (!settings?.hf_model_id) { alert('モデルIDを入力してください'); return }
                  const r = await api.llmDownloadHf(settings.hf_model_id)
                  if (r.ok) { setLocalModels(await api.listLocalModels()); alert('ダウンロード完了: '+(r.path||'')) }
                  else { alert(r.message||'ダウンロード失敗') }
                }}>ダウンロード</button>
                <label>ローカルモデル</label>
                <select value={settings?.local_model_path||''} onChange={(e)=>saveSettings({ local_model_path: e.target.value })}>
                  <option value="">選択してください</option>
                  {localModels.map((p)=> (<option key={p} value={p}>{p}</option>))}
                </select>
              </div>
            )}
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
              <div>LM Studio 既定: http://localhost:1234/v1/chat/completions / モデル: qwen3-14b@q4_k_m</div>
              <div>ローカル: ~/.local/share/sis-ui/models 以下の .gguf を自動検出します</div>
            </div>
          </>
        )}
      </div>
      <div className="setting-item">
        <span>電源</span>
        <div className="theme-selector">
          <button className="theme-button" onClick={() => power('logout')}>ログアウト</button>
          <button className="theme-button" onClick={() => power('reboot')}>再起動</button>
          <button className="theme-button" onClick={() => power('shutdown')}>シャットダウン</button>
        </div>
      </div>

      <div className="setting-item">
        <span>ログ</span>
        <div className="theme-selector" style={{ gap: 8 }}>
          <button className="theme-button" onClick={async()=>{ setLogPanelOpen('backend'); setBackendLog(await api.getBackendLog(500)); }}>バックエンド</button>
          <button className="theme-button" onClick={()=> setLogPanelOpen('frontend') }>フロントエンド</button>
        </div>
      </div>

      {logPanelOpen && (
        <div style={{ marginTop: 10, textAlign:'left' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
            <div style={{ fontSize: 13, opacity:.9 }}>{logPanelOpen==='backend'?'バックエンドログ（最新 約500行）':'フロントログ（直近出力）'}</div>
            <div style={{ display:'flex', gap:8 }}>
              {logPanelOpen==='backend' && (<>
                <button onClick={async()=>setBackendLog(await api.getBackendLog(500))}>再読込</button>
                <button onClick={async()=>{ await api.clearBackendLog(); setBackendLog(''); }}>消去</button>
              </>)}
              <button onClick={()=>setLogPanelOpen(null)}>閉じる</button>
            </div>
          </div>
          <pre style={{ whiteSpace:'pre-wrap', color:'#cfe6ff', fontSize:12, maxHeight: 260, overflow:'auto', margin:0, background:'rgba(0,0,0,0.25)', padding:8, borderRadius:8 }}>
            {logPanelOpen==='backend' ? backendLog : '(直近のAI/コマンド出力をここに表示します)'}
          </pre>
        </div>
      )}
    </div>
  );
}

export default Settings;
