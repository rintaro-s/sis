
import './Settings.css';

function Settings() {
  return (
    <div className="settings">
      <h3>設定</h3>
      <div className="setting-item">
        <span>テーマ</span>
        <div className="theme-selector">
          <button className="theme-button active">ダーク</button>
          <button className="theme-button">ライト</button>
        </div>
      </div>
      <div className="setting-item">
        <span>音量</span>
        <input type="range" min="0" max="100" value="50" className="slider" />
      </div>
      <div className="setting-item">
        <span>通知</span>
        <label className="switch">
          <input type="checkbox" checked />
          <span className="slider round"></span>
        </label>
      </div>
    </div>
  );
}

export default Settings;
