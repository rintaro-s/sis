import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import TopBar from './components/TopBar';
import BottomBar from './components/BottomBar';
import HomeScreen from './components/HomeScreen';
import Sidebar from './components/Sidebar';
import CommandPalette from './components/CommandPalette';
import './App.css';
import { api } from './services/api';
import Settings from './components/Settings';
import MiniControlCenter from './components/MiniControlCenter';

function App() {
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true); // サイドバーの状態
  const [ccOpen, setCcOpen] = useState(false);

  useEffect(() => {
    const unlisten = listen('super_key_pressed', async () => {
      setIsMenuVisible(p => !p);
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.code === 'Space') {
        e.preventDefault();
        setIsMenuVisible((p) => !p);
      }
      if (e.ctrlKey && e.shiftKey && (e.key.toLowerCase() === 'c')) {
        e.preventDefault();
        setCcOpen(p => !p);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setIsMenuVisible(p => !p);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
      }
      if (e.code === 'Escape') {
        setIsMenuVisible(false);
        setSettingsOpen(false);
        setCcOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    const openSettings = () => setSettingsOpen(true);
    window.addEventListener('sis:open-settings', openSettings as any);

    return () => {
      unlisten.then((f: () => void) => f());
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('sis:open-settings', openSettings as any);
    };
  }, []);

  useEffect(() => {
    // 初期テーマを適用（設定 or localStorage）
    (async () => {
      try {
        const saved = await api.getSettings().catch(()=>({theme:'system'} as any));
        const pref = (saved as any)?.theme || localStorage.getItem('sis-theme') || 'dark';
        const apply = pref === 'system' ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : pref;
        document.documentElement.className = apply === 'light' ? 'light-theme' : 'dark-theme';
        const wp = (saved as any)?.wallpaper;
        if (wp && typeof wp === 'string' && wp.trim()) {
          try {
            const cssVal = await api.cssUrlForPath(wp.trim())
            document.documentElement.style.setProperty('--desktop-wallpaper', cssVal)
          } catch {
            const v = wp.trim()
            const cssVal = /^url\(/i.test(v) ? v : `url('${v}')`
            document.documentElement.style.setProperty('--desktop-wallpaper', cssVal)
          }
        } else {
          document.documentElement.style.removeProperty('--desktop-wallpaper')
        }
      } catch {}
    })();

    let mounted = true;
    const probe = async () => {
      try {
        const info = await api.getSystemInfo();
        if (!mounted) return;
        if (!info || typeof info.cpuUsage !== 'number') {
          setBackendError('バックエンドから不正な応答');
        } else {
          setBackendError(null);
        }
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (!mounted) return;
        if (msg === 'invoke-unavailable') {
          setBackendError('バックエンドに未接続（Tauriが無効）');
        } else {
          setBackendError(`バックエンドエラー: ${msg}`);
        }
        setTimeout(() => { if (mounted) probe(); }, 1200);
      }
    };
    probe();
    return () => { mounted = false };
  }, []);

  return (
    <div className={`app-container ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {backendError && (
        <div className="error-banner">
          {backendError} — 設定やコマンドは無効です。アプリ一覧は取得できません。
        </div>
      )}
      <TopBar />
      <Sidebar isCollapsed={isSidebarCollapsed} onToggle={() => setIsSidebarCollapsed(p => !p)} />
      <main className="main-content">
        <HomeScreen />
      </main>
      <BottomBar />
  <MiniControlCenter open={ccOpen} onClose={()=>setCcOpen(false)} />
      
      <CommandPalette isVisible={isMenuVisible} onClose={() => setIsMenuVisible(false)} />

      {settingsOpen && (
        <div className="modal-overlay">
      <div className="modal-content">
            <button 
              className="modal-close-btn"
              onClick={()=>setSettingsOpen(false)}
            >
        ×
            </button>
            <Settings />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
