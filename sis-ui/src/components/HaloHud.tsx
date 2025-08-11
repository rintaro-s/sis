import { useEffect, useRef, useState } from 'react'
import './HaloHud.css'

type Props = { visible: boolean }

// Halo HUD: キーホールド中だけ出現する円形ヘルプ/ショートカットHUD
export default function HaloHud({ visible }: Props) {
  const [hint, setHint] = useState('')
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
  const lastMouseRef = useRef<{ x: number; y: number }>({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const selectedRef = useRef<string | null>(null)
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

  // 表示開始/終了時のロジック: 表示時にマウス位置を固定し、非表示時に選択確定
  useEffect(() => {
    if (visible) {
      // 表示時: 現在のマウス位置をHUDの中心に
      const p = lastMouseRef.current
      setPos(p)
      setHint('')
      startRef.current = p
      selectedRef.current = null
      // マウスの動きを追跡
      const onMove = (e: MouseEvent) => {
        lastMouseRef.current = { x: e.clientX, y: e.clientY }
        const k = (e.target as HTMLElement)?.getAttribute('data-hint')
        setHint(k ?? '')
        if (startRef.current) {
          const dx = e.clientX - startRef.current.x
          const dy = e.clientY - startRef.current.y
          const dist = Math.hypot(dx, dy)
          const dead = 24
          if (dist > dead) {
            const angle = Math.atan2(dy, dx)
            const sector = Math.round(((angle + Math.PI) / (2 * Math.PI)) * 6) % 6
            const map = ['launcher', 'files', 'music', 'volume', 'screen', 'control']
            selectedRef.current = map[sector]
          } else {
            selectedRef.current = null
          }
        }
      }
      window.addEventListener('mousemove', onMove)
      return () => {
        window.removeEventListener('mousemove', onMove)
        // 表示終了時: 選択を確定
        if (selectedRef.current) console.log('Halo select:', selectedRef.current)
        startRef.current = null
        selectedRef.current = null
      }
    }
  }, [visible])

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
