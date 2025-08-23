
import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import TopBar from './components/TopBar';
import BottomBar from './components/BottomBar';
import HomeScreen from './components/HomeScreen';
import CircularMenu from './components/CircularMenu';
import CommandPalette from './components/CommandPalette';
import './App.css';
import { api } from './services/api';
import MiniControlCenter from './components/MiniControlCenter.tsx';
import Settings from './components/Settings';

function App() {
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  // Halo HUD removed per user request
  const [ccOpen, setCcOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);

  useEffect(() => {
    const unlisten = listen('super_key_pressed', async () => {
      setIsMenuVisible(prev => !prev);
    });

    // Alt+Space でランチャー（フォールバック）
  const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.code === 'Space') {
        e.preventDefault();
        setIsMenuVisible((p) => !p);
      }
  // Halo HUD hotkey removed
      // Ctrl+Shift+C でコントロールセンター
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        setCcOpen((v)=>!v)
      }
      // Ctrl+, で設定を開く
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true)
      }
      // Esc でHUD/メニューを閉じる
      // Escで閉じる
      if (e.code === 'Escape') {
        setIsMenuVisible(false);
  //
        setSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    const openSettings = () => setSettingsOpen(true)
    window.addEventListener('sis:open-settings', openSettings as any)

    return () => {
      unlisten.then((f: () => void) => f());
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('sis:open-settings', openSettings as any)
    };
  }, []);

  // Backend health check: ensure invoke available and handler responds
  useEffect(() => {
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
        // retry once after short delay in case __TAURI__ becomes available late
        setTimeout(() => { if (mounted) probe(); }, 1200);
      }
    };
    probe();
    return () => { mounted = false };
  }, []);

  const handleMenuClose = () => {
    setIsMenuVisible(false);
  };


  return (
    <div className="app">
      {backendError && (
        <div className="error-banner">
          {backendError} — 設定やコマンドは無効です。アプリ一覧は取得できません。
        </div>
      )}
  <TopBar onToggleControlCenter={() => setCcOpen((v)=>!v)} />
      <HomeScreen />
  <BottomBar />
  {/* Halo HUD removed */}
  <MiniControlCenter open={ccOpen} onClose={()=>setCcOpen(false)} />
  <CommandPalette />
      <CircularMenu 
        isVisible={isMenuVisible} 
        onClose={handleMenuClose}
      />
      {settingsOpen && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex: 1000 }}>
          <div style={{ position:'absolute', top:'8%', left:'50%', transform:'translateX(-50%)', width:'min(980px, 92vw)', maxHeight:'84vh', overflow:'auto', background:'rgba(12,18,28,0.9)', border:'1px solid #2b3c51', borderRadius:12, boxShadow:'0 12px 50px rgba(0,0,0,0.45)', padding:16 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
              <h3 style={{ margin:0 }}>設定</h3>
            </div>
            <Settings onClose={()=>setSettingsOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
