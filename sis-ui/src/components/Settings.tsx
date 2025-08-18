
import { useState } from 'react';
import { api } from '../services/api';
import './Settings.css';

function Settings() {
  const [volume, setVolume] = useState(50)
  const [brightness, setBrightness] = useState(80)
  const [network, setNetwork] = useState(true)
  const [bluetooth, setBluetooth] = useState(true)

  const applyVolume = async (v: number) => {
    setVolume(v)
    await api.setVolume(v)
  }
  const applyBrightness = async (v: number) => {
    setBrightness(v)
    await api.setBrightness(v)
  }
  const toggleNetwork = async () => {
    const next = !network
    setNetwork(next)
    await api.networkSet(next)
  }
  const toggleBluetooth = async () => {
    const next = !bluetooth
    setBluetooth(next)
    await api.bluetoothSet(next)
  }
  const power = async (action: 'shutdown' | 'reboot' | 'logout') => {
    await api.powerAction(action)
  }
  return (
    <div className="settings">
      <h3>設定</h3>
      <div className="setting-item">
        <span>テーマ</span>
        <div className="theme-selector">
          <button className="theme-button active">ダーク</button>
          <button className="theme-button">ライト</button>
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
