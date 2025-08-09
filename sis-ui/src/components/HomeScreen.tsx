
import FileManager from './FileManager';
import AppStore from './AppStore';
import Settings from './Settings';
import { IconApp, IconFolder, IconTerminal } from '../assets/icons';
import './HomeScreen.css';

function HomeScreen() {
  return (
    <div className="home-screen">
      <div className="shortcuts">
        <div className="shortcut-card">
          <img src={IconApp} alt="App" />
          <span>App 1</span>
        </div>
        <div className="shortcut-card">
          <img src={IconFolder} alt="Folder" />
          <span>Folder 1</span>
        </div>
        <div className="shortcut-card">
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
      <FileManager />
      <AppStore />
      <Settings />
    </div>
  );
}

export default HomeScreen;
