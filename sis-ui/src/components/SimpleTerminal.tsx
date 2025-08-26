import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import './SimpleTerminal.css'
import { api } from '../services/api'

type SimpleTerminalProps = {
  open: boolean
  initialCmd?: string
  initialAutoRun?: boolean
  onClose: () => void
}

export default function SimpleTerminal({ open, initialCmd, initialAutoRun, onClose }: SimpleTerminalProps) {
  const [cmd, setCmd] = useState(initialCmd || '')
  const [out, setOut] = useState('')
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  useEffect(() => {
    if (typeof initialCmd === 'string') setCmd(initialCmd)
  }, [initialCmd])

  const helpers = useMemo(() => [
    'pwd', 'ls -la', 'df -h', 'free -h', 'whoami', 'uname -a',
  ], [])

  const run = useCallback(async () => {
    const text = (cmd || '').trim()
    if (!text) return
    if (/\bsudo\b/.test(text)) { alert('sudoは内蔵ターミナルでは実行できません'); return }
    setRunning(true)
    setOut('実行中…\n')
    const t0 = performance.now()
    try {
      const r = await api.runSafeCommand(`bash -lc '${text.replace(/'/g, "'\\''")}' 2>&1`)
      const dt = ((performance.now() - t0) / 1000).toFixed(2)
      setOut((r.text || '') + `\n\n[完了 ${dt}s]`)
      setHistory(h => [text, ...h].slice(0, 20))
    } catch (e: any) {
      setOut('実行に失敗しました: ' + (e?.message || 'unknown'))
    } finally {
      setRunning(false)
    }
  }, [cmd])

  const openExternal = async () => {
    const text = (cmd || '').trim()
    if (!text) return
    await openTerminalAndRun(text)
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault(); run()
    }
    if (e.key === 'Escape') onClose()
  }

  // auto-run when the terminal is opened with initialAutoRun flag
  useEffect(() => {
    if (open && initialAutoRun && initialCmd) {
      // ensure cmd state is set before running
      setCmd(initialCmd)
      setTimeout(() => {
        run()
      }, 80)
    }
  }, [open, initialAutoRun, initialCmd, run])

  if (!open) return null
  return (
    <div className="term-overlay" onClick={onClose}>
      <div className="term" onClick={(e)=>e.stopPropagation()}>
        <div className="term-header">
          <div className="term-title">内蔵ターミナル</div>
          <button className="term-close" onClick={onClose}>×</button>
        </div>
        <div className="term-input-row">
          <input ref={inputRef} className="term-input" placeholder="ここにコマンドを入力 (Enterで実行)" value={cmd} onChange={e=>setCmd(e.target.value)} onKeyDown={onKey} />
          <button className="term-run" onClick={run} disabled={running}>実行</button>
          <button className="term-ext" onClick={openExternal}>端末で</button>
        </div>
        <div className="term-helpers">
          {helpers.map((h) => (
            <button key={h} className="term-help" onClick={()=>setCmd(h)}>{h}</button>
          ))}
          {history.length>0 && <span className="term-sep"/>}
          {history.slice(0,6).map((h, i) => (
            <button key={i} className="term-hist" onClick={()=>setCmd(h)} title={h}>{h}</button>
          ))}
        </div>
        <pre className="term-out" aria-live="polite">{out}</pre>
      </div>
    </div>
  )
}

async function openTerminalAndRun(cmd: string) {
  const esc = cmd.replace(/'/g, "'\\''")
  const preferred = [
    "gnome-terminal -- bash -lc '$CMD; echo; read -n1 -r -p \"(Press any key to close)\"'",
    "x-terminal-emulator -e bash -lc '$CMD; echo; read -n1 -r -p \"(Press any key to close)\"'",
    "konsole -e bash -lc '$CMD; echo; read -n1 -r -p \"(Press any key to close)\"'",
    "xterm -e bash -lc '$CMD; echo; read -n1 -r -p \"(Press any key to close)\"'",
    "alacritty -e bash -lc '$CMD; echo; read -n1 -r -p \"(Press any key to close)\"'",
    "tilix -e bash -lc '$CMD; echo; read -n1 -r -p \"(Press any key to close)\"'",
  ]
  for (const tmpl of preferred) {
    const candidate = tmpl.replace('$CMD', esc)
    try {
      await api.runSafeCommand(`sh -lc "${candidate} >/dev/null 2>&1 & disown"`)
      return
    } catch {}
  }
  try {
    await api.runSafeCommand(`bash -lc '${esc}'`)
    alert('バックエンドで実行しました（出力はバックエンドログへ）')
  } catch { alert('実行に失敗しました') }
}
