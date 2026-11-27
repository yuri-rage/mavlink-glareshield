// Pairing a device with a bridge that needs a token (bridge/bridge.py --token; the Docker bridge by default).
//
// The bridge's QR code opens the app as https://<app>/#link=<ws(s)://host:port/?token=…>: the link rides in the
// hash, which the browser never sends to the app's server. Over TLS the QR first opens the bridge's own /pair page
// (the scan is also the phone's one-time acceptance of its self-signed certificate), which checks the token and
// redirects here. The app asks before connecting, so a link can't silently point it at someone else's bridge.

/** WebSocket close codes the bridge sends for a missing or wrong token (bridge.py CLOSE_TOKEN_*). */
export const CLOSE_TOKEN_MISSING = 4001;
export const CLOSE_TOKEN_WRONG = 4003;

export function pairingCloseMessage(code: number | undefined): string | null {
  if (code === CLOSE_TOKEN_MISSING) {
    return "This bridge needs a pairing token. Scan the QR code in the bridge's log (docker compose logs), or use its link ending in ?token=…";
  }
  if (code === CLOSE_TOKEN_WRONG) {
    return "Wrong pairing token for this bridge (it may have a new one). Pair this device again from the QR code in the bridge's log.";
  }
  return null;
}

/** The ws:// or wss:// link in a #link= hash, or null (none, or not a WebSocket URL). */
export function linkFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const link = params.get('link');
  if (!link) return null;
  try {
    const u = new URL(link);
    return u.protocol === 'ws:' || u.protocol === 'wss:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The pairing token in a link, or null. */
export function tokenOf(wsUrl: string): string | null {
  try {
    return new URL(wsUrl).searchParams.get('token');
  } catch {
    return null;
  }
}

/** host:port of a link, for asking before connecting. */
export function linkHost(wsUrl: string): string {
  try {
    return new URL(wsUrl).host;
  } catch {
    return wsUrl;
  }
}

/** The hosted web app: where a pairing link sends a phone when this page isn't on the web (the desktop app). */
export const WEB_APP_URL = 'https://glareshield.yurirage.com/';

/** The app address a pairing link should open on another device: this page's, or the hosted app's if it's not http(s). */
export function pairingAppUrl(href: string): string {
  return /^https?:/.test(href) ? href : WEB_APP_URL;
}

/**
 * What another device scans to pair with the bridge this link reaches (as the bridge's own QR code does): over
 * wss://, the bridge's /pair page (its certificate step); over ws://, straight to this app with the link.
 */
export function pairingUrl(wsUrl: string, appUrl: string): string | null {
  const token = tokenOf(wsUrl);
  if (!token) return null;
  let u: URL;
  try {
    u = new URL(wsUrl);
  } catch {
    return null;
  }
  if (u.protocol === 'wss:') return `https://${u.host}/pair?token=${encodeURIComponent(token)}`;
  if (u.protocol !== 'ws:') return null;
  const app = new URL(appUrl);
  return `${app.origin}${app.pathname}#link=${encodeURIComponent(u.toString())}`;
}

export interface PairingLinkDeps {
  hash: string;
  /** Takes the hash out of the address bar (it holds the token): history.replaceState. */
  clearHash: () => void;
  ask: (req: { title: string; message: string[]; confirmLabel: string }) => Promise<boolean>;
  /** The link in use now, if any (to say it is replaced). */
  currentUrl: string | null;
  /** Save and connect to the link. */
  use: (wsUrl: string) => void;
}

/**
 * A pairing link in the address (#link=…): out of the address bar at once, then asked about, then used. Resolves
 * with the link used, or null (none, declined, or already the one in use).
 */
export async function acceptPairingLink(d: PairingLinkDeps): Promise<string | null> {
  if (!/(^#|&)link=/.test(d.hash)) return null;
  d.clearHash();
  const link = linkFromHash(d.hash);
  if (!link || link === d.currentUrl) return null; // nothing to change: this device is paired already
  const host = linkHost(link);
  const replacing = d.currentUrl && d.currentUrl !== link ? linkHost(d.currentUrl) : null;
  const ok = await d.ask({
    title: 'Connect to this bridge?',
    message: [
      `This pairing link is for the bridge at ${host}.`,
      `Glareshield will connect to it and keep the link, with its pairing token, in this browser${
        replacing ? `, in place of ${replacing}` : ''
      }.`,
      'Only accept a link from your own bridge (its QR code or log).',
    ],
    confirmLabel: 'Connect',
  });
  if (!ok) return null;
  d.use(link);
  return link;
}

/** The link with its pairing token hidden (for showing on screen, e.g. while screen sharing): ?token=•••• */
export function maskToken(wsUrl: string): string {
  return wsUrl.replace(/([?&]token=)[^&#]*/, (_m, k: string) => `${k}••••••`);
}
