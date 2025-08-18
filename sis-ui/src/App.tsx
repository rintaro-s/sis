
import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import TopBar from './components/TopBar';
import BottomBar from './components/BottomBar';
import HomeScreen from './components/HomeScreen';
import CircularMenu from './components/CircularMenu';
import HaloHud from './components/HaloHud';
import CommandPalette from './components/CommandPalette';
import './App.css';
import { api } from './services/api';

function App() {
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [hudOpen, setHudOpen] = useState(false);
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
      // Ctrl+K で Halo HUD トグル
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setHudOpen((v) => !v);
      }
      // Esc でHUD/メニューを閉じる
      // Escで閉じる
      if (e.code === 'Escape') {
        setIsMenuVisible(false);
        setHudOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      unlisten.then((f: () => void) => f());
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Backend health check: ensure invoke available and handler responds
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const info = await api.getSystemInfo();
        if (!mounted) return;
        if (!info || typeof info.cpuUsage !== 'number') {
          setBackendError('バックエンドから不正な応答');
        }
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (msg === 'invoke-unavailable') {
          setBackendError('バックエンドに未接続（Tauriが無効）');
        } else {
          setBackendError(`バックエンドエラー: ${msg}`);
        }
      }
    })();
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
      <TopBar />
      <HomeScreen />
  <BottomBar />
  <HaloHud visible={hudOpen} />
  <CommandPalette />
      <CircularMenu 
        isVisible={isMenuVisible} 
        onClose={handleMenuClose}
      />
    </div>
  );
}

export default App;
