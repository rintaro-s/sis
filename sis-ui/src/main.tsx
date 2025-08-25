import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css';
import './global.css';
import './components/GameCard.css';
import './components/GameButton.css';
import './components/GameTabs.css';

import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
