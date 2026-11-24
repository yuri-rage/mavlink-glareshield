// ADS-B traffic: the aircraft the vehicle forwards (ADSB_VEHICLE, from its ADS-B receiver), how old each report is,
// and how much of a threat each one is to the vehicle. Pure; the store is store/trafficStore.ts, the map layer
// components/map/useTrafficLayer.ts.
//
// ArduPilot (Copter, Plane) sends one aircraft from its list each time the message is due, cycling through the list
// at most once a second, so the requested rate bounds how many aircraft stay current. Rover sends no traffic; it and
// Copter send their obstacle database through the same message (callsign OA_DB, no flags), which isn't traffic.

export const ADSB_FLAGS = {
  VALID_COORDS: 1,
  VALID_ALTITUDE: 2,
  VALID_HEADING: 4,
  VALID_VELOCITY: 8,
  VALID_CALLSIGN: 16,
  VALID_SQUAWK: 32,
  SIMULATED: 64,
  VERTICAL_VELOCITY_VALID: 128,
} as const;

/** One aircraft as last reported. Altitude is above mean sea level (barometric QNH or GNSS, per `altGeometric`). */
export interface TrafficAircraft {
  icao: number;
  lat: number;
  lon: number;
  altMslM: number | null;
  altGeometric: boolean;
  headingDeg: number | null;
  speedMs: number | null;
  climbMs: number | null;
  callsign: string | null;
  squawk: number | null;
  emitterType: number;
  simulated: boolean;
  /** When the report arrived here, less how long the receiver had already gone without hearing it (ms). */
  heardAtMs: number;
}

/** No report for this long: drawn faded (its position is getting old). */
export const TRAFFIC_STALE_MS = 10_000;
/** No report for this long: dropped. */
export const TRAFFIC_EXPIRE_MS = 60_000;

/** An ADSB_VEHICLE (as decoded) to an aircraft, or null when it isn't one (no valid position, or an obstacle). */
export function trafficFromMessage(d: any, nowMs: number): TrafficAircraft | null {
  const flags = Number(d?.flags) || 0;
  if ((flags & ADSB_FLAGS.VALID_COORDS) === 0) return null;
  if (d.callsign === 'OA_DB' || d.emitter_type === 255) return null;
  if (!Number.isFinite(d.lat) || !Number.isFinite(d.lon) || (d.lat === 0 && d.lon === 0) || Math.abs(d.lat) > 90 || Math.abs(d.lon) > 180) return null;
  return {
    icao: d.ICAO_address >>> 0,
    lat: d.lat,
    lon: d.lon,
    altMslM: flags & ADSB_FLAGS.VALID_ALTITUDE ? d.altitude : null,
    altGeometric: d.altitude_type === 1,
    headingDeg: flags & ADSB_FLAGS.VALID_HEADING ? d.heading : null,
    speedMs: flags & ADSB_FLAGS.VALID_VELOCITY ? d.hor_velocity : null,
    climbMs: flags & ADSB_FLAGS.VERTICAL_VELOCITY_VALID ? d.ver_velocity : null,
    callsign: flags & ADSB_FLAGS.VALID_CALLSIGN && d.callsign ? d.callsign : null,
    squawk: flags & ADSB_FLAGS.VALID_SQUAWK ? d.squawk : null,
    emitterType: d.emitter_type ?? 0,
    simulated: (flags & ADSB_FLAGS.SIMULATED) !== 0,
    heardAtMs: nowMs - (Number(d.tslc) || 0) * 1000,
  };
}

/** Hex ICAO address, as shown on flight trackers. */
export const icaoHex = (icao: number) => icao.toString(16).toUpperCase().padStart(6, '0');

/** Hijack, radio failure, emergency. */
export function emergencySquawk(squawk: number | null): string | null {
  // Squawks are octal codes sent as decimal digits (7700 is sent as 7700).
  if (squawk === 7500) return 'hijack';
  if (squawk === 7600) return 'radio failure';
  if (squawk === 7700) return 'emergency';
  return null;
}

export type ThreatLevel = 'none' | 'caution' | 'alert';

export interface Threat {
  level: ThreatLevel;
  /** Horizontal distance (m), bearing from the vehicle (deg), and traffic height relative to the vehicle (m, + above). */
  distanceM: number;
  bearingDeg: number;
  relAltM: number | null;
  /** The distance is shrinking. */
  closing: boolean;
  /** Seconds until closest approach, and the horizontal miss distance then, when they are coming together. */
  cpaS: number | null;
  cpaM: number | null;
}

/** What makes an aircraft a caution or an alert (configurable in Settings; these are the defaults). */
export interface TrafficThresholds {
  cautionRangeM: number;
  cautionVerticalM: number;
  alertRangeM: number;
  alertVerticalM: number;
  /** Predicted to pass within cpaAlertM within cpaHorizonS (and within alertVerticalM then): alert, wherever it is now. */
  cpaAlertM: number;
  cpaHorizonS: number;
}

export const DEFAULT_THRESHOLDS: TrafficThresholds = {
  cautionRangeM: 3000,
  cautionVerticalM: 300,
  alertRangeM: 1000,
  alertVerticalM: 150,
  cpaAlertM: 500,
  cpaHorizonS: 60,
};

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

/** East/north offset of `b` from `a` (m), flat-earth (fine at traffic ranges). */
function enOffset(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  return { e: rad(b.lon - a.lon) * R * Math.cos(rad(a.lat)), n: rad(b.lat - a.lat) * R };
}

/**
 * How much of a threat `t` is to the vehicle. Vertical checks need both altitudes; without them only the horizontal
 * ones decide (an aircraft of unknown altitude close by is a caution or alert). Closest approach assumes both keep
 * their current velocity. Traffic altitude may be barometric while the vehicle's is GNSS: tens of metres apart.
 */
export function assessThreat(
  t: TrafficAircraft,
  own: { lat: number; lon: number; altMslM: number | null; velN: number; velE: number; velUp?: number },
  th: TrafficThresholds = DEFAULT_THRESHOLDS
): Threat {
  const { e, n } = enOffset(own, t);
  const distanceM = Math.hypot(e, n);
  const bearingDeg = (Math.atan2(e, n) * 180 / Math.PI + 360) % 360;
  const relAltM = t.altMslM !== null && own.altMslM !== null ? t.altMslM - own.altMslM : null;
  // Relative velocity (traffic minus own).
  let rvE = -own.velE;
  let rvN = -own.velN;
  if (t.speedMs !== null && t.headingDeg !== null) {
    rvE += t.speedMs * Math.sin(rad(t.headingDeg));
    rvN += t.speedMs * Math.cos(rad(t.headingDeg));
  }
  const dot = e * rvE + n * rvN;
  const v2 = rvE * rvE + rvN * rvN;
  const closing = dot < 0;
  let cpaS: number | null = null;
  let cpaM: number | null = null;
  if (closing && v2 > 0.01) {
    cpaS = -dot / v2;
    cpaM = Math.hypot(e + rvE * cpaS, n + rvN * cpaS);
  }
  const vertWithin = (limit: number) => {
    if (relAltM === null) return true;
    if (Math.abs(relAltM) <= limit) return true;
    // At closest approach, using both climb rates where known.
    if (cpaS !== null && cpaS <= th.cpaHorizonS) {
      const relClimb = (t.climbMs ?? 0) - (own.velUp ?? 0);
      return Math.abs(relAltM + relClimb * cpaS) <= limit;
    }
    return false;
  };
  let level: ThreatLevel = 'none';
  if (distanceM <= th.cautionRangeM && vertWithin(th.cautionVerticalM)) level = 'caution';
  const cpaAlert = cpaS !== null && cpaM !== null && cpaS <= th.cpaHorizonS && cpaM <= th.cpaAlertM && vertWithin(th.alertVerticalM);
  if ((distanceM <= th.alertRangeM && vertWithin(th.alertVerticalM)) || cpaAlert) level = 'alert';
  return { level, distanceM, bearingDeg, relAltM, closing, cpaS, cpaM };
}

/** Compass point for a bearing. */
export function compassPoint(deg: number): string {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

/** While an aircraft stays at alert, repeat its warning this often. */
export const TRAFFIC_REPEAT_MS = 20_000;

/**
 * Which alert-level aircraft to announce now: those newly at alert, and those still at alert whose last warning was
 * TRAFFIC_REPEAT_MS ago. `announced` (ICAO → when last announced) is updated; aircraft no longer at alert are
 * forgotten, so coming back to alert announces again.
 */
export function trafficToAnnounce(threats: { icao: number; level: ThreatLevel }[], announced: Map<number, number>, nowMs: number): number[] {
  const alert = new Set(threats.filter((t) => t.level === 'alert').map((t) => t.icao));
  for (const icao of [...announced.keys()]) if (!alert.has(icao)) announced.delete(icao);
  const out: number[] = [];
  for (const icao of alert) {
    const last = announced.get(icao);
    if (last === undefined || nowMs - last >= TRAFFIC_REPEAT_MS) {
      announced.set(icao, nowMs);
      out.push(icao);
    }
  }
  return out;
}

/** The vehicle as the threat checks need it, from the telemetry store's position (null without a position). */
export function ownForThreat(p: { lat: number; lon: number; alt: number; vx: number; vy: number; vz: number }) {
  if (!Number.isFinite(p.lat) || (p.lat === 0 && p.lon === 0)) return null;
  return { lat: p.lat, lon: p.lon, altMslM: Number.isFinite(p.alt) ? p.alt : null, velN: p.vx || 0, velE: p.vy || 0, velUp: -(p.vz || 0) };
}

/** Every aircraft with its threat, worst first (alert, caution, none; then nearest). */
export function rankTraffic(
  aircraft: TrafficAircraft[],
  own: ReturnType<typeof ownForThreat>,
  th: TrafficThresholds = DEFAULT_THRESHOLDS
): { a: TrafficAircraft; t: Threat | null }[] {
  const order = { alert: 0, caution: 1, none: 2 };
  return aircraft
    .map((a) => ({ a, t: own ? assessThreat(a, own, th) : null }))
    .sort((x, y) => (x.t && y.t ? order[x.t.level] - order[y.t.level] || x.t.distanceM - y.t.distanceM : 0));
}

/** "+120 m ↑" relative height, in the user's units. */
export function relAltText(relAltM: number | null, climbMs: number | null, formatAltitude: (m: number) => { value: string; unit: string }): string {
  if (relAltM === null) return 'alt ?';
  const f = formatAltitude(Math.abs(relAltM));
  // Whole units: separation to a tenth of a metre is false precision (altitude sources differ by tens of metres).
  f.value = String(Math.round(Number(f.value)));
  const arrow = climbMs === null || Math.abs(climbMs) < 1 ? '' : climbMs > 0 ? ' ↑' : ' ↓';
  return `${relAltM >= 0 ? '+' : '−'}${f.value} ${f.unit}${arrow}`;
}
