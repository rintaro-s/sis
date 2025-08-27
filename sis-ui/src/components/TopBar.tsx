import { useState, useEffect } from 'react';
import './TopBar.css';
import { api } from '../services/api';

function TopBar() {
  const [systemInfo, setSystemInfo] = useState({ cpuUsage: 0, memUsage: 0, downloadSpeed: 0, uploadSpeed: 0 });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState<boolean | null>(null);

  useEffect(() => {
    const timer = setInterval(() => { 
      setCurrentTime(new Date());
      
      // システム情報を定期的に更新
      api.getSystemInfo().then(info => {
        setSystemInfo(info);
      }).catch(() => {
        console.warn('システム情報の取得に失敗');
      });
      
      // コントロールセンター状態を取得
      api.controlCenterState().then(state => {
        if (state) {
          if (typeof state.network === 'boolean') setIsOnline(state.network);
        }
      }).catch(() => {
        console.warn('ネットワーク状態の取得に失敗');
      });
      
      // バッテリー情報を取得
      api.runSafeCommand('upower -i $(upower -e | grep "BAT") 2>/dev/null | grep percentage | grep -o "[0-9]*" || echo ""').then(result => {
        const level = parseInt(result.text?.trim() || '');
        if (!isNaN(level)) {
          setBatteryLevel(level);
        }
      }).catch(() => {
        console.warn('バッテリー情報の取得に失敗');
      });
    }, 2000);
    
    return () => { clearInterval(timer) };
  }, []);

  const formattedTime = currentTime.toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const formattedDate = currentTime.toLocaleDateString('ja-JP', {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  });

  const getGaugeColor = (value: number, type: 'cpu' | 'memory' | 'battery') => {
    if (type === 'battery') {
      if (value > 60) return '#00ff88';
      if (value > 30) return '#ffaa00';
      return '#ff4444';
    }
    if (value < 50) return '#00ff88';
    if (value < 80) return '#ffaa00';
    return '#ff4444';
  };

  return (
    <div className="futuristic-topbar" style={{ pointerEvents: 'auto' }}>
      {/* システム情報パネル */}
      <div className="system-status">
        <div className="status-item">
          <div className="status-label">CPU</div>
          <div className="status-gauge">
            <div 
              className="gauge-fill" 
              style={{ 
                width: `${systemInfo.cpuUsage}%`,
                backgroundColor: getGaugeColor(systemInfo.cpuUsage, 'cpu')
              }}
            ></div>
          </div>
          <div className="status-value">{Math.round(systemInfo.cpuUsage)}%</div>
        </div>
        
        <div className="status-item">
          <div className="status-label">MEM</div>
          <div className="status-gauge">
            <div 
              className="gauge-fill" 
              style={{ 
                width: `${systemInfo.memUsage}%`,
                backgroundColor: getGaugeColor(systemInfo.memUsage, 'memory')
              }}
            ></div>
          </div>
          <div className="status-value">{Math.round(systemInfo.memUsage)}%</div>
        </div>

        <div className="status-item">
          <div className="status-label">BAT</div>
          <div className="status-gauge">
            <div 
              className="gauge-fill" 
              style={{ 
                width: `${batteryLevel ?? 0}%`,
                backgroundColor: getGaugeColor(batteryLevel ?? 0, 'battery')
              }}
            ></div>
          </div>
          <div className="status-value">{batteryLevel !== null ? `${batteryLevel}%` : 'N/A'}</div>
        </div>

        <div className="network-indicator">
          <div className={`network-status ${isOnline ? 'online' : 'offline'}`}>
            {isOnline === null ? 'N/A' : (isOnline ? 'NET' : 'OFF')}
          </div>
        </div>
      </div>

      {/* 中央ロゴエリア */}
      <div className="brand-area">
        <div className="brand-logo">SIS</div>
        <div className="brand-subtitle">Smart Interface System</div>
      </div>

      {/* 日時・通知エリア */}
      <div className="datetime-panel">
        <div className="time-display">{formattedTime}</div>
        <div className="date-display">{formattedDate}</div>
        <div className="notification-badge" title="通知">
          <span className="notification-icon">通知</span>
          <span className="notification-count">0</span>
        </div>
      </div>
    </div>
  );
}

export default TopBar;