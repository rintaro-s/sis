
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
        <div className="shortcut-card">
          <img src={IconApp} alt="App" />
          <span>App 1</span>
        </div>
        <div className="shortcut-card">
          <img src={IconFolder} alt="Folder" />
          <span>Folder 1</span>
        </div>
        <div className="shortcut-card" onClick={async () => {
          try {
            await api.launchApp('xfce4-terminal || x-terminal-emulator || gnome-terminal');
          } catch (e) { console.error('Failed to open terminal', e); }
        }}>
          <img src={IconTerminal} alt="Terminal" />
          <span>Terminal</span>
        </div>
        <div className="shortcut-card">
          <img src={IconApp} alt="App" />
          <span>App 2</span>
        </div>
        <div className="shortcut-card">
          <img src={IconFolder} alt="Folder" />
          <span>Folder 2</span>
        </div>
        <div className="shortcut-card">
          <img src={IconApp} alt="App" />
          <span>Web Link</span>
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
