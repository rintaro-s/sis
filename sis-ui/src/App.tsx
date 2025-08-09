
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
  const [hudHeld, setHudHeld] = useState(false);

  useEffect(() => {
    const unlisten = listen('super_key_pressed', async () => {
      setIsMenuVisible(prev => !prev);
    });

    // フォールバック: Alt+Space で開閉（ブラウザ/開発時）
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.code === 'Space') {
        e.preventDefault();
        setIsMenuVisible((p) => !p);
      }
      // Escで閉じる
      if (e.code === 'Escape') {
        setIsMenuVisible(false);
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

  // 長押し（Space + Super など）の簡易実装: Space押下中はHUD表示
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.code === 'Space' && (e.ctrlKey || e.metaKey || e.altKey)) || e.code === 'CapsLock') {
        setHudHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'CapsLock') {
        setHudHeld(false);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  return (
    <div className="app">
      <TopBar />
      <HomeScreen />
      <BottomBar />
  <HaloHud visible={hudHeld} />
  <CommandPalette />
      <CircularMenu 
        isVisible={isMenuVisible} 
        onClose={handleMenuClose}
      />
    </div>
  );
}

export default App;
