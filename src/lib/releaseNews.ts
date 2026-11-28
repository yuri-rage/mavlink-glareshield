// What's new after the desktop app updates itself: once per new version, a short banner lists the changes from that
// version's GitHub Release (written by scripts/release-notes.sh), with a link to the full notes. It can be turned off
// (Settings → About). The web app deploys several times a day without version tags, so it shows nothing on its own:
// About links to the latest release instead.
//
// The first run of an install isn't an update: it only records the version. A version older than the last one seen
// (a downgrade) shows nothing either. Offline, the banner still says which version this is, with the link.

import { create } from 'zustand';

import { desktopApi } from '../desktop/api';
import { REPO_URL } from './links';

const KEY = 'mavlink_glareshield_release_news';
const API = 'https://api.github.com/repos/yuri-rage/mavlink-glareshield/releases/tags/';

export const releaseUrl = (version: string) => `${REPO_URL}/releases/tag/v${version}`;
export const LATEST_RELEASE_URL = `${REPO_URL}/releases/latest`;

/** -1, 0 or 1, comparing dotted numeric versions ("0.10.0" after "0.9.2"); a pre-release suffix is ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .replace(/^v/, '')
      .split(/[-+]/)[0]
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Whether `current` is news to someone who last saw `lastSeen` (null: never ran before, so not an update). */
export function isNews(current: string, lastSeen: string | null): boolean {
  return lastSeen !== null && compareVersions(current, lastSeen) > 0;
}

/**
 * The changes listed in a release's notes: the "- Title (#N)" lines the notes script writes (inside a <details> when
 * there are many). Markdown code ticks are dropped; nothing else in the notes is read.
 */
export function parseReleaseChanges(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((l) => /^[-*] (.+\(#\d+\))\s*$/.exec(l)?.[1])
    .filter((t): t is string => Boolean(t))
    .map((t) => t.replace(/`/g, ''));
}

export interface ReleaseNews {
  version: string;
  /** The release's changes; empty when they couldn't be fetched (offline) or the notes list none. */
  changes: string[];
  url: string;
}

interface Saved {
  enabled: boolean;
  lastSeen: string | null;
}

function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (s && typeof s === 'object')
      return { enabled: s.enabled !== false, lastSeen: typeof s.lastSeen === 'string' ? s.lastSeen : null };
  } catch {
    // Unreadable: defaults.
  }
  return { enabled: true, lastSeen: null };
}

function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage blocked: it shows again next time, nothing worse.
  }
}

interface State extends Saved {
  /** The banner's content while it's showing. */
  news: ReleaseNews | null;
  setEnabled(on: boolean): void;
  /** The banner closed (dismissed or timed out): this version is seen. */
  dismiss(): void;
}

export const useReleaseNewsStore = create<State>((set, get) => ({
  ...load(),
  news: null,
  setEnabled(on) {
    set({ enabled: on, ...(on ? {} : { news: null }) });
    save({ enabled: on, lastSeen: get().lastSeen });
  },
  dismiss() {
    const news = get().news;
    if (!news) return;
    set({ news: null, lastSeen: news.version });
    save({ enabled: get().enabled, lastSeen: news.version });
  },
}));

/** The release's changes from GitHub, or [] when they can't be had (offline, rate limited, no such release). */
export async function fetchReleaseChanges(version: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  try {
    const res = await fetchImpl(`${API}v${encodeURIComponent(version)}`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return [];
    const json = await res.json();
    return typeof json?.body === 'string' ? parseReleaseChanges(json.body) : [];
  } catch {
    return [];
  }
}

/**
 * At startup: in the desktop app, after an update to a newer version, show what's new (once). Turned off, or on a
 * first run, the version is only recorded, so turning it back on later doesn't bring up an old version's news.
 */
export async function startReleaseNews(
  version: string | null = desktopApi()?.version ?? null,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  if (!version) return;
  const { enabled, lastSeen } = useReleaseNewsStore.getState();
  if (!enabled || !isNews(version, lastSeen)) {
    // Recorded only forward: after a downgrade, the newer version's news isn't shown again on the way back up.
    if (lastSeen === null || compareVersions(version, lastSeen) > 0) {
      useReleaseNewsStore.setState({ lastSeen: version });
      save({ enabled, lastSeen: version });
    }
    return;
  }
  const changes = await fetchReleaseChanges(version, fetchImpl);
  // Turned off while the notes were on their way: nothing to show.
  if (!useReleaseNewsStore.getState().enabled) return;
  useReleaseNewsStore.setState({ news: { version, changes, url: releaseUrl(version) } });
}
