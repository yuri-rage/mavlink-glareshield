// Must stay first: a pending "Restore defaults" clears saved settings before the stores load them.
import './lib/restoreDefaultsBoot';

import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';

import './index.css';
// Telemetry logging starts with the app, before any connection.
import './mavlink/tlogBoot';
// ADS-B traffic from the vehicle.
import './mavlink/adsbBoot';
// The vehicle's gimbal.
import './mavlink/gimbalBoot';
// Terrain: elevation tiles, and answering the vehicle's terrain requests.
import './mavlink/terrainBoot';
// Remembers the last vehicle's type and waypoint radii, for planning offline.
import './store/lastVehicleStore';

import { startReleaseNews } from './lib/releaseNews';
import { BUILD, buildLabel, checkForUpdate, startUpdateChecks, useUpdateStore } from './lib/updateCheck';
import { useTelemetryStore } from './store/telemetryStore';

console.info(`Glareshield ${buildLabel()}${BUILD.sha ? ` (${BUILD.sha})` : ''}`);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register service worker in production for offline app shell & map tile caching
// A tab still running an older deploy can fail to load a lazily loaded chunk that the new deploy no longer has:
// reload once to pick up the current build (the flag stops a reload loop if the chunk is genuinely unreachable).
// Never while armed: the page doesn't restart under a flying vehicle by itself. The widget shows its load error and
// the navbar offers the update, for after landing.
window.addEventListener('vite:preloadError', (event) => {
  if (useTelemetryStore.getState().heartbeat.isArmed) {
    useUpdateStore.setState((s) => (s.available ? s : { available: 'unknown' }));
    void checkForUpdate();
    return;
  }
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

// Notice a newer deploy (production only), so the navbar can offer a reload.
startUpdateChecks();
// The desktop app, just updated: what's new in this version (once).
void startReleaseNews();
