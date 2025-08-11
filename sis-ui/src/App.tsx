
import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import TopBar from './components/TopBar';
import BottomBar from './components/BottomBar';
import HomeScreen from './components/HomeScreen';
import CircularMenu from './components/CircularMenu';
import HaloHud from './components/HaloHud';
import CommandPalette from './components/CommandPalette';
import './App.css';

function App() {
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [hudOpen, setHudOpen] = useState(false);

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

  const handleMenuClose = () => {
    setIsMenuVisible(false);
  };


  return (
    <div className="app">
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
