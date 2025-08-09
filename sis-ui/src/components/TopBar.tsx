import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './TopBar.css';

function TopBar() {
  const [cpuUsage, setCpuUsage] = useState(0);
  const [memUsage, setMemUsage] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showNotificationTooltip, setShowNotificationTooltip] = useState(false);

  useEffect(() => {
    const getSystemInfo = async () => {
      try {
        const info: string = await invoke('get_system_info');
        const parsedInfo = JSON.parse(info);
        setCpuUsage(parsedInfo.cpuUsage);
        setMemUsage(parsedInfo.memUsage);
        setDownloadSpeed(parsedInfo.downloadSpeed);
        setUploadSpeed(parsedInfo.uploadSpeed);
      } catch (error) {
        console.error('Failed to get system info:', error);
        // Fallback to dummy values if there's an error
        setCpuUsage(50);
        setMemUsage(60);
        setDownloadSpeed(0);
        setUploadSpeed(0);
      }
    };

    getSystemInfo();
    const interval = setInterval(getSystemInfo, 5000);

    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => {
      clearInterval(interval);
      clearInterval(timer);
    };
  }, []);

  const formattedTime = currentTime.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).replace(/\//g, '/');

  return (
    <div className="top-bar">
      <div className="system-info">
        <span>CPU: {cpuUsage.toFixed(1)}%</span>
        <span>MEM: {memUsage}%</span>
        <span>DL: {downloadSpeed}MB/s</span>
        <span>UL: {uploadSpeed}MB/s</span>
      </div>
      <div className="datetime">
        <span>{formattedTime}</span>
      </div>
      <div 
        className="notification-center"
        onMouseEnter={() => setShowNotificationTooltip(true)}
        onMouseLeave={() => setShowNotificationTooltip(false)}
      >
        <img src="/home/rinta/デスクトップ/sis/theme_assets/icons/icon_settings.png" alt="settings" />
        {showNotificationTooltip && (
          <div className="notification-tooltip">
            通知はありません
          </div>
        )}
      </div>
    </div>
  );
}

export default TopBar;