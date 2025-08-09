
import './AppStore.css';

function AppStore() {
  const apps = [
    { name: 'Browser', icon: '/home/rinta/デスクトップ/sis/theme_assets/icons/icon_app_default.png' },
    { name: 'Terminal', icon: '/home/rinta/デスクトップ/sis/theme_assets/icons/icon_terminal.png' },
    { name: 'Settings', icon: '/home/rinta/デスクトップ/sis/theme_assets/icons/icon_settings.png' },
    { name: 'Documents', icon: '/home/rinta/デスクトップ/sis/theme_assets/icons/icon_file_document.png' },
    { name: 'Folder', icon: '/home/rinta/デスクトップ/sis/theme_assets/icons/icon_folder.png' },
    { name: 'Game', icon: '/home/rinta/デスクトップ/sis/theme_assets/icons/icon_app_default.png' },
  ];

  return (
    <div className="app-store">
      <h3>アプリストア</h3>
      <div className="app-grid">
        {apps.map((app, index) => (
          <div key={index} className="app-card">
            <img src={app.icon} alt={app.name} />
            <span>{app.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default AppStore;
