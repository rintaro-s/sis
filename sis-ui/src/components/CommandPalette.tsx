import { useEffect, useMemo, useRef, useState } from 'react'
import './CommandPalette.css'
import { api } from '../services/api'

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [apps, setApps] = useState<{ name: string }[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
        setTimeout(() => inputRef.current?.focus(), 0)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    api.getRecentApps().then(setApps).catch(() => setApps([]))
  }, [open])

  const items = useMemo(() => {
    const staticItems = [
      { id: 'launcher', label: 'アプリランチャーを開く (Alt+Space)' },
      { id: 'screenshot', label: 'スクリーンショットを撮る' },
      { id: 'music-play', label: '音楽 再生/一時停止' },
      { id: 'overlay-toggle', label: 'Raylibオーバーレイ 切替' },
      { id: 'settings', label: '設定を開く' },
    ]
    const appItems = apps.map((a) => ({ id: `app:${a.name}`, label: `起動: ${a.name}` }))
    return [...staticItems, ...appItems].filter((it) => it.label.toLowerCase().includes(q.toLowerCase()))
  }, [q, apps])

  const run = async (id: string) => {
    if (id === 'screenshot') await api.takeScreenshot()
    if (id === 'music-play') await api.playPauseMusic()
    if (id === 'overlay-toggle') {
      const running = await api.overlayStatus()
      if (running) await api.overlayStop()
      else await api.overlayStart()
    }
    if (id.startsWith('app:')) {
      console.log('launch app', id.slice(4))
    }
    setOpen(false)
  }

  if (!open) return null

  return (
    <div className="palette-root" onClick={() => setOpen(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="探す/指示する（Ctrl+Kで開閉）"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ul className="palette-list">
          {items.map((it) => (
            <li key={it.id} className="palette-item" onClick={() => run(it.id)}>
              {it.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
