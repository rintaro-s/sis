
import { useState } from 'react';
import { api } from '../services/api';
import './BottomBar.css';

function BottomBar() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [sudoPrompt, setSudoPrompt] = useState<{cmd: string} | null>(null);
  const [sudoPassword, setSudoPassword] = useState('');

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
        const res = await api.llmQuery(q);
        setOutput(res.text || res.message || '');
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
          placeholder="Alt+Space ランチャー / Ctrl+K Halo HUD / Ctrl+P コマンドパレット"
        />
        <span className="cursor-blink"></span>
      </form>
      
      <div className="action-buttons">
        <div className="status-indicator">
          <div className="status-dot"></div>
          <span className="status-text">{busy ? 'BUSY' : 'ONLINE'}</span>
        </div>
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
    </div>
  );
}

export default BottomBar;
