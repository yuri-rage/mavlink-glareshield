import React, { useEffect, useRef, useState } from 'react';

import {
  Activity,
  AlertTriangle,
  BatteryCharging,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  History,
  Home,
  Loader2,
  Moon,
  RefreshCw,
  Satellite,
  Settings,
  Shield,
  ShieldAlert,
  Sun,
  WifiOff,
  X,
  XCircle,
} from 'lucide-react';

import { displayAltitudeM } from '../../lib/displayAltitude';
import { getLinkStats, type LinkStats } from '../../lib/messageCache';
import { mavlinkConnection } from '../../mavlink/connection';
import { linkBars, linkLevel } from '../../mavlink/linkQuality';
import {
  getVehicleCategory,
  getVehicleCategoryLabel,
  getVehicleFlightModes,
  LANDED_STATE_NAMES,
  MAVLINK_MSG_ID,
  VTOL_STATE_NAMES,
} from '../../mavlink/messages';
import { messageRateManager } from '../../mavlink/rateManager';
import { flightNow, heartbeatLiveMs } from '../../mavlink/replayClock';
import { useConnectionStore } from '../../store/connectionStore';
import { useReplayStore } from '../../store/replayStore';
import { evaluatePreArmReadiness, sendTrackedCommand, useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Modal } from '../ui/modal';
// Loaded with the app, not on demand: Settings holds the link controls, so it must open offline or after a redeploy
// (when a lazily fetched chunk can fail to load), and it's small (~7 kB gzipped).
import { ReplayBar } from './ReplayBar';
import { SettingsDialog, type SettingsTab } from './SettingsDialog';
import { TlogIndicator } from './TlogSettings';
import { UpdateButton } from './UpdateButton';
import { TakeoverBanner, VehiclePicker } from './VehiclePicker';

const STORAGE_KEY_THEME = 'mavlink_glareshield_theme';

function formatDurationClock(totalMs: number): string {
  const totalSec = Math.max(0, Math.floor(totalMs / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// The telemetry strip's pills, each subscribed to its own slice: a packet re-renders the pill it changes, not the
// whole navbar. `active`: a vehicle heartbeat is current.
const BatteryPill: React.FC<{ active: boolean }> = ({ active }) => {
  const battery = useTelemetryStore((s) => s.battery);
  const shown = active && battery.voltage > 0;
  // Remaining % unknown (no capacity set): the voltage alone, not a red 0%.
  const pct = battery.remaining >= 0 ? battery.remaining : null;
  return (
    <div className="flex shrink-0 items-center gap-1.5" title="Pack Voltage & Remaining Capacity">
      <BatteryCharging
        className={`h-3.5 w-3.5 shrink-0 ${
          !shown
            ? 'text-zinc-500'
            : pct !== null && pct <= 15
              ? 'animate-pulse text-red-400'
              : pct !== null && pct <= 25
                ? 'text-amber-400'
                : 'text-emerald-400'
        }`}
      />
      <span className="font-sans text-[10px] font-bold uppercase text-zinc-400 md:text-[11px]">BAT</span>
      <span
        className={`font-bold ${!shown ? 'text-zinc-500' : pct !== null && pct <= 15 ? 'text-red-300' : pct !== null && pct <= 25 ? 'text-amber-300' : 'text-zinc-100'}`}
      >
        {shown ? `${battery.voltage.toFixed(1)}V${pct !== null ? ` · ${pct}%` : ''}` : '--'}
      </span>
    </div>
  );
};

/** Four rising bars, `filled` of them lit (Wi-Fi style), in the color of the level. */
const SignalBars: React.FC<{ filled: number; className: string }> = ({ filled, className }) => (
  <svg viewBox="0 0 16 14" className={`h-3.5 w-3.5 shrink-0 ${className}`} aria-hidden="true">
    {[0, 1, 2, 3].map((i) => (
      <rect
        key={i}
        x={i * 4 + 0.5}
        y={11 - i * 3.5}
        width={3}
        height={3 + i * 3.5}
        rx={0.6}
        fill="currentColor"
        opacity={i < filled ? 1 : 0.22}
      />
    ))}
  </svg>
);

/**
 * The link to the vehicle, as Mission Planner's bars: % of its packets received over the last 5 s (from their
 * sequence numbers), colored by level; the radio's signal in the tooltip when a telemetry radio reports it.
 */
const LinkPill: React.FC<{ active: boolean }> = ({ active }) => {
  const [link, setLink] = useState<LinkStats>(() => getLinkStats());
  useEffect(() => {
    const t = setInterval(() => setLink(getLinkStats()), 1000);
    return () => clearInterval(t);
  }, []);
  const q = active ? link.quality : null;
  const level = linkLevel(q);
  const tone =
    level === 'good'
      ? 'text-emerald-400'
      : level === 'fair'
        ? 'text-amber-400'
        : level === 'poor'
          ? 'animate-pulse text-red-400'
          : 'text-zinc-500';
  const radio =
    link.rssi !== null || link.remrssi !== null
      ? `; radio signal ${link.rssi ?? '--'} here, ${link.remrssi ?? '--'} at the vehicle`
      : '';
  return (
    <div
      className="flex shrink-0 items-center gap-1.5"
      title={
        q === null
          ? "Link quality: % of the vehicle's packets received (no data yet)"
          : `Link quality: ${q.toFixed(0)}% of the vehicle's packets received over the last 5 s (${link.received} received, ${link.lost} lost)${radio}`
      }
    >
      <SignalBars filled={linkBars(q)} className={tone} />
      <span className="font-sans text-[10px] font-bold uppercase text-zinc-400 md:text-[11px]">LINK</span>
      <span
        className={`font-bold ${level === 'poor' ? 'text-red-300' : level === 'fair' ? 'text-amber-300' : level ? 'text-zinc-100' : 'text-zinc-500'}`}
      >
        {q === null ? '--' : `${q.toFixed(0)}%`}
      </span>
    </div>
  );
};

const GpsPill: React.FC<{ active: boolean }> = ({ active }) => {
  const fixType = useTelemetryStore((s) => s.gps.fixType);
  const fixLabel = useTelemetryStore((s) => s.gps.fixLabel);
  const satellites = useTelemetryStore((s) => s.gps.satellites);
  return (
    <div className="flex shrink-0 items-center gap-1.5" title="GNSS Fix & Visible Satellites">
      <Satellite
        className={`h-3.5 w-3.5 shrink-0 ${!active ? 'text-zinc-500' : fixType >= 3 ? 'text-emerald-400' : 'text-amber-400'}`}
      />
      <span className="font-sans text-[10px] font-bold uppercase text-zinc-400 md:text-[11px]">GPS</span>
      <span className="font-bold text-zinc-100">{active ? `${fixLabel} (${satellites})` : '--'}</span>
    </div>
  );
};

const AltSpeedPill: React.FC<{ active: boolean; plane: boolean }> = ({ active, plane }) => {
  const { formatAltitude, formatSpeed, altitudeMode } = useUnitsStore();
  const altM = useTelemetryStore((s) => displayAltitudeM(altitudeMode, s.position, s.vfr.alt));
  const speedMs = useTelemetryStore((s) => (plane ? s.vfr.airspeed : s.vfr.groundspeed));
  return (
    <div className="flex shrink-0 items-center gap-1.5" title="Active Altitude & Speed">
      <span className="font-sans text-[10px] font-bold uppercase text-zinc-400 md:text-[11px]">
        {altitudeMode.toUpperCase()}
      </span>
      <span className="font-bold text-sky-300">{active ? formatAltitude(altM).full : '--'}</span>
      <span className="text-zinc-600">·</span>
      <span className="font-bold text-emerald-300">{active ? formatSpeed(speedMs).full : '--'}</span>
    </div>
  );
};

const HomePill: React.FC<{ active: boolean }> = ({ active }) => {
  const home = useTelemetryStore((s) => s.homePosition);
  // The formatter is one stable function: subscribe to the units too, so a change of units re-renders this.
  const formatHomeVector = useUnitsStore((s) => s.formatHomeVector);
  useUnitsStore((s) => s.system);
  return (
    <div
      className="flex shrink-0 items-center gap-1.5"
      title={
        home.source !== 'none'
          ? `Home (${home.source.toUpperCase()}): ${home.lat.toFixed(5)}, ${home.lon.toFixed(5)}`
          : 'Home Position not yet received'
      }
    >
      <Home className={`h-3.5 w-3.5 shrink-0 ${home.source !== 'none' ? 'text-amber-400' : 'text-zinc-500'}`} />
      <span className="font-sans text-[10px] font-bold uppercase text-zinc-400 md:text-[11px]">HOME</span>
      <span className="font-bold text-zinc-100">
        {active && home.distanceM !== null
          ? formatHomeVector(home.bearingDeg, home.distanceM)
          : home.source !== 'none'
            ? 'SET'
            : '--'}
      </span>
    </div>
  );
};

export const Navbar: React.FC = () => {
  const { url, linkKind, serialBaud, status, stats, connect } = useConnectionStore();
  const heartbeat = useTelemetryStore((state) => state.heartbeat);
  // Landed and VTOL state (EXTENDED_SYS_STATE), for the arm menu. Copter and Plane send it; Rover doesn't.
  const extendedState = useTelemetryStore((state) => state.extendedState);
  useEffect(() => {
    messageRateManager.registerRequirement('navbar-extended-state', MAVLINK_MSG_ID.EXTENDED_SYS_STATE);
    return () => messageRateManager.unregisterRequirement('navbar-extended-state');
  }, []);
  const stateFresh = extendedState.lastUpdate > 0 && Date.now() - extendedState.lastUpdate < 5000;
  const landed = stateFresh ? extendedState.landedState : 0;
  const airborne = landed === 2 || landed === 3 || landed === 4;
  const flightStateText = stateFresh
    ? [
        landed > 0 ? LANDED_STATE_NAMES[landed] : null,
        extendedState.vtolState > 0 ? VTOL_STATE_NAMES[extendedState.vtolState] : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  // The fast telemetry (battery, GPS, speeds, position, home vector) is shown by the small pills below, each
  // subscribed on its own: a packet re-renders a pill, not this whole bar. Here only derived, slow-changing values.
  const sysStatus = useTelemetryStore((state) => state.sysStatus);
  const statusMessages = useTelemetryStore((state) => state.statusMessages);
  // EKF and vibration as their verdicts and shown figures: re-rendered when those change, not on every report.
  const ekfHealthy = useTelemetryStore((s) => (s.ekf.flags & 0x01) !== 0 && s.ekf.posHorizVariance < 0.8);
  const ekfVarText = useTelemetryStore((s) => s.ekf.posHorizVariance.toFixed(2));
  const vibeWarning = useTelemetryStore(
    (s) =>
      s.vibration.vibrationX > 30 ||
      s.vibration.vibrationY > 30 ||
      s.vibration.vibrationZ > 30 ||
      s.vibration.clipping0 > 0 ||
      s.vibration.clipping1 > 0 ||
      s.vibration.clipping2 > 0
  );
  const vibeText = useTelemetryStore((s) =>
    Math.max(s.vibration.vibrationX, s.vibration.vibrationY, s.vibration.vibrationZ).toFixed(1)
  );
  const hasConnectedInSession = useTelemetryStore((state) => state.hasConnectedInSession);
  // Replaying a log: the arm and mode pills show the log's state, but their menus (which send) don't open.
  const replaying = useReplayStore((s) => s.active);
  const armedStartedAt = useTelemetryStore((state) => state.armedStartedAt);
  const accumulatedArmedMs = useTelemetryStore((state) => state.accumulatedArmedMs);
  const firmwareVersion = useTelemetryStore((state) => state.firmwareVersion);
  const firmwareRaw = useTelemetryStore((state) => state.firmwareRaw);
  const commandFeedback = useTelemetryStore((state) => state.commandFeedback);
  const clearCommandFeedback = useTelemetryStore((state) => state.clearCommandFeedback);

  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('link');
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [isPreArmMenuOpen, setIsPreArmMenuOpen] = useState(false);
  const [daylightMode, setDaylightMode] = useState<boolean>(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(STORAGE_KEY_THEME) === 'daylight';
      }
    } catch {}
    return false;
  });

  // Dropdown states for Arm & Mode flyouts
  const [isArmMenuOpen, setIsArmMenuOpen] = useState(false);
  const [armConfirmAction, setArmConfirmAction] = useState<'arm' | 'disarm' | 'force_arm' | 'force_disarm' | null>(
    null
  );
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const armMenuRef = useRef<HTMLDivElement | null>(null);
  const modeMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('daylight-theme', daylightMode);
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_THEME, daylightMode ? 'daylight' : 'dark');
      }
    } catch {}
  }, [daylightMode]);

  // Auto-dismiss command feedback notification after 3.5s (or 9s on error)
  useEffect(() => {
    if (!commandFeedback || commandFeedback.status === 'pending') return;
    const delay = commandFeedback.status === 'accepted' ? 3500 : 9000;
    const t = setTimeout(() => {
      clearCommandFeedback();
    }, delay);
    return () => clearTimeout(t);
  }, [commandFeedback, clearCommandFeedback]);

  // Close menus on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (armMenuRef.current && !armMenuRef.current.contains(event.target as Node)) {
        setIsArmMenuOpen(false);
        setArmConfirmAction(null);
      }
      if (modeMenuRef.current && !modeMenuRef.current.contains(event.target as Node)) {
        setIsModeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleArm = (arm: boolean, force = false) => {
    const encoder = mavlinkConnection.getEncoder();
    const sysId = heartbeat.systemId || 1;
    const compId = heartbeat.componentId || 1;
    const cmd = encoder.createArmDisarm(sysId, compId, arm, force);
    void sendTrackedCommand(cmd, {
      label: force ? (arm ? 'Force Arm' : 'Force Disarm') : arm ? 'Arm Motors' : 'Disarm Motors',
      targetKey: 'arm',
    });
  };

  const handleSetMode = (modeNum: number) => {
    const encoder = mavlinkConnection.getEncoder();
    const sysId = heartbeat.systemId || 1;
    const compId = heartbeat.componentId || 1;
    const cmd = encoder.createSetMode(sysId, compId, modeNum);
    void sendTrackedCommand(cmd, {
      label: `Set Mode ${modeNum}`,
      targetKey: `mode-${modeNum}`,
    });
  };

  const handleRunPreArmChecks = () => {
    const encoder = mavlinkConnection.getEncoder();
    const sysId = heartbeat.systemId || 1;
    const compId = heartbeat.componentId || 1;
    const cmd = encoder.createRunPrearmChecks(sysId, compId);
    void sendTrackedCommand(cmd, {
      label: 'Run Pre-Arm Checks',
      targetKey: 'prearm',
    });
  };

  const openConnectModal = (tab: SettingsTab = 'link') => {
    setSettingsTab(tab);
    mavlinkConnection.pauseReconnect();
    setIsConnectModalOpen(true);
  };

  const handleCloseConnectModal = () => {
    setIsConnectModalOpen(false);
    mavlinkConnection.resumeReconnect();
  };

  const vehicleCategory = getVehicleCategory(heartbeat.type);
  const vehicleCategoryLabel = getVehicleCategoryLabel(heartbeat.type);
  const availableModes = getVehicleFlightModes(heartbeat.type);

  // Vehicle icons from Mission Planner / TitanPlanner resources (copter, heli, plane, rover, boat, sub, tracker)
  const getVehicleIcon = (sizeClass = 'h-3.5 sm:h-4 w-auto max-w-[24px] sm:max-w-[28px]') => {
    let src = '/vehicles/copter.png';
    let alt = 'Copter';

    if (vehicleCategory === 'plane') {
      src = '/vehicles/plane.png';
      alt = 'Plane';
    } else if (vehicleCategory === 'rover') {
      if (heartbeat.type === 11) {
        src = '/vehicles/boat.png';
        alt = 'Boat';
      } else {
        src = '/vehicles/rover.png';
        alt = 'Rover';
      }
    } else if (vehicleCategory === 'sub') {
      src = '/vehicles/sub.png';
      alt = 'Sub';
    } else if (vehicleCategory === 'tracker') {
      src = '/vehicles/tracker.png';
      alt = 'Tracker';
    } else if (heartbeat.type === 4) {
      src = '/vehicles/heli.png';
      alt = 'Helicopter';
    } else {
      src = '/vehicles/copter.png';
      alt = 'Copter';
    }

    return <img src={src} alt={alt} className={`${sizeClass} shrink-0 object-contain`} />;
  };

  const getStatusBadge = () => {
    // A replay is not a vehicle link: say so where Connected would be.
    if (replaying) {
      return (
        <Badge
          variant="secondary"
          className="flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-violet-500/60 bg-violet-950/70 px-2 font-sans text-xs font-semibold text-violet-100 shadow-sm sm:px-2.5"
          onClick={() => openConnectModal('data')}
          title="Replaying a telemetry log: read-only, nothing is sent to a vehicle"
        >
          <History className="h-3.5 w-3.5 shrink-0 text-violet-300" />
          <span className="hidden md:inline">Replay</span>
        </Badge>
      );
    }
    switch (status) {
      case 'connected':
        return (
          <Badge
            variant="success"
            className="flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2 font-sans text-xs font-semibold shadow-sm transition-colors hover:bg-emerald-950/80 sm:px-2.5"
            onClick={() => openConnectModal()}
            title={`Connected: ${linkKind === 'serial' ? `serial @ ${serialBaud} baud` : url} (click for Link & Page Configuration)`}
          >
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-400" />
            <span className="hidden md:inline">Connected</span>
          </Badge>
        );
      case 'connecting':
        return (
          <Badge
            variant="warning"
            className="flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2 font-sans text-xs font-semibold shadow-sm sm:px-2.5"
            onClick={() => openConnectModal()}
            title="Connecting to MAVLink endpoint (click for Link & Page Configuration)..."
          >
            <span className="h-2 w-2 shrink-0 animate-ping rounded-full bg-amber-400" />
            <span className="hidden md:inline">Connecting...</span>
          </Badge>
        );
      case 'error':
        return (
          <Badge
            variant="destructive"
            className="flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2 font-sans text-xs font-semibold shadow-sm sm:px-2.5"
            onClick={() => openConnectModal()}
            title="Connection error (click for Link & Page Configuration)"
          >
            <WifiOff className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">Link Error</span>
          </Badge>
        );
      default:
        return (
          <Button
            variant="default"
            size="sm"
            onClick={() => openConnectModal()}
            className="flex h-7 items-center gap-1.5 rounded-lg bg-sky-500 px-2 font-sans text-xs font-semibold text-white shadow-sm hover:bg-sky-600 sm:px-2.5"
            title="Connect to MAVLink endpoint & open Page Configuration"
          >
            <WifiOff className="h-3.5 w-3.5 shrink-0" />
            <span>Connect</span>
          </Button>
        );
    }
  };

  const isHeartbeatActive =
    status === 'connected' &&
    heartbeat.lastHeartbeatTime > 0 &&
    nowMs - heartbeat.lastHeartbeatTime <= heartbeatLiveMs();

  const isLinkLost =
    hasConnectedInSession &&
    (status !== 'connected' ||
      heartbeat.lastHeartbeatTime === 0 ||
      nowMs - heartbeat.lastHeartbeatTime > heartbeatLiveMs());

  const linkLostSeconds =
    heartbeat.lastHeartbeatTime > 0 ? Math.max(4, Math.floor((nowMs - heartbeat.lastHeartbeatTime) / 1000)) : null;

  const totalArmedMs =
    accumulatedArmedMs +
    (heartbeat.isArmed && armedStartedAt !== null
      ? Math.max(0, (replaying ? flightNow() : nowMs) - armedStartedAt)
      : 0);

  const preArm = evaluatePreArmReadiness(sysStatus, statusMessages, heartbeat.isArmed);

  return (
    <>
      <header id="app-navbar" className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-md">
        {/* Top Row: Brand, Arm/Mode Flyouts, Link Rate, Settings Gear & Connection Pill */}
        {/* Wraps rather than overlapping if a long mode name or label ever outgrows the row. */}
        <div className="flex max-w-full flex-wrap items-center justify-between gap-x-2 gap-y-2 px-2.5 py-2 sm:gap-x-3 sm:px-6">
          {/* Left: Brand & Flight Status */}
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
            <div className="flex flex-shrink-0 items-center gap-1.5 sm:gap-2">
              {/* The logo and name open Settings → About: this build, the documentation and the source. */}
              <button
                type="button"
                onClick={() => openConnectModal('about')}
                title="About Glareshield: this build, documentation and source"
                aria-label="About Glareshield"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sky-500/25 bg-zinc-900/90 p-0.5 shadow-sm hover:border-sky-400/60"
              >
                <img
                  src="/logo-64.png"
                  alt="Glareshield Logo"
                  className="drop-shadow(0 1px 2px rgba(0,0,0,0.5)) h-full w-full object-contain filter"
                />
              </button>
              <div>
                <button
                  type="button"
                  onClick={() => openConnectModal('about')}
                  title="About Glareshield: this build, documentation and source"
                  className="hidden text-sm font-bold tracking-tight text-zinc-100 hover:text-sky-200 sm:text-base md:inline"
                >
                  GLARESHIELD
                </button>
                <div className="mt-0.5 flex items-center gap-1 leading-none sm:gap-1.5">
                  {status === 'connected' ? (
                    heartbeat.lastHeartbeatTime > 0 ? (
                      <>
                        {getVehicleIcon()}
                        <div className="flex min-w-0 items-baseline gap-1 sm:gap-1.5">
                          <span className="hidden truncate font-sans text-xs font-medium tracking-tight text-sky-300 min-[480px]:inline">
                            {vehicleCategoryLabel}
                          </span>
                          {firmwareVersion && (
                            <span
                              className="hidden font-mono text-[10px] font-normal tracking-tight text-zinc-400 sm:text-[11px] md:inline"
                              title={firmwareRaw || `Firmware: ${firmwareVersion}`}
                            >
                              {firmwareVersion}
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center py-0.5" title="Connecting to vehicle...">
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-400" />
                      </div>
                    )
                  ) : (
                    <span className="font-sans text-xs text-zinc-500">Standby</span>
                  )}
                </div>
              </div>
            </div>

            {status === 'connected' && heartbeat.lastHeartbeatTime > 0 && (
              <div className="hidden h-5 w-px bg-zinc-800 md:block" />
            )}

            {/* Which vehicle is commanded, when several are on the link */}
            {status === 'connected' && <VehiclePicker />}

            {/* Arm Status Pill (Left of Mode) with Dropdown Flyout */}
            {status === 'connected' && heartbeat.lastHeartbeatTime > 0 && (
              <div className="relative shrink-0" ref={armMenuRef}>
                <Badge
                  variant={heartbeat.isArmed ? 'destructive' : 'secondary'}
                  className={`flex h-7 cursor-pointer select-none items-center gap-1 rounded-lg px-2 font-sans text-xs font-semibold shadow-sm transition-all sm:gap-1.5 sm:px-2.5 ${
                    isArmMenuOpen ? 'bg-zinc-800 ring-2 ring-sky-400' : 'hover:brightness-110'
                  }`}
                  onClick={() => {
                    if (replaying) return;
                    setIsArmMenuOpen(!isArmMenuOpen);
                    setArmConfirmAction(null);
                    setIsModeMenuOpen(false);
                    setIsPreArmMenuOpen(false);
                  }}
                  title={replaying ? 'Replaying a log: read-only' : 'Click to Arm / Disarm vehicle'}
                  aria-label={heartbeat.isArmed ? 'Armed: arm / disarm menu' : 'Disarmed: arm / disarm menu'}
                >
                  {heartbeat.isArmed ? (
                    <>
                      <ShieldAlert className="h-3.5 w-3.5 shrink-0 animate-pulse text-red-400" />
                      <span>ARMED</span>
                    </>
                  ) : (
                    <>
                      <Shield className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                      {/* Phones: the shield alone (armed always shows its word). */}
                      <span className="hidden sm:inline">DISARMED</span>
                    </>
                  )}
                  <ChevronDown className="ml-0.5 h-3.5 w-3.5 shrink-0 opacity-60" />
                </Badge>

                {/* Arm / Disarm Flyout with Confirmation */}
                {isArmMenuOpen && (
                  <div className="animate-in fade-in zoom-in-95 absolute left-0 z-50 mt-2 w-64 rounded-xl border border-zinc-700/80 bg-zinc-900/95 p-3 shadow-2xl backdrop-blur-md duration-150">
                    {armConfirmAction ? (
                      /* Confirmation State */
                      <div className="animate-in fade-in space-y-2.5 duration-150">
                        <div className="flex items-center gap-1.5 border-b border-zinc-800 pb-2 text-amber-400">
                          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                          <span className="text-xs font-bold uppercase tracking-tight">
                            {armConfirmAction === 'arm' || armConfirmAction === 'force_arm'
                              ? 'Confirm Arm Motors'
                              : 'Confirm Disarm Motors'}
                          </span>
                        </div>

                        <p className="text-[11px] leading-snug text-zinc-300">
                          {armConfirmAction === 'arm' &&
                            'Motors will be energized and flight controls will become live. Ensure propellers and launch area are clear.'}
                          {armConfirmAction === 'force_arm' &&
                            'WARNING: Force Arm bypasses all ArduPilot pre-arm safety checks. Exercise extreme caution!'}
                          {armConfirmAction === 'disarm' &&
                            (airborne
                              ? `The vehicle reports it is ${landed === 2 ? 'in the air' : landed === 3 ? 'taking off' : 'landing'}. Disarming cuts motor power now: it will fall.`
                              : landed === 1
                                ? 'Motors will power down immediately. The vehicle reports it is on the ground.'
                                : 'Motors will power down immediately. WARNING: If vehicle is airborne, it will crash!')}
                          {armConfirmAction === 'force_disarm' &&
                            'CRITICAL: Emergency force disarm will instantly kill motor power regardless of flight status!'}
                        </p>

                        <div className="flex items-center gap-2 pt-1">
                          <Button
                            variant={
                              armConfirmAction === 'arm' || armConfirmAction === 'force_arm' ? 'destructive' : 'default'
                            }
                            size="sm"
                            onClick={() => {
                              if (armConfirmAction === 'arm') handleArm(true, false);
                              if (armConfirmAction === 'force_arm') handleArm(true, true);
                              if (armConfirmAction === 'disarm') handleArm(false, false);
                              if (armConfirmAction === 'force_disarm') handleArm(false, true);
                              setIsArmMenuOpen(false);
                              setArmConfirmAction(null);
                            }}
                            className={`h-8 flex-1 text-xs font-bold ${
                              armConfirmAction === 'arm' || armConfirmAction === 'force_arm'
                                ? 'bg-red-600 text-white hover:bg-red-700'
                                : 'bg-amber-600 text-white hover:bg-amber-700'
                            }`}
                          >
                            {armConfirmAction === 'arm' && 'Confirm Arm'}
                            {armConfirmAction === 'force_arm' && 'Force Arm'}
                            {armConfirmAction === 'disarm' && 'Confirm Disarm'}
                            {armConfirmAction === 'force_disarm' && 'Emergency Cut'}
                          </Button>

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setArmConfirmAction(null)}
                            className="h-8 px-2.5 text-xs text-zinc-400 hover:text-white"
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      /* Initial Action State */
                      <div>
                        <div className="mb-2 flex items-center gap-2 border-b border-zinc-800 pb-2">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              heartbeat.isArmed ? 'animate-pulse bg-red-500' : 'bg-zinc-500'
                            }`}
                          />
                          <div className="text-xs font-semibold text-zinc-200">
                            Vehicle is {heartbeat.isArmed ? 'ARMED' : 'DISARMED'}
                          </div>
                          {flightStateText && (
                            <span
                              className={`ml-auto text-[10px] font-medium ${airborne ? 'text-amber-300' : 'text-zinc-400'}`}
                              title="Reported by the vehicle (EXTENDED_SYS_STATE)"
                            >
                              {flightStateText}
                            </span>
                          )}
                        </div>

                        <p className="mb-3 text-[11px] leading-snug text-zinc-400">
                          {heartbeat.isArmed
                            ? 'Motors are energized and live. Ensure throttle is idle before disarming.'
                            : 'Pre-arm safety checks apply. Stand clear of propellers before arming.'}
                        </p>

                        {heartbeat.isArmed ? (
                          <div className="space-y-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setArmConfirmAction('disarm')}
                              className="h-8 w-full gap-1.5 border-zinc-700 bg-zinc-800 text-xs font-bold text-zinc-100 hover:bg-zinc-700"
                            >
                              <Shield className="h-3.5 w-3.5" />
                              Disarm Motors
                            </Button>
                            <button
                              type="button"
                              onClick={() => setArmConfirmAction('force_disarm')}
                              className="block w-full pt-1 text-center font-sans text-[10px] font-medium text-red-400/80 underline hover:text-red-300"
                            >
                              Emergency Force Disarm
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => setArmConfirmAction('arm')}
                              className="h-8 w-full gap-1.5 bg-red-600 text-xs font-bold text-white shadow-md hover:bg-red-700"
                            >
                              <ShieldAlert className="h-3.5 w-3.5" />
                              Arm Motors
                            </Button>
                            <button
                              type="button"
                              onClick={() => setArmConfirmAction('force_arm')}
                              className="block w-full pt-1 text-center font-sans text-[10px] font-medium text-zinc-500 underline hover:text-amber-400"
                            >
                              Force Arm (Bypass Checks)
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Mode Badge (Right of Arm) with Dropdown Flyout */}
            {status === 'connected' && heartbeat.lastHeartbeatTime > 0 && (
              <div className="relative shrink-0" ref={modeMenuRef}>
                <Badge
                  variant="info"
                  className={`flex h-7 cursor-pointer select-none items-center gap-1 rounded-lg px-2 font-sans text-xs font-semibold shadow-sm transition-all sm:gap-1.5 sm:px-2.5 ${
                    isModeMenuOpen ? 'bg-sky-950/80 ring-2 ring-sky-400' : 'hover:brightness-110'
                  }`}
                  onClick={() => {
                    if (replaying) return;
                    setIsModeMenuOpen(!isModeMenuOpen);
                    setIsArmMenuOpen(false);
                    setIsPreArmMenuOpen(false);
                  }}
                  title={replaying ? 'Replaying a log: read-only' : 'Click to switch flight mode'}
                >
                  <span className="max-w-[7.5rem] truncate whitespace-nowrap sm:max-w-[10rem]">
                    {heartbeat.modeName}
                  </span>
                  <ChevronDown className="ml-0.5 h-3.5 w-3.5 shrink-0 opacity-60" />
                </Badge>

                {/* Flight Mode Selector Flyout */}
                {isModeMenuOpen && (
                  <div className="animate-in fade-in zoom-in-95 absolute left-0 z-50 mt-2 w-52 rounded-xl border border-zinc-700/80 bg-zinc-900/95 p-2 shadow-2xl backdrop-blur-md duration-150 sm:left-auto">
                    <div className="mb-1.5 flex items-center justify-between border-b border-zinc-800/80 px-2 py-1 pb-1.5 font-sans text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      <span>Flight Modes</span>
                      <span className="font-normal lowercase text-zinc-500">{vehicleCategoryLabel}</span>
                    </div>

                    <div className="max-h-64 space-y-0.5 overflow-y-auto pr-0.5">
                      {availableModes.map((m) => {
                        const isActive = heartbeat.customMode === m.mode;
                        return (
                          <button
                            key={m.mode}
                            type="button"
                            onClick={() => {
                              handleSetMode(m.mode);
                              setIsModeMenuOpen(false);
                            }}
                            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left font-sans text-xs font-medium transition-colors ${
                              isActive
                                ? 'bg-sky-500 font-bold text-white shadow-sm'
                                : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                            }`}
                          >
                            <span>{m.label}</span>
                            {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-white" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: Telemetry Rate, Theme, Settings Gear & Connection Status */}
          <div className="ml-auto flex shrink-0 items-center justify-end gap-1.5 sm:gap-2">
            {/* Link Rate Stats (Adjacent to Connection Button) */}
            {status === 'connected' && (
              <div
                className="hidden h-7 items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 font-mono text-xs font-medium text-zinc-400 lg:flex"
                title={`Telemetry Link: ${stats.packetsPerSecond} packets/sec, ${(stats.bytesReceived / 1024).toFixed(1)} KB received total`}
              >
                <Activity className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                <span>{stats.packetsPerSecond} pkt/s</span>
              </div>
            )}

            <TlogIndicator onClick={() => openConnectModal('data')} />

            {/* Daylight / Dark Cockpit Theme Toggle (Rank 7) */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDaylightMode((v) => !v)}
              className="h-7 w-7 shrink-0 rounded-lg border-zinc-800 bg-zinc-900/70 p-0 text-zinc-300 hover:bg-zinc-800 hover:text-white"
              title={daylightMode ? 'Switch to Dark Cockpit Theme' : 'Switch to High-Contrast Daylight Theme'}
              aria-label="Toggle Display Theme"
            >
              {daylightMode ? (
                <Moon className="h-3.5 w-3.5 text-sky-400" />
              ) : (
                <Sun className="h-3.5 w-3.5 text-amber-400" />
              )}
            </Button>

            {/* A newer deploy is live: offered, never forced */}
            <UpdateButton />

            {/* Explicit Settings Gear Button (#4) */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openConnectModal()}
              className="h-7 shrink-0 gap-1 rounded-lg border-zinc-800 bg-zinc-900/70 px-2 text-zinc-300 hover:bg-zinc-800 hover:text-white"
              title="Settings (Units, Link, Altitude Mode & Audio)"
              aria-label="Settings"
            >
              <Settings className="h-3.5 w-3.5 shrink-0 text-sky-400" />
              <span className="hidden text-xs font-semibold xl:inline">Settings</span>
            </Button>

            {/* Connection Status Pill (Far Right) */}
            {getStatusBadge()}
          </div>
        </div>

        {/* Link-Loss Warning Banner (#3) */}
        {isLinkLost && (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 border-t border-red-600/70 bg-red-950/90 px-3 py-1.5 text-xs text-red-100 sm:px-6"
          >
            <div className="flex min-w-0 items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 animate-pulse text-red-400" />
              <span className="font-bold uppercase tracking-wider text-red-300">Telemetry Link Lost</span>
              <span className="truncate text-red-200">
                — No vehicle heartbeat{linkLostSeconds ? ` (${linkLostSeconds}s ago)` : ''}. Displayed telemetry is
                stale.
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => connect()}
              className="h-6 shrink-0 gap-1 border-red-500/60 bg-red-900/50 px-2.5 text-[11px] font-bold text-white hover:bg-red-800"
            >
              <RefreshCw className="h-3 w-3" />
              Reconnect
            </Button>
          </div>
        )}

        {/* A telemetry log is replayed: its controls, and the reminder that nothing is sent */}
        <ReplayBar />

        {/* The commanded vehicle is silent and another is on the link: offered, not taken */}
        <TakeoverBanner />

        {/* Persistent Global Telemetry Status Strip (Health First, Battery, GPS, Alt/Spd, Home, Flight Time) */}
        <div className="relative flex min-h-[30px] items-center overflow-hidden border-t border-zinc-800/80 bg-zinc-900/70 md:min-h-[34px]">
          <div className="no-scrollbar flex w-full items-center gap-3 overflow-x-auto px-2.5 py-1 font-mono text-[11px] sm:gap-5 sm:px-6 md:text-[13px]">
            {/* Pre-Arm & Subsystem Health Pill (Rank 3 - first on mobile for immediate visibility) */}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setIsPreArmMenuOpen(true)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-sans text-[10px] font-bold uppercase tracking-wider transition-colors md:text-[11px] ${
                  !isHeartbeatActive
                    ? 'border-zinc-800 bg-zinc-900 text-zinc-500'
                    : preArm.isReady && !vibeWarning
                      ? 'border-emerald-600/50 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-950/70'
                      : 'border-amber-500/60 bg-amber-950/50 text-amber-300 hover:bg-amber-950/80'
                }`}
                title="Click for Pre-Arm Readiness, EKF & Subsystem Health details"
              >
                {!isHeartbeatActive ? (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
                    <span>PRE-ARM: STANDBY</span>
                  </>
                ) : preArm.isReady && !vibeWarning ? (
                  <>
                    <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                    <span>{heartbeat.isArmed ? 'HEALTH OK' : 'PRE-ARM READY'}</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3 w-3 text-amber-400" />
                    <span>
                      {preArm.activePreArmErrors[0]
                        ? preArm.activePreArmErrors[0].slice(0, 28)
                        : `PRE-ARM CHECK (${preArm.failedSubsystems.length + preArm.activePreArmErrors.length})`}
                    </span>
                  </>
                )}
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
            </div>

            <span className="text-zinc-700">|</span>

            <LinkPill active={isHeartbeatActive} />

            <span className="text-zinc-700">|</span>

            <BatteryPill active={isHeartbeatActive} />

            <span className="text-zinc-700">|</span>

            <GpsPill active={isHeartbeatActive} />

            <span className="text-zinc-700">|</span>

            <AltSpeedPill active={isHeartbeatActive} plane={vehicleCategory === 'plane'} />

            <span className="text-zinc-700">|</span>

            <HomePill active={isHeartbeatActive} />

            <span className="hidden text-zinc-700 sm:inline">|</span>

            {/* Flight Time Pill */}
            <div className="hidden shrink-0 items-center gap-1.5 sm:flex" title="Cumulative Armed Flight Time">
              <Clock className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
              <span className="font-sans text-[10px] font-bold uppercase text-zinc-400 md:text-[11px]">FLT</span>
              <span className="font-bold text-zinc-200">{formatDurationClock(totalArmedMs)}</span>
            </div>
          </div>

          {/* Global Toast Notification overlay on top of the status bar */}
          {commandFeedback && (
            <div
              role="status"
              aria-live="polite"
              className={`animate-in fade-in absolute inset-0 z-30 flex items-center justify-between gap-2 px-3 font-sans text-xs transition-all duration-150 sm:px-6 ${
                commandFeedback.status === 'pending'
                  ? 'border-y border-sky-600/70 bg-sky-950/95 text-sky-200'
                  : commandFeedback.status === 'accepted'
                    ? 'border-y border-emerald-600/70 bg-emerald-950/95 text-emerald-200'
                    : 'border-rose-600/70 bg-rose-950/95 text-rose-100'
              }`}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {commandFeedback.status === 'pending' ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-400" />
                ) : commandFeedback.status === 'accepted' ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                )}
                <div className="min-w-0 flex-1 truncate text-[11px] sm:text-xs">
                  <span className="font-bold">{commandFeedback.label}:</span>{' '}
                  <span className="font-mono font-semibold">
                    {commandFeedback.status === 'pending'
                      ? 'AWAITING ACK…'
                      : (commandFeedback.resultText ?? commandFeedback.status.toUpperCase())}
                  </span>
                  {commandFeedback.reason && (
                    <span className="ml-1.5 font-sans font-medium text-amber-300">— {commandFeedback.reason}</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={clearCommandFeedback}
                className="shrink-0 rounded p-1 text-zinc-400 transition-colors hover:text-white"
                title="Dismiss notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Settings: mounted only while open, so its store subscriptions (the connection stats tick every second)
          don't re-render it while closed. */}
      {isConnectModalOpen && (
        <SettingsDialog
          open
          onClose={handleCloseConnectModal}
          initialTab={settingsTab}
          daylightMode={daylightMode}
          setDaylightMode={setDaylightMode}
        />
      )}

      {/* Pre-Arm & Subsystem Health Modal */}
      <Modal
        isOpen={isPreArmMenuOpen}
        onClose={() => setIsPreArmMenuOpen(false)}
        title="Pre-Arm & Subsystem Health"
        description="Autopilot pre-flight checks, sensor health, and active arming blockers."
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-3">
            <div className="flex min-w-0 items-center gap-2.5">
              {preArm.isReady && !vibeWarning ? (
                <>
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-emerald-300">
                      {heartbeat.isArmed ? 'VEHICLE ARMED (HEALTHY)' : 'PRE-ARM CHECKS PASSED'}
                    </div>
                    <div className="truncate text-[11px] text-zinc-400">
                      All required onboard sensors and safety checks report normal.
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-amber-300">PRE-ARM CHECKS FAILING</div>
                    <div className="truncate text-[11px] text-zinc-400">
                      Vehicle cannot be armed until blockers below are resolved.
                    </div>
                  </div>
                </>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!isHeartbeatActive || replaying}
              onClick={handleRunPreArmChecks}
              className="h-8 shrink-0 border-sky-500/50 bg-sky-950/40 px-3 text-xs font-bold text-sky-200 hover:bg-sky-900/60"
            >
              Run Pre-Arm Check
            </Button>
          </div>

          {/* Subsystem Health Grid */}
          <div>
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400">Subsystems & Sensors</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                {
                  label: 'Pre-Arm Bit',
                  ok: !preArm.prearmBitPresent || preArm.prearmBitHealthy,
                },
                {
                  label: 'Sensors',
                  ok: preArm.failedSubsystems.length === 0,
                  detail: preArm.failedSubsystems.length > 0 ? preArm.failedSubsystems.join(', ') : 'OK',
                },
                {
                  label: 'EKF Nav',
                  ok: !isHeartbeatActive || ekfHealthy,
                  detail: isHeartbeatActive ? `Var ${ekfVarText}` : '--',
                },
                {
                  label: 'Vibration',
                  ok: !vibeWarning,
                  detail: isHeartbeatActive ? `${vibeText} m/s²` : '--',
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 p-2.5"
                >
                  <span className="font-medium text-zinc-300">{item.label}</span>
                  <span
                    className={`flex items-center gap-1.5 font-mono text-xs font-bold ${
                      item.ok ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {item.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    {item.detail ?? (item.ok ? 'PASS' : 'FAIL')}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Active Pre-Arm / Arming Blocker Messages */}
          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              Active Pre-Arm & Safety Notices ({preArm.activePreArmErrors.length})
            </div>
            {preArm.activePreArmErrors.length === 0 ? (
              <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/30 p-3 text-xs text-emerald-300">
                No Pre-Arm blockers reported by autopilot telemetry.
              </div>
            ) : (
              <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                {preArm.activePreArmErrors.map((err, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-lg border border-amber-700/50 bg-amber-950/40 px-3 py-2 font-mono text-xs text-amber-200"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    <span>{err}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end border-t border-zinc-800 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsPreArmMenuOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
