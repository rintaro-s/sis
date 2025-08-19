import { useEffect, useState } from 'react'
import './MiniControlCenter.css'
import { api } from '../services/api'

type Props = { open: boolean; onClose: () => void }

export default function MiniControlCenter({ open, onClose }: Props) {
  const [volume, setVolume] = useState(50)
  const [brightness, setBrightness] = useState(80)
  const [network, setNetwork] = useState(true)
  const [bluetooth, setBluetooth] = useState(true)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const applyVolume = async (v: number) => { setVolume(v); const r = await api.setVolume(v); if (!r.ok) alert('音量変更に失敗') }
  const applyBrightness = async (v: number) => { setBrightness(v); const r = await api.setBrightness(v); if (!r.ok) alert('輝度変更に失敗') }
  const toggleNetwork = async () => { const n = !network; setNetwork(n); const r = await api.networkSet(n); if (!r.ok) alert('ネットワーク切替失敗') }
  const toggleBluetooth = async () => { const b = !bluetooth; setBluetooth(b); const r = await api.bluetoothSet(b); if (!r.ok) alert('Bluetooth切替失敗') }

  return (
    <div className="cc-root" onClick={onClose}>
      <div className="cc-panel" onClick={(e)=>e.stopPropagation()}>
        <div className="cc-title">コントロールセンター</div>
        <div className="cc-row">
          <span>音量</span>
          <input type="range" min={0} max={100} value={volume} onChange={(e)=>applyVolume(Number(e.target.value))} />
        </div>
        <div className="cc-row">
          <span>輝度</span>
          <input type="range" min={0} max={100} value={brightness} onChange={(e)=>applyBrightness(Number(e.target.value))} />
        </div>
        <div className="cc-row">
          <span>ネットワーク</span>
          <label className="cc-switch">
            <input type="checkbox" checked={network} onChange={toggleNetwork} />
            <span />
          </label>
        </div>
        <div className="cc-row">
          <span>Bluetooth</span>
          <label className="cc-switch">
            <input type="checkbox" checked={bluetooth} onChange={toggleBluetooth} />
            <span />
          </label>
        </div>
        <div className="cc-actions">
          <button onClick={()=>api.takeScreenshot()}>スクショ</button>
          <button onClick={()=>api.playPauseMusic()}>⏯</button>
          <button onClick={onClose}>閉じる</button>
        </div>
        <div className="cc-hint">Ctrl+Shift+C で開閉 / Escで閉じる</div>
      </div>
    </div>
  )
}
