import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './FileManager.css';

function FileManager() {
  const [filesOrganized, setFilesOrganized] = useState(false);

  const handleOrganizeFiles = async () => {
    // This is a placeholder for now. In a real scenario, you'd get a list of files to organize.
    // For demonstration, let's assume a dummy file path.
    const dummyFilePath = "/home/rinta/Downloads/test_image.jpg"; // Replace with a real path for testing
    try {
      const result = await invoke('organize_file', { filePath: dummyFilePath });
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
          <img src="/home/rinta/デスクトップ/sis/theme_assets/icons/icon_folder.png" alt="Images" />
          <span>画像</span>
          <span className="file-count">📁 120</span>
        </div>
        <div className="folder-card">
          <img src="/home/rinta/デスクトップ/sis/theme_assets/icons/icon_folder.png" alt="Documents" />
          <span>ドキュメント</span>
          <span className="file-count">📁 85</span>
        </div>
        <div className="folder-card">
          <img src="/home/rinta/デスクトップ/sis/theme_assets/icons/icon_folder.png" alt="Videos" />
          <span>動画</span>
          <span className="file-count">📁 30</span>
        </div>
        <div className="folder-card">
          <img src="/home/rinta/デスクトップ/sis/theme_assets/icons/icon_folder.png" alt="Others" />
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