
import FileManager from './FileManager';
import AppStore from './AppStore';
import Settings from './Settings';
import './HomeScreen.css';

function HomeScreen() {
  return (
    <div className="home-screen">
      <div className="shortcuts">
        <div className="shortcut-card">
          <img src="/home/rinta/デスクトップ/sis/theme_assets/icons/icon_app_default.png" alt="App" />
          <span>App 1</span>
        </div>
        <div className="shortcut-card">
          <img src="/home/rinta/デスクトップ/sis/theme_assets/icons/icon_folder.png" alt="Folder" />
          <span>Folder 1</span>
        </div>
        <div className="shortcut-card">
          <img src="/home/rinta/デスクトップ/sis/theme_assets/icons/icon_terminal.png" alt="Terminal" />
          <span>Terminal</span>
        </div>
        <div className="shortcut-card">
          <img src="/home/rinta/デスクトップ/sis/theme_assets/icons/icon_app_default.png" alt="App" />
          <span>App 2</span>
        </div>
        <div className="shortcut-card">
          <img src="/home/rinta/デスクトップ/sis/theme_assets/icons/icon_folder.png" alt="Folder" />
          <span>Folder 2</span>
        </div>
        <div className="shortcut-card">
          <img src="/home/rinta/デスクトップ/sis/theme_assets/icons/icon_app_default.png" alt="App" />
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
