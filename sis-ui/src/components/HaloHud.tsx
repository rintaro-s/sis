import { useEffect, useRef, useState } from 'react'
import './HaloHud.css'

type Props = { visible: boolean }

// Halo HUD: キーホールド中だけ出現する円形ヘルプ/ショートカットHUD
export default function HaloHud({ visible }: Props) {
  const [hint, setHint] = useState('')
  const [pos, setPos] = useState<{x:number;y:number}>({ x: window.innerWidth/2, y: window.innerHeight/2 })
  const startRef = useRef<{x:number;y:number}|null>(null)
  const selectedRef = useRef<string| null>(null)
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
    const onDown = (e: MouseEvent) => {
      startRef.current = { x: e.clientX, y: e.clientY }
      selectedRef.current = null
    }
    const onMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      const k = target.getAttribute('data-hint')
      setHint(k ?? '')
      setPos({ x: e.clientX, y: e.clientY })
      // 方向ジェスチャー（デッドゾーン15px）
      if (startRef.current) {
        const dx = e.clientX - startRef.current.x
        const dy = e.clientY - startRef.current.y
        const dist = Math.hypot(dx, dy)
        const dead = 24 // ごタップ防止: ある程度傾けないと判定しない
        if (dist > dead) {
          const angle = Math.atan2(dy, dx) // -PI..PI, 右を0
          // 6方向に量子化（0,60,120,180,240,300 度相当）
          const sector = Math.round(((angle + Math.PI) / (2*Math.PI)) * 6) % 6
          const map = ['launcher','files','music','volume','screen','control']
          selectedRef.current = map[sector]
        } else {
          selectedRef.current = null
        }
      }
    }
    const onUp = () => {
      // 選択が確定していればアクション実行
      // 実際の処理はApp側/コマンドパレットやAPIと接続可能
      // ここではイベントをconsoleに出す
      if (selectedRef.current) {
        console.log('Halo select:', selectedRef.current)
      }
      startRef.current = null
      selectedRef.current = null
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
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
