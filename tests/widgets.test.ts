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
const { describeAck, extractBoundValueFromState } = await import('../src/components/widgets/CustomWidgetRenderer.tsx');
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
  check('extractBoundValueFromState (legacy text): raw RC channel stays unscaled text', extractBoundValueFromState({ messageName: 'RC_CHANNELS', fieldName: 'chan3_raw', decimals: 2 }, rcState) === '1850');
  check('extractBoundValueFromState: an unused RC channel reads "--"', extractBoundValueFromState({ messageName: 'RC_CHANNELS', fieldName: 'chan2_raw' }, rcState) === '--');
  check('extractBoundValueFromState: RSSI 255 (unknown) reads "--"', extractBoundValueFromState({ messageName: 'RC_CHANNELS', fieldName: 'rssi' }, rcState) === '--');
  check('resolveRawValue: scaled RC channel maps PWM to -1..1', values.resolveRawValue({ messageName: 'RC_CHANNELS (scaled)', fieldName: 'chan1_scaled' }, rcState) === 0);
  check('extractBoundValueFromState: multiplier and decimals apply to other fields', extractBoundValueFromState({ messageName: 'ATTITUDE', fieldName: 'roll', multiplier: 2, decimals: 1 }, { attitude: { roll: 1.25 } }) === '2.5');
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

console.log(failures.length ? `\n${failures.length} widget check(s) FAILED` : '\nAll widget checks PASSED');
process.exit(failures.length ? 1 : 0);
