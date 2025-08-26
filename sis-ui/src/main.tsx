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
import { invoke } from '@tauri-apps/api/core'
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi'
import Sidebar from './components/Sidebar.tsx'

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
  <div style={{ width: '100dvw', height: '100dvh', overflow: 'hidden' }}>
      <HomeScreen />
    </div>
  );
}

function TopBarRoot() {
  useEffect(() => {
    const w = getCurrentWindow();
    (async () => {
      try {
        document.title = 'SIS TopBar';
        await w.setTitle('SIS TopBar');
        const mon = await currentMonitor();
        if (mon?.size) {
          // retry-resize until applied
          for (let i=0; i<8; i++) {
            await w.setSize(new LogicalSize(mon.size.width, 48));
            await w.setPosition(new LogicalPosition(0, 0));
            await new Promise(r=>setTimeout(r, 120));
          }
          // best-effort: X11 enforce
          await invoke('run_safe_command', { cmdline: `wmctrl -r 'SIS TopBar' -e 0,0,0,${mon.size.width},48` }).catch(()=>{});
        }
  await w.setAlwaysOnTop(true);
        await w.show();
      } catch {}
    })();
  // Note: monitor change events are not exposed; re-evaluate on next launch/login
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
        document.title = 'SIS Dock';
        await w.setTitle('SIS Dock');
        const mon = await currentMonitor();
        const h = 64;
        if (mon?.size) {
          for (let i=0; i<8; i++) {
            await w.setSize(new LogicalSize(mon.size.width, h));
            await w.setPosition(new LogicalPosition(0, Math.max(0, mon.size.height - h)));
            await new Promise(r=>setTimeout(r, 120));
          }
          await invoke('run_safe_command', { cmdline: `wmctrl -r 'SIS Dock' -e 0,0,${Math.max(0, mon.size.height - h)},${mon.size.width},${h}` }).catch(()=>{});
        }
  await w.setAlwaysOnTop(true);
        await w.show();
      } catch {}
    })();
  // Note: monitor change events are not exposed; re-evaluate on next launch/login
  }, []);
  return (
    <div style={{ width: '100%', height: '64px', backdropFilter: 'blur(6px)', background: 'rgba(20,20,24,0.55)' }}>
      <BottomBar />
    </div>
  );
}

function SidebarRoot() {
  const [collapsed, setCollapsed] = useState(true);
  useEffect(() => {
    const w = getCurrentWindow();
    (async () => {
      try {
        document.title = 'SIS Sidebar';
        await w.setTitle('SIS Sidebar');
        const mon = await currentMonitor();
        const width = collapsed ? 80 : 280;
        if (mon?.size) {
          for (let i=0; i<8; i++) {
            await w.setSize(new LogicalSize(width, mon.size.height));
            await w.setPosition(new LogicalPosition(0, 0));
            await new Promise(r=>setTimeout(r, 120));
          }
          await invoke('run_safe_command', { cmdline: `wmctrl -r 'SIS Sidebar' -e 0,0,0,${width},${mon.size.height}` }).catch(()=>{});
        }
  await w.setAlwaysOnTop(true);
        await w.show();
      } catch {}
    })();
  // Note: monitor change events are not exposed; re-evaluate on next launch/login
  }, [collapsed]);
  return (
    <div style={{ width: '100%', height: '100vh', backdropFilter: 'blur(10px)', background: 'rgba(20,20,24,0.55)' }}>
      <Sidebar isCollapsed={collapsed} onToggle={()=>setCollapsed(p=>!p)} />
    </div>
  );
}

function Root() {
  const label = useWindowLabel();
  if (!label) return null; // 初期化待ち
  if (label === 'desktop') {
    // Desktopは念のためタイトル/フルスクリーンを再確認
    const w = getCurrentWindow();
    (async () => { 
      try { 
        document.title = 'SIS Desktop';
        await w.setTitle('SIS Desktop');
        await w.setFullscreen(true);
        await w.show();
        const mon = await currentMonitor();
        if (mon?.size) {
          for (let i=0; i<8; i++) {
            await w.setFullscreen(true);
            await new Promise(r=>setTimeout(r, 120));
          }
          await invoke('run_safe_command', { cmdline: `wmctrl -r 'SIS Desktop' -b add,fullscreen` }).catch(()=>{});
          await invoke('run_safe_command', { cmdline: `wmctrl -r 'SIS Desktop' -e 0,0,0,${mon.size.width},${mon.size.height}` }).catch(()=>{});
        }
      } catch {}
    })();
    return <DesktopRoot />;
  }
  if (label === 'topbar') return <TopBarRoot />;
  if (label === 'dock') return <DockRoot />;
  if (label === 'sidebar') return <SidebarRoot />;
  // 既存の単一ウィンドウモード互換
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
