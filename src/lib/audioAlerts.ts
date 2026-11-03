import { useRef, useEffect } from 'react';
import { create } from 'zustand';
import { useTelemetryStore } from '../store/telemetryStore';
import { mavlinkConnection } from '../mavlink/connection';

export const STORAGE_KEY_SOUND = 'mavlink_glareshield_sound_enabled';
export const STORAGE_KEY_VOICE = 'mavlink_glareshield_voice_enabled';
export const STORAGE_KEY_WAYPOINT_ANNOUNCE = 'mavlink_glareshield_wp_announce_enabled';

const PIPER_VOICE_ID = 'en_US-amy-medium';
const MAX_CACHED_BUFFERS = 64;

let sharedAudioCtx: AudioContext | null = null;
let lastSpokenText = '';
let lastSpokenTime = 0;

// In-memory decoded AudioBuffer cache for 0ms repeat callouts
const audioBufferCache = new Map<string, AudioBuffer>();

// Cockpit voice playback queue & active source tracking
let activeVoiceSource: AudioBufferSourceNode | null = null;
const playbackQueue: AudioBuffer[] = [];
let playbackQueueTimer: ReturnType<typeof setTimeout> | null = null;

// Piper Neural TTS Web Worker state
let piperWorker: Worker | null = null;
let workerReqSeq = 0;
const pendingWorkerRequests = new Map<
  number,
  {
    resolve: (wavBuffer: ArrayBuffer) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
let prewarmStarted = false;
let hasUserInteracted = false;

if (typeof window !== 'undefined') {
  const onUserGesture = () => {
    hasUserInteracted = true;
    if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
    window.removeEventListener('pointerdown', onUserGesture, true);
    window.removeEventListener('keydown', onUserGesture, true);
    window.removeEventListener('touchstart', onUserGesture, true);
  };
  window.addEventListener('pointerdown', onUserGesture, { capture: true, once: true });
  window.addEventListener('keydown', onUserGesture, { capture: true, once: true });
  window.addEventListener('touchstart', onUserGesture, { capture: true, once: true });
}

function getSharedAudioContext(allowResume = false): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtxClass) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioCtxClass();
  }
  const canResume =
    hasUserInteracted ||
    (typeof navigator !== 'undefined' && (navigator as any).userActivation?.hasBeenActive);
  if (sharedAudioCtx.state === 'suspended' && (allowResume || canResume)) {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

function cacheAudioBuffer(key: string, buffer: AudioBuffer) {
  if (audioBufferCache.has(key)) {
    audioBufferCache.delete(key);
  } else if (audioBufferCache.size >= MAX_CACHED_BUFFERS) {
    const oldestKey = audioBufferCache.keys().next().value;
    if (oldestKey !== undefined) {
      audioBufferCache.delete(oldestKey);
    }
  }
  audioBufferCache.set(key, buffer);
}

/**
 * Plays a decoded AudioBuffer through a "Bitchin' Betty" cockpit comms DSP chain:
 * - High-pass @ 185 Hz (removes low-end mud/boom)
 * - Presence peaking boost @ 3.1 kHz (+3.8 dB) for crisp consonant articulation
 * - High-shelf @ 6.0 kHz (+2.5 dB) to eliminate any muffle
 * - Fast dynamics compressor for consistent cockpit volume
 */
function startBufferPlayback(ctx: AudioContext, buffer: AudioBuffer) {
  try {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 1.0; // Natural pitch; +15% cadence is generated natively by VITS length_scale

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 185;
    highpass.Q.value = 0.707;

    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 3100;
    presence.Q.value = 1.1;
    presence.gain.value = 3.8;

    const airShelf = ctx.createBiquadFilter();
    airShelf.type = 'highshelf';
    airShelf.frequency.value = 6000;
    airShelf.gain.value = 2.5;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 8;
    compressor.ratio.value = 3.5;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.12;

    const outGain = ctx.createGain();
    outGain.gain.value = 0.95;

    source.connect(highpass);
    highpass.connect(presence);
    presence.connect(airShelf);
    airShelf.connect(compressor);
    compressor.connect(outGain);
    outGain.connect(ctx.destination);

    activeVoiceSource = source;
    source.onended = () => {
      if (activeVoiceSource === source) {
        activeVoiceSource = null;
      }
      if (playbackQueue.length > 0) {
        playbackQueueTimer = setTimeout(() => {
          playbackQueueTimer = null;
          const nextBuf = playbackQueue.shift();
          const currentCtx = getSharedAudioContext();
          if (nextBuf && currentCtx && !activeVoiceSource) {
            startBufferPlayback(currentCtx, nextBuf);
          }
        }, 80);
      }
    };

    source.start(0);
  } catch {
    activeVoiceSource = null;
  }
}

function enqueueCockpitBuffer(buffer: AudioBuffer, priority: boolean) {
  const ctx = getSharedAudioContext();
  if (!ctx) return;

  if (priority) {
    playbackQueue.length = 0;
    if (playbackQueueTimer) {
      clearTimeout(playbackQueueTimer);
      playbackQueueTimer = null;
    }
    if (activeVoiceSource) {
      try {
        activeVoiceSource.onended = null;
        activeVoiceSource.stop();
      } catch {}
      activeVoiceSource = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    startBufferPlayback(ctx, buffer);
    return;
  }

  if (!activeVoiceSource && playbackQueue.length === 0) {
    startBufferPlayback(ctx, buffer);
  } else {
    playbackQueue.push(buffer);
  }
}

function selectPreferredBrowserFemaleVoice(): SpeechSynthesisVoice | null {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return null;
    const enVoices = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
    const pool = enVoices.length > 0 ? enVoices : voices;
    return (
      pool.find((v) => /samantha|ava|allison|victoria|zira|aria|jenny|sonia|serena/i.test(v.name)) ||
      pool.find((v) => /google.*english.*female|female/i.test(v.name)) ||
      pool.find((v) => /en-US/i.test(v.lang)) ||
      pool[0] ||
      null
    );
  } catch {
    return null;
  }
}

function fallbackBrowserSpeak(cleanText: string, priority: boolean) {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (priority) {
      window.speechSynthesis.cancel();
    }
    const utterance = new SpeechSynthesisUtterance(cleanText);
    const voice = selectPreferredBrowserFemaleVoice();
    if (voice) {
      utterance.voice = voice;
    }
    utterance.rate = 1.15;
    utterance.pitch = 1.0;
    utterance.volume = 0.92;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Ignore speech synthesis errors on unsupported platforms
  }
}

function synthesizeViaWorker(text: string, timeoutMs = 6000): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const worker = ensurePiperWorker();
    if (!worker) {
      reject(new Error('Piper worker unavailable'));
      return;
    }
    const id = ++workerReqSeq;
    const timer = setTimeout(() => {
      pendingWorkerRequests.delete(id);
      reject(new Error('Piper synthesis timeout'));
    }, timeoutMs);

    pendingWorkerRequests.set(id, { resolve, reject, timer });
    worker.postMessage({
      type: 'synthesize',
      id,
      text,
      voiceId: PIPER_VOICE_ID,
    });
  });
}

async function prewarmCoreCallouts() {
  if (prewarmStarted) return;
  prewarmStarted = true;
  const phrases = [
    'Motors armed',
    'Motors disarmed',
    'Warning: telemetry link lost',
    'Telemetry link restored',
  ];
  for (const phrase of phrases) {
    if (audioBufferCache.has(phrase)) continue;
    try {
      const wavBuf = await synthesizeViaWorker(phrase, 12000);
      const ctx = getSharedAudioContext(false);
      if (ctx) {
        const decoded = await ctx.decodeAudioData(wavBuf.slice(0));
        cacheAudioBuffer(phrase, decoded);
      }
    } catch {
      // Ignore prewarm errors if audio context isn't unlocked yet
    }
  }
}

function ensurePiperWorker(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;
  if (piperWorker) return piperWorker;

  try {
    const worker = new Worker(new URL('./piperTts.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'status') {
        if (msg.status === 'downloading') {
          useAudioAlertsStore.setState({
            ttsStatus: 'downloading',
            ttsDownloadProgress: msg.progress ?? 0,
          });
        } else if (msg.status === 'ready') {
          useAudioAlertsStore.setState({
            ttsStatus: 'ready',
            ttsDownloadProgress: 100,
          });
          setTimeout(() => {
            prewarmCoreCallouts().catch(() => {});
          }, 400);
        } else if (msg.status === 'error') {
          useAudioAlertsStore.setState({ ttsStatus: 'fallback' });
        }
      } else if (msg.type === 'result') {
        const pending = pendingWorkerRequests.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          pendingWorkerRequests.delete(msg.id);
          useAudioAlertsStore.setState({ ttsStatus: 'ready', ttsDownloadProgress: 100 });
          pending.resolve(msg.wavBuffer);
        }
      } else if (msg.type === 'error') {
        const pending = pendingWorkerRequests.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          pendingWorkerRequests.delete(msg.id);
          pending.reject(new Error(msg.error || 'Synthesis error'));
        }
      }
    };

    worker.onerror = () => {
      useAudioAlertsStore.setState({ ttsStatus: 'fallback' });
    };

    piperWorker = worker;
    worker.postMessage({ type: 'init', voiceId: PIPER_VOICE_ID });
    return worker;
  } catch {
    useAudioAlertsStore.setState({ ttsStatus: 'fallback' });
    return null;
  }
}

export function normalizeCalloutText(text: string): string {
  return text
    .replace(/_/g, ' ')
    .replace(/^PreArm:\s*/i, 'Pre-arm: ')
    .replace(/\bRTL\b/g, 'Return to Launch')
    .replace(/\bPOSHOLD\b/gi, 'Position Hold')
    .replace(/\bALTHOLD\b/gi, 'Altitude Hold')
    .replace(/\bFBWA\b/gi, 'Fly By Wire A')
    .replace(/\bFBWB\b/gi, 'Fly By Wire B')
    .replace(/\bQLOITER\b/gi, 'Q Loiter')
    .replace(/\bQHOVER\b/gi, 'Q Hover')
    .replace(/\bQSTABILIZE\b/gi, 'Q Stabilize')
    .replace(/\bQLAND\b/gi, 'Q Land')
    .replace(/\bQRTL\b/gi, 'Q Return to Launch')
    .trim();
}

export function speakCallout(text: string, priority = false) {
  try {
    if (typeof window === 'undefined') return;
    const { soundEnabled, voiceEnabled, ttsStatus } = useAudioAlertsStore.getState();
    if (!soundEnabled || !voiceEnabled) return;

    const clean = normalizeCalloutText(text);
    if (!clean) return;

    const now = Date.now();
    if (clean === lastSpokenText && now - lastSpokenTime < 4000) {
      return;
    }
    lastSpokenText = clean;
    lastSpokenTime = now;

    // 1. Instant 0ms hit if phrase is already in the decoded AudioBuffer cache
    const cached = audioBufferCache.get(clean);
    if (cached) {
      enqueueCockpitBuffer(cached, priority);
      return;
    }

    // Ensure Piper worker is initialized
    ensurePiperWorker();

    // 2. If Piper model is still downloading on first run or unavailable, speak immediately
    // via fallback browser TTS while also queueing neural synthesis for the cache once ready.
    if (ttsStatus === 'downloading' || ttsStatus === 'fallback') {
      fallbackBrowserSpeak(clean, priority);
      return;
    }

    // 3. Synthesize via Piper Neural TTS Web Worker and play through Cockpit EQ
    synthesizeViaWorker(clean)
      .then(async (wavBuffer) => {
        const ctx = getSharedAudioContext();
        if (!ctx) {
          fallbackBrowserSpeak(clean, priority);
          return;
        }
        const decoded = await ctx.decodeAudioData(wavBuffer.slice(0));
        cacheAudioBuffer(clean, decoded);
        enqueueCockpitBuffer(decoded, priority);
      })
      .catch(() => {
        fallbackBrowserSpeak(clean, priority);
      });
  } catch {
    // Ignore errors on unsupported platforms
  }
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

export type TtsEngineStatus = 'idle' | 'downloading' | 'ready' | 'fallback';

interface AudioAlertsState {
  soundEnabled: boolean;
  voiceEnabled: boolean;
  waypointAnnounceEnabled: boolean;
  ttsStatus: TtsEngineStatus;
  ttsDownloadProgress: number;
  toggleSound: () => void;
  toggleVoice: () => void;
  toggleWaypointAnnounce: () => void;
  setSoundEnabled: (enabled: boolean) => void;
  setVoiceEnabled: (enabled: boolean) => void;
  setWaypointAnnounceEnabled: (enabled: boolean) => void;
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
  voiceEnabled: (() => {
    try {
      if (typeof localStorage !== 'undefined') {
        const val = localStorage.getItem(STORAGE_KEY_VOICE);
        if (val !== null) return val === 'true';
      }
    } catch {}
    return true;
  })(),
  waypointAnnounceEnabled: (() => {
    try {
      if (typeof localStorage !== 'undefined') {
        const val = localStorage.getItem(STORAGE_KEY_WAYPOINT_ANNOUNCE);
        if (val !== null) return val === 'true';
      }
    } catch {}
    return true;
  })(),
  ttsStatus: 'idle',
  ttsDownloadProgress: 0,
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
  toggleVoice: () => {
    const next = !get().voiceEnabled;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_VOICE, String(next));
      }
    } catch {}
    set({ voiceEnabled: next });
    if (next) {
      speakCallout('Voice callouts enabled', true);
    }
  },
  toggleWaypointAnnounce: () => {
    const next = !get().waypointAnnounceEnabled;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_WAYPOINT_ANNOUNCE, String(next));
      }
    } catch {}
    set({ waypointAnnounceEnabled: next });
    if (next && get().voiceEnabled && get().soundEnabled) {
      speakCallout('Waypoint announcements enabled');
    }
  },
  setSoundEnabled: (enabled: boolean) => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_SOUND, String(enabled));
      }
    } catch {}
    set({ soundEnabled: enabled });
  },
  setVoiceEnabled: (enabled: boolean) => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_VOICE, String(enabled));
      }
    } catch {}
    set({ voiceEnabled: enabled });
  },
  setWaypointAnnounceEnabled: (enabled: boolean) => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_WAYPOINT_ANNOUNCE, String(enabled));
      }
    } catch {}
    set({ waypointAnnounceEnabled: enabled });
  },
}));

/**
 * Top-level listener mounted in App.tsx.
 * Ensures alerts chime regardless of which tab is active, plays spoken callouts
 * for mode changes, arm/disarm, link loss/restore, low battery, and critical/PreArm
 * alerts, and maintains a Screen Wake Lock while connected.
 */
export function useAudioAlertListener() {
  const statusMessages = useTelemetryStore((state) => state.statusMessages);
  const heartbeat = useTelemetryStore((state) => state.heartbeat);
  const battery = useTelemetryStore((state) => state.battery);
  const hasConnectedInSession = useTelemetryStore((state) => state.hasConnectedInSession);
  const soundEnabled = useAudioAlertsStore((state) => state.soundEnabled);
  const voiceEnabled = useAudioAlertsStore((state) => state.voiceEnabled);
  const waypointAnnounceEnabled = useAudioAlertsStore((state) => state.waypointAnnounceEnabled);
  const lastReachedWaypointSeq = useTelemetryStore((state) => state.lastReachedWaypointSeq);
  const currentWaypointSeq = useTelemetryStore((state) => state.currentWaypointSeq);
  const lastSeenIdRef = useRef<string | null>(statusMessages[0]?.id ?? null);
  const prevModeRef = useRef<string>(heartbeat.modeName);
  const prevArmedRef = useRef<boolean>(heartbeat.isArmed);
  const prevLinkLostRef = useRef<boolean>(false);
  const batteryWarnedRef = useRef<'none' | 'low' | 'critical'>('none');
  const lastAnnouncedWpRef = useRef<number>(-1);
  const prevWpSeqRef = useRef<number>(currentWaypointSeq);

  // Initialize Piper Neural TTS Worker in the background when voice callouts are enabled
  useEffect(() => {
    if (soundEnabled && voiceEnabled) {
      ensurePiperWorker();
    }
  }, [soundEnabled, voiceEnabled]);

  // StatusText chimes and spoken callouts
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

      const spokenCandidate = alertMsgs.find(
        (m) =>
          m.severity <= 2 ||
          /^(PreArm:|Arm:|Takeoff:|Failsafe|EKF|Battery|Fence)/i.test(m.text.trim())
      );
      if (spokenCandidate && !/^CMD\s+/i.test(spokenCandidate.text)) {
        speakCallout(spokenCandidate.text, spokenCandidate.severity <= 2);
      }
    }
  }, [statusMessages, soundEnabled]);

  // Mode change & Arm/Disarm spoken callouts
  useEffect(() => {
    if (heartbeat.lastHeartbeatTime === 0 || heartbeat.modeName === 'DISCONNECTED') {
      prevModeRef.current = heartbeat.modeName;
      prevArmedRef.current = heartbeat.isArmed;
      return;
    }

    // Synchronize initial state on reconnect without false "Motors armed" or mode callout
    if (prevModeRef.current === 'DISCONNECTED') {
      prevModeRef.current = heartbeat.modeName;
      prevArmedRef.current = heartbeat.isArmed;
      return;
    }

    if (prevArmedRef.current !== heartbeat.isArmed) {
      prevArmedRef.current = heartbeat.isArmed;
      playAlertChime(heartbeat.isArmed ? 3 : 4);
      speakCallout(heartbeat.isArmed ? 'Motors armed' : 'Motors disarmed', true);
    }

    if (prevModeRef.current !== heartbeat.modeName) {
      prevModeRef.current = heartbeat.modeName;
      speakCallout(`Flight mode ${heartbeat.modeName}`);
    }
  }, [heartbeat.modeName, heartbeat.isArmed, heartbeat.lastHeartbeatTime]);

  // Spoken mission progress ("waypoint n") upon arriving at each waypoint
  useEffect(() => {
    if (heartbeat.lastHeartbeatTime === 0 || heartbeat.modeName === 'DISCONNECTED') {
      lastAnnouncedWpRef.current = -1;
      prevWpSeqRef.current = currentWaypointSeq;
      return;
    }

    if (!soundEnabled || !voiceEnabled || !waypointAnnounceEnabled) {
      prevWpSeqRef.current = currentWaypointSeq;
      return;
    }

    // 1. Direct MAVLink MISSION_ITEM_REACHED event
    if (lastReachedWaypointSeq > 0 && lastReachedWaypointSeq !== lastAnnouncedWpRef.current) {
      lastAnnouncedWpRef.current = lastReachedWaypointSeq;
      speakCallout(`Waypoint ${lastReachedWaypointSeq}`);
      prevWpSeqRef.current = currentWaypointSeq;
      return;
    }

    // 2. Autopilot advanced current waypoint during mission (fallback when MISSION_ITEM_REACHED is not emitted)
    if (currentWaypointSeq > prevWpSeqRef.current && prevWpSeqRef.current > 0 && heartbeat.isArmed) {
      const completedWp = prevWpSeqRef.current;
      if (completedWp !== lastAnnouncedWpRef.current) {
        lastAnnouncedWpRef.current = completedWp;
        speakCallout(`Waypoint ${completedWp}`);
      }
    }
    prevWpSeqRef.current = currentWaypointSeq;
  }, [
    lastReachedWaypointSeq,
    currentWaypointSeq,
    heartbeat.isArmed,
    heartbeat.lastHeartbeatTime,
    soundEnabled,
    voiceEnabled,
    waypointAnnounceEnabled,
  ]);

  // Battery threshold callouts (25% Low, 15% Critical)
  useEffect(() => {
    if (heartbeat.lastHeartbeatTime === 0 || battery.voltage <= 0 || battery.remaining <= 0) {
      return;
    }
    if (battery.remaining <= 15 && batteryWarnedRef.current !== 'critical') {
      batteryWarnedRef.current = 'critical';
      if (soundEnabled) {
        playAlertChime(1);
        speakCallout(`Critical battery, ${Math.round(battery.remaining)} percent`, true);
      }
    } else if (
      battery.remaining <= 25 &&
      battery.remaining > 15 &&
      batteryWarnedRef.current === 'none'
    ) {
      batteryWarnedRef.current = 'low';
      if (soundEnabled) {
        playAlertChime(3);
        speakCallout(`Low battery, ${Math.round(battery.remaining)} percent`);
      }
    } else if (battery.remaining > 30) {
      batteryWarnedRef.current = 'none';
    }
  }, [battery.remaining, battery.voltage, heartbeat.lastHeartbeatTime, soundEnabled]);

  // Link-loss watchdog + Screen Wake Lock
  useEffect(() => {
    let wakeLockSentinel: any = null;

    const requestWakeLock = async () => {
      try {
        if (
          typeof navigator !== 'undefined' &&
          'wakeLock' in navigator &&
          document.visibilityState === 'visible'
        ) {
          wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
        }
      } catch {
        // Ignore WakeLock errors on unsupported browsers
      }
    };

    if (hasConnectedInSession) {
      requestWakeLock();
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && hasConnectedInSession) {
        requestWakeLock();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    const interval = setInterval(() => {
      const st = useTelemetryStore.getState();
      if (!st.hasConnectedInSession || mavlinkConnection.isManualDisconnect) {
        prevLinkLostRef.current = false;
        return;
      }
      const lastHb = st.heartbeat.lastHeartbeatTime;
      const isLost = lastHb === 0 || Date.now() - lastHb > 3500;

      if (isLost && !prevLinkLostRef.current) {
        prevLinkLostRef.current = true;
        if (useAudioAlertsStore.getState().soundEnabled) {
          playAlertChime(1);
          speakCallout('Warning: telemetry link lost', true);
        }
      } else if (!isLost && prevLinkLostRef.current) {
        prevLinkLostRef.current = false;
        if (useAudioAlertsStore.getState().soundEnabled) {
          playAlertChime(4);
          speakCallout('Telemetry link restored', true);
        }
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      if (wakeLockSentinel && typeof wakeLockSentinel.release === 'function') {
        wakeLockSentinel.release().catch(() => {});
      }
    };
  }, [hasConnectedInSession]);
}
