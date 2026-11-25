/**
 * ADS-B traffic checks: decoding ADSB_VEHICLE (frames packed by pymavlink), skipping obstacles and invalid
 * positions, report age, emergency squawks, and threat levels (range, vertical separation, closest approach).
 *
 * Run: npx tsx tests/adsb.test.ts
 */
export {};
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
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
check(
  'decoded: ICAO, position, altitude',
  t &&
    a.icaoHex(t.icao) === 'A1B2C3' &&
    Math.abs(t.lat - 35.01) < 1e-7 &&
    Math.abs(t.lon + 106.02) < 1e-7 &&
    Math.abs(t.altMslM! - 1750.5) < 1e-6,
  JSON.stringify(t)
);
check(
  'decoded: heading, speed, climb, callsign, squawk, emitter, geometric',
  t.headingDeg === 270 &&
    t.speedMs === 61.5 &&
    t.climbMs === -2.5 &&
    t.callsign === 'N123AB' &&
    t.squawk === 7700 &&
    t.emitterType === 3 &&
    t.altGeometric
);
check('report age from tslc', t.heardAtMs === now - 1000);
const o = frame('fd250000000101f60000050000008093dc1400afd1c00000000000000000000000007800004f415f444200000000ffcc3a');
check(
  'obstacle-database item (OA_DB) is not traffic',
  a.trafficFromMessage(decodePayload(o.messageId, o.payload), now) === null
);
check('no valid position: not traffic', a.trafficFromMessage({ ...d, flags: d.flags & ~1 }, now) === null);
check(
  'missing heading/velocity flags: unknown, not zero',
  (() => {
    const x = a.trafficFromMessage({ ...d, flags: 1 }, now)!;
    return x.headingDeg === null && x.speedMs === null && x.altMslM === null && x.callsign === null;
  })()
);
check(
  'callsign cleaned: printable, no HTML characters',
  a.cleanCallsign('N1<b>2\x01\"') === 'N1b2' && a.cleanCallsign('   ') === null && a.cleanCallsign(undefined) === null
);
check('HTML escaped for labels', a.escapeHtml('<img src=x onerror=1>') === '&lt;img src=x onerror=1&gt;');
check(
  'emergency squawks',
  a.emergencySquawk(7700) === 'emergency' &&
    a.emergencySquawk(7600) === 'radio failure' &&
    a.emergencySquawk(1200) === null
);

// Store: newer report wins, expiry
{
  const s = useTrafficStore.getState();
  s.clear();
  s.upsert(t);
  s.upsert({ ...t, lat: 35.5, heardAtMs: t.heardAtMs - 5000 });
  check("an older report doesn't replace a newer one", useTrafficStore.getState().aircraft[t.icao].lat === t.lat);
  s.prune(now + a.TRAFFIC_EXPIRE_MS + 2000);
  check('expired reports dropped', Object.keys(useTrafficStore.getState().aircraft).length === 0);
}

// Threats
{
  const own = { lat: 35, lon: -106, altMslM: 1700, velN: 0, velE: 0 };
  const at = (dn: number, de: number, o: Partial<typeof t> = {}) => ({
    ...t,
    lat: 35 + dn / 111195,
    lon: -106 + de / (111195 * Math.cos((35 * Math.PI) / 180)),
    headingDeg: null,
    speedMs: null,
    climbMs: null,
    ...o,
  });
  const lv = (x: any, ow: any = own) => a.assessThreat(x, ow).level;
  check('far away: none', lv(at(8000, 0, { altMslM: 1700 })) === 'none');
  check('2 km, same height: caution', lv(at(2000, 0, { altMslM: 1750 })) === 'caution');
  check('800 m, 100 m above: alert', lv(at(800, 0, { altMslM: 1800 })) === 'alert');
  check('800 m but 1000 m above: none', lv(at(800, 0, { altMslM: 2700 })) === 'none');
  check("altitude unknown close by: alert (can't rule it out)", lv(at(800, 0, { altMslM: null })) === 'alert');
  const head = at(2500, 0, { altMslM: 1720, headingDeg: 180, speedMs: 60 });
  const th = a.assessThreat(head, own);
  check(
    '2.5 km away, heading straight at us at 60 m/s: alert (closest approach in ~42 s)',
    th.level === 'alert' && th.closing && Math.abs(th.cpaS! - 41.7) < 1 && th.cpaM! < 1,
    JSON.stringify(th)
  );
  check(
    'same, flying away: caution only',
    lv(at(2500, 0, { altMslM: 1720, headingDeg: 0, speedMs: 60 })) === 'caution'
  );
  check(
    'passing 1.5 km to the side: no CPA alert',
    lv(at(2500, 1500, { altMslM: 1720, headingDeg: 180, speedMs: 60 })) === 'caution'
  );
  check(
    'descending onto our level by closest approach: alert',
    lv(at(2500, 0, { altMslM: 1900, headingDeg: 180, speedMs: 60, climbMs: -4 })) === 'alert'
  );
  check(
    'level with us now but climbing away by closest approach: no closest-approach alert (caution)',
    lv(at(2500, 0, { altMslM: 1700, headingDeg: 180, speedMs: 60, climbMs: 8 })) === 'caution'
  );
  // 2.9 km away (inside caution range), 400 m above (outside caution vertical) and descending to our level by its closest
  // approach in 25 s, which passes 2.5 km to the side: the range checks use the separation now, so not a caution.
  check(
    '400 m above now, descending to our level by a distant closest approach: not a caution',
    lv(at(1500, 2500, { altMslM: 2100, headingDeg: 180, speedMs: 60, climbMs: -16 })) === 'none'
  );
  check(
    'bearing and compass point',
    Math.round(a.assessThreat(at(1000, 1000), own).bearingDeg) === 45 && a.compassPoint(45) === 'NE'
  );
}

// The map label's relative height follows the user's units.
{
  const { useUnitsStore } = await import('../src/store/unitsStore.ts');
  const label = (relAltM: number, climb: number | null) =>
    a.relAltText(relAltM, climb, useUnitsStore.getState().formatAltitude);
  useUnitsStore.getState().setSystem('kmh');
  const metric = label(49.9, -2.5);
  useUnitsStore.getState().setSystem('kts');
  const kts = label(49.9, -2.5);
  useUnitsStore.getState().setSystem('mph');
  const mph = label(-30.48, 3);
  check(
    'relative height: metres for km/h, feet for knots and mph',
    metric === '+50 m ↓' && kts === '+164 ft ↓' && mph === '−100 ft ↑',
    `${metric} / ${kts} / ${mph}`
  );
  check(
    'vertical speed in the popup: the climb formatter (fpm when imperial)',
    useUnitsStore.getState().formatClimb(2.54).full === '+500 fpm'
  );
}

// Configurable thresholds
{
  const own = { lat: 35, lon: -106, altMslM: 1700, velN: 0, velE: 0 };
  const at = (dn: number, alt: number) => ({
    ...t,
    lat: 35 + dn / 111195,
    lon: -106,
    headingDeg: null,
    speedMs: null,
    climbMs: null,
    altMslM: alt,
  });
  const th = { ...a.DEFAULT_THRESHOLDS, cautionRangeM: 5000, alertRangeM: 2000, alertVerticalM: 300 };
  check('defaults: 2.5 km away is caution', a.assessThreat(at(2500, 1700), own).level === 'caution');
  check(
    'wider alert range: 1.5 km away is an alert',
    a.assessThreat(at(1500, 1700), own, th).level === 'alert' && a.assessThreat(at(1500, 1700), own).level === 'caution'
  );
  check(
    'wider caution range: 4 km away is a caution',
    a.assessThreat(at(4000, 1700), own, th).level === 'caution' && a.assessThreat(at(4000, 1700), own).level === 'none'
  );
  check(
    'larger alert vertical: 250 m above, 800 m away is an alert',
    a.assessThreat(at(800, 1950), own, th).level === 'alert' && a.assessThreat(at(800, 1950), own).level === 'caution'
  );
  const shortHorizon = { ...a.DEFAULT_THRESHOLDS, cpaHorizonS: 20 };
  const head = { ...at(2500, 1720), headingDeg: 180, speedMs: 60 };
  check(
    'shorter look-ahead: closest approach in 42 s no longer alerts',
    a.assessThreat(head, own).level === 'alert' && a.assessThreat(head, own, shortHorizon).level === 'caution'
  );

  const { useAdsbSettingsStore, clampThresholds } = await import('../src/store/adsbSettingsStore.ts');
  check(
    'out-of-range values are clamped, not taken as zero',
    clampThresholds({ alertRangeM: 0, cautionRangeM: -5, cpaHorizonS: 99999 }).alertRangeM === 50 &&
      clampThresholds({ cautionRangeM: -5 }).cautionRangeM === 50 &&
      clampThresholds({ cpaHorizonS: 99999 }).cpaHorizonS === 600
  );
  check(
    'garbage keeps the default',
    clampThresholds({ alertRangeM: NaN }).alertRangeM === a.DEFAULT_THRESHOLDS.alertRangeM
  );
  const st = useAdsbSettingsStore.getState();
  st.setThresholds({ alertRangeM: 1500 });
  st.setShowOnMap(false);
  st.setWarnings(false);
  const saved = JSON.parse(mem.get('mavlink_glareshield_adsb')!);
  check(
    'settings saved',
    saved.thresholds.alertRangeM === 1500 &&
      saved.showOnMap === false &&
      saved.warnings === false &&
      saved.thresholds.cautionRangeM === 3000
  );
  const fresh = await import('../src/store/adsbSettingsStore.ts?reload=1' as string);
  const r = fresh.useAdsbSettingsStore.getState();
  check('settings restored on reload', r.thresholds.alertRangeM === 1500 && !r.showOnMap && !r.warnings);
  st.resetThresholds();
  check('restore defaults', useAdsbSettingsStore.getState().thresholds.alertRangeM === 1000);
}

// Announcing
{
  const ann = new Map<number, number>();
  const T = (icao: number, level: string) => ({ icao, level }) as any;
  check(
    'new alert announced; caution not',
    a.trafficToAnnounce([T(1, 'alert'), T(2, 'caution')], ann, 0).join() === '1'
  );
  check('still at alert 5 s later: quiet', a.trafficToAnnounce([T(1, 'alert')], ann, 5000).length === 0);
  check('still at alert 20 s later: repeated', a.trafficToAnnounce([T(1, 'alert')], ann, 20_000).join() === '1');
  a.trafficToAnnounce([T(1, 'caution')], ann, 21_000);
  check(
    'drops to caution then back to alert: announced again at once',
    a.trafficToAnnounce([T(1, 'alert')], ann, 22_000).join() === '1'
  );
}

console.log(failures.length ? `\n${failures.length} ADS-B check(s) FAILED` : '\nAll ADS-B checks PASSED');
process.exit(failures.length ? 1 : 0);
