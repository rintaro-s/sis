import { useEffect, useMemo, useRef, useState } from 'react'
import './CommandPalette.css'
import { api } from '../services/api'

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [apps, setApps] = useState<{ name: string; exec?: string }[]>([])
  const [settings, setSettings] = useState<any | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
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
  api.getSettings().then(setSettings)
  }, [open])

  const items = useMemo(() => {
    const staticItems = [
      { id: 'launcher', label: 'アプリランチャーを開く (Alt+Space)' },
      { id: 'screenshot', label: 'スクリーンショットを撮る' },
      { id: 'music-play', label: '音楽 再生/一時停止' },
      { id: 'settings', label: '設定を開く' },
      { id: 'logs-backend', label: 'バックログ（設定→ログ）' },
    ]
    const appItems = apps
      .filter((a) => a.exec && a.exec.trim() !== '')
      .map((a) => ({ id: `app:${a.name}`, label: `起動: ${a.name}` }))

    // width-insensitive normalization and kana->romaji support
    const norm = (s: string) => normalizeForSearch(s)
    const nq = norm(q)

    // Add simple synonyms for common static targets (e.g., 設定)
    const withKeys = [...staticItems, ...appItems].map((it) => {
      const base = norm(it.label)
      const extra = /設定/.test(it.label) ? ' settei settings' : ''
      return { ...it, _key: (base + extra).trim() }
    })

    return withKeys.filter((it) => it._key.includes(nq))
  }, [q, apps])

  const run = async (id: string) => {
    if (id === 'screenshot') await api.takeScreenshot()
    if (id === 'music-play') await api.playPauseMusic()
  if (id === 'settings') { window.dispatchEvent(new Event('sis:open-settings')); setOpen(false); return }
  if (id === 'logs-backend') { alert('設定→ログから表示できます'); return }
    if (id.startsWith('app:')) {
      const name = id.slice(4)
      const app = apps.find((a) => a.name === name)
      if (app?.exec) {
        await api.launchApp(app.exec)
      }
    }
    setOpen(false)
  }

  function extractBash(text: string): string | null {
    const fence = /```[a-zA-Z]*\n([\s\S]*?)```/;
    const single = /'''\n([\s\S]*?)'''/;
    const m = fence.exec(text) || single.exec(text);
    if (!m) return null;
    const body = m[1].trim();
    const lines = body.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'));
    return lines.join('; ');
  }

  const onEnter = async () => {
    const text = q.trim();
    if (!text) return;
    // @prefix → AI
    if (text.startsWith('@')) {
      const guide = "次の指示をbashコマンドに変換して、必ず```bash\n#!/usr/bin/env bash\n...\n``` もしくは ''' で囲んで返してください。説明は不要。";
      const prompt = `${guide}\n\n${text.slice(1)}`
      let out = ''
      if (settings?.llm_mode === 'lmstudio') {
        const url = settings?.llm_remote_url || 'http://localhost:1234/v1/chat/completions'
        if (settings?.llm_autostart_localhost && /localhost|127\.0\.0\.1/.test(url)) {
          await api.tryStartLmStudio()
        }
        const res = await api.llmQueryRemote(url, prompt, settings?.llm_api_key || undefined, settings?.llm_model || undefined)
        out = res.text || res.message || ''
      } else {
        const res = await api.llmQuery(prompt)
        out = res.text || res.message || ''
      }
      const cmd = extractBash(out);
      if (cmd) {
        if (/\bsudo\b/.test(cmd)) {
          alert('sudoコマンドは下部バーから実行してください');
        } else {
          await api.runSafeCommand(cmd);
        }
      }
      setOpen(false);
      return;
    }
    // 通常は最初の候補を実行
    const first = items[0];
    if (first) await run(first.id);
  }

  if (!open) return null

  return (
    <div className="palette-root" onClick={() => setOpen(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="探す/指示する（Ctrl+Pで開閉）"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e)=>{ if (e.key==='Enter') onEnter() }}
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

// simple width-insensitive normalize + kana->romaji
function normalizeForSearch(input: string): string {
  const s = (input || '').normalize('NFKC').toLowerCase()
  // Hiragana to romaji (very small mapping sufficient for typical queries)
  const map: Record<string, string> = {
    'あ':'a','い':'i','う':'u','え':'e','お':'o',
    'か':'ka','き':'ki','く':'ku','け':'ke','こ':'ko',
    'さ':'sa','し':'shi','す':'su','せ':'se','そ':'so',
    'た':'ta','ち':'chi','つ':'tsu','て':'te','と':'to',
    'な':'na','に':'ni','ぬ':'nu','ね':'ne','の':'no',
    'は':'ha','ひ':'hi','ふ':'fu','へ':'he','ほ':'ho',
    'ま':'ma','み':'mi','む':'mu','め':'me','も':'mo',
    'や':'ya','ゆ':'yu','よ':'yo',
    'ら':'ra','り':'ri','る':'ru','れ':'re','ろ':'ro',
    'わ':'wa','ゐ':'wi','ゑ':'we','を':'wo','ん':'n',
    'が':'ga','ぎ':'gi','ぐ':'gu','げ':'ge','ご':'go',
    'ざ':'za','じ':'ji','ず':'zu','ぜ':'ze','ぞ':'zo',
    'だ':'da','ぢ':'ji','づ':'du','で':'de','ど':'do',
    'ば':'ba','び':'bi','ぶ':'bu','べ':'be','ぼ':'bo',
    'ぱ':'pa','ぴ':'pi','ぷ':'pu','ぺ':'pe','ぽ':'po',
    'ぁ':'a','ぃ':'i','ぅ':'u','ぇ':'e','ぉ':'o',
    'ゃ':'ya','ゅ':'yu','ょ':'yo','っ':'',
  }
  let out = ''
  for (const ch of s) {
    out += map[ch] ?? ch
  }
  return out
}
