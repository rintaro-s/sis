
import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { cursorPosition } from '@tauri-apps/api/window';
import TopBar from './components/TopBar';
import BottomBar from './components/BottomBar';
import HomeScreen from './components/HomeScreen';
import CircularMenu from './components/CircularMenu';
import './App.css';

function App() {
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const unlisten = listen('super_key_pressed', async () => {
      const position = await cursorPosition();
      setCursorPos({ x: position.x, y: position.y });
      setIsMenuVisible(prev => !prev);
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  const handleMenuItemClick = (itemName: string) => {
    console.log(`Menu item clicked: ${itemName}`);
    // Implement specific actions based on itemName here
    setIsMenuVisible(false); // Hide menu after click
  };

  return (
    <div className="app">
      <TopBar />
      <HomeScreen />
      <BottomBar />
      <CircularMenu 
        isVisible={isMenuVisible} 
        cursorPos={cursorPos} 
        onMenuItemClick={handleMenuItemClick}
      />
    </div>
  );
}

export default App;
