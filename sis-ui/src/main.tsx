import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css';
import './global.css';
import './components/GameCard.css';
import './components/GameButton.css';
import './components/GameTabs.css';

import App from './App.tsx'
import TopBar from './components/TopBar.tsx'
import BottomBar from './components/BottomBar.tsx'
import HomeScreen from './components/HomeScreen.tsx'
import { getCurrentWindow, currentMonitor } from '@tauri-apps/api/window'
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi'

function useWindowLabel() {
  const [label, setLabel] = useState<string>('');
  useEffect(() => {
    const w = getCurrentWindow();
    // label is sync, but call to ensure ready on mount
    setLabel((w as any).label ?? '');
    // prevent close (DE は閉じられない)
    w.onCloseRequested((e) => {
      e.preventDefault();
    });
  }, []);
  return label;
}

function DesktopRoot() {
  // 将来的に壁紙やデスクトップアイコンをここで描画
  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <HomeScreen />
    </div>
  );
}

function TopBarRoot() {
  useEffect(() => {
    const w = getCurrentWindow();
    (async () => {
      try {
        const mon = await currentMonitor();
        if (mon?.size) {
          await w.setSize(new LogicalSize(mon.size.width, 48));
          await w.setPosition(new LogicalPosition(0, 0));
        }
        await w.setAlwaysOnTop(true);
        await w.show();
      } catch {}
    })();
  }, []);
  return (
    <div style={{ width: '100%', height: '48px', backdropFilter: 'blur(6px)', background: 'rgba(20,20,24,0.6)' }}>
      <TopBar />
    </div>
  );
}

function DockRoot() {
  useEffect(() => {
    const w = getCurrentWindow();
    (async () => {
      try {
        const mon = await currentMonitor();
        const h = 64;
        if (mon?.size) {
          await w.setSize(new LogicalSize(mon.size.width, h));
          await w.setPosition(new LogicalPosition(0, Math.max(0, mon.size.height - h)));
        }
        await w.setAlwaysOnTop(true);
        await w.show();
      } catch {}
    })();
  }, []);
  return (
    <div style={{ width: '100%', height: '64px', backdropFilter: 'blur(6px)', background: 'rgba(20,20,24,0.55)' }}>
      <BottomBar />
    </div>
  );
}

function Root() {
  const label = useWindowLabel();
  if (!label) return null; // 初期化待ち
  if (label === 'desktop') return <DesktopRoot />;
  if (label === 'topbar') return <TopBarRoot />;
  if (label === 'dock') return <DockRoot />;
  // 既存の単一ウィンドウモード互換
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
