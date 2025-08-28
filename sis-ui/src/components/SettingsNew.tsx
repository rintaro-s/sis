import { useEffect, useState } from 'react';
import { api } from '../services/api';
import './Settings.css';

// デフォルト設定のテンプレート
const DEFAULT_SETTINGS = {
  wallpaper: '',
  theme: 'system',
  user_dirs: {
    desktop: '',
    documents: '',
    downloads: '',
    music: '',
    pictures: '',
    videos: ''
  }
}

function Settings() {
  const [settings, setSettings] = useState<any>({})
  const [draft, setDraft] = useState<any>({})
  const [isDirty, setIsDirty] = useState(false)
  const [capabilities, setCapabilities] = useState<{canListDir?: boolean}>({})
  const [volume, setVolume] = useState(50)
  const [brightness, setBrightness] = useState(80)
  const [network, setNetwork] = useState(true)
  const [bluetooth, setBluetooth] = useState(true)
  const [mdm, setMdm] = useState<{ monitoring: { screen: boolean; web_history: boolean; images: boolean; files: boolean }, screen_time: any } | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const savedSettings = await api.getSettings().catch(() => DEFAULT_SETTINGS)
        const mergedSettings = { ...DEFAULT_SETTINGS, ...savedSettings }
        
        // XDG ディレクトリの取得と設定へのマージ
        try {
          const xdgDirs = await api.getXdgUserDirs()
          const mergedUserDirs = {
            ...mergedSettings.user_dirs,
            desktop: mergedSettings.user_dirs?.desktop || xdgDirs.desktop || '',
            documents: mergedSettings.user_dirs?.documents || xdgDirs.documents || '',
            downloads: mergedSettings.user_dirs?.downloads || xdgDirs.downloads || '',
            music: mergedSettings.user_dirs?.music || xdgDirs.music || '',
            pictures: mergedSettings.user_dirs?.pictures || xdgDirs.pictures || '',
            videos: mergedSettings.user_dirs?.videos || xdgDirs.videos || ''
          }
          mergedSettings.user_dirs = mergedUserDirs
        } catch { /* XDG取得失敗時は元の設定を維持 */ }
        
        setSettings(mergedSettings)
        setDraft(JSON.parse(JSON.stringify(mergedSettings)))
        
        // 機能チェック
        try {
          await api.listDir('/tmp')
          setCapabilities({ canListDir: true })
        } catch {
          setCapabilities({ canListDir: false })
        }

        // コントロールセンターの状態を取得
        api.controlCenterState().then((s) => {
          if (!s) return
          if (typeof s.volume === 'number') setVolume(s.volume)
          if (typeof s.brightness === 'number') setBrightness(s.brightness)
          if (typeof s.network === 'boolean') setNetwork(s.network)
          if (typeof s.bluetooth === 'boolean') setBluetooth(s.bluetooth)
        }).catch(()=>{})

  // MDM 状態
  api.getMdmStatus().then(setMdm).catch(()=>setMdm(null))
      } catch (error) {
        console.error('設定読み込みエラー:', error)
        setSettings(DEFAULT_SETTINGS)
        setDraft(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)))
      }
    })()
  }, [])

  useEffect(() => {
    setIsDirty(JSON.stringify(settings) !== JSON.stringify(draft))
  }, [settings, draft])

  const updateDraft = (path: string, value: any) => {
    setDraft((prev: any) => {
      const keys = path.split('.')
      const newDraft = JSON.parse(JSON.stringify(prev))
      let target = newDraft
      for (let i = 0; i < keys.length - 1; i++) {
        if (!target[keys[i]]) target[keys[i]] = {}
        target = target[keys[i]]
      }
      target[keys[keys.length - 1]] = value
      return newDraft
    })
  }

  const saveAndExit = async () => {
    try {
      await api.setSettings(draft)
      setSettings(JSON.parse(JSON.stringify(draft)))
      setIsDirty(false)
      localStorage.setItem('sis-ui-settings-backup', JSON.stringify(draft))
    } catch (error) {
      console.error('設定保存エラー:', error)
      alert('設定の保存に失敗しました')
    }
  }

  const discardAndExit = () => {
    setDraft(JSON.parse(JSON.stringify(settings)))
    setIsDirty(false)
  }

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

  return (
    <div className="settings-container">
      <div className="settings-header">
        <div className="game-card large">
          <div className="game-card-header">
            <h2 className="game-card-title">システム設定</h2>
            <div className="settings-actions">
              {isDirty && (
                <>
                  <button className="game-btn primary" onClick={saveAndExit}>
                    💾 保存
                  </button>
                  <button className="game-btn secondary" onClick={discardAndExit}>
                    ❌ 変更を破棄
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="settings-grid">
        {/* システムコントロール */}
        <div className="game-card">
          <div className="game-card-header">
            <h3 className="game-card-title">🔧 システムコントロール</h3>
          </div>
          <div className="settings-section">
            <div className="control-grid">
              <div className="control-item">
                <label className="setting-label">音量</label>
                <div className="slider-container">
                  <input 
                    type="range" 
                    min="0" 
                    max="100" 
                    value={volume} 
                    onChange={e => applyVolume(Number(e.target.value))}
                    className="game-slider"
                  />
                  <span className="slider-value">{volume}%</span>
                </div>
              </div>
              
              <div className="control-item">
                <label className="setting-label">☀️ 輝度</label>
                <div className="slider-container">
                  <input 
                    type="range" 
                    min="0" 
                    max="100" 
                    value={brightness} 
                    onChange={e => applyBrightness(Number(e.target.value))}
                    className="game-slider"
                  />
                  <span className="slider-value">{brightness}%</span>
                </div>
              </div>
              
              <div className="control-item">
                <label className="setting-label">🌐 ネットワーク</label>
                <button 
                  className={`game-btn toggle ${network ? 'active' : ''}`}
                  onClick={toggleNetwork}
                >
                  {network ? 'オン' : 'オフ'}
                </button>
              </div>
              
              <div className="control-item">
                <label className="setting-label">📶 Bluetooth</label>
                <button 
                  className={`game-btn toggle ${bluetooth ? 'active' : ''}`}
                  onClick={toggleBluetooth}
                >
                  {bluetooth ? 'オン' : 'オフ'}
                </button>
              </div>
            </div>
            
            <div className="power-controls">
              <button className="game-btn danger small" onClick={() => power('logout')}>
                🚪 ログアウト
              </button>
              <button className="game-btn danger small" onClick={() => power('reboot')}>
                🔄 再起動
              </button>
              <button className="game-btn danger small" onClick={() => power('shutdown')}>
                ⚡ シャットダウン
              </button>
            </div>
          </div>
        </div>

        {/* 外観設定 */}
        <div className="game-card">
          <div className="game-card-header">
            <h3 className="game-card-title">🎨 外観設定</h3>
          </div>
          <div className="settings-section">
            <div className="setting-group">
              <label className="setting-label">テーマ</label>
              <select 
                className="game-input" 
                value={draft.theme || 'system'} 
                onChange={e => updateDraft('theme', e.target.value)}
              >
                <option value="system">システム連動</option>
                <option value="light">ライト</option>
                <option value="dark">ダーク</option>
              </select>
            </div>
            
            <div className="setting-group">
              <label className="setting-label">壁紙パス</label>
              <input 
                type="text" 
                className="game-input"
                value={draft.wallpaper || ''} 
                onChange={e => updateDraft('wallpaper', e.target.value)}
                placeholder="/path/to/wallpaper.jpg"
              />
            </div>
          </div>
        </div>

        {/* MDM / 教室ユーティリティ */}
        <div className="game-card">
          <div className="game-card-header">
            <h3 className="game-card-title">🏫 MDM / 教室ユーティリティ</h3>
          </div>
          <div className="settings-section">
            {mdm ? (
              <>
                <div className="info-grid">
                  <div className="info-item">
                    <span className="info-label">監視: 画面</span>
                    <span className={`info-status ${mdm.monitoring.screen ? 'active' : 'inactive'}`}>{mdm.monitoring.screen ? 'ON' : 'OFF'}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">監視: Web履歴</span>
                    <span className={`info-status ${mdm.monitoring.web_history ? 'active' : 'inactive'}`}>{mdm.monitoring.web_history ? 'ON' : 'OFF'}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">監視: 画像メタ</span>
                    <span className={`info-status ${mdm.monitoring.images ? 'active' : 'inactive'}`}>{mdm.monitoring.images ? 'ON' : 'OFF'}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">監視: ファイル</span>
                    <span className={`info-status ${mdm.monitoring.files ? 'active' : 'inactive'}`}>{mdm.monitoring.files ? 'ON' : 'OFF'}</span>
                  </div>
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="game-btn" onClick={() => api.mdmApply()}>ポリシー更新</button>
                  <button className="game-btn" onClick={() => api.mdmPullFiles()}>配布を受信</button>
                  <button className="game-btn" onClick={() => api.mdmScreenshot()}>スクリーンショット送信</button>
                  <button className="game-btn" onClick={async () => {
                    const p = await api.pickAnyFile()
                    if (p) await api.mdmSubmitFile(p)
                  }}>提出...</button>
                </div>
              </>
            ) : (
              <div className="capability-warning">MDM 状態が取得できません</div>
            )}
          </div>
        </div>

        {/* ディレクトリ設定 */}
        <div className="game-card">
          <div className="game-card-header">
            <h3 className="game-card-title">ディレクトリ設定</h3>
            {!capabilities.canListDir && (
              <div className="capability-warning">
                ⚠️ ディレクトリ一覧機能が利用できません
              </div>
            )}
          </div>
          <div className="settings-section">
            <div className="directory-grid">
              {[
                { key: 'desktop', label: '🖥️ デスクトップ', icon: '🖥️' },
                { key: 'documents', label: 'ドキュメント', icon: '' },
                { key: 'downloads', label: '⬇️ ダウンロード', icon: '⬇️' },
                { key: 'music', label: '🎵 音楽', icon: '🎵' },
                { key: 'pictures', label: '🖼️ 画像', icon: '🖼️' },
                { key: 'videos', label: '🎬 動画', icon: '🎬' }
              ].map(({ key, label, icon }) => (
                <div key={key} className="setting-group directory-item">
                  <label className="setting-label">
                    <span className="directory-icon">{icon}</span>
                    {label}
                  </label>
                  <input 
                    type="text" 
                    className="game-input"
                    value={draft.user_dirs?.[key] || ''} 
                    onChange={e => updateDraft(`user_dirs.${key}`, e.target.value)}
                    placeholder={`/${key}へのパス`}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* システム情報 */}
        <div className="game-card accent">
          <div className="game-card-header">
            <h3 className="game-card-title">ℹ️ システム情報</h3>
          </div>
          <div className="settings-section">
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label">UI バージョン</span>
                <span className="info-value">SIS-UI 0.1.0</span>
              </div>
              <div className="info-item">
                <span className="info-label">ディレクトリ一覧</span>
                <span className={`info-status ${capabilities.canListDir ? 'available' : 'unavailable'}`}>
                  {capabilities.canListDir ? '✅ 利用可能' : '❌ 利用不可'}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">設定状態</span>
                <span className={`info-status ${isDirty ? 'modified' : 'saved'}`}>
                  {isDirty ? '🔄 変更あり' : '💾 保存済み'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Settings;
