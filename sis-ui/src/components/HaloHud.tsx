import { useEffect, useRef, useState } from 'react'
import './HaloHud.css'

type Props = { visible: boolean; onAction?: (id: string) => void; onClose?: () => void }

// Halo HUD: キーホールド中だけ出現する円形ヘルプ/ショートカットHUD
export default function HaloHud({ visible, onAction, onClose }: Props) {
  const [hint, setHint] = useState('')
  const posRef = useRef<{ x: number; y: number }>({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
  const lastMouseRef = useRef<{ x: number; y: number }>({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const selectedRef = useRef<string | null>(null)
  const rafRef = useRef<number | null>(null)
  const ringRef = useRef<HTMLDivElement | null>(null)

  // Light-weight glow loop; paused when prefers-reduced-motion or not visible
  useEffect(() => {
    if (!visible) return
    const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) return

    let last = 0
    const tick = (now: number) => {
      // cap to ~30fps to reduce GPU load
      if (now - last > 33) {
        last = now
        const el = ringRef.current
        if (el) {
          const t = now * 0.001
          const glow = 0.4 + Math.sin(t * 2) * 0.2
          // update visual effects directly; avoid layout thrash
          el.style.boxShadow = `0 0 ${24 + glow * 12}px rgba(168, 195, 255, ${0.28 + glow * 0.22})`
          // update position via transform to avoid layout reflow
          const p = posRef.current
          // offset by half size (130) to center
          el.style.transform = `translate3d(${p.x - 130}px, ${p.y - 130}px, 0)`
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [visible])

  // 表示開始/終了時のロジック: 表示時にマウス位置を固定し、非表示時に選択確定
  useEffect(() => {
    if (visible) {
      // 表示時: 現在のマウス位置をHUDの中心に
      const p = lastMouseRef.current
      posRef.current = p
      // set initial transform immediately
      if (ringRef.current) ringRef.current.style.transform = `translate3d(${p.x - 130}px, ${p.y - 130}px, 0)`
      setHint('')
      startRef.current = p
      selectedRef.current = null
      // マウスの動きを追跡。setStateは最小限にしてヒント更新は throttled
      let queued = false
      let lastHint = ''
      const onMove = (e: MouseEvent) => {
        lastMouseRef.current = { x: e.clientX, y: e.clientY }
        if (!queued) {
          queued = true
          requestAnimationFrame(() => {
            queued = false
            const s = startRef.current
            if (s) {
              const dx = lastMouseRef.current.x - s.x
              const dy = lastMouseRef.current.y - s.y
              const dist = Math.hypot(dx, dy)
              const dead = 28
              if (dist > dead) {
                const angle = Math.atan2(dy, dx)
                const sector = Math.round(((angle + Math.PI) / (2 * Math.PI)) * 6) % 6
                const map = ['launcher', 'files', 'music', 'volume', 'screen', 'control']
                selectedRef.current = map[sector]
              } else {
                selectedRef.current = null
              }
            }
            // update position ref for RAF updater
            posRef.current = { x: lastMouseRef.current.x, y: lastMouseRef.current.y }
            // hint detection (throttled by comparing lastHint)
            const k = (e.target as HTMLElement)?.getAttribute('data-hint') || ''
            if (k !== lastHint) {
              lastHint = k
              setHint(k)
            }
          })
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

  const idByIndex = ['launcher','files','music','volume','screen','control']
  const handlePick = (i: number) => {
    const id = idByIndex[i]
    if (onAction) onAction(id)
    if (onClose) onClose()
  }
  const handleCancel = () => { if (onClose) onClose() }
  // wheel to rotate selection
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const idx = selectedRef.current ? idByIndex.indexOf(selectedRef.current) : 0
    const dir = e.deltaY > 0 ? 1 : -1
    const next = (idx + dir + idByIndex.length) % idByIndex.length
    selectedRef.current = idByIndex[next]
    setHint(actions[next].label)
  }

  return (
  <div className="halo-root" onContextMenu={(e)=>e.preventDefault()} onClick={handleCancel} onWheel={onWheel}>
      <div className="halo-overlay" />
      <div className="halo-ring" ref={ringRef}>
        <div className="halo-center" data-hint="左クリックでキャンセル" />
        {actions.map((a, i) => (
          <div
            className={`halo-slot halo-slot-${i}`}
            key={a.key}
            data-hint={`${a.label} — ${a.hint}`}
            aria-label={a.label}
            role="button"
            onContextMenu={(e)=>{ e.preventDefault(); handlePick(i) }}
          >
            <span className="halo-key">{a.key}</span>
            <span className="halo-label">{a.label}</span>
          </div>
        ))}
      </div>
      <div className="halo-hint">{hint || 'カーソルで選んで 右クリックで実行 / 左クリックでキャンセル'}</div>
    </div>
  )
}
