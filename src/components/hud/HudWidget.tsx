import React, { useEffect, useRef, useState } from 'react';

import clsx from 'clsx';
import { Compass, Sliders, Sun, Video } from 'lucide-react';

import { displayAltitudeM } from '../../lib/displayAltitude';
import { isFailsafeActive } from '../../lib/failsafe';
import { mavlinkConnection } from '../../mavlink/connection';
import { MAVLINK_MSG_ID } from '../../mavlink/messages';
import { messageRateManager } from '../../mavlink/rateManager';
import { heartbeatLiveMs } from '../../mavlink/replayClock';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { useInPane } from '../dashboard/paneContext';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Modal } from '../ui/modal';
import { CameraFeed, type CameraStatus } from './CameraFeed';

export interface HudVideoConfig {
  enabled: boolean;
  url: string;
  type: 'mjpeg' | 'snapshot' | 'video' | 'whep';
  /** WHEP: bearer token for the endpoint, if it needs one. */
  whepToken?: string;
  fit: 'cover' | 'contain';
  opacity: number;
  darken: number;
  snapshotIntervalMs: number;
  symbologyBrightness: number;
}

const STORAGE_KEY = 'glareshield_hud_video_config';

const DEFAULT_HUD_VIDEO_CONFIG: HudVideoConfig = {
  enabled: false,
  url: '',
  type: 'mjpeg',
  fit: 'cover',
  opacity: 1.0,
  darken: 0.2,
  snapshotIntervalMs: 200,
  symbologyBrightness: 1.0,
  whepToken: '',
};

/**
 * A text field that applies its value when you leave it or press Enter, not on every keystroke: a stream address
 * or token half-typed would otherwise open (and, for WHEP, authenticate to) a connection per character.
 */
const CommitInput: React.FC<
  { value: string; onCommit: (v: string) => void } & Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onChange'
  >
> = ({ value, onCommit, ...rest }) => {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  const commit = () => text !== value && onCommit(text);
  return (
    <input
      {...rest}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
};

function lerpColor(r: number, g: number, b: number, whiteness: number, a?: number): string {
  const nr = Math.round(r + (255 - r) * whiteness);
  const ng = Math.round(g + (255 - g) * whiteness);
  const nb = Math.round(b + (255 - b) * whiteness);
  if (a !== undefined) {
    const na = Math.min(1.0, a + (0.55 - a) * whiteness);
    return `rgba(${nr}, ${ng}, ${nb}, ${na.toFixed(2)})`;
  }
  return `rgb(${nr}, ${ng}, ${nb})`;
}

function loadHudVideoConfig(): HudVideoConfig {
  if (typeof window === 'undefined') return DEFAULT_HUD_VIDEO_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_HUD_VIDEO_CONFIG;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_HUD_VIDEO_CONFIG,
      ...parsed,
      symbologyBrightness:
        typeof parsed.symbologyBrightness === 'number'
          ? Math.max(0.1, Math.min(2.0, parsed.symbologyBrightness))
          : DEFAULT_HUD_VIDEO_CONFIG.symbologyBrightness,
    };
  } catch {
    return DEFAULT_HUD_VIDEO_CONFIG;
  }
}

function saveHudVideoConfig(cfg: HudVideoConfig) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {}
}

export const HudWidget: React.FC = () => {
  // In a Cockpit pane: fill it (no minimum heights; lists scroll inside).
  const inPane = useInPane();
  const heartbeat = useTelemetryStore((state) => state.heartbeat);
  // The fast-changing telemetry (attitude, speeds, position, ...) is not React state here: the canvas is drawn from a
  // requestAnimationFrame loop that reads the store, so a packet doesn't re-render this component (and its
  // settings). Only what the markup needs, and the slow inputs, are subscribed.
  const statusMessages = useTelemetryStore((state) => state.statusMessages);
  const {
    formatSpeed,
    formatAltitude,
    formatClimb,
    formatDistance,
    formatHomeVector,
    system: unitSystem,
    altitudeMode,
  } = useUnitsStore();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fpmStateRef = useRef<{ gamma: number; delta: number; initialized: boolean; lastTime: number }>({
    gamma: 0,
    delta: 0,
    initialized: false,
    lastTime: 0,
  });

  const [videoConfig, setVideoConfig] = useState<HudVideoConfig>(loadHudVideoConfig);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>({ state: 'connecting', method: 'img' });
  const [cameraReconnectKey, setCameraReconnectKey] = useState(0);
  const [flashTick, setFlashTick] = useState(0);
  const [dimensions, setDimensions] = useState<{ width: number; height: number; dpr: number }>({
    width: 0,
    height: 0,
    dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
  });

  // Track canvas container size via ResizeObserver to keep canvas razor-sharp on resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateSize = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      setDimensions((prev) => {
        if (prev.width === width && prev.height === height && prev.dpr === dpr) return prev;
        return { width, height, dpr };
      });
    };

    updateSize();

    const ro = new ResizeObserver(() => {
      updateSize();
    });
    ro.observe(canvas);

    window.addEventListener('resize', updateSize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  const isFailsafe = isFailsafeActive(heartbeat, statusMessages);

  // Flash timer for active FAILSAFE alert (~1 Hz cycle)
  useEffect(() => {
    if (!isFailsafe) return;
    const timer = setInterval(() => {
      setFlashTick((t) => (t + 1) % 1000);
    }, 500);
    return () => clearInterval(timer);
  }, [isFailsafe]);

  // Reconnect the camera when it is most likely to have dropped: the tab or phone waking after being hidden,
  // the network coming back, or the vehicle link reconnecting (same network path, often the same outage).
  useEffect(() => {
    const reconnect = () => setCameraReconnectKey((k) => k + 1);
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 5000) reconnect();
    };
    let wasConnected = mavlinkConnection.getStatus() === 'connected';
    const unsubscribe = mavlinkConnection.onStatus((st) => {
      const isConnected = st === 'connected';
      if (isConnected && !wasConnected) reconnect();
      wasConnected = isConnected;
    });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', reconnect);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', reconnect);
    };
  }, []);

  const handleUpdateConfig = (updates: Partial<HudVideoConfig>) => {
    setVideoConfig((prev) => {
      const next = { ...prev, ...updates };
      saveHudVideoConfig(next);
      return next;
    });
  };

  // Register subscription for high-frequency attitude, VFR, NAV_CONTROLLER and IMU. (STATUSTEXT needs no request:
  // the autopilot sends it whenever it has something to say.)
  useEffect(() => {
    messageRateManager.registerRequirement('hud-attitude', MAVLINK_MSG_ID.ATTITUDE);
    messageRateManager.registerRequirement('hud-vfr', MAVLINK_MSG_ID.VFR_HUD);
    messageRateManager.registerRequirement('hud-pos', MAVLINK_MSG_ID.GLOBAL_POSITION_INT);
    messageRateManager.registerRequirement('hud-nav', MAVLINK_MSG_ID.NAV_CONTROLLER_OUTPUT);
    messageRateManager.registerRequirement('hud-imu', MAVLINK_MSG_ID.RAW_IMU);
    messageRateManager.registerRequirement('hud-scaled-imu', MAVLINK_MSG_ID.SCALED_IMU);
    messageRateManager.registerRequirement('hud-highres-imu', MAVLINK_MSG_ID.HIGHRES_IMU);
    return () => {
      messageRateManager.unregisterRequirement('hud-attitude');
      messageRateManager.unregisterRequirement('hud-vfr');
      messageRateManager.unregisterRequirement('hud-pos');
      messageRateManager.unregisterRequirement('hud-nav');
      messageRateManager.unregisterRequirement('hud-imu');
      messageRateManager.unregisterRequirement('hud-scaled-imu');
      messageRateManager.unregisterRequirement('hud-highres-imu');
    };
  }, []);

  const dirtyRef = useRef(true);
  // Any render (settings, size, units, failsafe flash) means the picture may have changed.
  dirtyRef.current = true;
  const drawRef = useRef<() => void>(() => {});
  drawRef.current = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const {
      attitude,
      vfr,
      position,
      navController,
      homePosition,
      missionWaypoints,
      currentWaypointSeq,
      imu,
      heartbeat,
      hasConnectedInSession,
    } = useTelemetryStore.getState();

    // Handle high DPI
    const dpr = dimensions.dpr || window.devicePixelRatio || 1;
    const width = dimensions.width || canvas.clientWidth;
    const height = dimensions.height || canvas.clientHeight;
    if (width === 0 || height === 0) return;

    // Resizing the canvas reallocates its backing store (and wipes the context): only when the size changes.
    const bw = Math.round(width * dpr);
    const bh = Math.round(height * dpr);
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    // The context keeps its state between frames now, so each frame starts from a clean one (and the finally
    // below puts it back, whatever path the drawing takes).
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    try {
      const cx = width / 2;
      const cy = height / 2;

      // =========================================================
      // Clear Background - Deep cockpit glass or Live Camera Video
      // =========================================================
      const isVideoBackground = videoConfig.enabled && Boolean(videoConfig.url.trim());
      if (isVideoBackground) {
        ctx.clearRect(0, 0, width, height);
        if (videoConfig.darken > 0) {
          ctx.fillStyle = `rgba(0, 0, 0, ${videoConfig.darken})`;
          ctx.fillRect(0, 0, width, height);
        }
        // Edge vignette to keep outer tape scales legible over bright camera feeds
        const maxRadius = Math.hypot(cx, cy);
        const hudGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxRadius);
        hudGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
        hudGrad.addColorStop(0.55, 'rgba(0, 0, 0, 0.08)');
        hudGrad.addColorStop(1, 'rgba(0, 0, 0, 0.65)');
        ctx.fillStyle = hudGrad;
        ctx.fillRect(0, 0, width, height);

        // Contrast drop-shadow for HUD vector symbology over video
        ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
        ctx.shadowBlur = 3;
      } else {
        ctx.fillStyle = '#051509';
        ctx.fillRect(0, 0, width, height);

        // Smooth optical falloff toward corners (pure dark falloff, zero green donut/banding)
        const maxRadius = Math.hypot(cx, cy);
        const hudGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxRadius);
        hudGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
        hudGrad.addColorStop(0.45, 'rgba(0, 0, 0, 0.08)');
        hudGrad.addColorStop(0.75, 'rgba(0, 0, 0, 0.45)');
        hudGrad.addColorStop(1, 'rgba(0, 0, 0, 0.88)');
        ctx.fillStyle = hudGrad;
        ctx.fillRect(0, 0, width, height);

        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
      }

      const rawBrightness =
        typeof videoConfig.symbologyBrightness === 'number'
          ? Math.max(0.1, Math.min(2.0, videoConfig.symbologyBrightness))
          : 1.0;

      // Below 1.0: Dim alpha from 1.0 down to 0.1 (Night mode)
      // Above 1.0: Alpha stays 1.0, while colors smoothly interpolate from green to pure white at 2.0 (Daylight overdrive)
      const symbologyAlpha = Math.min(1.0, rawBrightness);
      const whiteness = Math.max(0, Math.min(1.0, rawBrightness - 1.0));

      const HUD_GREEN = lerpColor(34, 197, 94, whiteness);
      const HUD_DIM_GREEN = lerpColor(34, 197, 94, whiteness, 0.35);
      const HUD_BRIGHT = lerpColor(74, 222, 128, whiteness);
      const HUD_HIGHLIGHT = lerpColor(134, 239, 172, whiteness);
      const HUD_BORDER = HUD_GREEN; // Secondary readout outlines (matches heading box)

      const hasLink =
        heartbeat.lastHeartbeatTime > 0 &&
        heartbeat.modeName !== 'DISCONNECTED' &&
        Date.now() - heartbeat.lastHeartbeatTime <= heartbeatLiveMs();

      // Geometric layouts for HUD overlay instruments
      const PITCH_SCALE = 4.2; // Pixels per degree
      // Readout text and its boxes grow with the HUD: 1x up to a 520 x 380 HUD, at most 1.3x, so a large HUD is
      // easier to read and a small one keeps its layout. In a Cockpit pane (which may be smaller than a Flow card ever
      // is) they also shrink, to 0.8x, so the corner readouts and the compass tape still fit. The pitch ladder's
      // spacing doesn't change.
      const ts = Math.max(inPane ? 0.8 : 1, Math.min(1.3, Math.min(width / 520, height / 380)));
      const hudFont = (px: number, weight = 'bold') =>
        `${weight} ${(px * ts).toFixed(1)}px ui-monospace, SFMono-Regular, monospace`;
      // Steady disarm banner ~18 deg above the horizon, but always below the compass tape (a short HUD, in a small pane).
      const disarmY = Math.max(cy - 18 * PITCH_SCALE, 40 * ts + 14 * ts);
      const failsafeY = disarmY + 25 * ts; // Directly below DISARMED
      const isFlashVisible = flashTick % 2 === 0;

      // The speed and altitude boxes flank the horizon within a core about as wide as the HUD is tall: at the edges of
      // a usual HUD, but on a wide, short one (a wide screen) they stay beside the pitch ladder rather than drifting
      // to the far edges, away from what they're read against.
      const coreHalf = Math.min(cx - 10, Math.max(260 * ts, height * 0.9));
      const spdBoxX = cx - coreHalf;
      const spdBoxW = 62 * ts;
      const spdBoxH = 30 * ts;
      const spdBoxY = cy - spdBoxH / 2;

      const altBoxW = 62 * ts;
      const altBoxX = cx + coreHalf - altBoxW;
      const altBoxH = 30 * ts;
      const altBoxY = cy - altBoxH / 2;

      // Narrower on a small HUD, so it stays clear of the corner readouts (G and home, up to ~140 px each at 1x).
      const tapeWidth = Math.max(120, Math.min(280, width - 110, width - 2 * (140 * ts + 12)));

      ctx.save();
      ctx.globalAlpha = symbologyAlpha;

      // Inner viewport clipping
      ctx.beginPath();
      ctx.rect(0, 0, width, height);
      ctx.clip();

      // =========================================================
      // 1. Artificial Horizon & Pitch Ladder (Rotates with roll)
      // Masked around all HUD overlay instruments using evenodd clipping
      // so rungs and horizon lines never cross behind flight readouts.
      // =========================================================
      ctx.save();
      ctx.beginPath();
      // Outer canvas boundary
      ctx.rect(0, 0, width, height);

      // Instrument cutouts (evenodd winding rule cuts these out of the ladder drawing)
      // Left speed tape corridor (bracket, IAS box, GS readout)
      ctx.rect(0, cy - 68 * ts, spdBoxX + spdBoxW + 8, 136 * ts);
      // Right altitude tape corridor (bracket, Alt box, VVI readout)
      ctx.rect(altBoxX - 8, cy - 68 * ts, width - altBoxX + 8, 136 * ts);
      // Top compass tape & digital heading box
      ctx.rect(cx - tapeWidth / 2 - 2, 0, tapeWidth + 4, 40 * ts);
      // Bottom left WP progress readout
      ctx.rect(0, height - 44 * ts, 145 * ts, 44 * ts);
      // Bottom right Throttle readout
      ctx.rect(width - 95 * ts, height - 32 * ts, 95 * ts, 32 * ts);
      // Top left Load Factor (Nz) readout
      ctx.rect(0, 0, 80 * ts, 30 * ts);
      // Top right Home vector readout (if active)
      if (hasLink && homePosition.distanceM !== null) {
        ctx.rect(width - 155 * ts, 0, 155 * ts, 30 * ts);
      }
      // Link lost banner (if active)
      if (!hasLink) {
        ctx.rect(cx - 130 * ts, 40 * ts, 260 * ts, 26 * ts);
      }
      // Central DISARMED / FAILSAFE annunciation cutouts
      if (hasLink && !heartbeat.isArmed) {
        ctx.rect(cx - 56 * ts, disarmY - 11 * ts, 112 * ts, 22 * ts);
      }
      if (isFailsafe && isFlashVisible) {
        ctx.rect(cx - 56 * ts, failsafeY - 11 * ts, 112 * ts, 22 * ts);
      }
      ctx.clip('evenodd');

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-attitude.roll);

      const pitchOffset = attitude.pitchDeg * PITCH_SCALE;
      ctx.translate(0, pitchOffset);

      // Horizon line with central 44px gap for boresight
      ctx.strokeStyle = HUD_GREEN;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([]);
      ctx.beginPath();
      // Left horizon segment
      ctx.moveTo(-width * 0.45, 0);
      ctx.lineTo(-24, 0);
      // Right horizon segment
      ctx.moveTo(24, 0);
      ctx.lineTo(width * 0.45, 0);
      ctx.stroke();

      // Pitch Ladder (MIL-STD style)
      ctx.font = hudFont(10, 'normal');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let deg = -50; deg <= 50; deg += 5) {
        if (deg === 0) continue;
        const y = -deg * PITCH_SCALE;
        const isMajor = deg % 10 === 0;
        const armWidth = isMajor ? 32 : 18;
        const tickHeight = isMajor ? 6 : 4;

        if (deg > 0) {
          // Positive pitch: Solid line with downward ticks (toward horizon)
          ctx.strokeStyle = HUD_GREEN;
          ctx.fillStyle = HUD_BRIGHT;
          ctx.lineWidth = 1.4;
          ctx.setLineDash([]);

          // Left arm
          ctx.beginPath();
          ctx.moveTo(-armWidth - 14, y);
          ctx.lineTo(-14, y);
          ctx.lineTo(-14, y + tickHeight);
          ctx.stroke();

          // Right arm
          ctx.beginPath();
          ctx.moveTo(14 + armWidth, y);
          ctx.lineTo(14, y);
          ctx.lineTo(14, y + tickHeight);
          ctx.stroke();

          if (isMajor) {
            ctx.fillText(deg.toString(), -armWidth - 24, y);
            ctx.fillText(deg.toString(), armWidth + 24, y);
          }
        } else {
          // Negative pitch: Dashed line with upward ticks (toward horizon)
          ctx.strokeStyle = HUD_GREEN;
          ctx.fillStyle = HUD_BRIGHT;
          ctx.lineWidth = 1.2;
          ctx.setLineDash([4, 3]);

          // Left arm
          ctx.beginPath();
          ctx.moveTo(-armWidth - 14, y);
          ctx.lineTo(-14, y);
          ctx.lineTo(-14, y - tickHeight);
          ctx.stroke();

          // Right arm
          ctx.beginPath();
          ctx.moveTo(14 + armWidth, y);
          ctx.lineTo(14, y);
          ctx.lineTo(14, y - tickHeight);
          ctx.stroke();

          if (isMajor) {
            ctx.fillText(Math.abs(deg).toString(), -armWidth - 24, y);
            ctx.fillText(Math.abs(deg).toString(), armWidth + 24, y);
          }
        }
      }
      ctx.setLineDash([]);
      ctx.restore(); // Restores roll & pitch transform
      ctx.restore(); // Restores evenodd cutout clipping mask (returns to full viewport)

      // =========================================================
      // 1b. Flight Path Marker (FPM) / Velocity Vector (The "Bird")
      // Conformal Earth-referenced trajectory marker anchored to the
      // flight path angle (gamma) and track drift relative to heading.
      // Screen position is computed first and then clamped in screen
      // coordinates so steep climbs and dives are never falsely caged.
      // Wings remain strictly parallel to the aircraft waterline.
      // =========================================================
      let vn = position.vx;
      let ve = position.vy;
      let vd = position.vz;

      // Fallback if position.vx/vy are not yet populated
      if (Math.hypot(vn, ve) < 0.1 && vfr.groundspeed > 0.1) {
        const hdgRad = (attitude.yawDeg * Math.PI) / 180;
        vn = vfr.groundspeed * Math.cos(hdgRad);
        ve = vfr.groundspeed * Math.sin(hdgRad);
        vd = -vfr.climb;
      }

      const gs = Math.hypot(vn, ve);
      const climb = Math.abs(vd) > 0.05 ? -vd : vfr.climb;

      // Flight Path Angle (gamma: degrees above horizon)
      let fpaDeg = 0;
      if (gs > 0.2) {
        fpaDeg = (Math.atan2(climb, gs) * 180) / Math.PI;
      }

      // Track (Course Over Ground) & Drift Angle relative to heading.
      // Prefer GLOBAL_POSITION_INT's own hdg (sampled synchronously with velocity),
      // falling back to ATTITUDE yaw only when hdg is unknown (65535 or undefined).
      let driftDeg = 0;
      if (gs > 0.2) {
        let trackDeg = (Math.atan2(ve, vn) * 180) / Math.PI;
        if (trackDeg < 0) trackDeg += 360;

        const posHdg = position.hdg;
        const hasValidPosHdg = posHdg != null && posHdg !== 65535 && posHdg !== 655.35;
        const refHeadingDeg = hasValidPosHdg ? posHdg : attitude.yawDeg;

        driftDeg = trackDeg - refHeadingDeg;
        while (driftDeg > 180) driftDeg -= 360;
        while (driftDeg < -180) driftDeg += 360;
      }

      // Always visible: when stationary (gs < 0.4), smoothly park the FPM on the
      // aircraft boresight/waterline (gamma = pitch, drift = 0).
      const blend = Math.min(1.0, Math.max(0.0, (gs - 0.4) / 0.8));
      const targetGamma = (1 - blend) * attitude.pitchDeg + blend * fpaDeg;
      const targetDelta = blend * driftDeg;

      // Time-based smoothing with shortest-arc wrapping at +/-180 deg
      const now = performance.now();
      if (!fpmStateRef.current.initialized) {
        fpmStateRef.current = {
          gamma: targetGamma,
          delta: targetDelta,
          initialized: true,
          lastTime: now,
        };
      } else {
        const dt = Math.min(Math.max((now - fpmStateRef.current.lastTime) / 1000, 0.001), 0.5);
        fpmStateRef.current.lastTime = now;

        // Time-based exponential smoothing: tau ~ 0.23s (matches alpha = 0.35 at 10 Hz)
        const alpha = 1 - Math.exp(-dt / 0.23);

        fpmStateRef.current.gamma += (targetGamma - fpmStateRef.current.gamma) * alpha;

        // Shortest-arc angular difference to prevent 360-degree sweep when reversing (+/-180 wrap)
        let deltaDiff = targetDelta - fpmStateRef.current.delta;
        while (deltaDiff > 180) deltaDiff -= 360;
        while (deltaDiff < -180) deltaDiff += 360;

        fpmStateRef.current.delta += deltaDiff * alpha;
        while (fpmStateRef.current.delta > 180) fpmStateRef.current.delta -= 360;
        while (fpmStateRef.current.delta < -180) fpmStateRef.current.delta += 360;
      }

      const displayGamma = fpmStateRef.current.gamma;
      const displayDelta = fpmStateRef.current.delta;

      // Compute the marker's unclamped screen offset from HUD center (cx, cy).
      // In the roll-rotated frame:
      //   xr = displayDelta * PITCH_SCALE
      //   yr = (attitude.pitchDeg - displayGamma) * PITCH_SCALE
      // Rotating by the horizon's rotation (-attitude.roll) gives true screen offsets:
      const xr = displayDelta * PITCH_SCALE;
      const yr = (attitude.pitchDeg - displayGamma) * PITCH_SCALE;
      const rollRot = -attitude.roll;
      const cosR = Math.cos(rollRot);
      const sinR = Math.sin(rollRot);
      const screenDx = xr * cosR - yr * sinR;
      const screenDy = xr * sinR + yr * cosR;

      // Clamp in screen coordinates to central corridor (so steep climbs/dives are never
      // falsely clamped against the off-screen horizon line)
      const maxScreenDx = width * 0.34;
      const maxScreenDy = height * 0.38;
      const isCaged = Math.abs(screenDx) > maxScreenDx || Math.abs(screenDy) > maxScreenDy;
      const clampedDx = Math.max(-maxScreenDx, Math.min(maxScreenDx, screenDx));
      const clampedDy = Math.max(-maxScreenDy, Math.min(maxScreenDy, screenDy));

      const fpmScreenX = cx + clampedDx;
      const fpmScreenY = cy + clampedDy;

      // Draw the FPM Symbol in screen space:
      // Wings remain strictly parallel to the waterline (screen horizontal)
      ctx.save();
      ctx.strokeStyle = HUD_HIGHLIGHT;
      ctx.fillStyle = HUD_HIGHLIGHT;
      ctx.lineWidth = 1.8;
      if (isCaged) {
        ctx.setLineDash([3, 2]); // Caged indicator
      } else {
        ctx.setLineDash([]);
      }

      // Center circle (5px radius, open center without dot)
      ctx.beginPath();
      ctx.arc(fpmScreenX, fpmScreenY, 5, 0, Math.PI * 2);
      ctx.stroke();

      // Left wing / leg (7px wide, parallel to waterline)
      ctx.beginPath();
      ctx.moveTo(fpmScreenX - 5, fpmScreenY);
      ctx.lineTo(fpmScreenX - 12, fpmScreenY);
      ctx.stroke();

      // Right wing / leg (7px wide, parallel to waterline)
      ctx.beginPath();
      ctx.moveTo(fpmScreenX + 5, fpmScreenY);
      ctx.lineTo(fpmScreenX + 12, fpmScreenY);
      ctx.stroke();

      // Top vertical fin (5px tall, perpendicular to waterline)
      ctx.beginPath();
      ctx.moveTo(fpmScreenX, fpmScreenY - 5);
      ctx.lineTo(fpmScreenX, fpmScreenY - 10);
      ctx.stroke();

      ctx.restore();

      // =========================================================
      // 2. Aircraft Waterline / Boresight Reticle (Fixed center)
      // =========================================================
      ctx.strokeStyle = HUD_BRIGHT;
      ctx.fillStyle = HUD_BRIGHT;
      ctx.lineWidth = 2.0;

      // Waterline symbol: center inverted caret with side wings
      ctx.beginPath();
      // Center caret
      ctx.moveTo(cx - 5, cy);
      ctx.lineTo(cx, cy + 4);
      ctx.lineTo(cx + 5, cy);
      // Left wing
      ctx.moveTo(cx - 30, cy);
      ctx.lineTo(cx - 10, cy);
      // Right wing
      ctx.moveTo(cx + 10, cy);
      ctx.lineTo(cx + 30, cy);
      ctx.stroke();

      // Center tiny dot
      ctx.beginPath();
      ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
      ctx.fill();

      // =========================================================
      // 3. Roll Index & Bank Angle Scale (Continuous bottom arc)
      // =========================================================
      ctx.save();
      const rollRadius = Math.min(cx * 0.72, cy - 40);
      ctx.strokeStyle = HUD_DIM_GREEN;
      ctx.lineWidth = 1.3;

      // Continuous unbroken arc spanning full scale from -60° to +60°
      // (In canvas 2D: 0 rad is 3 o'clock, 90° (PI/2) is 6 o'clock straight down)
      // -60° bank = 30° in canvas = (30 * PI) / 180
      // +60° bank = 150° in canvas = (150 * PI) / 180
      ctx.beginPath();
      ctx.arc(cx, cy, rollRadius, (30 * Math.PI) / 180, (150 * Math.PI) / 180);
      ctx.stroke();

      // Bank angle tick marks anchored to continuous arc
      [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60].forEach((ang) => {
        const rad = (ang + 90) * (Math.PI / 180);
        const isMajor = Math.abs(ang) === 30 || Math.abs(ang) === 60 || ang === 0;
        const r1 = rollRadius - (isMajor ? 7 : 4);
        const r2 = rollRadius;
        ctx.beginPath();
        ctx.moveTo(cx + r1 * Math.cos(rad), cy + r1 * Math.sin(rad));
        ctx.lineTo(cx + r2 * Math.cos(rad), cy + r2 * Math.sin(rad));
        ctx.strokeStyle = isMajor ? HUD_GREEN : HUD_DIM_GREEN;
        ctx.lineWidth = isMajor ? 1.4 : 1.0;
        ctx.stroke();
      });

      // Roll indicator pointer triangle (glides along continuous arc)
      ctx.translate(cx, cy);
      ctx.rotate(-attitude.roll);
      ctx.fillStyle = HUD_HIGHLIGHT;
      ctx.beginPath();
      ctx.moveTo(0, rollRadius - 2);
      ctx.lineTo(-4, rollRadius - 10);
      ctx.lineTo(4, rollRadius - 10);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // =========================================================
      // 4. Moving Heading Compass Tape (Top) - Smooth scrolling fix
      // =========================================================
      const tapeY = 18;
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx - tapeWidth / 2, 0, tapeWidth, 40); // Tall enough for labels below ticks
      ctx.clip();

      const degPx = 4; // 4 pixels per compass degree
      const curHdg = ((vfr.heading % 360) + 360) % 360;

      // Compute visible compass degree range based on tape width
      const visibleRange = Math.ceil(tapeWidth / 2 / degPx) + 5;
      const startDeg = Math.floor((curHdg - visibleRange) / 5) * 5;
      const endDeg = Math.ceil((curHdg + visibleRange) / 5) * 5;

      for (let d = startDeg; d <= endDeg; d += 5) {
        const normDeg = ((d % 360) + 360) % 360;
        const x = cx + (d - curHdg) * degPx;

        const isCard = normDeg % 90 === 0;
        const isMajor = normDeg % 30 === 0;
        const isTen = normDeg % 10 === 0;

        const tickLen = isCard ? 10 : isMajor ? 8 : isTen ? 5 : 3;

        ctx.strokeStyle = isCard ? HUD_HIGHLIGHT : isMajor ? HUD_BRIGHT : HUD_DIM_GREEN;
        ctx.lineWidth = isCard ? 2.0 : isMajor ? 1.4 : 1.0;
        ctx.beginPath();
        ctx.moveTo(x, tapeY);
        ctx.lineTo(x, tapeY + tickLen);
        ctx.stroke();

        if (isCard) {
          ctx.fillStyle = HUD_HIGHLIGHT;
          ctx.font = hudFont(10);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          const label = normDeg === 0 ? 'N' : normDeg === 90 ? 'E' : normDeg === 180 ? 'S' : 'W';
          ctx.fillText(label, x, tapeY + 12);
        } else if (isMajor) {
          ctx.fillStyle = HUD_BRIGHT;
          ctx.font = hudFont(10);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText((normDeg / 10).toFixed(0).padStart(2, '0'), x, tapeY + 12);
        }
      }
      ctx.restore();

      // Central Heading Caret & Digital Heading Box
      ctx.strokeStyle = HUD_BRIGHT;
      ctx.fillStyle = HUD_BRIGHT;
      ctx.beginPath();
      ctx.moveTo(cx, tapeY + 3);
      ctx.lineTo(cx - 4, tapeY - 4);
      ctx.lineTo(cx + 4, tapeY - 4);
      ctx.closePath();
      ctx.fill();

      // Digital Heading Box
      ctx.strokeStyle = HUD_GREEN;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(cx - 24 * ts, 2, 48 * ts, 14 * ts);
      ctx.fillStyle = HUD_HIGHLIGHT;
      ctx.font = hudFont(10);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${curHdg.toFixed(0).padStart(3, '0')}°`, cx, 2 + 7 * ts);

      // =========================================================
      // 5. Left: Airspeed / Groundspeed Ladder & Prominent IAS
      // =========================================================
      // Prominent Speed: Indicated Airspeed (IAS)
      const isKtsMode = unitSystem === 'kts';
      const iasKts = vfr.airspeed * 1.943844;
      const gsKts = vfr.groundspeed * 1.943844;

      const primarySpeedVal = !hasLink
        ? '--.-'
        : isKtsMode
          ? iasKts >= 100
            ? iasKts.toFixed(0)
            : iasKts.toFixed(1)
          : formatSpeed(vfr.airspeed).value;
      const primarySpeedUnit = isKtsMode ? 'KIAS' : `IAS ${formatSpeed(vfr.airspeed).unit.toUpperCase()}`;

      // Current Speed Value Box (Pitch ladder is masked behind this region)
      ctx.strokeStyle = HUD_BRIGHT;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(spdBoxX, spdBoxY, spdBoxW, spdBoxH);

      ctx.fillStyle = HUD_HIGHLIGHT;
      ctx.font = hudFont(14);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(primarySpeedVal, spdBoxX + spdBoxW / 2, spdBoxY + 10 * ts);

      ctx.fillStyle = HUD_BRIGHT;
      ctx.font = hudFont(10);
      ctx.fillText(primarySpeedUnit, spdBoxX + spdBoxW / 2, spdBoxY + 22 * ts);

      // Groundspeed readout beneath box (Pitch ladder is masked behind this region)
      const gsVal = !hasLink
        ? '--'
        : isKtsMode
          ? gsKts >= 100
            ? gsKts.toFixed(0)
            : gsKts.toFixed(1)
          : formatSpeed(vfr.groundspeed).value;
      const gsUnit = isKtsMode ? 'KGS' : formatSpeed(vfr.groundspeed).unit.toUpperCase();
      const gsText = isKtsMode ? `${gsVal} ${gsUnit}` : `GS ${gsVal} ${gsUnit}`;

      const gsH = 15 * ts;
      const gsY = spdBoxY + spdBoxH + 4;

      ctx.fillStyle = HUD_BRIGHT;
      ctx.font = hudFont(10);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(gsText, spdBoxX + 4, gsY + gsH / 2);

      // =========================================================
      // 6. Right: Altitude Ladder & Box
      // =========================================================
      // Current Altitude Value Box (Pitch ladder is masked behind this region)
      ctx.strokeStyle = HUD_BRIGHT;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(altBoxX, altBoxY, altBoxW, altBoxH);

      const rawAltM = displayAltitudeM(altitudeMode, position, vfr.alt);
      const altFormatted = formatAltitude(rawAltM);
      ctx.fillStyle = HUD_HIGHLIGHT;
      ctx.font = hudFont(14);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(hasLink ? altFormatted.value : '--.-', altBoxX + altBoxW / 2, altBoxY + 10 * ts);

      ctx.fillStyle = HUD_BRIGHT;
      ctx.font = hudFont(10);
      ctx.fillText(
        `${altFormatted.unit.toUpperCase()} ${altitudeMode.toUpperCase()}`,
        altBoxX + altBoxW / 2,
        altBoxY + 22 * ts
      );

      // Vertical Speed / Climb Rate readout beneath box (Pitch ladder is masked behind this region)
      const climbFormatted = formatClimb(vfr.climb);
      const vviText = hasLink ? climbFormatted.full : `-- ${climbFormatted.unit}`;
      const vviMetrics = ctx.measureText(vviText);
      const vviW = vviMetrics.width + 8;
      const vviH = 15 * ts;
      const vviY = altBoxY + altBoxH + 4;
      // Right-aligned under the altitude box (wherever the core puts it).
      const vviX = altBoxX + altBoxW - vviW;

      ctx.fillStyle = Math.abs(vfr.climb) > 0.3 ? HUD_HIGHLIGHT : HUD_BRIGHT;
      ctx.font = hudFont(10);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(vviText, vviX + 4, vviY + vviH / 2);

      // =========================================================
      // 7. Bottom Status Readout (Mission WP Progress & THR with Masking)
      // =========================================================
      const rawTotalWps = missionWaypoints.length;
      // Human readable waypoint count excludes WP 0 (Home position)
      const totalWps = Math.max(0, rawTotalWps - 1);
      const currentWp = currentWaypointSeq ?? missionWaypoints.find((w) => w.current)?.seq ?? 0;
      const wpDistM = navController.wpDist;
      const etaSec = hasLink && wpDistM > 0 && vfr.groundspeed > 0.8 ? Math.round(wpDistM / vfr.groundspeed) : null;

      // Split HUD WP info to two lines: line 1 = WP index, line 2 = distance/ETA
      const wpLine1 = totalWps > 0 ? `WP ${currentWp}/${totalWps}` : 'WP 0/0';
      const wpDistStr = hasLink && wpDistM > 0 ? formatDistance(wpDistM).full : '';
      const etaStr =
        etaSec !== null
          ? etaSec >= 60
            ? `${Math.floor(etaSec / 60)}m${(etaSec % 60).toString().padStart(2, '0')}s`
            : `${etaSec}s`
          : '';
      const wpLine2 = wpDistStr ? (etaStr ? `${wpDistStr} · ${etaStr}` : wpDistStr) : totalWps > 0 ? '--' : '';

      const thrText = hasLink ? `THR: ${Math.round(vfr.throttle)}%` : 'THR: --%';

      const wpPadX = 7;
      ctx.font = hudFont(10);
      const w1 = ctx.measureText(wpLine1).width;
      ctx.font = hudFont(9.5);
      const w2 = wpLine2 ? ctx.measureText(wpLine2).width : 0;
      const wpBoxW = Math.max(w1, w2) + wpPadX * 2;
      const isTwoLine = Boolean(wpLine2);
      const wpBoxH = (isTwoLine ? 32 : 20) * ts;
      const wpBoxX = 10;
      const wpBoxY = height - wpBoxH - 8;

      // Waypoint Progress Box (Pitch ladder is masked behind this region)
      ctx.strokeStyle = HUD_BORDER;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(wpBoxX, wpBoxY, wpBoxW, wpBoxH);

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      if (isTwoLine) {
        ctx.fillStyle = HUD_HIGHLIGHT;
        ctx.font = hudFont(10);
        ctx.fillText(wpLine1, wpBoxX + wpPadX, wpBoxY + 9 * ts);

        ctx.fillStyle = HUD_BRIGHT;
        ctx.font = hudFont(9.5);
        ctx.fillText(wpLine2, wpBoxX + wpPadX, wpBoxY + 22 * ts);
      } else {
        ctx.fillStyle = HUD_HIGHLIGHT;
        ctx.font = hudFont(10);
        ctx.fillText(wpLine1, wpBoxX + wpPadX, wpBoxY + 10 * ts);
      }

      // Lower Right: THR (Pitch ladder is masked behind this region)
      ctx.font = hudFont(11);
      const thrMetrics = ctx.measureText(thrText);
      const thrBoxW = thrMetrics.width + wpPadX * 2;
      const thrBoxH = 20 * ts;
      const thrBoxX = width - thrBoxW - 10;
      const thrBoxY = height - thrBoxH - 8;

      ctx.strokeStyle = HUD_BORDER;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(thrBoxX, thrBoxY, thrBoxW, thrBoxH);

      ctx.fillStyle = HUD_HIGHLIGHT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(thrText, thrBoxX + wpPadX, thrBoxY + 10 * ts);

      // =========================================================
      // 8. Upper Left: Normal Load Factor (Nz) in G & Upper Right: Home Vector
      // =========================================================
      const nzVal =
        imu && imu.nz !== 0 && !isNaN(imu.nz)
          ? imu.nz
          : Math.min(9.9, Math.max(-4.0, 1 / Math.max(0.15, Math.cos(attitude.roll))));
      const nzText = hasLink ? `${nzVal.toFixed(1)} G` : '-- G';

      ctx.font = hudFont(11);
      ctx.textBaseline = 'middle';

      const nzMetrics = ctx.measureText(nzText);
      const nzPadX = 7;
      const nzBoxW = nzMetrics.width + nzPadX * 2;
      const nzBoxH = 20 * ts;
      const nzBoxX = 10;
      const nzBoxY = 16 * ts - nzBoxH / 2;

      // Normal Load Factor (Nz) Box (Pitch ladder is masked behind this region)
      ctx.strokeStyle = HUD_BORDER;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(nzBoxX, nzBoxY, nzBoxW, nzBoxH);

      ctx.fillStyle = HUD_HIGHLIGHT;
      ctx.textAlign = 'left';
      ctx.fillText(nzText, nzBoxX + nzPadX, 16 * ts);

      // Upper Right: Home Distance & Bearing (Symbology: "H 000°/0.0 NM")
      if (hasLink && homePosition.distanceM !== null) {
        const homeText = formatHomeVector(homePosition.bearingDeg, homePosition.distanceM);
        const hmMetrics = ctx.measureText(homeText);
        const hmBoxW = hmMetrics.width + nzPadX * 2;
        const hmBoxX = width - hmBoxW - 10;
        // Home Vector Box (Pitch ladder is masked behind this region)
        ctx.strokeStyle = HUD_BORDER;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(hmBoxX, nzBoxY, hmBoxW, nzBoxH);
        ctx.fillStyle = HUD_HIGHLIGHT;
        ctx.textAlign = 'left';
        ctx.fillText(homeText, hmBoxX + nzPadX, 16 * ts);
      }

      // =========================================================
      // 9. No-Link / Link-Lost HUD Flag (#3)
      // =========================================================
      if (!hasLink) {
        const flagText = hasConnectedInSession ? 'LINK LOST — STALE DATA' : 'NO LINK — STANDBY';
        ctx.font = hudFont(11);
        const flMetrics = ctx.measureText(flagText);
        const flW = flMetrics.width + 20;
        const flH = 22 * ts;
        const flX = cx - flW / 2;
        const flY = 42 * ts;
        ctx.fillStyle = hasConnectedInSession ? 'rgba(69, 10, 10, 0.92)' : 'rgba(9, 9, 11, 0.88)';
        ctx.fillRect(flX, flY, flW, flH);
        ctx.strokeStyle = hasConnectedInSession ? '#ef4444' : '#f59e0b';
        ctx.lineWidth = 1.4;
        ctx.strokeRect(flX, flY, flW, flH);
        ctx.fillStyle = hasConnectedInSession ? '#fca5a5' : '#fde68a';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(flagText, cx, flY + flH / 2);
      }

      // =========================================================
      // 10. Central Annunciations: DISARMED & Flashing FAILSAFE
      // =========================================================
      // Steady DISARMED text about 20 degrees above the wings level horizon
      if (hasLink && !heartbeat.isArmed) {
        ctx.save();
        ctx.font = hudFont(18);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = HUD_BRIGHT;
        ctx.fillText('DISARMED', cx, disarmY);
        ctx.restore();
      }

      // Flashing FAILSAFE text directly below the area where DISARMED is displayed
      if (isFailsafe && isFlashVisible) {
        ctx.save();
        ctx.font = hudFont(18);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = HUD_BRIGHT;
        ctx.fillText('FAILSAFE', cx, failsafeY);
        ctx.restore();
      }

      ctx.restore();
    } finally {
      ctx.restore();
    }
  };

  // Draw when something changed, at most ~30 times a second: telemetry marks it dirty through a store subscription
  // (no React render), and so does every render (above).
  useEffect(() => {
    const unsubscribe = useTelemetryStore.subscribe((st, prev) => {
      if (
        st.attitude !== prev.attitude ||
        st.vfr !== prev.vfr ||
        st.position !== prev.position ||
        st.navController !== prev.navController ||
        st.homePosition !== prev.homePosition ||
        st.imu !== prev.imu ||
        st.missionWaypoints !== prev.missionWaypoints ||
        st.currentWaypointSeq !== prev.currentWaypointSeq ||
        st.heartbeat !== prev.heartbeat ||
        st.hasConnectedInSession !== prev.hasConnectedInSession
      ) {
        dirtyRef.current = true;
      }
    });
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      // 28 ms, not 33: at 60 Hz two frames can land a hair under 33 ms apart, which would skip a third (20 fps).
      if (!dirtyRef.current || t - last < 28) return;
      last = t;
      dirtyRef.current = false;
      drawRef.current();
    };
    raf = requestAnimationFrame(tick);
    return () => {
      unsubscribe();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <Card className="relative flex h-full flex-col overflow-hidden border-zinc-800 bg-zinc-950 shadow-lg">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5 sm:px-3.5">
        <CardTitle className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-300">
          <Compass className="h-3.5 w-3.5 text-sky-400" />
          Heads-Up Display (HUD)
        </CardTitle>
        <div className="flex items-center gap-2">
          {videoConfig.enabled && Boolean(videoConfig.url.trim()) && (
            <button
              type="button"
              onClick={() => setCameraReconnectKey((k) => k + 1)}
              title={`Camera ${cameraStatus.state}${cameraStatus.detail ? `: ${cameraStatus.detail}` : ''}. Click to reconnect.`}
              className={clsx(
                'flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px]',
                cameraStatus.state === 'error'
                  ? 'border-red-800/60 bg-red-950/80 text-red-400'
                  : cameraStatus.state === 'live'
                    ? 'border-emerald-800/60 bg-emerald-950/80 text-emerald-400'
                    : 'border-amber-800/60 bg-amber-950/80 text-amber-300'
              )}
            >
              <span
                className={clsx(
                  'h-1.5 w-1.5 rounded-full',
                  cameraStatus.state === 'error'
                    ? 'bg-red-400'
                    : cameraStatus.state === 'live'
                      ? 'gs-blink bg-emerald-400'
                      : 'gs-blink bg-amber-400'
                )}
              />
              {cameraStatus.state === 'error' ? 'CAM ERR' : cameraStatus.state === 'live' ? 'CAM' : 'CAM …'}
            </button>
          )}
          <span className="font-mono text-[10px] uppercase text-zinc-500">
            {altitudeMode.toUpperCase()} • {unitSystem.toUpperCase()}
          </span>
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className={clsx(
              'rounded p-1 transition-colors',
              isSettingsOpen || videoConfig.enabled
                ? 'border border-sky-800/60 bg-sky-950/60 text-sky-400 hover:bg-sky-900/60'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
            )}
            title="Configure HUD Symbology & Video Settings"
          >
            <Sliders className="h-3.5 w-3.5" />
          </button>
        </div>
      </CardHeader>
      <CardContent
        className={`relative w-full flex-1 p-0 sm:p-0 ${inPane ? 'min-h-0' : 'min-h-[340px]'} overflow-hidden bg-black`}
      >
        {/* Live Camera Video / Stream Layer */}
        {videoConfig.enabled && Boolean(videoConfig.url.trim()) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
            <CameraFeed
              url={videoConfig.url.trim()}
              type={videoConfig.type}
              token={videoConfig.whepToken}
              fit={videoConfig.fit}
              opacity={videoConfig.opacity}
              snapshotIntervalMs={videoConfig.snapshotIntervalMs}
              reconnectKey={cameraReconnectKey}
              onStatus={setCameraStatus}
            />
          </div>
        )}

        {/* HUD Vector Canvas */}
        <canvas ref={canvasRef} className="absolute inset-0 z-10 block h-full w-full" />
      </CardContent>

      {/* HUD Settings Page Modal */}
      <Modal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        title="HUD & Video Settings"
        description="Configure HUD symbology brightness, vector display, and live camera feed overlay."
      >
        <div className="space-y-4 text-xs text-zinc-300">
          {/* Section 1: HUD Symbology & Brightness */}
          <div className="space-y-2.5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
              <div className="flex items-center gap-2">
                <Sun
                  className={clsx(
                    'h-4 w-4 transition-colors',
                    (videoConfig.symbologyBrightness ?? 1.0) > 1.05 ? 'text-white' : 'text-emerald-400'
                  )}
                />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-100">
                  Symbology Brightness
                </span>
              </div>
              <span
                className={clsx(
                  'rounded border px-2 py-0.5 font-mono text-xs font-bold transition-colors',
                  (videoConfig.symbologyBrightness ?? 1.0) > 1.05
                    ? 'border-zinc-600 bg-zinc-800 text-white shadow-sm'
                    : 'border-emerald-800/60 bg-emerald-950/60 text-emerald-400'
                )}
              >
                {Math.round((videoConfig.symbologyBrightness ?? 1.0) * 100)}%
                {(videoConfig.symbologyBrightness ?? 1.0) >= 1.95
                  ? ' • Pure White'
                  : (videoConfig.symbologyBrightness ?? 1.0) > 1.05
                    ? ' • White Boost'
                    : (videoConfig.symbologyBrightness ?? 1.0) >= 0.95
                      ? ' • Default Green'
                      : ' • Dim'}
              </span>
            </div>

            <p className="text-[11px] leading-relaxed text-zinc-400">
              Controls the optical intensity and color temperature of HUD symbology. Increasing beyond the 100% default
              smoothly transitions green vector elements into pure high-contrast white.
            </p>

            <div className="space-y-2 pt-1">
              <input
                type="range"
                min="0.1"
                max="2.0"
                step="0.05"
                value={videoConfig.symbologyBrightness ?? 1.0}
                onChange={(e) => handleUpdateConfig({ symbologyBrightness: parseFloat(e.target.value) })}
                className={clsx(
                  'w-full cursor-pointer transition-colors',
                  (videoConfig.symbologyBrightness ?? 1.0) > 1.05 ? 'accent-white' : 'accent-emerald-500'
                )}
              />

              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="font-mono text-[10px] text-zinc-500">10% (Night)</span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleUpdateConfig({ symbologyBrightness: 0.3 })}
                    className={clsx(
                      'rounded border px-2 py-0.5 text-[10px] font-medium transition-colors',
                      (videoConfig.symbologyBrightness ?? 1.0) <= 0.4
                        ? 'border-emerald-700/60 bg-emerald-950/80 text-emerald-300'
                        : 'border-zinc-700 bg-zinc-800/80 text-zinc-400 hover:text-zinc-200'
                    )}
                  >
                    Night (30%)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleUpdateConfig({ symbologyBrightness: 1.0 })}
                    className={clsx(
                      'rounded border px-2 py-0.5 text-[10px] font-medium transition-colors',
                      Math.abs((videoConfig.symbologyBrightness ?? 1.0) - 1.0) <= 0.05
                        ? 'border-emerald-700/60 bg-emerald-950/80 text-emerald-300'
                        : 'border-zinc-700 bg-zinc-800/80 text-zinc-400 hover:text-zinc-200'
                    )}
                  >
                    Default (100%)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleUpdateConfig({ symbologyBrightness: 2.0 })}
                    className={clsx(
                      'rounded border px-2 py-0.5 text-[10px] font-medium transition-colors',
                      (videoConfig.symbologyBrightness ?? 1.0) >= 1.9
                        ? 'border-white bg-white font-bold text-zinc-950'
                        : 'border-zinc-700 bg-zinc-800/80 text-zinc-400 hover:text-zinc-200'
                    )}
                  >
                    White (200%)
                  </button>
                </div>
                <span className="font-mono text-[10px] text-zinc-500">200% (White)</span>
              </div>
            </div>
          </div>

          {/* Section 2: Video Background */}
          <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
              <div className="flex items-center gap-2">
                <Video className="h-4 w-4 text-sky-400" />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-100">
                  Video Background Feed
                </span>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={videoConfig.enabled}
                  onChange={(e) => handleUpdateConfig({ enabled: e.target.checked })}
                  className="peer sr-only"
                />
                <div className="peer h-5 w-9 rounded-full bg-zinc-700 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-zinc-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-sky-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none"></div>
              </label>
            </div>

            {/* Stream URL */}
            <div className="space-y-1">
              <label className="flex items-center justify-between text-[11px] font-semibold text-zinc-300">
                <span>Stream URL</span>
                <span className="text-[10px] font-normal text-zinc-500">Stored locally in browser</span>
              </label>
              <CommitInput
                type="text"
                value={videoConfig.url}
                onCommit={(v) => handleUpdateConfig({ url: v })}
                placeholder={
                  videoConfig.type === 'whep'
                    ? 'http://<host>:8889/<stream>/whep'
                    : videoConfig.type === 'video'
                      ? 'http://<host>/<stream>.mp4'
                      : 'http://<camera-ip>/cgi-bin/mjpg/video.cgi?channel=1&subtype=1'
                }
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none"
              />
              <p className="text-[10px] leading-relaxed text-zinc-500">
                Tip: For Amcrest, Dahua, or Axis cameras, open the camera web UI in another browser tab and log in once
                to authorize your browser session before streaming.
              </p>
              <p className="text-[10px] leading-relaxed text-zinc-500">
                Reconnects on its own. MJPEG streams that allow CORS are watched frame by frame, so a frozen stream is
                caught within seconds (go2rtc: <code className="text-zinc-400">api: origin: "*"</code>, or an
                <code className="text-zinc-400"> Access-Control-Allow-Origin</code> header on your proxy). Without CORS
                it still reconnects on errors and when the camera drops off the network and returns. Click the CAM badge
                to reconnect by hand.
                {videoConfig.enabled && cameraStatus.method === 'img' && videoConfig.type === 'mjpeg' && (
                  <span className="text-amber-400/90"> This camera does not allow CORS.</span>
                )}
              </p>
            </div>

            {/* Stream Type & Fit */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-zinc-300">Format</label>
                <select
                  value={videoConfig.type}
                  onChange={(e) => handleUpdateConfig({ type: e.target.value as any })}
                  className="w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-sky-500 focus:outline-none"
                >
                  <option value="mjpeg">MJPEG Stream (HTTP)</option>
                  <option value="snapshot">Snapshot Polling (JPEG)</option>
                  <option value="whep">WebRTC (WHEP), low latency</option>
                  <option value="video">HTML5 Video (MP4, HLS where the browser plays it)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-zinc-300">Aspect Ratio Fit</label>
                <select
                  value={videoConfig.fit}
                  onChange={(e) => handleUpdateConfig({ fit: e.target.value as any })}
                  className="w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-sky-500 focus:outline-none"
                >
                  <option value="cover">Cover (Fill HUD)</option>
                  <option value="contain">Contain (Letterbox)</option>
                </select>
              </div>
            </div>

            {/* WHEP: where to find the endpoint, and a token if it needs one */}
            {videoConfig.type === 'whep' && (
              <div className="space-y-1.5">
                <p className="text-[10px] leading-relaxed text-zinc-500">
                  The stream's WHEP address: MediaMTX{' '}
                  <code className="text-zinc-400">http://HOST:8889/STREAM/whep</code>, go2rtc{' '}
                  <code className="text-zinc-400">http://HOST:1984/api/webrtc?src=STREAM</code>. Usually well under a
                  second behind. The server must allow this page (CORS; MediaMTX and go2rtc do by default) and the
                  browser must reach its WebRTC port (MediaMTX 8189/UDP).
                </p>
                <label className="block space-y-1">
                  <span className="flex items-center justify-between text-[11px] font-semibold text-zinc-300">
                    Bearer token (optional)
                    <span className="text-[10px] font-normal text-zinc-500">kept in this browser, not encrypted</span>
                  </span>
                  <CommitInput
                    type="password"
                    autoComplete="off"
                    value={videoConfig.whepToken ?? ''}
                    onCommit={(v) => handleUpdateConfig({ whepToken: v })}
                    className="w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-sky-500 focus:outline-none"
                  />
                </label>
              </div>
            )}

            {/* Snapshot interval if snapshot */}
            {videoConfig.type === 'snapshot' && (
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-zinc-300">Snapshot Polling Rate</label>
                <select
                  value={videoConfig.snapshotIntervalMs}
                  onChange={(e) => handleUpdateConfig({ snapshotIntervalMs: Number(e.target.value) })}
                  className="w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-sky-500 focus:outline-none"
                >
                  <option value={100}>10 FPS (100 ms)</option>
                  <option value={200}>5 FPS (200 ms)</option>
                  <option value={333}>3 FPS (333 ms)</option>
                  <option value={500}>2 FPS (500 ms)</option>
                  <option value={1000}>1 FPS (1000 ms)</option>
                </select>
              </div>
            )}

            {/* Sliders: Opacity & Darkening */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="font-semibold text-zinc-300">Video Opacity</span>
                  <span className="font-mono text-zinc-400">{Math.round(videoConfig.opacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.2"
                  max="1.0"
                  step="0.05"
                  value={videoConfig.opacity}
                  onChange={(e) => handleUpdateConfig({ opacity: parseFloat(e.target.value) })}
                  className="w-full cursor-pointer accent-sky-500"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="font-semibold text-zinc-300">Darkening Tint</span>
                  <span className="font-mono text-zinc-400">{Math.round(videoConfig.darken * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="0.7"
                  step="0.05"
                  value={videoConfig.darken}
                  onChange={(e) => handleUpdateConfig({ darken: parseFloat(e.target.value) })}
                  className="w-full cursor-pointer accent-sky-500"
                />
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between border-t border-zinc-800 pt-3">
            <button
              type="button"
              onClick={() => {
                handleUpdateConfig(DEFAULT_HUD_VIDEO_CONFIG);
              }}
              className="text-[11px] text-zinc-400 underline hover:text-zinc-200"
            >
              Reset Defaults
            </button>
            <Button type="button" variant="default" size="sm" onClick={() => setIsSettingsOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
};
