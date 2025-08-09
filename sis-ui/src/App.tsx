
import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import TopBar from './components/TopBar';
import BottomBar from './components/BottomBar';
import HomeScreen from './components/HomeScreen';
import CircularMenu from './components/CircularMenu';
import './App.css';

function App() {
  const [isMenuVisible, setIsMenuVisible] = useState(false);

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

  return (
    <div className="app">
      <TopBar />
      <HomeScreen />
      <BottomBar />
      <CircularMenu 
        isVisible={isMenuVisible} 
        onClose={handleMenuClose}
      />
    </div>
  );
}

export default App;
