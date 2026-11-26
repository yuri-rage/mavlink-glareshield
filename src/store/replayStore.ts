// The telemetry log replay in progress, for the replay bar and the status pill (mavlink/replay.ts drives it).

import { create } from 'zustand';

export interface ReplayStoreState {
  active: boolean;
  /** The log's name (file name). */
  name: string;
  positionMs: number;
  durationMs: number;
  playing: boolean;
  speed: number;
  seeking: boolean;
  ended: boolean;
  /** Wall-clock time of the log's first frame (ms since 1970). */
  startEpochMs: number;
  /** Long pauses in the log played as a second each. */
  gapsCompressed: number;
}

export const initialReplayState: ReplayStoreState = {
  active: false,
  name: '',
  positionMs: 0,
  durationMs: 0,
  playing: false,
  speed: 1,
  seeking: false,
  ended: false,
  startEpochMs: 0,
  gapsCompressed: 0,
};

export const useReplayStore = create<ReplayStoreState>(() => ({ ...initialReplayState }));

/**
 * A log is replaying: the vehicle shown isn't live, so every control that would command it is disabled (the
 * connection drops anything sent anyway; this keeps the controls from looking live).
 */
export const useReplaying = () => useReplayStore((s) => s.active);
