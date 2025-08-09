import { useEffect, useRef, useState } from 'react'
import './HaloHud.css'

type Props = { visible: boolean }

// Halo HUD: キーホールド中だけ出現する円形ヘルプ/ショートカットHUD
export default function HaloHud({ visible }: Props) {
  const [hint, setHint] = useState('')
  const [pos, setPos] = useState<{x:number;y:number}>({ x: window.innerWidth/2, y: window.innerHeight/2 })
  const rafRef = useRef<number | null>(null)
  const ringRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!visible) return
    const tick = () => {
      if (ringRef.current) {
        const t = performance.now() * 0.001
        const glow = 0.4 + Math.sin(t * 2) * 0.2
        ringRef.current.style.boxShadow = `0 0 ${24 + glow * 16}px rgba(168, 195, 255, ${0.35 + glow * 0.25})`
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [visible])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      const k = target.getAttribute('data-hint')
      setHint(k ?? '')
  setPos({ x: e.clientX, y: e.clientY })
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  if (!visible) return null

  const actions = [
    { key: 'A', label: 'アプリランチャー', hint: 'Alt+Space で開閉' },
    { key: 'F', label: 'ファイル', hint: '最近のダウンロードを整理' },
    { key: 'M', label: 'ミュージック', hint: '再生/次/前' },
    { key: 'V', label: 'ボリューム', hint: '音量スライダー' },
    { key: 'S', label: 'スクリーン', hint: 'スクショを撮影' },
    { key: 'C', label: 'コントロール', hint: 'Wi-Fi / BT / 明るさ' },
  ]

  return (
    <div className="halo-root">
      <div className="halo-overlay" />
  <div className="halo-ring" ref={ringRef} style={{ left: pos.x, top: pos.y }}>
        <div className="halo-center" data-hint="Spaceを離すと閉じます" />
        {actions.map((a, i) => (
          <div
            className={`halo-slot halo-slot-${i}`}
            key={a.key}
            data-hint={`${a.label} — ${a.hint}`}
            aria-label={a.label}
            role="button"
          >
            <span className="halo-key">{a.key}</span>
            <span className="halo-label">{a.label}</span>
          </div>
        ))}
      </div>
      <div className="halo-hint">{hint || 'Ctrl(またはAlt)+Spaceをホールド'}</div>
    </div>
  )
}
