// Mission waypoint navigation shared by the Waypoint Control widget and the map's mission footer.

import { useEffect, useState } from 'react';
import { useTelemetryStore, setMissionCurrentWaypoint } from '../store/telemetryStore';

/** "11s", "2m 05s", "1h 04m"; '--' when unknown or not moving. */
export function formatEta(distanceM: number, groundspeedMs: number): string {
  if (!(distanceM > 0) || !(groundspeedMs > 0.5)) return '--';
  const total = Math.round(distanceM / groundspeedMs);
  if (total >= 3600) return `${Math.floor(total / 3600)}h ${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}m`;
  if (total >= 60) return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
  return `${total}s`;
}

export function useWaypointNavigation() {
  const heartbeat = useTelemetryStore((s) => s.heartbeat);
  const missionWaypoints = useTelemetryStore((s) => s.missionWaypoints);
  const currentWaypointSeq = useTelemetryStore((s) => s.currentWaypointSeq);
  const [isPending, setIsPending] = useState(false);

  const connected = heartbeat.lastHeartbeatTime > 0 && heartbeat.modeName !== 'DISCONNECTED';
  // User waypoints exclude WP0 (home).
  const userWps = missionWaypoints.filter((w) => w.seq > 0);
  const userWpCount = userWps.length;
  const maxSeq = userWpCount > 0 ? Math.max(...userWps.map((w) => w.seq)) : 0;
  const minSeq = userWpCount > 0 ? Math.min(...userWps.map((w) => w.seq)) : 1;
  const nextSeq = Math.min(maxSeq, (currentWaypointSeq || 0) + 1);
  const prevSeq = Math.max(minSeq, (currentWaypointSeq || 1) - 1);
  const hasNext = connected && userWpCount > 0 && currentWaypointSeq < maxSeq;
  const hasPrev = connected && userWpCount > 0 && currentWaypointSeq > minSeq;
  const activeWp = missionWaypoints.find((w) => w.seq === currentWaypointSeq);

  const navigateTo = async (targetSeq: number) => {
    if (!connected || targetSeq <= 0 || isPending) return;
    setIsPending(true);
    try {
      await setMissionCurrentWaypoint(targetSeq);
    } finally {
      setTimeout(() => setIsPending(false), 500);
    }
  };

  return {
    heartbeat,
    connected,
    missionWaypoints,
    currentWaypointSeq,
    userWps,
    userWpCount,
    minSeq,
    maxSeq,
    nextSeq,
    prevSeq,
    hasNext,
    hasPrev,
    activeWp,
    isPending,
    navigateTo,
  };
}

/**
 * Two-step confirmation for a consequential action: the first press arms it, a second press within
 * `timeoutMs` runs it, and it disarms on its own after that.
 */
export function useConfirmStep(timeoutMs = 4000) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), timeoutMs);
    return () => clearTimeout(timer);
  }, [armed, timeoutMs]);
  return { armed, arm: () => setArmed(true), cancel: () => setArmed(false) };
}
