import { useRef, useEffect } from 'react';
import { create } from 'zustand';
import { useTelemetryStore } from '../store/telemetryStore';

export const STORAGE_KEY_SOUND = 'mavlink_glareshield_sound_enabled';

let sharedAudioCtx: AudioContext | null = null;

function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtxClass) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioCtxClass();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

export function playAlertChime(severity: number) {
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    if (severity <= 2) {
      // Emergency (0), Alert (1), Critical (2): 2-tone high urgency warble (880Hz -> 660Hz)
      osc.type = 'square';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(660, now + 0.12);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else if (severity === 3) {
      // Error (3): double chime (587Hz -> 440Hz)
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(440, now + 0.1); // A4
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } else {
      // Warning (4): pleasant single soft chime (440Hz)
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    }
  } catch {
    // Ignore audio context restrictions if user hasn't interacted yet
  }
}

interface AudioAlertsState {
  soundEnabled: boolean;
  toggleSound: () => void;
  setSoundEnabled: (enabled: boolean) => void;
}

export const useAudioAlertsStore = create<AudioAlertsState>((set, get) => ({
  soundEnabled: (() => {
    try {
      if (typeof localStorage !== 'undefined') {
        const val = localStorage.getItem(STORAGE_KEY_SOUND);
        if (val !== null) return val === 'true';
      }
    } catch {}
    return true;
  })(),
  toggleSound: () => {
    const next = !get().soundEnabled;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_SOUND, String(next));
      }
    } catch {}
    if (next) {
      playAlertChime(4);
    }
    set({ soundEnabled: next });
  },
  setSoundEnabled: (enabled: boolean) => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_SOUND, String(enabled));
      }
    } catch {}
    set({ soundEnabled: enabled });
  },
}));

/**
 * Top-level listener mounted in App.tsx.
 * Ensures alerts chime regardless of which tab is active, and plays
 * the HIGHEST severity tone among all messages in a batch.
 */
export function useAudioAlertListener() {
  const statusMessages = useTelemetryStore((state) => state.statusMessages);
  const soundEnabled = useAudioAlertsStore((state) => state.soundEnabled);
  const lastSeenIdRef = useRef<string | null>(statusMessages[0]?.id ?? null);

  useEffect(() => {
    if (statusMessages.length === 0) {
      lastSeenIdRef.current = null;
      return;
    }

    const newest = statusMessages[0];
    const lastSeenId = lastSeenIdRef.current;

    // First time initializing
    if (lastSeenId === null) {
      lastSeenIdRef.current = newest.id;
      return;
    }

    // If newest message is the same, nothing to chime
    if (newest.id === lastSeenId) {
      return;
    }

    // Collect all newly arrived messages up to the last seen ID
    const idx = statusMessages.findIndex((m) => m.id === lastSeenId);
    const newMessages = idx === -1 ? statusMessages.slice(0, 10) : statusMessages.slice(0, idx);
    lastSeenIdRef.current = newest.id;

    if (!soundEnabled || newMessages.length === 0) return;

    // Filter for warnings and above (severity <= 4)
    const alertMsgs = newMessages.filter((m) => m.severity <= 4);
    if (alertMsgs.length > 0) {
      // In MAVLink, lower number is higher severity (0=Emergency, 1=Alert, 2=Critical, 3=Error, 4=Warning)
      const highestSeverity = Math.min(...alertMsgs.map((m) => m.severity));
      playAlertChime(highestSeverity);
    }
  }, [statusMessages, soundEnabled]);
}
