import { useState, useEffect } from 'react';
import { IconSettings } from '../assets/icons';
import './TopBar.css';

type Props = { onToggleControlCenter?: () => void }

function TopBar({ onToggleControlCenter }: Props) {
  // Gauges hidden per request
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showNotificationTooltip, setShowNotificationTooltip] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => { setCurrentTime(new Date()) }, 1000);
    return () => { clearInterval(timer) };
  }, []);

  const formattedTime = currentTime.toLocaleDateString('ja-JP', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).replace(/\//g, '.');

  const formattedDate = currentTime.getFullYear() + '年' + 
    String(currentTime.getMonth() + 1).padStart(2, '0') + '月' + 
    String(currentTime.getDate()).padStart(2, '0') + '日';

  // Gauges removed

  return (
    <div className="top-bar">
  {/* system-info gauges removed */}
      <div className="datetime">
        <span>{formattedDate}</span>
        <span>{formattedTime}</span>
      </div>
      <div 
        className="notification-center"
        onMouseEnter={() => setShowNotificationTooltip(true)}
        onMouseLeave={() => setShowNotificationTooltip(false)}
        onClick={() => onToggleControlCenter?.()}
        onDoubleClick={() => { window.dispatchEvent(new Event('sis:open-settings')) }}
      >
        <img src={IconSettings} alt="control-panel" />
    {showNotificationTooltip && (
          <div className="notification-tooltip">
      制御パネル（ダブルクリックで設定 / Ctrl+, でも開く）
          </div>
        )}
      </div>
    </div>
  );
}

export default TopBar;