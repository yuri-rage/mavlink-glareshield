/**
 * Fence switch checks: the fence's state from SYS_STATUS and FENCE_STATUS, and what enabling it would put the
 * vehicle outside of (zones, home circle, max and min altitude).
 *
 * Run: npx tsx tests/fenceControl.test.ts
 */
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const c = await import('../src/mavlink/fenceControl.ts');
const fd = await import('../src/mavlink/fenceDraft.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}

const G = 1 << 20;
const now = 1_000_000;
const st = (o: Partial<Parameters<typeof c.vehicleFenceState>[0]>) =>
  c.vehicleFenceState({ sensorsPresent: 1, sensorsEnabled: 0, sensorsHealth: 0, fenceStatusAt: 0, fenceStatusBreached: false, nowMs: now, fenceType: 4, fenceAction: 1, hasZones: true, ...o });

check('present, enabled, healthy: on', st({ sensorsPresent: G, sensorsEnabled: G, sensorsHealth: G }).state === 'on');
check('present, not enabled: off', st({ sensorsPresent: G, sensorsHealth: G }).state === 'off');
check('enabled and unhealthy (breached): breach', st({ sensorsPresent: G, sensorsEnabled: G, sensorsHealth: 0 }).state === 'breach');
check('FENCE_STATUS breached: breach', st({ sensorsPresent: G, sensorsEnabled: G, sensorsHealth: G, fenceStatusAt: now - 500, fenceStatusBreached: true }).state === 'breach');
check('report only: SYS_STATUS says off, but a fresh FENCE_STATUS means on', st({ sensorsPresent: G, sensorsHealth: G, fenceAction: 0, fenceStatusAt: now - 800 }).state === 'on' && st({ fenceAction: 0 }).reportOnly);
check('stale FENCE_STATUS doesn\'t count', st({ sensorsPresent: G, sensorsHealth: G, fenceStatusAt: now - 10_000 }).state === 'off');
check('polygons only, none loaded: nothing to enforce', st({ hasZones: false, sensorsPresent: 1 }).state === 'none');
check('altitude fence configured, no zones: types without polygons', st({ hasZones: false, fenceType: 5, sensorsPresent: G, sensorsHealth: G }).types === 1);
check('no SYS_STATUS yet: unknown', st({ sensorsPresent: 0 }).state === 'unknown');
check('type names', c.fenceTypeNames(15).join(', ') === 'zones, home circle, max altitude, min altitude');

// Enabling: what the vehicle would be outside of
{
  const H = { lat: 35, lon: -106 };
  const fence = fd.addShape(fd.EMPTY_FENCE, { kind: 'circle', inclusion: false, center: H, radius: 40 }).draft;
  const base = { types: 15, fence, position: H, relAlt: 20, homeDistanceM: 0, fenceRadius: 300, altMax: 100, altMin: 10 };
  const b = (o: any) => c.fenceEnableBreaches({ ...base, ...o });
  check('inside a new exclusion zone', b({}).some((r) => /exclusion circle F1/.test(r)));
  check('clear of everything: nothing', b({ fence: fd.EMPTY_FENCE }).length === 0);
  check('outside the home circle', b({ fence: fd.EMPTY_FENCE, homeDistanceM: 350 }).some((r) => /home circle/.test(r)));
  check('above max altitude', b({ fence: fd.EMPTY_FENCE, relAlt: 120 }).some((r) => /FENCE_ALT_MAX/.test(r)));
  check('below min altitude (e.g. on the ground)', b({ fence: fd.EMPTY_FENCE, relAlt: 0 }).some((r) => /FENCE_ALT_MIN/.test(r)));
  check('types not enforced are not checked', c.fenceEnableBreaches({ ...base, types: c.FENCE_TYPE_ALT_MAX, relAlt: 0 }).length === 0);
  check('unknown position/home/params skip those checks', c.fenceEnableBreaches({ ...base, position: null, relAlt: null, homeDistanceM: null }).length === 0);
}

// FENCE_STATUS reaches the store (it must be on the store's list of handled messages, or it is dropped unread).
{
  const { useTelemetryStore } = await import('../src/store/telemetryStore.ts');
  const payload = new Uint8Array(9);
  const v = new DataView(payload.buffer);
  v.setUint32(0, 12345, true); // breach_time
  v.setUint16(4, 3, true); // breach_count
  payload[6] = 1; // breach_status
  payload[7] = 2; // max altitude
  useTelemetryStore.getState().processPacket({ version: 2, sequence: 0, systemId: 1, componentId: 1, messageId: 162, payload, crc: 0, raw: new Uint8Array() } as any);
  const fs = useTelemetryStore.getState().fenceStatus;
  check('FENCE_STATUS decoded into the store', fs.breached && fs.breachCount === 3 && fs.breachType === 2 && fs.receivedAt > 0, JSON.stringify(fs));
}

console.log(failures.length ? `\n${failures.length} fence control check(s) FAILED` : '\nAll fence control checks PASSED');
process.exit(failures.length ? 1 : 0);
