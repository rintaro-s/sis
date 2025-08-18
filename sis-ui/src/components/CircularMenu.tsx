import { useState, useMemo } from 'react';
import { api } from '../services/api';
import type { AppInfo } from '../services/api';
import { IconSettings, IconApp, IconFolder, IconTerminal } from '../assets/icons';
import './CircularMenu.css';

interface CircularMenuProps {
  isVisible: boolean;
  onClose: () => void;
}

function CircularMenu({ isVisible, onClose }: CircularMenuProps) {
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const [recentApps, setRecentApps] = useState<AppInfo[]>([]);
  
  const menuItems = useMemo(() => [
    { name: 'ファイル', icon: IconFolder, action: 'file_manager' },
    { name: 'ターミナル', icon: IconTerminal, action: 'terminal' },
    { name: 'ドキュメント', icon: IconFolder, action: 'documents' },
    { name: 'アプリ', icon: IconApp, action: 'apps' },
    { name: 'システム', icon: IconSettings, action: 'system' },
    { name: 'スクリーン', icon: IconSettings, action: 'screenshot' },
    { name: 'ミュージック', icon: IconApp, action: 'music' },
    { name: 'ボリューム', icon: IconSettings, action: 'volume' },
  ], []);

  const handleItemClick = async (action: string) => {
    switch (action) {
      case 'file_manager':
        try {
          const r = await api.launchApp('xdg-open "$HOME"');
          if (!r.ok) alert('ファイルマネージャを開けません')
          onClose();
        } catch (e) {
          alert('ファイルマネージャを開けません')
        }
        break;
      case 'terminal':
        try {
          // Prefer xfce4-terminal when available; fallback to x-terminal-emulator
          await api.launchApp('xfce4-terminal || x-terminal-emulator || gnome-terminal');
          onClose();
        } catch (e) {
          console.error('Failed to open terminal:', e);
        }
        break;
      case 'documents':
        try {
          const r = await api.launchApp('xdg-open "$HOME/Documents"');
          if (!r.ok) alert('ドキュメントを開けません')
          onClose();
        } catch (e) {
          alert('ドキュメントを開けません')
        }
        break;
      case 'apps':
        try {
          const apps = await api.getRecentApps();
          setRecentApps(apps);
          setActiveSubmenu('apps');
        } catch (error) {
          console.error('Failed to get apps:', error);
        }
        break;
      case 'system':
        setActiveSubmenu('system');
        break;
      case 'screenshot':
        try {
          const result = await api.takeScreenshot();
          console.log(result);
          onClose();
        } catch (error) {
          console.error('Failed to take screenshot:', error);
        }
        break;
      case 'music':
        setActiveSubmenu('music');
        break;
      case 'volume':
        setActiveSubmenu('volume');
        break;
      default:
        onClose();
    }
  };

  const handleVolumeChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const volume = parseInt(event.target.value);
    try {
      await api.setVolume(volume);
      console.log(`Volume set to ${volume}%`);
    } catch (error) {
      console.error('Failed to set volume:', error);
    }
  };

  const handleMusicControl = async (action: string) => {
    try {
      switch (action) {
        case 'play_pause':
          await api.playPauseMusic();
          break;
        case 'next':
          await api.nextTrack();
          break;
        case 'previous':
          await api.previousTrack();
          break;
      }
    } catch (error) {
      console.error(`Failed to ${action}:`, error);
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <>
      <div className="menu-overlay" onClick={onClose} />
      <div className="circular-menu">
        <div className="menu-center" onClick={onClose}>
          <img src={IconSettings} alt="menu" className="center-icon" />
        </div>
        
        {menuItems.map((item, index) => (
          <div 
            key={index} 
            className="menu-item"
            onClick={() => handleItemClick(item.action)}
          >
            <img src={item.icon} alt={item.name} />
            <div className="item-tooltip">{item.name}</div>
          </div>
        ))}

        {activeSubmenu === 'apps' && (
          <div className="app-list-container">
            <h4>アプリケーション</h4>
            <ul>
              {recentApps.filter(a => a.exec && a.exec.trim() !== '').length > 0 ? (
                recentApps.filter(a => a.exec && a.exec.trim() !== '').map((app, index) => (
                  <li key={index}>
                    {app.name}
                    <button
                      onClick={async () => {
                        try {
                          if (!app.exec || app.exec.trim() === '') {
                            console.warn('No exec available for', app.name);
                            return;
                          }
                          await api.launchApp(app.exec);
                          onClose();
                        } catch (e) {
                          console.error('Failed to launch app:', e);
                        }
                      }}
                    >起動</button>
                  </li>
                ))
              ) : (
                <li>アプリがありません</li>
              )}
            </ul>
          </div>
        )}

        {activeSubmenu === 'system' && (
          <div className="app-list-container">
            <h4>システム</h4>
            <ul>
              <li>CPU使用率: 45% <button>詳細</button></li>
              <li>メモリ使用率: 62% <button>詳細</button></li>
              <li>ディスク容量: 78% <button>詳細</button></li>
              <li>ネットワーク <button>詳細</button></li>
            </ul>
          </div>
        )}

        {activeSubmenu === 'music' && (
          <div className="music-controls-container">
            <h4>ミュージック</h4>
            <div className="music-buttons">
              <button onClick={() => handleMusicControl('previous')}>⏮</button>
              <button onClick={() => handleMusicControl('play_pause')}>⏯</button>
              <button onClick={() => handleMusicControl('next')}>⏭</button>
            </div>
          </div>
        )}

        {activeSubmenu === 'volume' && (
          <div className="music-controls-container">
            <h4>ボリューム</h4>
            <input 
              type="range" 
              min="0" 
              max="100" 
              defaultValue="50" 
              className="volume-slider"
              onChange={handleVolumeChange}
            />
          </div>
        )}
      </div>
    </>
  );
}

export default CircularMenu;