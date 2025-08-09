import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './CircularMenu.css';

interface CircularMenuProps {
  isVisible: boolean;
  cursorPos: { x: number; y: number; };
  onMenuItemClick: (itemName: string) => void;
}

interface AppInfo {
  name: string;
  exec: string;
}

function CircularMenu({ isVisible, cursorPos, onMenuItemClick }: CircularMenuProps) {
  const [menuItems] = useState([
    { name: 'Volume', icon: '/home/rinta/デスクトップ/sis/theme_assets/icons/icon_settings.png', type: 'volume' },
    { name: 'Recent Apps', icon: '/home/rinta/デスクトップ/sis/theme_assets/icons/icon_app_default.png', type: 'recent_apps' },
    { name: 'Favorite Apps', icon: '/home/rinta/デスクトップ/sis/theme_assets/icons/icon_app_default.png', type: 'favorite_apps' },
    { name: 'Screenshot', icon: '/home/rinta/デスクトップ/sis/theme_assets/icons/icon_app_default.png', type: 'screenshot' },
    { name: 'Music', icon: '/home/rinta/デスクトップ/sis/theme_assets/icons/icon_app_default.png', type: 'music_control' },
  ]);

  const [recentApps, setRecentApps] = useState<AppInfo[]>([]);
  const [showRecentApps, setShowRecentApps] = useState(false);
  const [favoriteApps, setFavoriteApps] = useState<AppInfo[]>([]);
  const [showFavoriteApps, setShowFavoriteApps] = useState(false);
  const [showMusicControls, setShowMusicControls] = useState(false);

  const handleVolumeChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const volume = parseInt(event.target.value);
    try {
      await invoke('set_volume', { volume });
      console.log(`Volume set to ${volume}%`);
    } catch (error) {
      console.error('Failed to set volume:', error);
    }
  };

  const handleRecentAppsClick = async () => {
    try {
      const apps: AppInfo[] = await invoke('get_recent_apps');
      setRecentApps(apps);
      setShowRecentApps(true);
      setShowFavoriteApps(false); // Hide other lists
      setShowMusicControls(false);
    } catch (error) {
      console.error('Failed to get recent apps:', error);
    }
  };

  const handleFavoriteAppsClick = async () => {
    try {
      const apps: AppInfo[] = await invoke('get_favorite_apps');
      setFavoriteApps(apps);
      setShowFavoriteApps(true);
      setShowRecentApps(false); // Hide other lists
      setShowMusicControls(false);
    } catch (error) {
      console.error('Failed to get favorite apps:', error);
    }
  };

  const handleAddFavorite = async (app: AppInfo) => {
    try {
      const result = await invoke('add_favorite_app', { app });
      console.log(result);
      handleFavoriteAppsClick(); // Refresh list
    } catch (error) {
      console.error('Failed to add favorite app:', error);
    }
  };

  const handleRemoveFavorite = async (appName: string) => {
    try {
      const result = await invoke('remove_favorite_app', { appName });
      console.log(result);
      handleFavoriteAppsClick(); // Refresh list
    } catch (error) {
      console.error('Failed to remove favorite app:', error);
    }
  };

  const handleScreenshot = async () => {
    try {
      const result = await invoke('take_screenshot');
      console.log(result);
    } catch (error) {
      console.error('Failed to take screenshot:', error);
    }
  };

  const handleMusicControlClick = () => {
    setShowMusicControls(true);
    setShowRecentApps(false);
    setShowFavoriteApps(false);
  };

  const handlePlayPause = async () => {
    try {
      const result = await invoke('play_pause_music');
      console.log(result);
    } catch (error) {
      console.error('Failed to toggle play/pause:', error);
    }
  };

  const handleNextTrack = async () => {
    try {
      const result = await invoke('next_track');
      console.log(result);
    } catch (error) {
      console.error('Failed to go to next track:', error);
    }
  };

  const handlePreviousTrack = async () => {
    try {
      const result = await invoke('previous_track');
      console.log(result);
    } catch (error) {
      console.error('Failed to go to previous track:', error);
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div 
      className="circular-menu-overlay"
      style={{ top: cursorPos.y, left: cursorPos.x }}
    >
      <div className="circular-menu-container">
        {menuItems.map((item, index) => (
          <div 
            key={index} 
            className="circular-menu-item"
            style={{
              transform: `rotate(${index * (360 / menuItems.length)}deg) translate(100px) rotate(-${index * (360 / menuItems.length)}deg)`
            }}
            onClick={() => {
              if (item.type === 'recent_apps') {
                handleRecentAppsClick();
              } else if (item.type === 'favorite_apps') {
                handleFavoriteAppsClick();
              } else if (item.type === 'screenshot') {
                handleScreenshot();
              } else if (item.type === 'music_control') {
                handleMusicControlClick();
              } else {
                onMenuItemClick(item.name);
              }
            }}
          >
            <img src={item.icon} alt={item.name} />
            <span>{item.name}</span>
            {item.type === 'volume' && (
              <input 
                type="range" 
                min="0" 
                max="100" 
                defaultValue="50" 
                className="volume-slider"
                onClick={(e) => e.stopPropagation()} // Prevent menu item click when dragging slider
                onChange={handleVolumeChange}
              />
            )}
          </div>
        ))}
      </div>

      {showRecentApps && (
        <div className="app-list-container">
          <h4>最近のアプリ</h4>
          <ul>
            {recentApps.length > 0 ? (
              recentApps.map((app, index) => (
                <li key={index}>
                  {app.name}
                  <button onClick={() => handleAddFavorite(app)}>Add to Fav</button>
                </li>
              ))
            ) : (
              <li>最近のアプリはありません</li>
            )}
          </ul>
        </div>
      )}

      {showFavoriteApps && (
        <div className="app-list-container">
          <h4>お気に入りアプリ</h4>
          <ul>
            {favoriteApps.length > 0 ? (
              favoriteApps.map((app, index) => (
                <li key={index}>
                  {app.name}
                  <button onClick={() => handleRemoveFavorite(app.name)}>Remove</button>
                </li>
              ))
            ) : (
              <li>お気に入りアプリはありません</li>
            )}
          </ul>
        </div>
      )}

      {showMusicControls && (
        <div className="music-controls-container">
          <h4>音楽操作</h4>
          <div className="music-buttons">
            <button onClick={handlePreviousTrack}>⏮️</button>
            <button onClick={handlePlayPause}>⏯️</button>
            <button onClick={handleNextTrack}>⏭️</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default CircularMenu;