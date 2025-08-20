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
    ;(async ()=>{
      try {
        const s = await api.controlCenterState()
        setVolume(s.volume); setBrightness(s.brightness); setNetwork(s.network); setBluetooth(s.bluetooth)
      } catch {}
    })()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const applyVolume = async (v: number) => { setVolume(v); const r = await api.setVolume(v); if (!r.ok) alert('音量変更に失敗') }
  const applyBrightness = async (v: number) => { setBrightness(v); const r = await api.setBrightness(v); if (!r.ok) alert('輝度変更に失敗') }
  const toggleNetwork = async () => { const n = !network; setNetwork(n); const r = await api.networkSet(n); if (!r.ok) alert('ネットワーク切替失敗') }
  const toggleBluetooth = async () => { const b = !bluetooth; setBluetooth(b); const r = await api.bluetoothSet(b); if (!r.ok) alert('Bluetooth切替失敗') }

  return (
    <div className={`cc-anchor ${open ? 'open' : ''}`}>
      <div className="cc-panel" role="dialog" aria-label="コントロールセンター">
        <div className="cc-grid" aria-live="polite">
          <div className="cc-tile wide">
            <div className="cc-tile-title">音量</div>
            <input type="range" min={0} max={100} value={volume} onChange={(e)=>applyVolume(Number(e.target.value))} />
          </div>
          <div className="cc-tile wide">
            <div className="cc-tile-title">輝度</div>
            <input type="range" min={0} max={100} value={brightness} onChange={(e)=>applyBrightness(Number(e.target.value))} />
          </div>
          <div className={`cc-tile ${network?'active':''}`} onClick={toggleNetwork}>
            <div className="cc-tile-title">ネットワーク</div>
            <div className="cc-tile-body">{network?'ON':'OFF'}</div>
          </div>
          <div className={`cc-tile ${bluetooth?'active':''}`} onClick={toggleBluetooth}>
            <div className="cc-tile-title">Bluetooth</div>
            <div className="cc-tile-body">{bluetooth?'ON':'OFF'}</div>
          </div>
          <div className="cc-tile" onClick={()=>api.takeScreenshot()}>
            <div className="cc-tile-title">スクショ</div>
            <div className="cc-tile-body">撮影</div>
          </div>
          <div className="cc-tile" onClick={()=>api.playPauseMusic()}>
            <div className="cc-tile-title">ミュージック</div>
            <div className="cc-tile-body">⏯</div>
          </div>
        </div>
        <div className="cc-hint">Ctrl+Shift+C で開閉 / Escで閉じる</div>
      </div>
    </div>
  )
}
