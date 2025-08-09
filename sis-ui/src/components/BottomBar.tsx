
import { useState } from 'react';
import './BottomBar.css';

function BottomBar() {
  const [input, setInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      console.log('Command:', input);
      // Here would be API call to process command
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
          placeholder="コマンドを入力してください... (例: help, status, scan)"
        />
        <span className="cursor-blink"></span>
      </form>
      
      <div className="action-buttons">
        <div className="status-indicator">
          <div className="status-dot"></div>
          <span className="status-text">ONLINE</span>
        </div>
        
        <button 
          type="submit" 
          className="send-button"
          onClick={handleSubmit}
          disabled={!input.trim()}
        >
          ▶
        </button>
      </div>
    </div>
  );
}

export default BottomBar;
