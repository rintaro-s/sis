
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
import MiniControlCenter from './components/MiniControlCenter.tsx';

function App() {
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [hudOpen, setHudOpen] = useState(false);
  const [ccOpen, setCcOpen] = useState(false);
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
      // Ctrl+Alt+Z または Meta(Super)+Z で Halo HUD トグル
      const isCtrlAltZ = e.ctrlKey && e.altKey && e.key.toLowerCase() === 'z'
      const isMetaZ = (e.metaKey || (e as any).superKey) && e.key.toLowerCase() === 'z'
      if (isCtrlAltZ || isMetaZ) {
        e.preventDefault();
        setHudOpen((v) => !v)
      }
      // Ctrl+Shift+C でコントロールセンター
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        setCcOpen((v)=>!v)
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
  <HaloHud visible={hudOpen} onAction={(id)=>{
    // map actions
    if (id==='launcher') setIsMenuVisible(true)
    if (id==='files') api.organizeLatestDownload()
    if (id==='music') api.playPauseMusic()
    if (id==='volume') setCcOpen(true)
    if (id==='screen') api.takeScreenshot()
    if (id==='control') setCcOpen(true)
  }} onClose={()=>setHudOpen(false)} />
  <MiniControlCenter open={ccOpen} onClose={()=>setCcOpen(false)} />
  <CommandPalette />
      <CircularMenu 
        isVisible={isMenuVisible} 
        onClose={handleMenuClose}
      />
    </div>
  );
}

export default App;
