import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { IconSettings } from '../assets/icons';
import './TopBar.css';

type Props = { onToggleControlCenter?: () => void }

function TopBar({ onToggleControlCenter }: Props) {
  const [cpuUsage, setCpuUsage] = useState(0);
  const [memUsage, setMemUsage] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showNotificationTooltip, setShowNotificationTooltip] = useState(false);

  useEffect(() => {
    const getSystemInfo = async () => {
      const info = await api.getSystemInfo();
      setCpuUsage(info.cpuUsage);
      setMemUsage(info.memUsage);
      setDownloadSpeed(info.downloadSpeed);
      setUploadSpeed(info.uploadSpeed);
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

  const Gauge = ({ label, value, unit = '%' }: { label: string; value: number; unit?: string }) => (
    <div className="stat-gauge">
      <div className="stat-label">{label}</div>
      <div className="gauge-container">
        <div className="gauge-fill" style={{ width: `${Math.min(value, 100)}%` }}></div>
      </div>
      <div className="stat-value">{value.toFixed(1)}{unit}</div>
    </div>
  );

  return (
    <div className="top-bar">
      <div className="system-info">
        <Gauge label="CPU" value={cpuUsage} />
        <Gauge label="MEM" value={memUsage} />
        <Gauge label="DL" value={downloadSpeed} unit="MB/s" />
        <Gauge label="UL" value={uploadSpeed} unit="MB/s" />
      </div>
      <div className="datetime">
        <span>{formattedDate}</span>
        <span>{formattedTime}</span>
      </div>
      <div 
        className="notification-center"
  onMouseEnter={() => setShowNotificationTooltip(true)}
  onMouseLeave={() => setShowNotificationTooltip(false)}
  onClick={() => onToggleControlCenter?.()}
      >
        <img src={IconSettings} alt="control-panel" />
        {showNotificationTooltip && (
          <div className="notification-tooltip">
            制御パネル
          </div>
        )}
      </div>
    </div>
  );
}

export default TopBar;