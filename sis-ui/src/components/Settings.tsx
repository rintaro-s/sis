
import { useEffect, useState } from 'react';
import { api } from '../services/api';
import './Settings.css';

function Settings() {
  const [volume, setVolume] = useState(50)
  const [brightness, setBrightness] = useState(80)
  const [network, setNetwork] = useState(true)
  const [bluetooth, setBluetooth] = useState(true)

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

  // simple theme switch using data-theme on body
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  useEffect(() => {
    document.body.dataset.theme = theme
  }, [theme])
  return (
    <div className="settings">
      <h3>設定</h3>
      <div className="setting-item">
        <span>テーマ</span>
        <div className="theme-selector">
          <button className={`theme-button ${theme==='dark'?'active':''}`} onClick={()=>setTheme('dark')}>ダーク</button>
          <button className={`theme-button ${theme==='light'?'active':''}`} onClick={()=>setTheme('light')}>ライト</button>
        </div>
      </div>
      <div className="setting-item">
        <span>音量</span>
        <input type="range" min="0" max="100" value={volume} className="slider" onChange={(e) => applyVolume(Number(e.target.value))} />
      </div>
      <div className="setting-item">
        <span>輝度</span>
        <input type="range" min="0" max="100" value={brightness} className="slider" onChange={(e) => applyBrightness(Number(e.target.value))} />
      </div>
      <div className="setting-item">
        <span>ネットワーク</span>
        <label className="switch">
          <input type="checkbox" checked={network} onChange={toggleNetwork} />
          <span className="slider round"></span>
        </label>
      </div>
      <div className="setting-item">
        <span>Bluetooth</span>
        <label className="switch">
          <input type="checkbox" checked={bluetooth} onChange={toggleBluetooth} />
          <span className="slider round"></span>
        </label>
      </div>
      <div className="setting-item">
        <span>電源</span>
        <div className="theme-selector">
          <button className="theme-button" onClick={() => power('logout')}>ログアウト</button>
          <button className="theme-button" onClick={() => power('reboot')}>再起動</button>
          <button className="theme-button" onClick={() => power('shutdown')}>シャットダウン</button>
        </div>
      </div>
    </div>
  );
}

export default Settings;
