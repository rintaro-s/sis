
import { useEffect, useState } from 'react';
import { api } from '../services/api';
import './BottomBar.css';

function BottomBar() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [sudoPrompt, setSudoPrompt] = useState<{cmd: string} | null>(null);
  const [sudoPassword, setSudoPassword] = useState('');
  const [settings, setSettings] = useState<any | null>(null)
  // logs moved to Settings

  useEffect(() => { api.getSettings().then(setSettings) }, [])

  function extractBashCommandBlocks(text: string): { cmd: string; needsSudo: boolean }[] {
    const blocks: { cmd: string; needsSudo: boolean }[] = []
    const fenceRe = /```[a-zA-Z]*\n([\s\S]*?)```/g
    const singleFenceRe = /'''\n([\s\S]*?)'''/g
    let m: RegExpExecArray | null
    while ((m = fenceRe.exec(text)) !== null) {
      const body = m[1].trim()
      const isShebang = body.startsWith('#!/usr/bin/env bash') || body.startsWith('#!/bin/bash')
      const needsSudo = /^\s*sudo\s+/m.test(body)
      if (isShebang || /```(bash|sh|zsh)/.test(m[0])) {
        // take non-empty lines excluding comments; join with '; '
        const lines = body.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'))
        const cmd = lines.join('; ')
        if (cmd) blocks.push({ cmd, needsSudo })
      }
    }
    while ((m = singleFenceRe.exec(text)) !== null) {
      const body = m[1].trim()
      const isShebang = body.startsWith('#!/usr/bin/env bash') || body.startsWith('#!/bin/bash')
      const needsSudo = /^\s*sudo\s+/m.test(body)
      if (isShebang || true) {
        const lines = body.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'))
        const cmd = lines.join('; ')
        if (cmd) blocks.push({ cmd, needsSudo })
      }
    }
    // Fallback: detect shebang block without fences
    const she = /(^|\n)#!\/(usr\/bin\/env bash|bin\/bash)[\s\S]*/m.exec(text)
    if (she) {
      const body = text.slice(she.index).trim()
      const lines = body.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'))
      const cmd = lines.join('; ')
      if (cmd) blocks.push({ cmd, needsSudo: /^\s*sudo\s+/m.test(body) })
    }
    return blocks
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!q || busy) return;
    setBusy(true);
    setOutput('');
    try {
      if (q.startsWith('!')) {
        const cmd = q.slice(1).trim();
  if (cmd.startsWith('sudo ')) {
          // show password prompt
          setSudoPrompt({ cmd });
        } else {
          const res = await api.runSafeCommand(cmd);
          setOutput(res.text || res.message || '');
        }
      } else {
        const guide = "次の指示をbashコマンドに変換して、必ず```bash\n#!/usr/bin/env bash\n...\n``` もしくは ''' で囲まれたブロックで返してください。説明文は不要。";
        let text = ''
        const prompt = `${guide}\n\n${q}`
        if (settings?.llm_mode === 'lmstudio') {
          const url = settings?.llm_remote_url || 'http://localhost:1234/v1/chat/completions'
          if (settings?.llm_autostart_localhost && /localhost|127\.0\.0\.1/.test(url)) {
            await api.tryStartLmStudio()
          }
          const res = await api.llmQueryRemote(url, prompt, settings?.llm_api_key || undefined, settings?.llm_model || undefined)
          text = res.text || res.message || ''
        } else {
          const res = await api.llmQuery(prompt)
          text = res.text || res.message || ''
        }
        setOutput(text);
        // Try to auto-extract bash commands and run them
        const blocks = extractBashCommandBlocks(text)
        if (blocks.length) {
          const first = blocks[0]
          if (first.needsSudo) {
            setSudoPrompt({ cmd: first.cmd })
          } else {
            const run = await api.runSafeCommand(first.cmd)
            setOutput((prev) => prev + '\n\n$ ' + first.cmd + '\n' + (run.text || run.message || ''))
          }
        }
      }
    } catch (err) {
      setOutput((err as Error).message);
    } finally {
      setBusy(false);
      // do not clear input if waiting for sudo password
      if (!sudoPrompt) setInput('');
    }
  };

  const submitSudo = async () => {
    if (!sudoPrompt) return;
    setBusy(true);
    try {
      const res = await api.runWithSudo(sudoPrompt.cmd, sudoPassword);
      setOutput(res.text || res.message || '');
    } catch (e) {
      setOutput((e as Error).message);
    } finally {
      setBusy(false);
      setSudoPrompt(null);
      setSudoPassword('');
      setInput('');
    }
  };

  return (
    <div className="bottom-bar">
      <form onSubmit={handleSubmit} className="command-prompt">
        <span className="prompt-prefix">SIS$</span>
        <input
          type="text"
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Alt+Space ランチャー / Ctrl+Alt+Z HUD / Ctrl+P パレット（先頭@でAI）"
        />
        <span className="cursor-blink"></span>
      </form>
      
      <div className="action-buttons">
        <div className="status-indicator">
          <div className="status-dot"></div>
          <span className="status-text">{busy ? 'BUSY' : 'ONLINE'}</span>
        </div>
  {/* logs moved to Settings */}
        <button type="button" title="Push-To-Talk (長押しで録音)" className="send-button" onMouseDown={() => console.log('PTT start')} onMouseUp={() => console.log('PTT stop')}>
          🎤
        </button>
        
        <button 
          type="submit" 
          className="send-button"
          onClick={handleSubmit}
          disabled={!input.trim() || busy}
        >
          ▶
        </button>
      </div>
      {output && (
        <div style={{ position: 'absolute', left: 16, right: 16, bottom: 56, color: '#cfe6ff', fontSize: 12, opacity: 0.9 }}>
          <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{output}</pre>
        </div>
      )}
      {sudoPrompt && (
        <div style={{ position: 'absolute', left: 16, right: 16, bottom: 110, color: '#ffd9d9', fontSize: 13 }}>
          <div>sudo コマンドを実行するにはパスワードを入力してください:</div>
          <input type="password" value={sudoPassword} onChange={(e) => setSudoPassword(e.target.value)} style={{ width: '60%', marginRight: 8 }} />
          <button onClick={submitSudo} disabled={busy || !sudoPassword}>送信</button>
          <button onClick={() => { setSudoPrompt(null); setSudoPassword(''); }}>キャンセル</button>
        </div>
      )}
  {/* logs overlay removed from footer */}
    </div>
  );
}

export default BottomBar;
