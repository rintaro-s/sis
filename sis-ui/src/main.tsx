import { StrictMode, useEffect, useRef, useState } from 'react'
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
import MiniControlCenter from './components/MiniControlCenter'
// Settings app was removed; controls are distributed into Sidebar/HomeScreen
import CommandPalette from './components/CommandPalette'
import SimpleTerminal from './components/SimpleTerminal'
import { listen } from '@tauri-apps/api/event'
import { api } from './services/api'
import { applyAllToDom, ensureSystemThemeWatcher } from './services/domApply'

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
  // デスクトップはOS上で常時表示。ここに設定/CC/ターミナル/ランチャーを統合する。
  const [isMenuVisible, setIsMenuVisible] = useState(false)
  const [ccOpen, setCcOpen] = useState(false)
  const [termOpen, setTermOpen] = useState(false)
  const [termCmd, setTermCmd] = useState<string | undefined>(undefined)
  const [termAutoRun, setTermAutoRun] = useState<boolean>(false)

  useEffect(() => {
  // OSテーマ変化に追従（system選択時）
  ensureSystemThemeWatcher()
    const w = getCurrentWindow();
    (async () => {
      try {
        // Dockやアプリ一覧に出さない
        // setSkipTaskbarはサポート環境でのみ動作
        if (typeof w.setSkipTaskbar === 'function') await (w as any).setSkipTaskbar(true)
      } catch {}
    })()
  }, [])

  useEffect(() => {
    // 起動時に保存済み設定を反映（テーマ/外観/壁紙）
    (async()=>{
      try {
        let s = await api.getSettings()
        // バックエンドが空を返した場合のフォールバック（localStorage）
        if (!s || (typeof s === 'object' && Object.keys(s).length === 0)) {
          try {
            const raw = localStorage.getItem('sis-ui-settings-backup')
            if (raw) s = { ...(s||{}), ...JSON.parse(raw) }
          } catch {}
        }
        const t = (s?.theme==='system') ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : (s?.theme||'dark')
        try { document.body.setAttribute('data-theme', t==='light'?'light':'dark') } catch {}
        const ap = s?.appearance||{}
        const r = (v:number,min:number,max:number)=>Math.max(min,Math.min(max,Number(v)))
        document.documentElement.style.setProperty('--sis-dock-opacity', String(r(ap.dockOpacity??0.95,0,1)))
        document.documentElement.style.setProperty('--sis-dock-blur', `${r(ap.dockBlur??20,0,60)}px`)
        document.documentElement.style.setProperty('--sis-dock-icon', `${r(ap.dockIcon??56,32,96)}px`)
        document.documentElement.style.setProperty('--sis-app-icon', `${r(ap.appIcon??80,48,128)}px`)
        if (s?.wallpaper) {
          try { const cssVal = await api.cssUrlForPath(String(s.wallpaper)); document.documentElement.style.setProperty('--desktop-wallpaper', cssVal) } catch {}
        }
      } catch {}
    })()
    // Tauriイベント: Superキーや各操作をグローバルに受け取る
    const unsubs: Array<() => void> = []
    // 一括適用（堅牢な受信側）
    listen('sis:settings-saved', async (e:any)=>{
      console.log('[DesktopRoot] Received sis:settings-saved:', e?.payload)
      const s = e?.payload || await api.getSettings().catch(()=>({}))
      await applyAllToDom(s, { cssUrlForPath: api.cssUrlForPath })
      console.log('[DesktopRoot] Applied settings')
    }).then(u=>unsubs.push(u))
  // フォーカス時・周期的に再適用（取りこぼし防止）
  const reapplyDock = async ()=>{ try { const s = await api.getSettings(); await applyAllToDom(s, { cssUrlForPath: api.cssUrlForPath }) } catch {} }
  const onFocusDock = () => { reapplyDock() }
  window.addEventListener('focus', onFocusDock)
  const tickDockId = window.setInterval(reapplyDock, 10000)
    listen('super_key_pressed', () => setIsMenuVisible(p => !p)).then(u => unsubs.push(u))
    // 設定反映イベント
    listen('sis:apply-theme', (e:any)=>{
      const t = e?.payload?.theme
      if (t==='light' || t==='dark') { try { document.body.setAttribute('data-theme', t==='light'?'light':'dark') } catch {} }
    }).then(u => unsubs.push(u))
    listen('sis:appearance-changed', (e:any)=>{
      const p = e?.payload||{}
      if (typeof p.dockOpacity === 'number') document.documentElement.style.setProperty('--sis-dock-opacity', String(p.dockOpacity))
      if (typeof p.dockBlur === 'number') document.documentElement.style.setProperty('--sis-dock-blur', `${p.dockBlur}px`)
      if (typeof p.dockIcon === 'number') document.documentElement.style.setProperty('--sis-dock-icon', `${p.dockIcon}px`)
      if (typeof p.appIcon === 'number') document.documentElement.style.setProperty('--sis-app-icon', `${p.appIcon}px`)
    }).then(u => unsubs.push(u))
    listen('sis:wallpaper-changed', (e:any)=>{
  const css = e?.payload?.css
      if (typeof css === 'string') {
        const root = document.documentElement
        if (css) root.style.setProperty('--desktop-wallpaper', css)
        else root.style.removeProperty('--desktop-wallpaper')
      }
    }).then(u => unsubs.push(u))
  // 設定ウィンドウは廃止
  listen('sis:toggle-cc', () => setCcOpen(p => !p)).then(u => unsubs.push(u))
  // DOM側フォールバック（Dockなどからの発火を確実に受ける）
  const onToggleCc = () => setCcOpen(p=>!p)
  window.addEventListener('sis:toggle-cc', onToggleCc as any)
    listen('sis:open-builtin-terminal', (e: any) => {
      setTermCmd(e?.payload?.cmd)
      setTermAutoRun(!!e?.payload?.autoRun)
      setTermOpen(true)
    }).then(u => unsubs.push(u))
    listen('sis:toggle-builtin-terminal', () => setTermOpen(p => !p)).then(u => unsubs.push(u))

    // DOMカスタムイベント（同ウィンドウ内用フォールバック）
  // 設定ウィンドウは廃止
    const toggleCc = () => setCcOpen(p => !p)
    const openBuiltinTerm = (e: any) => { setTermCmd(e?.detail?.cmd); setTermAutoRun(!!e?.detail?.autoRun); setTermOpen(true) }
    const toggleBuiltin = () => setTermOpen(p => !p)
  // window.addEventListener('sis:open-settings', openSettings as any) // removed
    window.addEventListener('sis:toggle-cc', toggleCc as any)
    window.addEventListener('sis:open-builtin-terminal', openBuiltinTerm as any)
    window.addEventListener('sis:toggle-builtin-terminal', toggleBuiltin as any)

    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.code === 'Space') { e.preventDefault(); setIsMenuVisible(p=>!p) }
      if (e.ctrlKey && e.shiftKey && (e.key.toLowerCase() === 'c')) { e.preventDefault(); setCcOpen(p=>!p) }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') { e.preventDefault(); setIsMenuVisible(p => !p) }
  // Ctrl+, was opening settings; now unused
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === '7') { e.preventDefault(); setTermOpen(p=>!p) }
  if (e.code === 'Escape') { setIsMenuVisible(false); setCcOpen(false) }
    }
    window.addEventListener('keydown', onKey)
  return () => { 
      window.removeEventListener('keydown', onKey);
  // window.removeEventListener('sis:open-settings', openSettings as any)
      window.removeEventListener('sis:toggle-cc', toggleCc as any)
      window.removeEventListener('sis:open-builtin-terminal', openBuiltinTerm as any)
  window.removeEventListener('sis:toggle-builtin-terminal', toggleBuiltin as any)
  window.removeEventListener('sis:toggle-cc', onToggleCc as any)
  unsubs.forEach(u=>u());
  window.removeEventListener('focus', onFocusDock);
  clearInterval(tickDockId);
    }
  }, [])

  return (
    <div style={{ 
      width: '100dvw', 
      height: '100dvh', 
      overflow: 'auto',
      backgroundImage: 'var(--desktop-wallpaper, var(--app-bg))',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
  // Dockに隠れないように下部余白（重なっても内容が読める）
  paddingBottom: 'var(--sis-dock-height, 68px)'
    }}>
      <HomeScreen />
      <MiniControlCenter open={ccOpen} onClose={()=>setCcOpen(false)} />
      <CommandPalette isVisible={isMenuVisible} onClose={() => setIsMenuVisible(false)} />
      <SimpleTerminal open={termOpen} initialCmd={termCmd} initialAutoRun={termAutoRun} onClose={()=>{ setTermOpen(false); setTermAutoRun(false) }} />
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
  // タスクバー/Dockから非表示
  if (typeof w.setSkipTaskbar === 'function') await (w as any).setSkipTaskbar(true)
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
  // 常時最前面は無効化（GNOMEパネルと衝突するため）
        try { await (w as any).setAlwaysOnTop?.(false) } catch {}
        // Xorg 環境では TopBar は生成していない想定だが、もし来た場合は非表示にして早期return
        try {
          const isXorg = !('' + (await (window as any).navigator?.userAgentData?.platform || '')).toLowerCase().includes('wayland')
          if (isXorg) { await w.hide(); return }
        } catch {}
        await w.show();
      } catch {}
    })();
  // Note: monitor change events are not exposed; re-evaluate on next launch/login
  }, []);
  return (
  <div style={{ width: '100%', height: '48px', backdropFilter: 'blur(0px)', background: 'transparent', pointerEvents: 'none' }}>
      <TopBar />
    </div>
  );
}

function DockRoot() {
  useEffect(() => {
  ensureSystemThemeWatcher()
    const w = getCurrentWindow();
    (async () => {
      try {
        // 余白の白帯を防ぐため、WebView自体の背景を透過に固定
        try {
          document.documentElement.style.background = 'transparent'
          document.body.style.background = 'transparent'
        } catch {}
        document.title = 'SIS Dock';
        await w.setTitle('SIS Dock');
  // タスクバー/Dockから非表示
  if (typeof w.setSkipTaskbar === 'function') await (w as any).setSkipTaskbar(true)
        const mon = await currentMonitor();
  const h = 68;
        if (mon?.size) {
          for (let i=0; i<8; i++) {
            await w.setSize(new LogicalSize(mon.size.width, h));
            await w.setPosition(new LogicalPosition(0, Math.max(0, mon.size.height - h)));
            await new Promise(r=>setTimeout(r, 120));
          }
          await invoke('run_safe_command', { cmdline: `wmctrl -r 'SIS Dock' -e 0,0,${Math.max(0, mon.size.height - h)},${mon.size.width},${h}` }).catch(()=>{});
              await invoke('run_safe_command', { cmdline: `wmctrl -r 'SIS Dock' -b add,skip_taskbar,skip_pager,above || true` }).catch(()=>{});
          // Reserve bottom strut on X11
          await invoke('run_safe_command', { cmdline: `xprop -name 'SIS Dock' -f _NET_WM_STRUT 32c -set _NET_WM_STRUT '0, 0, 0, ${h}'` }).catch(()=>{});
          // fields: left,right,top,bottom, left_start_y,left_end_y,right_start_y,right_end_y, top_start_x,top_end_x,bottom_start_x,bottom_end_x
          await invoke('run_safe_command', { cmdline: `xprop -name 'SIS Dock' -f _NET_WM_STRUT_PARTIAL 32c -set _NET_WM_STRUT_PARTIAL '0, 0, 0, ${h}, 0, 0, 0, 0, 0, 0, 0, ${mon.size.width}'` }).catch(()=>{});
        }
  try { await (w as any).setAlwaysOnTop?.(false) } catch {}
        await w.show();
      } catch {}
    })();
    // 起動時に保存済み設定反映
    (async()=>{ try {
      let s = await api.getSettings();
      if (!s || (typeof s === 'object' && Object.keys(s).length===0)) {
        try { const raw = localStorage.getItem('sis-ui-settings-backup'); if (raw) s = { ...(s||{}), ...JSON.parse(raw) } } catch {}
      }
      const t = (s?.theme==='system') ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : (s?.theme||'dark')
      try { document.body.setAttribute('data-theme', t==='light'?'light':'dark') } catch {}
      const ap = s?.appearance||{}; const r=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,Number(v)))
      document.documentElement.style.setProperty('--sis-dock-opacity', String(r(ap.dockOpacity??0.95,0,1)))
      document.documentElement.style.setProperty('--sis-dock-blur', `${r(ap.dockBlur??20,0,60)}px`)
      document.documentElement.style.setProperty('--sis-dock-icon', `${r(ap.dockIcon??56,32,96)}px`)
    } catch {} })()
    // 設定反映イベント（Dock側）
    const unsubs: Array<() => void> = []
    listen('sis:settings-saved', async (e:any)=>{
      console.log('[DockRoot] Received sis:settings-saved:', e?.payload)
      const s = e?.payload || await api.getSettings().catch(()=>({}))
      await applyAllToDom(s, { cssUrlForPath: api.cssUrlForPath })
      console.log('[DockRoot] Applied settings')
    }).then(u=>unsubs.push(u))
    // フォーカス時・周期的に再適用（取りこぼし防止: Dock）
    const reapplyDock = async () => {
      try {
        const s = await api.getSettings()
        await applyAllToDom(s, { cssUrlForPath: api.cssUrlForPath })
      } catch {}
    }
    const onFocusDock = () => { reapplyDock() }
    window.addEventListener('focus', onFocusDock)
    const tickDockId = window.setInterval(reapplyDock, 10000)
    listen('sis:apply-theme', (e:any)=>{
      const t = e?.payload?.theme
      if (t==='light' || t==='dark') { try { document.body.setAttribute('data-theme', t==='light'?'light':'dark') } catch {} }
    }).then(u=>unsubs.push(u))
    listen('sis:appearance-changed', (e:any)=>{
      const p = e?.payload||{}
      if (typeof p.dockOpacity === 'number') document.documentElement.style.setProperty('--sis-dock-opacity', String(p.dockOpacity))
      if (typeof p.dockBlur === 'number') document.documentElement.style.setProperty('--sis-dock-blur', `${p.dockBlur}px`)
      if (typeof p.dockIcon === 'number') document.documentElement.style.setProperty('--sis-dock-icon', `${p.dockIcon}px`)
    }).then(u=>unsubs.push(u))
    listen('sis:wallpaper-changed', (e:any)=>{
      const css = e?.payload?.css
      if (typeof css === 'string') {
        const root = document.documentElement
        if (css) root.style.setProperty('--desktop-wallpaper', css)
        else root.style.removeProperty('--desktop-wallpaper')
      }
    }).then(u=>unsubs.push(u))
  return ()=>{ unsubs.forEach(u=>u()); window.removeEventListener('focus', onFocusDock); clearInterval(tickDockId) }
  // Note: monitor change events are not exposed; re-evaluate on next launch/login
  }, []);
  return (
    <div style={{ width: '100%', height: '68px', background: 'transparent', pointerEvents: 'none' }}>
      <div style={{ pointerEvents: 'auto', width: '100%', height: '100%' }}>
        <BottomBar />
      </div>
    </div>
  );
}

function SidebarRoot() {
  const [collapsed, setCollapsed] = useState(true);
  // タイマーの重複生成を回避
  const hoverTimerRef = useRef<number | null>(null)
  const clearHoverTimer = () => { if (hoverTimerRef && hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null } }
  // アイドル自動クローズ（5秒）
  const idleTimerRef = useRef<number | null>(null)
  const resetIdle = () => {
    if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null }
    if (!collapsed) {
      idleTimerRef.current = setTimeout(() => { setCollapsed(true) }, 5000) as unknown as number
    }
  }
  
  useEffect(() => {
  ensureSystemThemeWatcher()
    const w = getCurrentWindow();
    (async () => {
      try {
        // 余白の白帯を防ぐため、WebView自体の背景を透過に固定
        try {
          document.documentElement.style.background = 'transparent'
          document.body.style.background = 'transparent'
        } catch {}
        document.title = 'SIS Sidebar';
        await w.setTitle('SIS Sidebar');
  // タスクバー/Dockから非表示
  if (typeof w.setSkipTaskbar === 'function') await (w as any).setSkipTaskbar(true)
  const mon = await currentMonitor();
  const width = collapsed ? 12 : 280; // 折りたたみ時は薄いハンドルだけ
        const TOP = 48;
        if (mon?.size) {
          for (let i=0; i<8; i++) {
            await w.setSize(new LogicalSize(width, Math.max(0, mon.size.height - TOP)));
            await w.setPosition(new LogicalPosition(0, TOP));
            await new Promise(r=>setTimeout(r, 120));
          }
          await invoke('run_safe_command', { cmdline: `wmctrl -r 'SIS Sidebar' -e 0,0,${TOP},${width},${Math.max(0, mon.size.height - TOP)}` }).catch(()=>{});
                await invoke('run_safe_command', { cmdline: `wmctrl -r 'SIS Sidebar' -b add,skip_taskbar,skip_pager,above || true` }).catch(()=>{});
          // Reserve only a thin handle (12px) on X11 regardless of expanded width
          const HANDLE = 12
          await invoke('run_safe_command', { cmdline: `xprop -name 'SIS Sidebar' -f _NET_WM_STRUT 32c -set _NET_WM_STRUT '${HANDLE}, 0, 0, 0'` }).catch(()=>{});
          // fields: left,right,top,bottom, left_start_y,left_end_y,right_start_y,right_end_y, top_start_x,top_end_x,bottom_start_x,bottom_end_x
          await invoke('run_safe_command', { cmdline: `xprop -name 'SIS Sidebar' -f _NET_WM_STRUT_PARTIAL 32c -set _NET_WM_STRUT_PARTIAL '${HANDLE}, 0, 0, 0, ${TOP}, ${mon.size.height}, 0, 0, 0, 0, 0, 0'` }).catch(()=>{});
        }
  try { await (w as any).setAlwaysOnTop?.(false) } catch {}
        await w.show();
      } catch {}
    })();
    // 起動時に保存済み設定反映
    (async()=>{ try {
      let s = await api.getSettings();
      if (!s || (typeof s === 'object' && Object.keys(s).length===0)) {
        try { const raw = localStorage.getItem('sis-ui-settings-backup'); if (raw) s = { ...(s||{}), ...JSON.parse(raw) } } catch {}
      }
      const t = (s?.theme==='system') ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : (s?.theme||'dark')
      try { document.body.setAttribute('data-theme', t==='light'?'light':'dark') } catch {}
      const ap = s?.appearance||{}; const r=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,Number(v)))
      document.documentElement.style.setProperty('--sis-dock-opacity', String(r(ap.dockOpacity??0.95,0,1)))
      document.documentElement.style.setProperty('--sis-dock-blur', `${r(ap.dockBlur??20,0,60)}px`)
      document.documentElement.style.setProperty('--sis-dock-icon', `${r(ap.dockIcon??56,32,96)}px`)
      document.documentElement.style.setProperty('--sis-app-icon', `${r(ap.appIcon??80,48,128)}px`)
      if (s?.wallpaper) { try { const cssVal = await api.cssUrlForPath(String(s.wallpaper)); document.documentElement.style.setProperty('--desktop-wallpaper', cssVal) } catch {} }
    } catch {} })()
    // 設定反映イベント（Sidebar側）
    const unsubs: Array<() => void> = []
    listen('sis:settings-saved', async (e:any)=>{
      console.log('[SidebarRoot] Received sis:settings-saved:', e?.payload)
      const s = e?.payload || await api.getSettings().catch(()=>({}))
      await applyAllToDom(s, { cssUrlForPath: api.cssUrlForPath })
      console.log('[SidebarRoot] Applied settings')
    }).then(u=>unsubs.push(u))
  // フォーカス時・周期的に再適用
  const reapplySide = async ()=>{ try { const s = await api.getSettings(); await applyAllToDom(s, { cssUrlForPath: api.cssUrlForPath }) } catch {} }
  const onFocusSide = () => { reapplySide() }
  window.addEventListener('focus', onFocusSide)
  const tickSide = setInterval(reapplySide, 10000)
    listen('sis:apply-theme', (e:any)=>{
      const t = e?.payload?.theme
      if (t==='light' || t==='dark') { try { document.body.setAttribute('data-theme', t==='light'?'light':'dark') } catch {} }
    }).then(u=>unsubs.push(u))
    listen('sis:appearance-changed', (e:any)=>{
      const p = e?.payload||{}
      if (typeof p.dockOpacity === 'number') document.documentElement.style.setProperty('--sis-dock-opacity', String(p.dockOpacity))
      if (typeof p.dockBlur === 'number') document.documentElement.style.setProperty('--sis-dock-blur', `${p.dockBlur}px`)
      if (typeof p.dockIcon === 'number') document.documentElement.style.setProperty('--sis-dock-icon', `${p.dockIcon}px`)
      if (typeof p.appIcon === 'number') document.documentElement.style.setProperty('--sis-app-icon', `${p.appIcon}px`)
    }).then(u=>unsubs.push(u))
    listen('sis:wallpaper-changed', (e:any)=>{
      const css = e?.payload?.css
      if (typeof css === 'string') {
        const root = document.documentElement
        if (css) root.style.setProperty('--desktop-wallpaper', css)
        else root.style.removeProperty('--desktop-wallpaper')
      }
    }).then(u=>unsubs.push(u))
  // Escで閉じる + 自動開閉（安定化: デバウンス/mouseleaveで閉じる）
  const onKey = (e: KeyboardEvent)=>{ if (e.key==='Escape') setCollapsed(true) }
  const onMouseMove = (e: MouseEvent) => {
    // アイドルタイマーはマウス移動でリセットしない（閉じない問題の原因）
    // resetIdle() を削除
    // 左端に1秒滞在で開く（多重タイマー防止）
    if (e.clientX <= 4 && collapsed) {
      if (!hoverTimerRef.current) {
        hoverTimerRef.current = setTimeout(() => { setCollapsed(false); hoverTimerRef.current = null }, 1000) as unknown as number
      }
    } else {
      // 離れたらキャンセル
      clearHoverTimer()
    }
    // 右へ十分離れたら閉じる
    if (e.clientX > 300 && !collapsed) {
      setCollapsed(true)
    }
  }
  const onMouseLeave = () => {
  // ウィンドウ外に出たら即座に閉じる（誤作動防止のためディレイ削除）
  if (!collapsed) { setCollapsed(true) }
    clearHoverTimer()
    if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null }
  }
  const onKeyAny = () => resetIdle()
  const onClickAny = () => resetIdle()
  window.addEventListener('keydown', onKey)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseleave', onMouseLeave)
  window.addEventListener('keypress', onKeyAny)
  window.addEventListener('click', onClickAny)
  return ()=>{ 
    unsubs.forEach(u=>u()); 
    window.removeEventListener('focus', onFocusSide);
    clearInterval(tickSide);
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseleave', onMouseLeave)
    window.removeEventListener('keypress', onKeyAny)
    window.removeEventListener('click', onClickAny)
    clearHoverTimer()
    if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null }
  }
  // Note: monitor change events are not exposed; re-evaluate on next launch/login
  }, [collapsed]);
  return (
    <div style={{ width: '100%', height: '100vh', background: 'transparent', pointerEvents: 'none' }}>
      <div style={{ pointerEvents: 'auto', width: '100%', height: '100%' }}>
        <Sidebar isCollapsed={collapsed} onToggle={()=>setCollapsed(p=>!p)} />
      </div>
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
  // タスクバー/Dockから非表示
  if (typeof w.setSkipTaskbar === 'function') await (w as any).setSkipTaskbar(true)
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
  // 'settings' window was removed
  // 既存の単一ウィンドウモード互換
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
