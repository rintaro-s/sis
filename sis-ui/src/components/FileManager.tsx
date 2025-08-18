import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { IconFolder } from '../assets/icons';
import './FileManager.css';

function FileManager() {
  const [filesOrganized, setFilesOrganized] = useState(false);
  const [counts, setCounts] = useState<{ pictures: number; documents: number; videos: number; downloads: number; music: number; others: number }>({ pictures: 0, documents: 0, videos: 0, downloads: 0, music: 0, others: 0 });

  useEffect(() => {
    api.getFolderCounts().then(setCounts).catch(() => {})
  }, [])

  const handleOrganizeFiles = async () => {
    try {
      const result = await api.organizeLatestDownload();
      console.log(result);
      setFilesOrganized(true);
      setTimeout(() => setFilesOrganized(false), 3000);
    } catch (error) {
      console.error('Failed to organize file:', error);
    }
  };

  const openDownloads = async () => {
    try {
      await api.launchApp('xdg-open "$HOME/Downloads"');
    } catch (e) {
      console.error('Failed to open Downloads:', e);
    }
  };

  const openHome = async () => {
    try {
      await api.launchApp('xdg-open "$HOME"');
    } catch (e) {
      console.error('Failed to open Home:', e);
    }
  };

  return (
    <div className="file-manager">
      <h3>ファイル管理</h3>
      <div className="folder-categories">
        <div className="folder-card">
          <img src={IconFolder} alt="Images" />
          <span>画像</span>
          <span className="file-count">📁 {counts.pictures}</span>
        </div>
        <div className="folder-card">
          <img src={IconFolder} alt="Documents" />
          <span>ドキュメント</span>
          <span className="file-count">📁 {counts.documents}</span>
        </div>
        <div className="folder-card">
          <img src={IconFolder} alt="Videos" />
          <span>動画</span>
          <span className="file-count">📁 {counts.videos}</span>
        </div>
        <div className="folder-card">
          <img src={IconFolder} alt="Others" />
          <span>その他</span>
          <span className="file-count">📁 {counts.others}</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={handleOrganizeFiles}>最新のダウンロードを整理</button>
        <button onClick={openDownloads}>Downloads を開く</button>
        <button onClick={openHome}>ホームを開く</button>
        <button onClick={async () => api.launchApp('xdg-open "$HOME/Pictures"')}>Pictures を開く</button>
        <button onClick={async () => api.launchApp('xdg-open "$HOME/Documents"')}>Documents を開く</button>
        <button onClick={async () => api.launchApp('xdg-open "$HOME/Videos"')}>Videos を開く</button>
      </div>
      {filesOrganized && <p className="organization-message">ファイルが整理されました！</p>}
    </div>
  );
}

export default FileManager;