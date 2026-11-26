// The clock for readouts that measure the flight itself (flight time, packets per second): the log's own time while
// a replay plays, so they keep pace at 10x and stand still when paused; the wall clock otherwise. Liveness checks
// (heartbeat age, link silence) stay on the wall clock. replay.ts sets the source; nothing here imports the replay.

let source: { now: () => number; speed: () => number } | null = null;

/** While a replay plays: its clock (ms since 1970, as the log has it) and speed. Null when it ends. */
export function setReplayClock(next: typeof source): void {
  source = next;
}

/** Now, for measuring the flight: the log's time during a replay, else Date.now(). */
export function flightNow(): number {
  return source ? source.now() : Date.now();
}

/** Playback speed during a replay (1 otherwise): a count per real second divided by it is per second of the log. */
export function replaySpeed(): number {
  const s = source?.speed() ?? 1;
  return s > 0 ? s : 1;
}

/** A heartbeat older than this (wall-clock ms) means the vehicle isn't heard: the link is lost. */
export const HEARTBEAT_LIVE_MS = 3500;

/**
 * How old the last heartbeat may be (wall-clock ms) before the vehicle counts as not heard. Slowed down (a replay at
 * 0.5x), a log's heartbeats arrive further apart in wall time: the limit stretches with it, so they don't read as
 * a lost link.
 */
export function heartbeatLiveMs(): number {
  const s = replaySpeed();
  return s < 1 ? HEARTBEAT_LIVE_MS / s : HEARTBEAT_LIVE_MS;
}
