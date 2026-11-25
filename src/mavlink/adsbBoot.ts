// ADS-B traffic in: decodes ADSB_VEHICLE from the link into the traffic store, asks the vehicle to send it, drops
// reports as they expire, and speaks a warning for traffic at alert level (through the app's audio callouts and
// their on/off settings). Imported once at startup, so traffic and its warning don't depend on which widgets show.

import { playAlertChime, speakCallout, useAudioAlertsStore } from '../lib/audioAlerts';
import { useAdsbSettingsStore } from '../store/adsbSettingsStore';
import { useTelemetryStore } from '../store/telemetryStore';
import { useTrafficStore } from '../store/trafficStore';
import { useUnitsStore } from '../store/unitsStore';
import {
  compassPoint,
  emergencySquawk,
  ownForThreat,
  rankTraffic,
  trafficFromMessage,
  trafficToAnnounce,
  type Threat,
} from './adsb';
import { mavlinkConnection } from './connection';
import { MAVLINK_MSG_ID } from './messages';
import { decodePayload } from './parser';
import { messageRateManager } from './rateManager';

mavlinkConnection.onPacket((p) => {
  if (p.messageId !== MAVLINK_MSG_ID.ADSB_VEHICLE) return;
  const a = trafficFromMessage(decodePayload(p.messageId, p.payload), Date.now());
  if (a) useTrafficStore.getState().upsert(a);
});
// One aircraft per message: the rate is how many aircraft a second stay current (ArduPilot cycles its list).
messageRateManager.registerRequirement('adsb-traffic', MAVLINK_MSG_ID.ADSB_VEHICLE);
setInterval(() => useTrafficStore.getState().prune(Date.now()), 2000);

const WORDS: Record<string, string> = { N: 'north', S: 'south', E: 'east', W: 'west' };

/** "Traffic, north east, 800 meters, 100 meters above, closing". */
function calloutText(t: Threat, squawk: number | null): string {
  const units = useUnitsStore.getState().system;
  const imperial = units === 'kts' || units === 'mph';
  const dist =
    units === 'kts'
      ? `${(t.distanceM / 1852).toFixed(1)} nautical miles`
      : units === 'mph'
        ? `${(t.distanceM / 1609.344).toFixed(1)} miles`
        : t.distanceM < 1000
          ? `${Math.round(t.distanceM / 10) * 10} meters`
          : `${(t.distanceM / 1000).toFixed(1)} kilometers`;
  const rel =
    t.relAltM === null
      ? 'altitude unknown'
      : Math.abs(t.relAltM) < 15
        ? 'same altitude'
        : `${Math.round((Math.abs(t.relAltM) * (imperial ? 3.28084 : 1)) / 10) * 10} ${imperial ? 'feet' : 'meters'} ${t.relAltM > 0 ? 'above' : 'below'}`;
  const dir = compassPoint(t.bearingDeg)
    .split('')
    .map((c) => WORDS[c])
    .join(' ');
  const emergency = emergencySquawk(squawk);
  return `Traffic, ${dir}, ${dist}, ${rel}${t.closing ? ', closing' : ''}${emergency ? `, squawking ${emergency}` : ''}`;
}

const announced = new Map<number, number>();
setInterval(() => {
  const { warnings, thresholds } = useAdsbSettingsStore.getState();
  const own = ownForThreat(useTelemetryStore.getState().position);
  if (!own || !warnings) {
    announced.clear(); // turned back on, a threat already there is announced at once
    return;
  }
  const ranked = rankTraffic(Object.values(useTrafficStore.getState().aircraft), own, thresholds);
  const toSay = trafficToAnnounce(
    ranked.map((r) => ({ icao: r.a.icao, level: r.t!.level })),
    announced,
    Date.now()
  );
  if (toSay.length === 0) return;
  // The worst one (they're ranked); the others are on the map.
  const r = ranked.find((x) => toSay.includes(x.a.icao))!;
  if (useAudioAlertsStore.getState().soundEnabled) playAlertChime(2);
  speakCallout(calloutText(r.t!, r.a.squawk), true);
}, 2000);
