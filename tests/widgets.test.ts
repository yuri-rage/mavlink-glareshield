/**
 * Custom widget engine checks: dial / axis geometry, the binding value pipeline (store, message cache, multiplier,
 * offset, unit conversion, staleness, thresholds), the message cache's source filtering, the fixed-rate sampler,
 * chart scaling, command-ack wording, and sanitising imported widget JSON.
 *
 * Run: npx tsx tests/widgets.test.ts
 */
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const geo = await import('../src/lib/gaugeGeometry.ts');
const values = await import('../src/lib/widgetValues.ts');
const cache = await import('../src/lib/messageCache.ts');
const { valueSampler, SampleRing } = await import('../src/lib/valueSampler.ts');
const { computeYRange } = await import('../src/components/widgets/custom/TimeSeriesChart.tsx');
const { describeAck } = await import('../src/components/widgets/custom/panelModel.ts');
const { sanitizeWidgetDefinition, cleanBinding } = await import('../src/lib/widgetValidation.ts');
const { MAVLINK_MSG_ID } = await import('../src/mavlink/messages.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

// ------------------------------------------------------------------------------------------------
// A. Geometry
// ------------------------------------------------------------------------------------------------
check('valueToAngle: min and max sit at the ends of a 240° sweep', geo.valueToAngle(0, 0, 100, 240) === -120 && geo.valueToAngle(100, 0, 100, 240) === 120);
check('valueToAngle: midpoint is 12 o\'clock', geo.valueToAngle(50, 0, 100, 240) === 0);
check('valueToAngle: out-of-range values pin to the ends', geo.valueToAngle(-5, 0, 100, 270) === -135 && geo.valueToAngle(500, 0, 100, 270) === 135);
check('valueToAngle: a non-finite value or empty range rests at the start', geo.valueToAngle(NaN, 0, 100, 180) === -90 && geo.valueToAngle(5, 3, 3, 180) === -90);
{
  const p = geo.polar(100, 100, 50, 90);
  check('polar: 90° is 3 o\'clock', near(p.x, 150) && near(p.y, 100));
  check('arcPath: a sweep over 180° sets the large-arc flag', geo.arcPath(100, 100, 50, -120, 120).includes(' 0 1 1 ') && geo.arcPath(100, 100, 50, -45, 45).includes(' 0 0 1 '));
}
check('niceTicks: 0..100 in ~5 steps → 0,20,...,100', JSON.stringify(geo.niceTicks(0, 100, 5)) === JSON.stringify([0, 20, 40, 60, 80, 100]));
check('niceTicks: 13..17 in ~6 steps lands on round numbers', JSON.stringify(geo.niceTicks(13, 17, 6)) === JSON.stringify([13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17]) || JSON.stringify(geo.niceTicks(13, 17, 6)) === JSON.stringify([13, 14, 15, 16, 17]), JSON.stringify(geo.niceTicks(13, 17, 6)));
check('niceTicks: -3..3 includes zero', geo.niceTicks(-3, 3, 5).includes(0));
check('niceStep picks 1/2/2.5/5 × 10^n', geo.niceStep(0, 1, 4) === 0.25 && geo.niceStep(0, 1000, 5) === 200 && geo.niceStep(0, 7, 2) === 5);
check('stepDecimals: 0.25 → 2, 5 → 0, 0.5 → 1', geo.stepDecimals(0.25) === 2 && geo.stepDecimals(5) === 0 && geo.stepDecimals(0.5) === 1);
{
  const z = geo.thresholdZones({ messageName: 'X', fieldName: 'y', warnThreshold: 60, critThreshold: 80 }, 0, 100);
  check('thresholdZones: normal < warn < crit going up', JSON.stringify(z.map((x) => [x.from, x.to, x.level])) === JSON.stringify([[0, 60, 'normal'], [60, 80, 'warn'], [80, 100, 'crit']]));
  const inv = geo.thresholdZones({ messageName: 'X', fieldName: 'y', warnThreshold: 14.8, critThreshold: 14.2, thresholdInvert: true }, 13, 17);
  check('thresholdZones: inverted (voltage) puts crit at the bottom', JSON.stringify(inv.map((x) => x.level)) === JSON.stringify(['crit', 'warn', 'normal']) && inv[0].from === 13 && inv[0].to === 14.2 && inv[2].to === 17);
  const warnOnly = geo.thresholdZones({ messageName: 'X', fieldName: 'y', warnThreshold: 50 }, 0, 100);
  check('thresholdZones: a warn threshold alone gives normal + warn', JSON.stringify(warnOnly.map((x) => x.level)) === JSON.stringify(['normal', 'warn']));
  check('thresholdZones: no thresholds, no zones', geo.thresholdZones({ messageName: 'X', fieldName: 'y' }, 0, 100).length === 0);
  const clipped = geo.thresholdZones({ messageName: 'X', fieldName: 'y', critThreshold: 150 }, 0, 100);
  check('thresholdZones: a threshold beyond max is clipped to the scale', clipped.length === 1 && clipped[0].level === 'normal' && clipped[0].to === 100);
}

{
  const a = 232 / 158;
  check('bestGridColumns: one dial is one column', geo.bestGridColumns(1, 400, 300, a, 16) === 1);
  check('bestGridColumns: 4 dials in a wide, short card go 4 across', geo.bestGridColumns(4, 900, 220, a, 16) === 4);
  check('bestGridColumns: 4 dials in a squarer card go 2 × 2', geo.bestGridColumns(4, 440, 420, a, 16) === 2);
  check('bestGridColumns: 3 dials in a tall narrow card stack', geo.bestGridColumns(3, 300, 700, a, 16) === 1);
  check('bestGridColumns: unknown size falls back to one column', geo.bestGridColumns(5, 0, 0, a) === 1);
}

// ------------------------------------------------------------------------------------------------
// B. Message cache and value pipeline
// ------------------------------------------------------------------------------------------------
cache.resetMessageCache();
function hb(sysid: number, compid: number, type: number, autopilot: number) {
  const payload = new Uint8Array(9);
  payload[4] = type;
  payload[5] = autopilot;
  return { version: 2 as const, sequence: 0, systemId: sysid, componentId: compid, messageId: MAVLINK_MSG_ID.HEARTBEAT, payload, crc: 0, raw: new Uint8Array() };
}
function vfr(sysid: number, airspeed: number, groundspeed: number, alt: number) {
  const payload = new Uint8Array(20);
  const dv = new DataView(payload.buffer);
  dv.setFloat32(0, airspeed, true);
  dv.setFloat32(4, groundspeed, true);
  dv.setFloat32(8, alt, true);
  dv.setFloat32(12, 1.5, true);
  dv.setInt16(16, 90, true);
  dv.setInt16(18, 40, true);
  return { version: 2 as const, sequence: 0, systemId: sysid, componentId: 1, messageId: MAVLINK_MSG_ID.VFR_HUD, payload, crc: 0, raw: new Uint8Array() };
}
function radio(sysid: number, rssi: number) {
  const payload = new Uint8Array(9);
  payload[4] = rssi;
  payload[5] = rssi - 10;
  return { version: 2 as const, sequence: 0, systemId: sysid, componentId: 68, messageId: MAVLINK_MSG_ID.RADIO_STATUS, payload, crc: 0, raw: new Uint8Array() };
}
const T0 = 1_000_000;
cache.recordPacket(hb(1, 1, 2, 3), T0); // quadrotor, ArduPilot: vehicle is sysid 1
cache.recordPacket(hb(255, 190, 6, 8), T0); // another GCS
cache.recordPacket(hb(1, 154, 26, 3), T0); // gimbal on the vehicle
cache.recordPacket(vfr(1, 12, 10, 45), T0);
cache.recordPacket(vfr(2, 99, 99, 99), T0); // a different vehicle on the link
cache.recordPacket(radio(51, 180), T0); // SiK radio reports as its own system
check('messageCache: vehicle fields are cached', cache.getCachedField('VFR_HUD', 'groundspeed') === 10 && cache.getCachedField('VFR_HUD', 'alt') === 45);
check('messageCache: another system\'s telemetry does not overwrite the vehicle\'s', cache.getCachedField('VFR_HUD', 'airspeed') === 12);
check('messageCache: RADIO_STATUS from the radio\'s own system id is accepted', cache.getCachedField('RADIO_STATUS', 'rssi') === 180);
check('messageCache: GCS and gimbal heartbeats do not replace the autopilot\'s', cache.getCachedField('HEARTBEAT', 'type') === 2);
check('messageCache: the observed catalog lists received messages with their fields', (cache.getObservedCatalog().VFR_HUD ?? []).includes('groundspeed') && 'RADIO_STATUS' in cache.getObservedCatalog());
check('messageCache: "(scaled)" pseudo-messages resolve to the real message', cache.baseMessageName('RC_CHANNELS (scaled)') === 'RC_CHANNELS');

{
  const state = { vfr: {}, parameters: {} };
  const r = values.readBinding({ messageName: 'RADIO_STATUS', fieldName: 'remrssi', decimals: 0 }, state, 'ms', 3, T0 + 500);
  check('readBinding: a field only the cache has (RADIO_STATUS.remrssi) is readable', r.value === 170 && r.text === '170' && !r.stale, JSON.stringify(r));
  const spd = values.readBinding({ messageName: 'VFR_HUD', fieldName: 'groundspeed', unitKind: 'speed', decimals: 1 }, state, 'kts', 3, T0 + 500);
  check('readBinding: unitKind speed converts m/s to the chosen unit (10 m/s → 19.4 kts)', spd.text === '19.4' && spd.unit === 'kts' && spd.base === 10);
  const alt = values.readBinding({ messageName: 'VFR_HUD', fieldName: 'alt', unitKind: 'altitude', decimals: 0 }, state, 'mph', 3, T0 + 500);
  check('readBinding: unitKind altitude shows feet with imperial units (45 m → 148 ft)', alt.text === '148' && alt.unit === 'ft');
  const fixed = values.readBinding({ messageName: 'VFR_HUD', fieldName: 'alt', unit: 'm', unitKind: 'none', decimals: 1 }, state, 'mph', 3, T0 + 500);
  check('readBinding: without a unit kind the value and label are left alone', fixed.text === '45.0' && fixed.unit === 'm');
  const tempF = values.readBinding({ messageName: 'VFR_HUD', fieldName: 'groundspeed', multiplier: 1.8, offset: 32, decimals: 1 }, state, 'ms', 3, T0 + 500);
  check('readBinding: multiplier then offset (10 → 50.0, a °C→°F style conversion)', tempF.text === '50.0' && tempF.base === 50);
  const stale = values.readBinding({ messageName: 'VFR_HUD', fieldName: 'groundspeed' }, state, 'ms', 3, T0 + 3500);
  check('readBinding: a message older than the stale timeout is flagged stale', stale.stale && stale.ageMs === 3500);
  const fresh = values.readBinding({ messageName: 'VFR_HUD', fieldName: 'groundspeed' }, state, 'ms', 5, T0 + 3500);
  check('readBinding: the stale timeout is configurable', !fresh.stale);
  const unknown = values.readBinding({ messageName: 'WIND', fieldName: 'speed' }, state, 'ms', 3, T0);
  check('readBinding: a never-received message is unknown, not stale', unknown.value === null && unknown.text === '--' && !unknown.stale);
  const storeFirst = values.readBinding({ messageName: 'VFR_HUD', fieldName: 'groundspeed', decimals: 1 }, { vfr: { groundspeed: 3 } }, 'ms', 3, T0);
  check('readBinding: the telemetry store wins over the cache when it has the field', storeFirst.text === '3.0');
}
{
  const rcState = { rc: { channels: [1500, 65535, 1850], chancount: 16, rssi: 255 }, parameters: {} };
  const text = (b: any, st: any) => values.readBinding(b, st, 'ms', 5, Date.now()).text;
  check('readBinding: a raw RC channel shows whole microseconds by default', text({ messageName: 'RC_CHANNELS', fieldName: 'chan3_raw' }, rcState) === '1850');
  check('readBinding: …and the binding\'s own decimals when set', text({ messageName: 'RC_CHANNELS', fieldName: 'chan3_raw', decimals: 2 }, rcState) === '1850.00');
  check('readBinding: other fields keep one decimal by default', text({ messageName: 'ATTITUDE', fieldName: 'roll' }, { attitude: { roll: 1.25 } }) !== '1');
  check('readBinding: an unused RC channel reads "--"', text({ messageName: 'RC_CHANNELS', fieldName: 'chan2_raw' }, rcState) === '--');
  check('readBinding: RSSI 255 (unknown) reads "--"', text({ messageName: 'RC_CHANNELS', fieldName: 'rssi' }, rcState) === '--');
  check('resolveRawValue: scaled RC channel maps PWM to -1..1', values.resolveRawValue({ messageName: 'RC_CHANNELS (scaled)', fieldName: 'chan1_scaled' }, rcState) === 0);
  check('readBinding: multiplier and decimals apply to other fields', text({ messageName: 'ATTITUDE', fieldName: 'roll', multiplier: 2, decimals: 1 }, { attitude: { roll: 1.25 } }) === '2.5', text({ messageName: 'ATTITUDE', fieldName: 'roll', multiplier: 2, decimals: 1 }, { attitude: { roll: 1.25 } }));
}
check('evaluateAlert: rising thresholds', values.evaluateAlert(70, { messageName: 'X', fieldName: 'y', warnThreshold: 60, critThreshold: 80 }) === 'warn' && values.evaluateAlert(85, { messageName: 'X', fieldName: 'y', warnThreshold: 60, critThreshold: 80 }) === 'crit');
check('evaluateAlert: inverted thresholds (low voltage)', values.evaluateAlert(14.0, { messageName: 'X', fieldName: 'y', warnThreshold: 14.8, critThreshold: 14.2, thresholdInvert: true }) === 'crit');
check('evaluateAlert: unknown values never alert', values.evaluateAlert(null, { messageName: 'X', fieldName: 'y', warnThreshold: 0 }) === 'normal');
check('getAllBindings: primary first, then extras; empty ones dropped', values.getAllBindings({ binding: { messageName: 'A', fieldName: 'a' }, bindings: [{ messageName: 'B', fieldName: 'b' }, { messageName: '', fieldName: '' }] }).map((b) => b.messageName).join() === 'A,B');
check('getAllBindings: a saved pre-upgrade widget (binding only) still works', values.getAllBindings({ binding: { messageName: 'VFR_HUD', fieldName: 'alt' } }).length === 1);

// ------------------------------------------------------------------------------------------------
// C. Sampler
// ------------------------------------------------------------------------------------------------
{
  const ring = new SampleRing(4);
  for (let i = 0; i < 6; i++) ring.push(i * 100, i);
  check('SampleRing: wraps, keeping the newest samples in time order', ring.length === 4 && ring.at(0).v === 2 && ring.at(3).v === 5);
  check('SampleRing: lowerBound finds the first sample at or after a time', ring.lowerBound(350) === 2 && ring.lowerBound(0) === 0 && ring.lowerBound(9999) === 4);
}
{
  valueSampler.reset();
  let alt: number | undefined = 10;
  valueSampler.setStateGetter(() => ({ vfr: { test_only: alt } }));
  cache.recordPacket(vfr(1, 12, 10, 45), T0);
  const b = { messageName: 'VFR_HUD', fieldName: 'test_only', multiplier: 2 }; // a field only the store has
  const h1 = valueSampler.acquire(b);
  const h2 = valueSampler.acquire({ ...b });
  check('valueSampler: widgets bound to the same field share one series', h1.ring === h2.ring && valueSampler.refCount(h1.key) === 2);
  valueSampler.sampleNow(T0 + 100);
  alt = undefined;
  valueSampler.sampleNow(T0 + 200);
  alt = 12;
  valueSampler.sampleNow(T0 + 10_000); // message stale by now
  const r = h1.ring;
  check('valueSampler: stores base units (multiplier applied)', r.at(0).v === 20, String(r.at(0).v));
  check('valueSampler: a missing value is recorded as a gap', Number.isNaN(r.at(1).v));
  check('valueSampler: a stale message is recorded as a gap', Number.isNaN(r.at(2).v));
  check('valueSampler: a steady value still produces samples on the clock', r.length === 3 && r.at(2).t === T0 + 10_000);
  h1.release();
  h1.release(); // idempotent
  h2.release();
  check('valueSampler: releasing keeps the history but drops the subscriber', valueSampler.refCount(h1.key) === 0 && valueSampler.getRing(h1.key)?.length === 3);
  const before = r.length;
  valueSampler.sampleNow(T0 + 10_100);
  check('valueSampler: unsubscribed series are not sampled', r.length === before);
  valueSampler.reset();
}

// ------------------------------------------------------------------------------------------------
// D. Chart scaling, acks, import sanitising
// ------------------------------------------------------------------------------------------------
{
  const [lo, hi] = computeYRange(45, 45, 'auto', 0, 100);
  check('computeYRange: a steady value gets a narrow band around it, not a zero-height range', lo < 45 && hi > 45 && hi - lo < 5, `${lo}..${hi}`);
  const [zlo] = computeYRange(40, 50, 'zero', 0, 100);
  check('computeYRange: include-zero starts at zero for positive data', zlo === 0);
  const [nlo, nhi] = computeYRange(-8, -2, 'zero', 0, 100);
  check('computeYRange: include-zero ends at zero for negative data', nhi === 0 && nlo < -8);
  check('computeYRange: fixed uses the configured min/max', JSON.stringify(computeYRange(-500, 500, 'fixed', -10, 10)) === '[-10,10]');
  const [plo, phi] = computeYRange(-10, 10, 'auto', 0, 1);
  check('computeYRange: auto pads the data range', plo < -10 && phi > 10);
}
check('describeAck: accepted', describeAck({ command: 20, result: 0, resultText: 'ACCEPTED', time: 1 }).status === 'accepted');
check('describeAck: denied reads as a sentence', describeAck({ command: 20, result: 2, resultText: 'DENIED', time: 1 }).text === 'Denied');
check('describeAck: timeout and not-sent are distinguished', describeAck({ command: 20, result: -1, resultText: 'TIMEOUT', time: 1 }).text.includes('timeout') && describeAck({ command: 20, result: -2, resultText: 'NOT_SENT', time: 1 }).text.includes('link down'));
{
  const w = sanitizeWidgetDefinition({
    id: 'x',
    name: 'Imported',
    category: 'telemetry',
    displayType: 'bogus' as any,
    binding: { messageName: 'VFR_HUD', fieldName: 'alt', decimals: 42, min: Infinity as any, color: 'red; background:url(x)' } as any,
    bindings: Array.from({ length: 40 }, () => ({ messageName: 'VFR_HUD', fieldName: 'alt', color: '#ff0000' })),
    gauge: { sweep: 123 as any, style: 'needle', majorTicks: 99 },
    chart: { windowSec: 1e9, yScale: 'weird' as any },
    action: { label: 'RTL', commandId: 20, params: [0, 0, 0, 0, 0, 0, 0], confirmation: false },
  });
  check('sanitize: unknown display type falls back to a stat card', w.displayType === 'stat-card');
  check('sanitize: non-hex colours are dropped, hex kept', w.binding?.color === undefined && w.bindings?.[0].color === '#ff0000');
  check('sanitize: decimals and non-finite numbers are cleaned', w.binding?.decimals === 6 && w.binding?.min === undefined);
  check('sanitize: extra bindings are capped', (w.bindings?.length ?? 0) === 16);
  check('sanitize: gauge and chart options are clamped to valid values', w.gauge?.sweep === undefined && w.gauge?.style === 'needle' && w.gauge?.majorTicks === 12 && w.chart?.windowSec === 600 && w.chart?.yScale === undefined);
  check('sanitize: imported actions always require confirmation', w.action?.confirmation === true);
  const mb = sanitizeWidgetDefinition({ id: 'm', name: 'M', category: 'telemetry', displayType: 'multi-bar', multiBarConfig: { group: 'servo-8-scaled' } });
  check('sanitize: scaled multi-bar groups survive import (previously reset to rc-8)', mb.multiBarConfig?.group === 'servo-8-scaled');
  const saved = cleanBinding({ messageName: 'RPM', fieldName: 'rpm1', min: 0, max: 4000, unit: undefined, label: '' });
  check('cleanBinding keeps an extra gauge\'s own min / max (they were dropped, so gauge 2 used gauge 1\'s scale)', saved.min === 0 && saved.max === 4000 && !('unit' in saved) && !('label' in saved));
  const multi = sanitizeWidgetDefinition({ id: 'g2', name: 'G', category: 'telemetry', displayType: 'gauge-radial', gauge: { layout: 'multiple' },
    binding: { messageName: 'A', fieldName: 'a', min: -100, max: 100 }, bindings: [{ messageName: 'B', fieldName: 'b', min: 0, max: 4000 }] });
  check('sanitize: per-gauge ranges survive import', multi.bindings?.[0].min === 0 && multi.bindings?.[0].max === 4000 && multi.binding?.min === -100);
  const mg = sanitizeWidgetDefinition({ id: 'g', name: 'G', category: 'telemetry', displayType: 'gauge-radial', gauge: { layout: 'multiple' } });
  const bad = sanitizeWidgetDefinition({ id: 'g', name: 'G', category: 'telemetry', displayType: 'gauge-radial', gauge: { layout: 'grid' as any } });
  check('sanitize: gauge layout "multiple" is kept, unknown layouts dropped', mg.gauge?.layout === 'multiple' && bad.gauge?.layout === undefined);
  const vl = sanitizeWidgetDefinition({ id: 'v', name: 'V', category: 'telemetry', displayType: 'value-list' });
  check('sanitize: the new value-list type is accepted', vl.displayType === 'value-list');
}

// ------------------------------------------------------------------------------------------------
// Panel model: what a panel shows, its alert and staleness, and what its controls send
// ------------------------------------------------------------------------------------------------
{
  const pm = await import('../src/components/widgets/custom/panelModel.ts');
  const base = { id: 'p', name: 'P', category: 'telemetry' as const };
  const a = { messageName: 'VFR_HUD', fieldName: 'groundspeed', warnThreshold: 5, critThreshold: 8 };
  const b = { messageName: 'ATTITUDE', fieldName: 'rollDeg', warnThreshold: 20, critThreshold: 40 };
  const reading = (v: number | null, stale = false, ageMs = 0) => ({ base: v, value: v, text: String(v), unit: '', stale, ageMs });

  check('panelBindings: a stat card shows only its first value', pm.panelBindings({ ...base, displayType: 'stat-card', binding: a, bindings: [b] }).length === 1);
  check('panelBindings: a chart shows every value', pm.panelBindings({ ...base, displayType: 'sparkline', binding: a, bindings: [b] }).length === 2);
  check('panelBindings: control panels read no values', pm.panelBindings({ ...base, displayType: 'slider-control', binding: a }).length === 0);
  check('feedbackBinding: only toggles have one', pm.feedbackBinding({ ...base, displayType: 'toggle-switch', feedback: b }) === b && pm.feedbackBinding({ ...base, displayType: 'stat-card', feedback: b }) === undefined);

  const single = { ...base, displayType: 'gauge-radial' as const, binding: a, bindings: [b] };
  check('panelAlert: a single gauge alerts on its primary value only', pm.panelAlert(single, [a, b], [reading(1), reading(50)]) === 'normal');
  const multiG = { ...single, gauge: { layout: 'multiple' as const } };
  check('panelAlert: a multiple-gauge panel takes its worst gauge', pm.panelAlert(multiG, [a, b], [reading(1), reading(50)]) === 'crit' && pm.panelAlert(multiG, [a, b], [reading(6), reading(1)]) === 'warn');

  const st = pm.staleSummary([a, b], [reading(1, true, 4200), reading(2)]);
  check('staleSummary: counts stale readings, names their messages, reports the oldest', st.count === 1 && !st.all && st.messages.join() === 'VFR_HUD' && st.ageSec === 4);
  check('staleSummary: all stale dims the panel', pm.staleSummary([a], [reading(1, true)]).all);
  check('effectiveScheme: alerts override the panel colour', pm.effectiveScheme('crit', 'green') === 'red' && pm.effectiveScheme('normal', 'green') === 'green' && pm.effectiveScheme('normal', undefined) === 'default');

  const ids = pm.requiredMessageIds({ ...base, displayType: 'toggle-switch', feedback: { messageName: 'SERVO_OUTPUT_RAW', fieldName: 'servo9_raw' } });
  check('requiredMessageIds: includes a toggle\'s feedback message', ids.includes(MAVLINK_MSG_ID.SERVO_OUTPUT_RAW));
  check('requiredMessageIds: multi-bar uses its group\'s message', pm.requiredMessageIds({ ...base, displayType: 'multi-bar', multiBarConfig: { group: 'vibration-xyz' } })[0] === MAVLINK_MSG_ID.VIBRATION);
  check('requiredMessageIds: scaled pseudo-messages map to the real one', pm.requiredMessageIds({ ...base, displayType: 'stat-card', binding: { messageName: 'RC_CHANNELS (scaled)', fieldName: 'chan1_scaled' } })[0] === MAVLINK_MSG_ID.RC_CHANNELS);

  const p7 = [9, 0, 0, 0, 0, 0, 0];
  check('toggleParams: DO_SET_RELAY puts 1 / 0 in param2', pm.toggleParams(181, [2, 0, 0, 0, 0, 0, 0], true)[1] === 1 && pm.toggleParams(181, [2, 0, 0, 0, 0, 0, 0], false)[1] === 0);
  check('toggleParams: DO_SET_SERVO defaults to 1900 / 1100', pm.toggleParams(183, p7, true)[1] === 1900 && pm.toggleParams(183, p7, false)[1] === 1100);
  check('toggleParams: DO_SET_SERVO uses the configured ON / OFF PWM', pm.toggleParams(183, [9, 2000, 1000, 0, 0, 0, 0], true)[1] === 2000 && pm.toggleParams(183, [9, 2000, 1000, 0, 0, 0, 0], false)[1] === 1000);
  check('toggleParams: other commands put 1 / 0 in param1 and keep the rest', (() => { const o = pm.toggleParams(400, [0, 21196, 0, 0, 0, 0, 0], true); return o[0] === 1 && o[1] === 21196; })());
  check('toggleParams: does not modify the definition', p7[1] === 0);
  check('sliderParams: DO_CHANGE_SPEED / relay / servo take the value in param2', [178, 181, 183].every((c) => pm.sliderParams(c, p7, 3.5)[1] === 3.5));
  check('sliderParams: other commands take it in param1', pm.sliderParams(31010, p7, 42)[0] === 42);
}

// ------------------------------------------------------------------------------------------------
// Composite widgets: several panels in one card
// ------------------------------------------------------------------------------------------------
{
  const pm = await import('../src/components/widgets/custom/panelModel.ts');
  const { MAX_PANELS, MAX_COMPOSITE_BINDINGS } = await import('../src/lib/widgetValidation.ts');
  const gauge = { displayType: 'gauge-radial', title: 'Pressure', span: 6, binding: { messageName: 'SCALED_PRESSURE', fieldName: 'press_diff', min: 0, max: 50 } };
  const toggle = { displayType: 'toggle-switch', span: 6, action: { label: 'Pump', commandId: 183, params: [9, 1900, 1100, 0, 0, 0, 0], confirmation: false },
    feedback: { messageName: 'SERVO_OUTPUT_RAW', fieldName: 'servo9_raw' }, stateThreshold: 1500, colorScheme: 'green' };
  const chart = { displayType: 'sparkline', binding: { messageName: 'SCALED_PRESSURE', fieldName: 'press_diff' } };
  const card: any = { id: 'pump', name: 'Pump Station', category: 'control', displayType: 'composite', colorScheme: 'blue', staleAfterSec: 5, panels: [gauge, toggle, chart] };

  const panels = pm.cardPanels(card);
  check('cardPanels: one stand-alone definition per panel', panels.length === 3 && panels.map((p) => p.displayType).join() === 'gauge-radial,toggle-switch,sparkline');
  check('cardPanels: a panel title becomes its name, otherwise the card name', panels[0].name === 'Pressure' && panels[1].name === 'Pump Station');
  check('cardPanels: card colour and stale timeout fill in, panel settings win', panels[0].colorScheme === 'blue' && panels[1].colorScheme === 'green' && panels.every((p) => p.staleAfterSec === 5));
  check('cardPanels: panel ids are unique within the card', new Set(panels.map((p) => p.id)).size === 3);
  check('cardPanels: a single widget is its own only panel', pm.cardPanels({ id: 'x', name: 'X', category: 'telemetry', displayType: 'stat-card' }).length === 1);
  check('panelSpan: as set, clamped to 1-12, default full width', pm.panelSpan(card, 0) === 6 && pm.panelSpan(card, 2) === 12 && pm.panelSpan({ ...card, panels: [{ ...gauge, span: 40 }] }, 0) === 12);
  const ids = pm.requiredMessageIds(card);
  check('requiredMessageIds: a composite streams every panel\'s messages once', ids.length === 2 && ids.includes(MAVLINK_MSG_ID.SCALED_PRESSURE) && ids.includes(MAVLINK_MSG_ID.SERVO_OUTPUT_RAW));

  const clean = sanitizeWidgetDefinition(card);
  check('sanitize: composite panels are kept', clean.displayType === 'composite' && clean.panels?.length === 3);
  check('sanitize: confirmation is forced on every panel\'s command', clean.panels?.[1].action?.confirmation === true);
  check('sanitize: panel title, span and scheme survive', clean.panels?.[0].title === 'Pressure' && clean.panels?.[0].span === 6 && clean.panels?.[1].colorScheme === 'green');
  const hostile = sanitizeWidgetDefinition({ ...card, panels: [
    { displayType: 'composite', panels: [gauge] },
    { displayType: 'nope' },
    { ...toggle, colorScheme: 'url(javascript:1)', span: -3, title: 'x'.repeat(500), evil: '<script>' },
    { displayType: 'param-control', paramControl: { paramId: 'FENCE_ACTION', confirmation: false } },
    'not a panel',
    ...Array(20).fill(chart),
  ] });
  check('sanitize: composites cannot nest', hostile.panels?.[0].displayType === 'stat-card' && !('panels' in (hostile.panels?.[0] ?? {})));
  check('sanitize: unknown panel types become stat cards', hostile.panels?.[1].displayType === 'stat-card');
  const h2: any = hostile.panels?.[2];
  check('sanitize: bad panel colour dropped, span clamped, title trimmed, unknown keys dropped', h2.colorScheme === undefined && h2.span === 1 && h2.title.length === 40 && !('evil' in h2));
  check('sanitize: parameter writes in panels are forced to confirm', hostile.panels?.[3].paramControl?.confirmation === true);
  check(`sanitize: at most ${MAX_PANELS} panels, non-objects dropped`, hostile.panels?.length === MAX_PANELS - 1);
  const many = sanitizeWidgetDefinition({ ...card, panels: Array(8).fill({ displayType: 'value-list', binding: { messageName: 'A', fieldName: 'a' }, bindings: Array(15).fill({ messageName: 'B', fieldName: 'b' }) }) });
  const total = (many.panels ?? []).reduce((n, p) => n + 1 + (p.bindings?.length ?? 0), 0);
  check(`sanitize: a composite reads at most ${MAX_COMPOSITE_BINDINGS} values`, total === MAX_COMPOSITE_BINDINGS && many.panels?.[0].bindings?.length === 15, `total ${total}`);
  check('sanitize: stray panels are removed from a non-composite widget', !('panels' in sanitizeWidgetDefinition({ id: 's', name: 'S', category: 'telemetry', displayType: 'stat-card', panels: [gauge] } as any)));
  const act = sanitizeWidgetDefinition({ id: 'a', name: 'A', category: 'control', displayType: 'action-button', action: { label: 'X', commandId: '20' as any, params: [1, 'x', null] as any, confirmation: false } });
  check('sanitize: a command without a numeric ID is dropped', act.action === undefined);
  const act2 = sanitizeWidgetDefinition({ id: 'a', name: 'A', category: 'control', displayType: 'action-button', action: { label: 'X', commandId: 20, params: [1, 'x', null, 4] as any, confirmation: false } });
  check('sanitize: command params become seven finite numbers', act2.action?.params.join() === '1,0,0,4,0,0,0');
}

// ------------------------------------------------------------------------------------------------
// Built-in widgets as composite panels
// ------------------------------------------------------------------------------------------------
{
  const pm = await import('../src/components/widgets/custom/panelModel.ts');
  const { BUILTIN_PANELS, builtinPanelId } = await import('../src/lib/builtinWidgets.ts');
  const card: any = { id: 'b', name: 'B', category: 'telemetry', displayType: 'composite', panels: [
    { displayType: 'builtin', widgetId: 'built-in-gps-card', span: 6, title: 'Position', binding: { messageName: 'X', fieldName: 'y' }, evil: 1 },
    { displayType: 'builtin', widgetId: 'built-in-pfd' },
    { displayType: 'builtin', widgetId: 'built-in-nope' },
    { displayType: 'builtin', widgetId: 'custom-123' },
    { displayType: 'builtin' },
  ] };
  const clean = sanitizeWidgetDefinition(card);
  check('builtin: known built-ins kept, unknown or missing IDs dropped', clean.panels?.length === 2);
  check('builtin: keeps only its ID, title and span', JSON.stringify(clean.panels?.[0]) === JSON.stringify({ displayType: 'builtin', widgetId: 'built-in-gps-card', title: 'Position', span: 6 }));
  check('builtin: older IDs map to the current one', clean.panels?.[1].widgetId === 'built-in-hud');
  check('builtin: not allowed as a whole widget', sanitizeWidgetDefinition({ id: 't', name: 'T', category: 'telemetry', displayType: 'builtin' as any, widgetId: 'built-in-gps-card' }).displayType === 'stat-card');
  check('builtin: a custom widget cannot be embedded as one', builtinPanelId('custom-1') === undefined && builtinPanelId(42) === undefined);
  check('builtin: reads no bound values and requests no streams itself', pm.panelBindings(pm.cardPanels(clean)[0]).length === 0 && pm.requiredMessageIds(clean).length === 0);
  check('builtin: cardPanels passes the widget ID through', pm.cardPanels(clean)[0].widgetId === 'built-in-gps-card');
  check('builtin: the mini STATUSTEXT widget can be a panel', builtinPanelId('built-in-statustext-mini') === 'built-in-statustext-mini' && !BUILTIN_PANELS['built-in-statustext-mini'].minHeightPx);
  check('builtin: widgets with vehicle controls say so', ['built-in-glareshield', 'built-in-all-modes', 'built-in-set-speed', 'built-in-waypoints', 'built-in-map', 'built-in-parameters', 'built-in-ntrip'].every((id) => Boolean(BUILTIN_PANELS[id].controls)));
}

// ------------------------------------------------------------------------------------------------
// Relay state: RELAY_STATUS decoding, bit bindings, relay toggles following the vehicle
// ------------------------------------------------------------------------------------------------
{
  const pm = await import('../src/components/widgets/custom/panelModel.ts');
  const { MavlinkParser, decodePayload } = await import('../src/mavlink/parser.ts');
  const { extractBit, resolveRawValue } = await import('../src/lib/widgetValues.ts');
  const { recordPacket, getCachedField } = await import('../src/lib/messageCache.ts');

  // pymavlink: RELAY_STATUS(time_boot_ms=123456, on=0b0101, present=0b1111), sys 1 comp 1.
  const hex = 'fd07000000010178010040e2010005000fa422'; // payload trimmed of its trailing zero, as MAVLink 2 sends it
  const packets = new MavlinkParser().parse(Uint8Array.from(Buffer.from(hex, 'hex')));
  check('RELAY_STATUS: a pymavlink packet passes the CRC check', packets.length === 1 && packets[0].messageId === MAVLINK_MSG_ID.RELAY_STATUS);
  const d: any = packets[0] ? decodePayload(packets[0].messageId, packets[0].payload) : {};
  check('RELAY_STATUS: decodes time, on and present', d.time_boot_ms === 123456 && d.on === 5 && d.present === 15, JSON.stringify(d));
  if (packets[0]) recordPacket(packets[0]);
  check('RELAY_STATUS: reaches the message cache for bindings', getCachedField('RELAY_STATUS', 'on') === 5);

  check('extractBit: picks single bits', extractBit(5, 0) === 1 && extractBit(5, 1) === 0 && extractBit(5, 2) === 1 && extractBit(0x80000000, 31) === 1);
  check('bit binding: reads one bit of a field', resolveRawValue({ messageName: 'RELAY_STATUS', fieldName: 'on', bit: 2 }, {}) === 1 && resolveRawValue({ messageName: 'RELAY_STATUS', fieldName: 'on', bit: 1 }, {}) === 0);
  check('bit binding: without a bit, the whole field', resolveRawValue({ messageName: 'RELAY_STATUS', fieldName: 'on' }, {}) === 5);
  const b = sanitizeWidgetDefinition({ id: 'x', name: 'X', category: 'telemetry', displayType: 'stat-card', binding: { messageName: 'A', fieldName: 'b', bit: 40.6 } });
  check('sanitize: bit is a whole number from 0 to 31', b.binding?.bit === 31);

  const relayToggle: any = { id: 'r', name: 'Lights', category: 'control', displayType: 'toggle-switch', stateThreshold: 1500,
    action: { label: 'Lights', commandId: 181, params: [2, 0, 0, 0, 0, 0, 0], confirmation: true } };
  const fb = pm.feedbackBinding(relayToggle);
  check('relay toggle: follows RELAY_STATUS.on, bit = relay instance', fb?.messageName === 'RELAY_STATUS' && fb?.fieldName === 'on' && fb?.bit === 2 && fb?.label === 'RELAY3');
  check('relay toggle: on above 0, whatever stateThreshold says', pm.followsRelayStatus(relayToggle) && pm.feedbackThreshold(relayToggle) === 0);
  check('relay toggle: asks the vehicle to stream RELAY_STATUS', pm.requiredMessageIds(relayToggle).includes(MAVLINK_MSG_ID.RELAY_STATUS));
  const explicit = { ...relayToggle, feedback: { messageName: 'SERVO_OUTPUT_RAW', fieldName: 'servo9_raw' } };
  check('relay toggle: an explicit feedback field overrides it', pm.feedbackBinding(explicit)?.messageName === 'SERVO_OUTPUT_RAW' && !pm.followsRelayStatus(explicit) && pm.feedbackThreshold(explicit) === 1500);
  check('servo toggle: no automatic feedback', pm.feedbackBinding({ ...relayToggle, action: { ...relayToggle.action, commandId: 183 } }) === undefined);
  check('relay toggle: out-of-range relay numbers get no automatic feedback', pm.relayInstance({ ...relayToggle, action: { ...relayToggle.action, params: [16, 0, 0, 0, 0, 0, 0] } }) === undefined && pm.relayInstance({ ...relayToggle, action: { ...relayToggle.action, params: [1.5, 0, 0, 0, 0, 0, 0] } }) === undefined);
}

// Scaled values normalise like ArduPilot: SERVOn_REVERSED flips servo outputs, RCn_REVERSED / RCn_REV flip RC inputs.
{
  const P = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v }]));
  const { scaleServoOutput } = values;
  check('servo scaled: normal output, 1900 µs = +0.8', Math.abs(scaleServoOutput(1900, 1, P({ SERVO1_MIN: 1000, SERVO1_TRIM: 1500, SERVO1_MAX: 2000, SERVO1_REVERSED: 0 })) - 0.8) < 1e-9);
  check('servo scaled: SERVOn_REVERSED = 1 flips it to -0.8', Math.abs(scaleServoOutput(1900, 1, P({ SERVO1_MIN: 1000, SERVO1_TRIM: 1500, SERVO1_MAX: 2000, SERVO1_REVERSED: 1 })) + 0.8) < 1e-9);
  check('servo scaled: reversed uses the other side\'s range (asymmetric trim)', Math.abs(scaleServoOutput(1300, 2, P({ SERVO2_MIN: 1100, SERVO2_TRIM: 1400, SERVO2_MAX: 1900, SERVO2_REVERSED: 1 })) - 1 / 3) < 1e-9);
  check('servo scaled: reversed at trim is 0, not -0', Object.is(scaleServoOutput(1500, 3, P({ SERVO3_REVERSED: 1 })), 0));
  check('servo scaled: another output\'s reversal does not apply', scaleServoOutput(2000, 4, P({ SERVO3_REVERSED: 1 })) === 1);
  check('servo scaled: RCn_REVERSED / RCn_REV never reverse an output', scaleServoOutput(2000, 5, P({ RC5_REVERSED: 1, RC5_REV: -1 })) === 1);

  const { scaleRcInput } = values;
  check('rc scaled: normal input, 1900 µs = +0.8', Math.abs(scaleRcInput(1900, 1, P({ RC1_REVERSED: 0 })) - 0.8) < 1e-9);
  check('rc scaled: RCn_REVERSED = 1 flips it', Math.abs(scaleRcInput(1900, 1, P({ RC1_REVERSED: 1 })) + 0.8) < 1e-9);
  check('rc scaled: older firmware RCn_REV = -1 flips it', scaleRcInput(2000, 2, P({ RC2_REV: -1 })) === -1);
  check('rc scaled: RCn_REV = 1 is normal', scaleRcInput(2000, 2, P({ RC2_REV: 1 })) === 1);
  check('rc scaled: SERVOn_REVERSED does not reverse an input', scaleRcInput(2000, 3, P({ SERVO3_REVERSED: 1 })) === 1);
  check('rc scaled: reversed at trim is 0, not -0', Object.is(scaleRcInput(1500, 4, P({ RC4_REVERSED: 1 })), 0));
  const rcState: any = { rc: { channels: [1900, 1100], chancount: 8 }, parameters: P({ RC1_REVERSED: 1 }) };
  const rcR = values.readBinding({ messageName: 'RC_CHANNELS (SCALED)', fieldName: 'chan1_scaled', decimals: 2 }, rcState, 'ms', 3, Date.now());
  check('rc scaled binding: honours RCn_REVERSED', rcR.text === '-0.80', rcR.text);
  check('servo scaled: no parameters, defaults and not reversed', scaleServoOutput(1000, 6, undefined) === -1);

  const state: any = { servo: { servos: [1900, 1100] }, parameters: P({ SERVO1_REVERSED: 1 }) };
  const r = values.readBinding({ messageName: 'SERVO_OUTPUT_RAW (SCALED)', fieldName: 'servo1_scaled', decimals: 2 }, state, 'ms', 3, Date.now());
  check('servo scaled binding: honours SERVOn_REVERSED', r.text === '-0.80', r.text);
  const pm = await import('../src/components/widgets/custom/panelModel.ts');
  const bars = pm.extractMultiBarItems('servo-8-scaled', state);
  check('servo multi-bar: S1 reversed, S2 not', bars[0].value === -0.8 && bars[1].value === -0.8, JSON.stringify(bars.slice(0, 2).map((b: any) => b.value)));
  const rcBars = pm.extractMultiBarItems('rc-8-scaled', rcState);
  check('rc multi-bar: CH1 reversed, CH2 not', rcBars[0].value === -0.8 && rcBars[1].value === -0.8, JSON.stringify(rcBars.slice(0, 2).map((b: any) => b.value)));
  const raw = pm.extractMultiBarItems('servo-8', state);
  check('servo multi-bar raw µs: unchanged by reversal', raw[0].value === 1900);
}

console.log(failures.length ? `\n${failures.length} widget check(s) FAILED` : '\nAll widget checks PASSED');
process.exit(failures.length ? 1 : 0);
