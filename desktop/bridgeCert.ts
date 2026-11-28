// The desktop bridge's TLS certificate (desktop/bridgeServer.ts): self-signed, as the Docker bridge makes it
// (bridge/entrypoint.sh), for localhost, this computer's name and its LAN addresses. Phones load the hosted app over
// https, which may only open wss://, so the bridge needs one; each device accepts it once (the pairing QR's /pair
// page). Kept in the app's user data folder and reused, so devices don't have to accept it again, until it expires or
// this computer has an address it doesn't name.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { generate } from 'selfsigned';

export interface BridgeCert {
  key: string;
  cert: string;
  /** The names and addresses it's for. */
  names: string[];
  notAfter: number;
}

const VALID_DAYS = 365;
/** Renewed this long before it expires. */
const RENEW_MS = 14 * 24 * 3600 * 1000;

/** This computer's LAN IPv4 addresses (not loopback, not link-local). */
export function lanAddresses(): string[] {
  const out = new Set<string>();
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list ?? [])
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.add(a.address);
  return [...out].sort();
}

/** A hostname fit for a certificate (as entrypoint.sh's valid_name), or null. */
const plainName = (n: string) => (/^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(n) ? n : null);

export function certNames(hostname = os.hostname(), addresses = lanAddresses()): string[] {
  const host = plainName(hostname);
  const names = ['localhost', '127.0.0.1'];
  if (host && host !== 'localhost') names.push(host, `${host}.local`);
  return [...names, ...addresses];
}

const isIp = (n: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(n);

/** Whether a kept certificate still serves: not about to expire, and naming every one of `needed`. */
export function stillGood(c: BridgeCert | null, needed: string[], now = Date.now()): boolean {
  return !!c && c.notAfter - now > RENEW_MS && needed.every((n) => c.names.includes(n));
}

export async function makeCert(names: string[], now = Date.now()): Promise<BridgeCert> {
  const notAfter = now + VALID_DAYS * 24 * 3600 * 1000;
  const cn = names.find((n) => isIp(n) && n !== '127.0.0.1') ?? names[2] ?? 'localhost';
  const pems = await generate([{ name: 'commonName', value: cn }], {
    keyType: 'rsa',
    keySize: 2048,
    algorithm: 'sha256',
    notBeforeDate: new Date(now - 60_000),
    notAfterDate: new Date(notAfter),
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: names.map((n) => (isIp(n) ? { type: 7 as const, ip: n } : { type: 2 as const, value: n })),
      },
    ],
  });
  return { key: pems.private, cert: pems.cert, names, notAfter };
}

/** The kept certificate, or a new one (kept, the key readable only by this user) when it no longer serves. */
export async function ensureCert(dir: string, needed = certNames()): Promise<BridgeCert> {
  const file = path.join(dir, 'bridge-cert.json');
  let kept: BridgeCert | null = null;
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof c?.key === 'string' && typeof c?.cert === 'string' && Array.isArray(c?.names)) kept = c;
  } catch {
    // None yet, or unreadable: a new one.
  }
  if (kept && stillGood(kept, needed)) return kept;
  // Keep naming what the old one named too (an address that comes and goes doesn't make devices accept it again).
  const names = [...new Set([...needed, ...(kept?.names ?? [])])];
  const fresh = await makeCert(names);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(fresh), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return fresh;
}
