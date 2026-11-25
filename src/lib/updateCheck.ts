// This build's identity, and noticing that a newer deploy is live so the page can offer to reload.
//
// Each deploy writes /version.json (vite.config.ts) with its build ID. A page left open keeps running the build it
// loaded, and after a deploy that build's lazily loaded pieces may no longer be served, nor cached (the new service
// worker drops the old deploy's cache). So the deployed ID is fetched now and then: every 10 minutes, when the tab
// comes back into view, when the browser comes back online, and when a new service worker takes control. When it
// differs, `available` is set and the navbar offers a reload; nothing reloads on its own. Offline, or on the dev
// server, nothing is checked.

import { create } from 'zustand';

export interface BuildInfo {
  id: string;
  sha: string | null;
  date: string | null;
  dirty: boolean;
}

/** This build (defined at build time; "dev" on the dev server and in tests). */
export const BUILD: BuildInfo = typeof __BUILD__ !== 'undefined' ? __BUILD__ : { id: 'dev', sha: null, date: null, dirty: false };

/** "2026.11.25 · 55b37e4" (with "+" when built from uncommitted changes), or "dev". */
export function buildLabel(b: BuildInfo = BUILD): string {
  if (b.id === 'dev' || !b.date) return b.id;
  return b.sha ? `${b.date} · ${b.sha.slice(0, 7)}${b.dirty ? '+' : ''}` : b.id;
}

/**
 * What the deployed build is compared with this one: 'same' (this build), the newer deploy's ID, or null when the
 * answer can't be read (it changes nothing).
 */
export function compareDeploy(currentId: string, fetched: unknown): 'same' | string | null {
  if (currentId === 'dev') return null;
  const id = fetched && typeof fetched === 'object' ? (fetched as { id?: unknown }).id : undefined;
  if (typeof id !== 'string' || !id || id.length > 64) return null;
  return id === currentId ? 'same' : id;
}

/** The deployed build's ID when it's another build than this one, else null. */
export function newerDeploy(currentId: string, fetched: unknown): string | null {
  const c = compareDeploy(currentId, fetched);
  return c === 'same' ? null : c;
}

interface UpdateState {
  /** The newer deploy's build ID, once one is seen. */
  available: string | null;
}
export const useUpdateStore = create<UpdateState>(() => ({ available: null }));

const CHECK_EVERY_MS = 10 * 60 * 1000;

/** Fetch the deployed build ID and note a newer one (quietly: offline or a failed fetch changes nothing). */
export async function checkForUpdate(fetchImpl: typeof fetch = fetch, currentId: string = BUILD.id): Promise<string | null> {
  try {
    const res = await fetchImpl(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const c = compareDeploy(currentId, await res.json());
    if (c === null) return null;
    // The deployed build is this one: nothing to offer (a chunk-load blip that wasn't a deploy, or a rollback).
    if (c === 'same') {
      if (useUpdateStore.getState().available !== null) useUpdateStore.setState({ available: null });
      return null;
    }
    if (c !== useUpdateStore.getState().available) useUpdateStore.setState({ available: c });
    return c;
  } catch {
    return null;
  }
}

let started = false;

/** Start checking (production builds only; once). */
export function startUpdateChecks(): void {
  if (started || BUILD.id === 'dev' || typeof window === 'undefined') return;
  started = true;
  setInterval(() => void checkForUpdate(), CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  });
  window.addEventListener('online', () => void checkForUpdate());
  // A new service worker taking control is a new deploy (or the first install): check rather than assume.
  navigator.serviceWorker?.addEventListener('controllerchange', () => void checkForUpdate());
}
