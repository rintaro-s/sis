import { useEffect, useMemo, useRef, useState } from 'react'
import './CommandPalette.css'
import { api } from '../services/api'

type CommandPaletteProps = {
  isVisible: boolean;
  onClose: () => void;
};

export default function CommandPalette({ isVisible, onClose }: CommandPaletteProps) {
  const [q, setQ] = useState('')
  const [apps, setApps] = useState<{ name: string; exec?: string }[]>([])
  const [settings, setSettings] = useState<any | null>(null)
  const [aiCmds, setAiCmds] = useState<string[]>([])
  const [aiText, setAiText] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [finished, setFinished] = useState<boolean>(false)
  const [aiBlocks, setAiBlocks] = useState<{ lang: string; raw: string; runnable?: string }[]>([])
  const [sseInfo, setSseInfo] = useState<{ mode: 'sse' | 'plain' | null; chunks: number }>({ mode: null, chunks: 0 })
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [lmUrl, setLmUrl] = useState('')
  const [lmModel, setLmModel] = useState('')
  const [lmKey, setLmKey] = useState('')
  const [lmAutostart, setLmAutostart] = useState(false)

  async function preloadLm() {
    try {
      const s = await api.getSettings().catch(()=>({})) as any
      setLmUrl(s?.llm_remote_url || 'http://localhost:1234/v1/chat/completions')
      setLmModel(s?.llm_model || '')
      setLmKey(s?.llm_api_key || '')
      setLmAutostart(!!s?.llm_autostart_localhost)
    } catch {
      setLmUrl('http://localhost:1234/v1/chat/completions')
      setLmModel('')
      setLmKey('')
      setLmAutostart(false)
    }
  }

  async function saveLmSettings() {
    try {
      const prev = await api.getSettings().catch(()=>({})) as any
      const next = { ...prev, llm_mode: 'lmstudio', llm_remote_url: lmUrl, llm_model: lmModel, llm_api_key: lmKey, llm_autostart_localhost: lmAutostart }
      await api.setSettings(next)
      try { await api.emitGlobalEvent('sis:settings-saved', next) } catch {}
      alert('LM Studio 設定を保存しました')
    } catch {
      alert('保存に失敗しました')
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!isVisible) return
    api.getRecentApps().then(setApps).catch(() => setApps([]))
  api.getSettings().then(setSettings)
  }, [isVisible])

  // When the palette is closed, clear any AI state so it doesn't persist forever
  useEffect(() => {
    if (!isVisible) {
      // abort any streaming
      if (abortRef.current) { try { abortRef.current.abort() } catch {} ; abortRef.current = null }
      setAiText('')
      setAiCmds([])
      setAiBlocks([])
      setSseInfo({ mode: null, chunks: 0 })
      setLoading(false)
      setFinished(false)
    }
  }, [isVisible])

  // ストリーミング中に閉じたら中断
  useEffect(() => {
    if (!isVisible && abortRef.current) {
      try { abortRef.current.abort() } catch {}
      abortRef.current = null
    }
    return () => {
      if (abortRef.current) {
        try { abortRef.current.abort() } catch {}
        abortRef.current = null
      }
    }
  }, [isVisible])

  const items = useMemo(() => {
    const staticItems = [
      { id: 'launcher', label: 'アプリランチャーを開く (Alt+Space)' },
      { id: 'screenshot', label: 'スクリーンショットを撮る' },
      { id: 'music-play', label: '音楽 再生/一時停止' },
      { id: 'logs-backend', label: 'バックログを表示' },
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

    let list = withKeys.filter((it) => it._key.includes(nq))
    // @でAIサジェストを表示
    if (q.trim().startsWith('@')) {
      list = [ 
        { id: 'ai-chat', label: 'AIとチャット…', _key: 'ai chat あい ちゃっと' },
        { id: 'lm-settings', label: 'LM Studio 設定を開く (@)', _key: 'lm studio settings せってい' },
        ...list 
      ]
    }
    return list
  }, [q, apps])

  const run = async (id: string) => {
  if (id === 'screenshot') await api.takeScreenshot()
  if (id === 'music-play') await api.playPauseMusic()
  if (id === 'logs-backend') { const text = await api.getBackendLog(200); alert(text || '(空)'); return }
  if (id === 'lm-settings') { setQ('@settings'); await preloadLm(); return }
    if (id.startsWith('bash:')) {
      const cmd = id.slice(5)
      if (cmd.includes('sudo ')) { alert('sudoコマンドは手動で実行してください'); return }
      const ok = confirm(`このコマンドを実行しますか？\n\n${cmd}`)
      if (ok) { await api.runSafeCommand(cmd) }
      onClose()
      return
    }
    if (id === 'ai-chat') {
      // 単にフォーカス維持
      return
    }
    if (id.startsWith('app:')) {
      const name = id.slice(4)
      const app = apps.find((a) => a.name === name)
      if (app?.exec) {
        await api.launchApp(app.exec)
      }
    }
    onClose()
  }

  function extractBashAll(text: string): string[] {
    const out: string[] = []
    const fences = Array.from(text.matchAll(/```(bash|sh)?\n([\s\S]*?)```/g))
    const triples = Array.from(text.matchAll(/'''\n([\s\S]*?)'''/g))
    const blocks = [
      ...fences.map(m => m[2] ?? ''),
      ...triples.map(m => m[1] ?? ''),
    ]
    for (const raw of blocks) {
      const body = (raw || '').trim()
      if (!body) continue
      // 先頭のshebangや説明コメントは除去
      const lines = body.split(/\r?\n/)
        .map(l => l.replace(/^#!.*$/, '').trimEnd())
        .filter(l => l.trim() && !l.trim().startsWith('#'))
      if (lines.length === 0) continue
      // 複数行は改行を維持（関数・条件分岐などの壊れを避ける）
      const merged = lines.join('\n')
      // 単なるechoだけの候補はノイズなので除外
      if (/^echo\b/i.test(merged) && merged.split(/[;\n]/).length <= 2) continue
      // sudoは安全のため弾く（実行時にも再チェック）
      if (/\bsudo\b/.test(merged)) continue
      out.push(merged)
    }
    return Array.from(new Set(out)).slice(0, 5)
  }

  function looksLikeShell(body: string): boolean {
    const s = (body || '').trim()
    if (!s) return false
    if (/^#!\//.test(s)) return true
    const hints = ['#!/usr/bin/env bash', 'set -e', 'set -o', 'for ', 'if ', 'then', 'fi', '||', '&&']
    return hints.some(h => s.includes(h))
  }

  function extractCodeBlocksDetailed(text: string): { lang: string; raw: string; runnable?: string }[] {
    const blocks: { lang: string; raw: string; runnable?: string }[] = []
    const reF = /```(\w+)?\n([\s\S]*?)```/g
    const reQ = /'''\n([\s\S]*?)'''/g
    for (const m of text.matchAll(reF)) {
      const lang = (m[1] || '').toLowerCase()
      const raw = m[2] || ''
      let runnable: string | undefined
      if (lang === 'bash' || lang === 'sh' || looksLikeShell(raw)) {
        const lines = raw.split(/\r?\n/)
          .map(l => l.replace(/^#!.*$/, '').replace(/^\$\s?/, '').trimEnd())
          .filter(l => l.trim() && !l.trim().startsWith('#'))
        if (lines.length) runnable = lines.join('\n')
      }
      blocks.push({ lang: lang || 'plain', raw, runnable })
    }
    for (const m of text.matchAll(reQ)) {
      const raw = m[1] || ''
      let runnable: string | undefined
      if (looksLikeShell(raw)) {
        const lines = raw.split(/\r?\n/)
          .map(l => l.replace(/^#!.*$/, '').replace(/^\$\s?/, '').trimEnd())
          .filter(l => l.trim() && !l.trim().startsWith('#'))
        if (lines.length) runnable = lines.join('\n')
      }
      blocks.push({ lang: 'plain', raw, runnable })
    }
    return blocks
  }

  async function streamLmStudioChat(url: string, model: string | undefined, apiKey: string | undefined, prompt: string): Promise<string> {
    // OpenAI互換SSE: POST /v1/chat/completions { model, messages, stream: true }
    const body = {
      model: model || 'lmstudio-community/Meta-Llama-3-8B-Instruct-GGUF',
      messages: [ { role: 'user', content: prompt } ],
      stream: true,
      temperature: 0.7,
    }
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
    const res = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers, signal: ctrl.signal })
    // 非SSE応答の場合はまとめて処理
    const ctype = res.headers.get('content-type') || ''
    if (!ctype.includes('stream') && !ctype.includes('event')) {
      setSseInfo({ mode: 'plain', chunks: 0 })
      const j = await res.json().catch(async () => ({ choices: [{ message: { content: await res.text() } }] }))
      const text = j?.choices?.[0]?.message?.content || j?.choices?.[0]?.text || ''
      setAiText(text)
      return text
    }
    setSseInfo({ mode: 'sse', chunks: 0 })
    const reader = res.body!.getReader()
    const td = new TextDecoder()
    let acc = ''
    let buf = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += td.decode(value, { stream: true })
      // SSE: lines separated by \n\n; parse lines starting with 'data:'
      const parts = buf.split(/\n\n/)
      buf = parts.pop() || ''
      for (const chunk of parts) {
        const line = chunk.split('\n').find(l => l.startsWith('data:')) || ''
        const data = line.replace(/^data:\s*/, '').trim()
        if (!data || data === '[DONE]') continue
        try {
          const j = JSON.parse(data)
          const delta: string = j?.choices?.[0]?.delta?.content || j?.choices?.[0]?.message?.content || j?.choices?.[0]?.text || ''
          if (delta) {
            acc += delta
            setAiText(acc)
            setSseInfo(prev => ({ mode: 'sse', chunks: (prev.chunks + 1) }))
          }
        } catch {
          // 有効でないJSONは無視
        }
      }
    }
    return acc
  }

  const onEnter = async () => {
    const text = q.trim();
    if (!text) return;
    // @prefix → AI
    if (text.startsWith('@')) {
      // 入力をクリアし、ローディング表示
      const userPrompt = text.slice(1)
      setLoading(true)
      setAiText('')
      setAiCmds([])
      setFinished(false)
      setQ('')

      // 改良システムプロンプト（日本語／雑談時はコマンド不要、作業時のみ安全なbashを提案）
      const guide = [
        'あなたはLinuxデスクトップのアシスタントです。回答は日本語で簡潔に。',
        '1) 依頼が雑談・挨拶・質問などで実行操作を伴わない場合、コマンドは出力しない（echo等で水増ししない）。',
        '2) 実作業が必要な場合のみ、安全なbash例を提案する。破壊的操作やsudoは含めない。',
        '3) コマンドは必ず ```bash\n#!/usr/bin/env bash\n...\n``` もしくは ```bash\n...\n``` のフェンスで示す。',
        '4) まず短い説明→続けてコードブロック。',
      ].join('\n')
      const prompt = `${guide}\n\nユーザーの依頼:\n${userPrompt}`
  let out = ''
      if (settings?.llm_mode === 'lmstudio') {
        const url = settings?.llm_remote_url || 'http://localhost:1234/v1/chat/completions'
        if (settings?.llm_autostart_localhost && /localhost|127\.0\.0\.1/.test(url)) {
          await api.tryStartLmStudio()
        }
        try {
          out = await streamLmStudioChat(url, settings?.llm_model, settings?.llm_api_key, prompt)
        } catch (e) {
          // フォールバック（非ストリーム）
          const res = await api.llmQueryRemote(url, prompt, settings?.llm_api_key || undefined, settings?.llm_model || undefined)
          out = res.text || res.message || ''
          setAiText(out)
        }
      } else {
        const res = await api.llmQuery(prompt)
        out = res.text || res.message || ''
      }
      // Compute blocks first, then commands and remove duplicates so the same command
      // doesn't appear both in the code-block panel and the command list.
      const blocks = extractCodeBlocksDetailed(out || '')
      const cmdsRaw = extractBashAll(out || '')
      const blockRunnables = new Set(blocks.filter(b => b.runnable).map(b => b.runnable!.trim()))
      const cmds = cmdsRaw.filter(c => !blockRunnables.has(c.trim()))
      setAiText(out || '')
      setAiBlocks(blocks)
      setAiCmds(cmds)
      setLoading(false)
      setFinished(true)
      return
    }
    // 通常は最初の候補を実行
  const first = items[0];
  if (first) await run(first.id);
  setQ('')
  }

  if (!isVisible) return null

  return (
    <div className="palette-root" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="探す/指示する（Ctrl+Pで開閉）"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e)=>{ if (e.key==='Enter') onEnter() }}
        />
        <div className="palette-body">
          {q.trim().startsWith('@') && q.trim() === '@settings' && (
            <div className="ai-block">
              <div className="ai-commands-title">LM Studio 設定</div>
              <div className="setting-group">
                <label className="setting-label">サーバーURL</label>
                <input className="game-input" type="text" value={lmUrl} onChange={(e)=>setLmUrl(e.target.value)} placeholder="http://localhost:1234/v1/chat/completions" />
              </div>
              <div className="setting-group">
                <label className="setting-label">モデル</label>
                <input className="game-input" type="text" value={lmModel} onChange={(e)=>setLmModel(e.target.value)} placeholder="lmstudio-community/Meta-Llama-3-8B-Instruct-GGUF" />
              </div>
              <div className="setting-group">
                <label className="setting-label">APIキー（任意）</label>
                <input className="game-input" type="password" value={lmKey} onChange={(e)=>setLmKey(e.target.value)} />
              </div>
              <div className="setting-group" style={{display:'flex',alignItems:'center',gap:8}}>
                <label className="setting-label">localhostなら自動起動</label>
                <button className={`game-btn ${lmAutostart?'primary':'secondary'}`} onClick={()=>setLmAutostart(v=>!v)}>{lmAutostart?'有効':'無効'}</button>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button className="game-btn primary" onClick={saveLmSettings}>保存</button>
                <button className="game-btn secondary" onClick={preloadLm}>再読込</button>
              </div>
            </div>
          )}
          {loading && (
            <div className="palette-loading">
              <div className="spinner" aria-label="Loading" />
              <span>AIに問い合わせ中…</span>
              {sseInfo.mode && (
                <span className="ai-stream-badge">{sseInfo.mode === 'sse' ? `SSE受信中: ${sseInfo.chunks}` : '非ストリーム応答'}</span>
              )}
            </div>
          )}
          {!!aiText && (
            <div className="ai-block">
              <div className="ai-text" aria-live="polite">{aiText}</div>
              {aiBlocks.length > 0 && (
                <div className="ai-codeblocks">
                        {aiBlocks.map((b, i) => (
                    <div key={i} className="codepanel">
                      <div className="codepanel-actions">
                        <span className="codepanel-lang">{b.lang === 'plain' ? 'code' : b.lang}</span>
                        {b.runnable && <button className="btn-run" onClick={() => openInBuiltinTerminal(b.runnable!, true)}>実行</button>}
                        {b.runnable && <button className="btn-ext" onClick={() => openTerminalAndRun(b.runnable!)}>端末</button>}
                        <button className="btn-copy" onClick={() => copyToClipboard(b.raw)}>コピー</button>
                      </div>
                      <pre className="codepanel-pre"><code>{b.raw}</code></pre>
                    </div>
                  ))}
                </div>
              )}
              {finished ? (
                <div className="ai-commands">
                  <div className="ai-commands-title">実行コマンド候補</div>
                  <div className="ai-commands-list">
                    {aiCmds.map((c, i) => (
                      <div key={i} className="cmd-row">
                        <button className="cmd-pill" onClick={() => openInBuiltinTerminal(c, true)} title={c}>実行</button>
                        <button className="copy-btn" onClick={() => openTerminalAndRun(c)} title="外部端末で実行">端末</button>
                        <button className="copy-btn" onClick={() => copyToClipboard(c)}>コピー</button>
                        <span className="cmd-text" title={c}>{c}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="ai-commands" aria-live="polite" style={{padding:'6px 12px', color:'#5a6da0', fontSize:12}}>コマンド候補を解析中…</div>
              )}
            </div>
          )}
          <ul className="palette-list">
          {items.map((it) => (
            <li key={it.id} className="palette-item" onClick={() => run(it.id)}>
              {it.label}
            </li>
          ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function copyToClipboard(text: string) {
  if (!text) return
  if (navigator?.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
  } else {
    fallbackCopy(text)
  }
}

function fallbackCopy(text: string) {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-1000px'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  } catch { /* ignore */ }
}

function openInBuiltinTerminal(cmd: string, autoRun: boolean = false) {
  const ev = new CustomEvent('sis:open-builtin-terminal', { detail: { cmd, autoRun } })
  window.dispatchEvent(ev)
}

async function openTerminalAndRun(cmd: string) {
  if (!cmd) return
  const esc = cmd.replace(/'/g, "'\\''")
  // Try to use Tauri to spawn a terminal; prefer gnome-terminal, x-terminal-emulator, konsole, xterm
  try {
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
        // ask backend to run the launcher command (detached)
        await api.runSafeCommand(`sh -lc "${candidate} >/dev/null 2>&1 & disown"`)
        return
      } catch {
        // try next
      }
    }
  } catch (e) {
    // continue to fallback
  }

  // 最終フォールバック: backend で実行してログを得る（ウィンドウ表示は不可）
  try {
    const r = await api.runSafeCommand(`bash -lc '${esc}'`)
    if (r.ok) {
      alert('コマンドはバックエンドで実行されました。出力はログで確認してください。')
    } else {
      alert('コマンドの実行に失敗しました: ' + (r.message || 'unknown'))
    }
  } catch (e) {
    alert('コマンド実行に失敗しました')
  }
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
