
import { useState } from 'react';
import './BottomBar.css';

function BottomBar() {
  const [isChatBarFocused, setIsChatBarFocused] = useState(false);
  const [showAppLauncherTooltip, setShowAppLauncherTooltip] = useState(false);
  const [showControlCenterTooltip, setShowControlCenterTooltip] = useState(false);

  return (
    <div className="bottom-bar">
      <div 
        className="app-launcher"
        onMouseEnter={() => setShowAppLauncherTooltip(true)}
        onMouseLeave={() => setShowAppLauncherTooltip(false)}
      >
        <img src="/home/rinta/デスクトップ/sis/theme_assets/icons/icon_app_default.png" alt="launcher" />
        {showAppLauncherTooltip && (
          <div className="bottom-bar-tooltip">
            アプリランチャー
          </div>
        )}
      </div>
      <div 
        className="control-center"
        onMouseEnter={() => setShowControlCenterTooltip(true)}
        onMouseLeave={() => setShowControlCenterTooltip(false)}
      >
        <img src="/home/rinta/デスクトップ/sis/theme_assets/icons/icon_settings.png" alt="settings" />
        {showControlCenterTooltip && (
          <div className="bottom-bar-tooltip">
            コントロールセンター
          </div>
        )}
      </div>
      <div className="llm-chat-bar">
        <input
          type="text"
          placeholder="LLMに話しかける..."
          onFocus={() => setIsChatBarFocused(true)}
          onBlur={() => setIsChatBarFocused(false)}
          className={isChatBarFocused ? 'focused' : ''}
        />
      </div>
    </div>
  );
}

export default BottomBar;
