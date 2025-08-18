
import FileManager from './FileManager';
import { api } from '../services/api';
import AppStore from './AppStore';
import Settings from './Settings';
import { IconApp, IconFolder, IconTerminal } from '../assets/icons';
import './HomeScreen.css';

function HomeScreen() {
  return (
    <div className="home-screen">
      <div className="dashboard-grid">
      <div className="panel shortcuts-panel">
        <div className="shortcuts">
          <div className="shortcut-card" onClick={async () => {
            const r = await api.launchApp('xdg-open "$HOME"');
            if (!r.ok) alert('ホームフォルダを開けません: ' + (r.message || 'unknown'))
          }}>
            <img src={IconFolder} alt="Home" />
            <span>ホーム</span>
          </div>
          <div className="shortcut-card" onClick={async () => {
            const r = await api.launchApp('xdg-open "$HOME/Downloads"');
            if (!r.ok) alert('ダウンロードを開けません: ' + (r.message || 'unknown'))
          }}>
            <img src={IconFolder} alt="Downloads" />
            <span>ダウンロード</span>
          </div>
          <div className="shortcut-card" onClick={async () => {
            const r = await api.launchApp('xfce4-terminal || x-terminal-emulator || gnome-terminal');
            if (!r.ok) alert('ターミナル起動に失敗: ' + (r.message || 'unknown'))
          }}>
            <img src={IconTerminal} alt="Terminal" />
            <span>ターミナル</span>
          </div>
          <div className="shortcut-card" onClick={async () => {
            const r = await api.takeScreenshot();
            if (!r.ok) alert('スクリーンショットに失敗しました')
          }}>
            <img src={IconApp} alt="Screenshot" />
            <span>スクショ</span>
          </div>
          <div className="shortcut-card" onClick={async () => {
            const r = await api.playPauseMusic();
            if (!r.ok) alert('音楽制御に失敗しました')
          }}>
            <img src={IconApp} alt="Music" />
            <span>音楽</span>
          </div>
          <div className="shortcut-card" onClick={async () => {
            const running = await api.overlayStatus();
            const r = running ? await api.overlayStop() : await api.overlayStart();
            if (!r.ok) alert('オーバーレイ失敗: ' + (r.message || 'unknown'))
          }}>
            <img src={IconApp} alt="Overlay" />
            <span>HUD</span>
          </div>
        </div>
      </div>
      <FileManager />
      <AppStore />
      <Settings />
      </div>
    </div>
  );
}

export default HomeScreen;
