import { useState } from 'react';
import { api } from '../services/api';
import { IconFolder } from '../assets/icons';
import './FileManager.css';

function FileManager() {
  const [filesOrganized, setFilesOrganized] = useState(false);

  const handleOrganizeFiles = async () => {
    // This is a placeholder for now. In a real scenario, you'd get a list of files to organize.
    // For demonstration, let's assume a dummy file path.
    const dummyFilePath = "C:/Users/user/Downloads/test_image.jpg"; // ダミーパス（Windows向け）
    try {
      const result = await api.organizeFile(dummyFilePath);
      console.log(result);
      setFilesOrganized(true);
      setTimeout(() => setFilesOrganized(false), 3000); // Hide message after 3 seconds
    } catch (error) {
      console.error('Failed to organize file:', error);
    }
  };

  return (
    <div className="file-manager">
      <h3>ファイル管理</h3>
      <div className="folder-categories">
        <div className="folder-card">
          <img src={IconFolder} alt="Images" />
          <span>画像</span>
          <span className="file-count">📁 120</span>
        </div>
        <div className="folder-card">
          <img src={IconFolder} alt="Documents" />
          <span>ドキュメント</span>
          <span className="file-count">📁 85</span>
        </div>
        <div className="folder-card">
          <img src={IconFolder} alt="Videos" />
          <span>動画</span>
          <span className="file-count">📁 30</span>
        </div>
        <div className="folder-card">
          <img src={IconFolder} alt="Others" />
          <span>その他</span>
          <span className="file-count">📁 50</span>
        </div>
      </div>
      <button onClick={handleOrganizeFiles}>ファイルを整理</button>
      {filesOrganized && <p className="organization-message">ファイルが整理されました！</p>}
    </div>
  );
}

export default FileManager;