/**
 * ADS-B traffic checks: decoding ADSB_VEHICLE (frames packed by pymavlink), skipping obstacles and invalid
 * positions, report age, emergency squawks, and threat levels (range, vertical separation, closest approach).
 *
 * Run: npx tsx tests/adsb.test.ts
 */
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { MavlinkParser, decodePayload } = await import('../src/mavlink/parser.ts');
const a = await import('../src/mavlink/adsb.ts');
const { useTrafficStore } = await import('../src/store/trafficStore.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}
const frame = (hex: string) => new MavlinkParser().parse(Uint8Array.from(Buffer.from(hex, 'hex')))[0];
const now = 1_800_000_000_000;

// pymavlink: ICAO A1B2C3 at 35.01, -106.02, 1750.5 m, heading 270, 61.5 m/s, descending 2.5 m/s, N123AB, squawk 7700,
// emitter 3 (large), tslc 1 s. And an obstacle-database item (callsign OA_DB, emitter 255, no flags).
const p = frame('fd260000000101f60000c3b2a100201ade14c0a1cec0e4b51a007869061806ffbf00141e014e31323341420000000301f7ca');
const d = p && decodePayload(p.messageId, p.payload);
check('frame parsed (CRC seed known)', p?.messageId === 246);
const t = a.trafficFromMessage(d, now)!;
check('decoded: ICAO, position, altitude', t && a.icaoHex(t.icao) === 'A1B2C3' && Math.abs(t.lat - 35.01) < 1e-7 && Math.abs(t.lon + 106.02) < 1e-7 && Math.abs(t.altMslM! - 1750.5) < 1e-6, JSON.stringify(t));
check('decoded: heading, speed, climb, callsign, squawk, emitter, geometric', t.headingDeg === 270 && t.speedMs === 61.5 && t.climbMs === -2.5 && t.callsign === 'N123AB' && t.squawk === 7700 && t.emitterType === 3 && t.altGeometric);
check('report age from tslc', t.heardAtMs === now - 1000);
const o = frame('fd250000000101f60000050000008093dc1400afd1c00000000000000000000000007800004f415f444200000000ffcc3a');
check('obstacle-database item (OA_DB) is not traffic', a.trafficFromMessage(decodePayload(o.messageId, o.payload), now) === null);
check('no valid position: not traffic', a.trafficFromMessage({ ...d, flags: d.flags & ~1 }, now) === null);
check('missing heading/velocity flags: unknown, not zero', (() => { const x = a.trafficFromMessage({ ...d, flags: 1 }, now)!; return x.headingDeg === null && x.speedMs === null && x.altMslM === null && x.callsign === null; })());
check('emergency squawks', a.emergencySquawk(7700) === 'emergency' && a.emergencySquawk(7600) === 'radio failure' && a.emergencySquawk(1200) === null);

// Store: newer report wins, expiry
{
  const s = useTrafficStore.getState();
  s.clear();
  s.upsert(t);
  s.upsert({ ...t, lat: 35.5, heardAtMs: t.heardAtMs - 5000 });
  check('an older report doesn\'t replace a newer one', useTrafficStore.getState().aircraft[t.icao].lat === t.lat);
  s.prune(now + a.TRAFFIC_EXPIRE_MS + 2000);
  check('expired reports dropped', Object.keys(useTrafficStore.getState().aircraft).length === 0);
}

// Threats
{
  const own = { lat: 35, lon: -106, altMslM: 1700, velN: 0, velE: 0 };
  const at = (dn: number, de: number, o: Partial<typeof t> = {}) => ({ ...t, lat: 35 + dn / 111195, lon: -106 + de / (111195 * Math.cos(35 * Math.PI / 180)), headingDeg: null, speedMs: null, climbMs: null, ...o });
  const lv = (x: any, ow: any = own) => a.assessThreat(x, ow).level;
  check('far away: none', lv(at(8000, 0, { altMslM: 1700 })) === 'none');
  check('2 km, same height: caution', lv(at(2000, 0, { altMslM: 1750 })) === 'caution');
  check('800 m, 100 m above: alert', lv(at(800, 0, { altMslM: 1800 })) === 'alert');
  check('800 m but 1000 m above: none', lv(at(800, 0, { altMslM: 2700 })) === 'none');
  check('altitude unknown close by: alert (can\'t rule it out)', lv(at(800, 0, { altMslM: null })) === 'alert');
  const head = at(2500, 0, { altMslM: 1720, headingDeg: 180, speedMs: 60 });
  const th = a.assessThreat(head, own);
  check('2.5 km away, heading straight at us at 60 m/s: alert (closest approach in ~42 s)', th.level === 'alert' && th.closing && Math.abs(th.cpaS! - 41.7) < 1 && th.cpaM! < 1, JSON.stringify(th));
  check('same, flying away: caution only', lv(at(2500, 0, { altMslM: 1720, headingDeg: 0, speedMs: 60 })) === 'caution');
  check('passing 1.5 km to the side: no CPA alert', lv(at(2500, 1500, { altMslM: 1720, headingDeg: 180, speedMs: 60 })) === 'caution');
  check('descending onto our level by closest approach: alert', lv(at(2500, 0, { altMslM: 1900, headingDeg: 180, speedMs: 60, climbMs: -4 })) === 'alert');
  check('bearing and compass point', Math.round(a.assessThreat(at(1000, 1000), own).bearingDeg) === 45 && a.compassPoint(45) === 'NE');
}

// Announcing
{
  const ann = new Map<number, number>();
  const T = (icao: number, level: string) => ({ icao, level }) as any;
  check('new alert announced; caution not', a.trafficToAnnounce([T(1, 'alert'), T(2, 'caution')], ann, 0).join() === '1');
  check('still at alert 5 s later: quiet', a.trafficToAnnounce([T(1, 'alert')], ann, 5000).length === 0);
  check('still at alert 20 s later: repeated', a.trafficToAnnounce([T(1, 'alert')], ann, 20_000).join() === '1');
  a.trafficToAnnounce([T(1, 'caution')], ann, 21_000);
  check('drops to caution then back to alert: announced again at once', a.trafficToAnnounce([T(1, 'alert')], ann, 22_000).join() === '1');
}

console.log(failures.length ? `\n${failures.length} ADS-B check(s) FAILED` : '\nAll ADS-B checks PASSED');
process.exit(failures.length ? 1 : 0);
