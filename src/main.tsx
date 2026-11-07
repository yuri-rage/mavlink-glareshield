import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register service worker in production for offline app shell & map tile caching
// A tab still running an older deploy can fail to load a lazily loaded chunk that the new deploy no longer has:
// reload once to pick up the current build (the flag stops a reload loop if the chunk is genuinely unreachable).
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (sessionStorage.getItem('glareshield_chunk_reload')) return;
    sessionStorage.setItem('glareshield_chunk_reload', '1');
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});
window.addEventListener('load', () => {
  // Loaded cleanly: allow a future reload for the next deploy.
  setTimeout(() => {
    try {
      sessionStorage.removeItem('glareshield_chunk_reload');
    } catch {
      /* storage unavailable */
    }
  }, 10000);
});

if (import.meta.env.PROD && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
