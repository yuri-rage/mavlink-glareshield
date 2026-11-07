// The app's saved settings in this browser, and resetting them.

/** Every key the app writes starts with one of these; nothing else on the origin is touched. */
const APP_KEY_PREFIXES = ['mavlink_', 'glareshield_'];
/** Set just before the restore-defaults reload, so the next load clears again before any store reads its settings. */
const RESTORE_FLAG = 'glareshield_restore_defaults';

/** Removes the app's saved settings from `storage`. Returns how many entries were removed. */
export function clearAppStorage(storage: Storage = localStorage): number {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && APP_KEY_PREFIXES.some((p) => key.startsWith(p))) keys.push(key);
  }
  keys.forEach((k) => storage.removeItem(k));
  return keys.length;
}

/**
 * Clears the saved settings and reloads. The clear is repeated at the start of the next load
 * (applyPendingRestore), because a store may write its value back in the moment before the page unloads.
 */
export function restoreDefaultsAndReload(): void {
  try {
    clearAppStorage();
    sessionStorage.setItem(RESTORE_FLAG, '1');
  } catch (err) {
    console.error('Failed to clear saved settings:', err);
  }
  window.location.reload();
}

/** Run once at startup, before the stores load their saved settings. */
export function applyPendingRestore(): void {
  try {
    if (typeof sessionStorage === 'undefined' || !sessionStorage.getItem(RESTORE_FLAG)) return;
    sessionStorage.removeItem(RESTORE_FLAG);
    clearAppStorage();
  } catch {
    // Storage blocked: nothing saved to clear.
  }
}
