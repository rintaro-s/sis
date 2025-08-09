
import './AppStore.css';
import { IconApp, IconTerminal, IconSettings, IconDoc, IconFolder } from '../assets/icons';

function AppStore() {
  const apps = [
    { name: 'Browser', icon: IconApp },
    { name: 'Terminal', icon: IconTerminal },
    { name: 'Settings', icon: IconSettings },
    { name: 'Documents', icon: IconDoc },
    { name: 'Folder', icon: IconFolder },
    { name: 'Game', icon: IconApp },
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
