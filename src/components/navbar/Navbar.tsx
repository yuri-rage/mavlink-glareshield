import { TlogIndicator } from './TlogSettings';
import { TakeoverBanner, VehiclePicker } from './VehiclePicker';
import { displayAltitudeM } from '../../lib/displayAltitude';
import React, { Suspense, lazy, useState, useRef, useEffect } from 'react';
import type { SettingsTab } from './SettingsDialog';

const SettingsDialog = lazy(() => import('./SettingsDialog'));
import { useConnectionStore } from '../../store/connectionStore';
import {
  useTelemetryStore,
  evaluatePreArmReadiness,
  sendTrackedCommand,
} from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { mavlinkConnection } from '../../mavlink/connection';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Modal } from '../ui/modal';
import {
  WifiOff,
  Shield,
  ShieldAlert,
  Activity,
  ChevronDown,
  Check,
  AlertTriangle,
  Loader2,
  Settings,
  BatteryCharging,
  Satellite,
  Home,
  Clock,
  CheckCircle2,
  XCircle,
  X,
  Sun,
  Moon,
  RefreshCw,
} from 'lucide-react';
import { messageRateManager } from '../../mavlink/rateManager';
import {
  getVehicleCategory,
  getVehicleCategoryLabel,
  getVehicleFlightModes,
  LANDED_STATE_NAMES,
  MAVLINK_MSG_ID,
  VTOL_STATE_NAMES,
} from '../../mavlink/messages';

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
  return (
    <div className="flex items-center gap-1.5 shrink-0" title="Pack Voltage & Remaining Capacity">
      <BatteryCharging
        className={`h-3.5 w-3.5 shrink-0 ${
          !shown ? 'text-zinc-500' : battery.remaining <= 15 ? 'text-red-400 animate-pulse' : battery.remaining <= 25 ? 'text-amber-400' : 'text-emerald-400'
        }`}
      />
      <span className="text-zinc-400 font-sans font-bold uppercase text-[10px] md:text-[11px]">BAT</span>
      <span
        className={`font-bold ${!shown ? 'text-zinc-500' : battery.remaining <= 15 ? 'text-red-300' : battery.remaining <= 25 ? 'text-amber-300' : 'text-zinc-100'}`}
      >
        {shown ? `${battery.voltage.toFixed(1)}V · ${battery.remaining}%` : '--'}
      </span>
    </div>
  );
};

const GpsPill: React.FC<{ active: boolean }> = ({ active }) => {
  const fixType = useTelemetryStore((s) => s.gps.fixType);
  const fixLabel = useTelemetryStore((s) => s.gps.fixLabel);
  const satellites = useTelemetryStore((s) => s.gps.satellites);
  return (
    <div className="flex items-center gap-1.5 shrink-0" title="GNSS Fix & Visible Satellites">
      <Satellite className={`h-3.5 w-3.5 shrink-0 ${!active ? 'text-zinc-500' : fixType >= 3 ? 'text-emerald-400' : 'text-amber-400'}`} />
      <span className="text-zinc-400 font-sans font-bold uppercase text-[10px] md:text-[11px]">GPS</span>
      <span className="font-bold text-zinc-100">{active ? `${fixLabel} (${satellites})` : '--'}</span>
    </div>
  );
};

const AltSpeedPill: React.FC<{ active: boolean; plane: boolean }> = ({ active, plane }) => {
  const { formatAltitude, formatSpeed, altitudeMode } = useUnitsStore();
  const altM = useTelemetryStore((s) => displayAltitudeM(altitudeMode, s.position, s.vfr.alt));
  const speedMs = useTelemetryStore((s) => (plane ? s.vfr.airspeed : s.vfr.groundspeed));
  return (
    <div className="flex items-center gap-1.5 shrink-0" title="Active Altitude & Speed">
      <span className="text-zinc-400 font-sans font-bold uppercase text-[10px] md:text-[11px]">{altitudeMode.toUpperCase()}</span>
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
      className="flex items-center gap-1.5 shrink-0"
      title={home.source !== 'none' ? `Home (${home.source.toUpperCase()}): ${home.lat.toFixed(5)}, ${home.lon.toFixed(5)}` : 'Home Position not yet received'}
    >
      <Home className={`h-3.5 w-3.5 shrink-0 ${home.source !== 'none' ? 'text-amber-400' : 'text-zinc-500'}`} />
      <span className="text-zinc-400 font-sans font-bold uppercase text-[10px] md:text-[11px]">HOME</span>
      <span className="font-bold text-zinc-100">
        {active && home.distanceM !== null ? formatHomeVector(home.bearingDeg, home.distanceM) : home.source !== 'none' ? 'SET' : '--'}
      </span>
    </div>
  );
};

export const Navbar: React.FC = () => {
  const {
    url,
    linkKind,
    serialBaud,
    status,
    stats,
    connect,
  } = useConnectionStore();
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
    ? [landed > 0 ? LANDED_STATE_NAMES[landed] : null, extendedState.vtolState > 0 ? VTOL_STATE_NAMES[extendedState.vtolState] : null]
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
  const vibeText = useTelemetryStore((s) => Math.max(s.vibration.vibrationX, s.vibration.vibrationY, s.vibration.vibrationZ).toFixed(1));
  const hasConnectedInSession = useTelemetryStore((state) => state.hasConnectedInSession);
  const armedStartedAt = useTelemetryStore((state) => state.armedStartedAt);
  const accumulatedArmedMs = useTelemetryStore((state) => state.accumulatedArmedMs);
  const firmwareVersion = useTelemetryStore((state) => state.firmwareVersion);
  const firmwareRaw = useTelemetryStore((state) => state.firmwareRaw);
  const commandFeedback = useTelemetryStore((state) => state.commandFeedback);
  const clearCommandFeedback = useTelemetryStore((state) => state.clearCommandFeedback);

  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('link');
  // The dialog's code is fetched the first time it opens, then kept (closing doesn't unload it).
  const [settingsLoaded, setSettingsLoaded] = useState(false);
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
  const [armConfirmAction, setArmConfirmAction] = useState<
    'arm' | 'disarm' | 'force_arm' | 'force_disarm' | null
  >(null);
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
    setSettingsLoaded(true);
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

    return (
      <img
        src={src}
        alt={alt}
        className={`${sizeClass} shrink-0 object-contain`}
      />
    );
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'connected':
        return (
          <Badge
            variant="success"
            className="h-7 px-2 sm:px-2.5 text-xs font-sans font-semibold gap-1.5 cursor-pointer rounded-lg flex items-center hover:bg-emerald-950/80 transition-colors shadow-sm"
            onClick={() => openConnectModal()}
            title={`Connected: ${linkKind === 'serial' ? `serial @ ${serialBaud} baud` : url} (click for Link & Page Configuration)`}
          >
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="hidden md:inline">Connected</span>
          </Badge>
        );
      case 'connecting':
        return (
          <Badge
            variant="warning"
            className="h-7 px-2 sm:px-2.5 text-xs font-sans font-semibold gap-1.5 cursor-pointer rounded-lg flex items-center shadow-sm"
            onClick={() => openConnectModal()}
            title="Connecting to MAVLink endpoint (click for Link & Page Configuration)..."
          >
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping shrink-0" />
            <span className="hidden md:inline">Connecting...</span>
          </Badge>
        );
      case 'error':
        return (
          <Badge
            variant="destructive"
            className="h-7 px-2 sm:px-2.5 text-xs font-sans font-semibold gap-1.5 cursor-pointer rounded-lg flex items-center shadow-sm"
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
            className="h-7 px-2 sm:px-2.5 text-xs font-sans font-semibold bg-sky-500 hover:bg-sky-600 text-white gap-1.5 rounded-lg flex items-center shadow-sm"
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
    nowMs - heartbeat.lastHeartbeatTime <= 3500;

  const isLinkLost =
    hasConnectedInSession &&
    (status !== 'connected' ||
      heartbeat.lastHeartbeatTime === 0 ||
      nowMs - heartbeat.lastHeartbeatTime > 3500);

  const linkLostSeconds =
    heartbeat.lastHeartbeatTime > 0
      ? Math.max(4, Math.floor((nowMs - heartbeat.lastHeartbeatTime) / 1000))
      : null;

  const totalArmedMs =
    accumulatedArmedMs +
    (heartbeat.isArmed && armedStartedAt !== null ? Math.max(0, nowMs - armedStartedAt) : 0);

  const preArm = evaluatePreArmReadiness(sysStatus, statusMessages, heartbeat.isArmed);

  return (
    <>
      <header id="app-navbar" className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-md">
        {/* Top Row: Brand, Arm/Mode Flyouts, Link Rate, Settings Gear & Connection Pill */}
        {/* Wraps rather than overlapping if a long mode name or label ever outgrows the row. */}
        <div className="px-2.5 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-y-2 gap-x-2 sm:gap-x-3 max-w-full">
          {/* Left: Brand & Flight Status */}
          <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
              <div className="h-8 w-8 rounded-lg border border-sky-500/25 bg-zinc-900/90 shadow-sm flex items-center justify-center p-0.5 shrink-0">
                <img
                  src="/logo-64.png"
                  alt="Glareshield Logo"
                  className="h-full w-full object-contain filter drop-shadow(0 1px 2px rgba(0,0,0,0.5))"
                />
              </div>
              <div>
                <span className="font-bold text-sm sm:text-base tracking-tight text-zinc-100 hidden md:inline">
                  GLARESHIELD
                </span>
                <div className="flex items-center gap-1 sm:gap-1.5 leading-none mt-0.5">
                  {status === 'connected' ? (
                    heartbeat.lastHeartbeatTime > 0 ? (
                      <>
                        {getVehicleIcon()}
                        <div className="flex items-baseline gap-1 sm:gap-1.5 min-w-0">
                          <span className="text-xs text-sky-300 font-sans font-medium tracking-tight hidden min-[480px]:inline truncate">
                            {vehicleCategoryLabel}
                          </span>
                          {firmwareVersion && (
                            <span
                              className="text-[10px] sm:text-[11px] text-zinc-400 font-mono font-normal tracking-tight hidden md:inline"
                              title={firmwareRaw || `Firmware: ${firmwareVersion}`}
                            >
                              {firmwareVersion}
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center py-0.5" title="Connecting to vehicle...">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400 shrink-0" />
                      </div>
                    )
                  ) : (
                    <span className="text-zinc-500 text-xs font-sans">Standby</span>
                  )}
                </div>
              </div>
            </div>

            {status === 'connected' && heartbeat.lastHeartbeatTime > 0 && (
              <div className="h-5 w-px bg-zinc-800 hidden md:block" />
            )}

            {/* Which vehicle is commanded, when several are on the link */}
            {status === 'connected' && <VehiclePicker />}

            {/* Arm Status Pill (Left of Mode) with Dropdown Flyout */}
            {status === 'connected' && heartbeat.lastHeartbeatTime > 0 && (
              <div className="relative shrink-0" ref={armMenuRef}>
                <Badge
                  variant={heartbeat.isArmed ? 'destructive' : 'secondary'}
                  className={`h-7 px-2 sm:px-2.5 text-xs font-sans font-semibold gap-1 sm:gap-1.5 cursor-pointer select-none transition-all shadow-sm rounded-lg flex items-center ${
                    isArmMenuOpen ? 'ring-2 ring-sky-400 bg-zinc-800' : 'hover:brightness-110'
                  }`}
                  onClick={() => {
                    setIsArmMenuOpen(!isArmMenuOpen);
                    setArmConfirmAction(null);
                    setIsModeMenuOpen(false);
                    setIsPreArmMenuOpen(false);
                  }}
                  title="Click to Arm / Disarm vehicle"
                  aria-label={heartbeat.isArmed ? 'Armed: arm / disarm menu' : 'Disarmed: arm / disarm menu'}
                >
                  {heartbeat.isArmed ? (
                    <>
                      <ShieldAlert className="h-3.5 w-3.5 animate-pulse text-red-400 shrink-0" />
                      <span>ARMED</span>
                    </>
                  ) : (
                    <>
                      <Shield className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                      {/* Phones: the shield alone (armed always shows its word). */}
                      <span className="hidden sm:inline">DISARMED</span>
                    </>
                  )}
                  <ChevronDown className="h-3.5 w-3.5 opacity-60 ml-0.5 shrink-0" />
                </Badge>

                {/* Arm / Disarm Flyout with Confirmation */}
                {isArmMenuOpen && (
                  <div className="absolute left-0 mt-2 w-64 rounded-xl bg-zinc-900/95 border border-zinc-700/80 shadow-2xl backdrop-blur-md p-3 z-50 animate-in fade-in zoom-in-95 duration-150">
                    {armConfirmAction ? (
                      /* Confirmation State */
                      <div className="space-y-2.5 animate-in fade-in duration-150">
                        <div className="flex items-center gap-1.5 pb-2 border-b border-zinc-800 text-amber-400">
                          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                          <span className="font-bold text-xs uppercase tracking-tight">
                            {armConfirmAction === 'arm' || armConfirmAction === 'force_arm'
                              ? 'Confirm Arm Motors'
                              : 'Confirm Disarm Motors'}
                          </span>
                        </div>

                        <p className="text-[11px] text-zinc-300 leading-snug">
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
                              armConfirmAction === 'arm' || armConfirmAction === 'force_arm'
                                ? 'destructive'
                                : 'default'
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
                            className={`flex-1 h-8 text-xs font-bold ${
                              armConfirmAction === 'arm' || armConfirmAction === 'force_arm'
                                ? 'bg-red-600 hover:bg-red-700 text-white'
                                : 'bg-amber-600 hover:bg-amber-700 text-white'
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
                        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-zinc-800">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              heartbeat.isArmed ? 'bg-red-500 animate-pulse' : 'bg-zinc-500'
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

                        <p className="text-[11px] text-zinc-400 mb-3 leading-snug">
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
                              className="w-full h-8 text-xs font-bold gap-1.5 border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-100"
                            >
                              <Shield className="h-3.5 w-3.5" />
                              Disarm Motors
                            </Button>
                            <button
                              type="button"
                              onClick={() => setArmConfirmAction('force_disarm')}
                              className="w-full text-center text-[10px] text-red-400/80 hover:text-red-300 font-sans font-medium underline pt-1 block"
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
                              className="w-full h-8 text-xs font-bold gap-1.5 shadow-md bg-red-600 hover:bg-red-700 text-white"
                            >
                              <ShieldAlert className="h-3.5 w-3.5" />
                              Arm Motors
                            </Button>
                            <button
                              type="button"
                              onClick={() => setArmConfirmAction('force_arm')}
                              className="w-full text-center text-[10px] text-zinc-500 hover:text-amber-400 font-sans font-medium underline pt-1 block"
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
                  className={`h-7 px-2 sm:px-2.5 text-xs font-sans font-semibold gap-1 sm:gap-1.5 cursor-pointer select-none transition-all shadow-sm rounded-lg flex items-center ${
                    isModeMenuOpen ? 'ring-2 ring-sky-400 bg-sky-950/80' : 'hover:brightness-110'
                  }`}
                  onClick={() => {
                    setIsModeMenuOpen(!isModeMenuOpen);
                    setIsArmMenuOpen(false);
                    setIsPreArmMenuOpen(false);
                  }}
                  title="Click to switch flight mode"
                >
                  <span className="whitespace-nowrap truncate max-w-[7.5rem] sm:max-w-[10rem]">{heartbeat.modeName}</span>
                  <ChevronDown className="h-3.5 w-3.5 opacity-60 ml-0.5 shrink-0" />
                </Badge>

                {/* Flight Mode Selector Flyout */}
                {isModeMenuOpen && (
                  <div className="absolute left-0 sm:left-auto mt-2 w-52 rounded-xl bg-zinc-900/95 border border-zinc-700/80 shadow-2xl backdrop-blur-md p-2 z-50 animate-in fade-in zoom-in-95 duration-150">
                    <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400 font-sans flex items-center justify-between border-b border-zinc-800/80 pb-1.5 mb-1.5">
                      <span>Flight Modes</span>
                      <span className="text-zinc-500 lowercase font-normal">{vehicleCategoryLabel}</span>
                    </div>

                    <div className="space-y-0.5 max-h-64 overflow-y-auto pr-0.5">
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
                            className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-sans font-medium flex items-center justify-between transition-colors ${
                              isActive
                                ? 'bg-sky-500 text-white font-bold shadow-sm'
                                : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                            }`}
                          >
                            <span>{m.label}</span>
                            {isActive && <Check className="h-3.5 w-3.5 text-white shrink-0" />}
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
          <div className="flex items-center gap-1.5 sm:gap-2 justify-end ml-auto shrink-0">
            {/* Link Rate Stats (Adjacent to Connection Button) */}
            {status === 'connected' && (
              <div
                className="h-7 hidden lg:flex items-center gap-1.5 text-xs font-mono font-medium text-zinc-400 border border-zinc-800 rounded-lg px-2.5 bg-zinc-900/60"
                title={`Telemetry Link: ${stats.packetsPerSecond} packets/sec, ${(stats.bytesReceived / 1024).toFixed(1)} KB received total`}
              >
                <Activity className="h-3.5 w-3.5 text-sky-400 shrink-0" />
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
              className="h-7 w-7 p-0 border-zinc-800 bg-zinc-900/70 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg shrink-0"
              title={daylightMode ? 'Switch to Dark Cockpit Theme' : 'Switch to High-Contrast Daylight Theme'}
              aria-label="Toggle Display Theme"
            >
              {daylightMode ? (
                <Moon className="h-3.5 w-3.5 text-sky-400" />
              ) : (
                <Sun className="h-3.5 w-3.5 text-amber-400" />
              )}
            </Button>

            {/* Explicit Settings Gear Button (#4) */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openConnectModal()}
              className="h-7 px-2 border-zinc-800 bg-zinc-900/70 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg gap-1 shrink-0"
              title="Settings (Units, Link, Altitude Mode & Audio)"
              aria-label="Settings"
            >
              <Settings className="h-3.5 w-3.5 text-sky-400 shrink-0" />
              <span className="hidden xl:inline text-xs font-semibold">Settings</span>
            </Button>

            {/* Connection Status Pill (Far Right) */}
            {getStatusBadge()}
          </div>
        </div>

        {/* Link-Loss Warning Banner (#3) */}
        {isLinkLost && (
          <div
            role="alert"
            className="bg-red-950/90 border-t border-red-600/70 px-3 sm:px-6 py-1.5 flex items-center justify-between gap-2 text-xs text-red-100"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="h-4 w-4 text-red-400 animate-pulse shrink-0" />
              <span className="font-bold uppercase tracking-wider text-red-300">
                Telemetry Link Lost
              </span>
              <span className="text-red-200 truncate">
                — No vehicle heartbeat{linkLostSeconds ? ` (${linkLostSeconds}s ago)` : ''}. Displayed telemetry is stale.
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => connect()}
              className="h-6 px-2.5 text-[11px] font-bold border-red-500/60 bg-red-900/50 text-white hover:bg-red-800 shrink-0 gap-1"
            >
              <RefreshCw className="h-3 w-3" />
              Reconnect
            </Button>
          </div>
        )}

        {/* The commanded vehicle is silent and another is on the link: offered, not taken */}
        <TakeoverBanner />

        {/* Persistent Global Telemetry Status Strip (Health First, Battery, GPS, Alt/Spd, Home, Flight Time) */}
        <div className="relative border-t border-zinc-800/80 bg-zinc-900/70 min-h-[30px] md:min-h-[34px] flex items-center overflow-hidden">
          <div className="px-2.5 sm:px-6 py-1 flex items-center gap-3 sm:gap-5 text-[11px] md:text-[13px] font-mono overflow-x-auto no-scrollbar w-full">
            {/* Pre-Arm & Subsystem Health Pill (Rank 3 - first on mobile for immediate visibility) */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setIsPreArmMenuOpen(true)}
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[10px] md:text-[11px] font-sans font-bold uppercase tracking-wider transition-colors ${
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

          <BatteryPill active={isHeartbeatActive} />

          <span className="text-zinc-700">|</span>

          <GpsPill active={isHeartbeatActive} />

          <span className="text-zinc-700">|</span>

          <AltSpeedPill active={isHeartbeatActive} plane={vehicleCategory === 'plane'} />

          <span className="text-zinc-700">|</span>

          <HomePill active={isHeartbeatActive} />

          <span className="text-zinc-700 hidden sm:inline">|</span>

          {/* Flight Time Pill */}
          <div
            className="hidden sm:flex items-center gap-1.5 shrink-0"
            title="Cumulative Armed Flight Time"
          >
            <Clock className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
            <span className="text-zinc-400 font-sans font-bold uppercase text-[10px] md:text-[11px]">FLT</span>
            <span className="font-bold text-zinc-200">{formatDurationClock(totalArmedMs)}</span>
          </div>
        </div>

        {/* Global Toast Notification overlay on top of the status bar */}
        {commandFeedback && (
          <div
            role="status"
            aria-live="polite"
            className={`absolute inset-0 z-30 px-3 sm:px-6 flex items-center justify-between gap-2 text-xs font-sans transition-all animate-in fade-in duration-150 ${
              commandFeedback.status === 'pending'
                ? 'bg-sky-950/95 border-y border-sky-600/70 text-sky-200'
                : commandFeedback.status === 'accepted'
                  ? 'bg-emerald-950/95 border-y border-emerald-600/70 text-emerald-200'
                  : 'bg-rose-950/95 border-rose-600/70 text-rose-100'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {commandFeedback.status === 'pending' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400 shrink-0" />
              ) : commandFeedback.status === 'accepted' ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
              )}
              <div className="min-w-0 flex-1 truncate text-[11px] sm:text-xs">
                <span className="font-bold">{commandFeedback.label}:</span>{' '}
                <span className="font-mono font-semibold">
                  {commandFeedback.status === 'pending'
                    ? 'AWAITING ACK…'
                    : commandFeedback.resultText ?? commandFeedback.status.toUpperCase()}
                </span>
                {commandFeedback.reason && (
                  <span className="ml-1.5 text-amber-300 font-medium font-sans">
                    — {commandFeedback.reason}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={clearCommandFeedback}
              className="text-zinc-400 hover:text-white p-1 rounded shrink-0 transition-colors"
              title="Dismiss notification"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </header>

      {/* Settings (loaded on first open) */}
      {settingsLoaded && (
        <Suspense fallback={null}>
          <SettingsDialog
            open={isConnectModalOpen}
            onClose={handleCloseConnectModal}
            initialTab={settingsTab}
            daylightMode={daylightMode}
            setDaylightMode={setDaylightMode}
          />
        </Suspense>
      )}

      {/* Pre-Arm & Subsystem Health Modal */}
      <Modal
        isOpen={isPreArmMenuOpen}
        onClose={() => setIsPreArmMenuOpen(false)}
        title="Pre-Arm & Subsystem Health"
        description="Autopilot pre-flight checks, sensor health, and active arming blockers."
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-900 border border-zinc-800">
            <div className="flex items-center gap-2.5 min-w-0">
              {preArm.isReady && !vibeWarning ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-emerald-300">
                      {heartbeat.isArmed ? 'VEHICLE ARMED (HEALTHY)' : 'PRE-ARM CHECKS PASSED'}
                    </div>
                    <div className="text-[11px] text-zinc-400 truncate">
                      All required onboard sensors and safety checks report normal.
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-amber-300">PRE-ARM CHECKS FAILING</div>
                    <div className="text-[11px] text-zinc-400 truncate">
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
              disabled={!isHeartbeatActive}
              onClick={handleRunPreArmChecks}
              className="h-8 px-3 text-xs font-bold border-sky-500/50 bg-sky-950/40 text-sky-200 hover:bg-sky-900/60 shrink-0"
            >
              Run Pre-Arm Check
            </Button>
          </div>

          {/* Subsystem Health Grid */}
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
              Subsystems & Sensors
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                {
                  label: 'Pre-Arm Bit',
                  ok: !preArm.prearmBitPresent || preArm.prearmBitHealthy,
                },
                {
                  label: 'Sensors',
                  ok: preArm.failedSubsystems.length === 0,
                  detail:
                    preArm.failedSubsystems.length > 0
                      ? preArm.failedSubsystems.join(', ')
                      : 'OK',
                },
                {
                  label: 'EKF Nav',
                  ok: !isHeartbeatActive || ekfHealthy,
                  detail: isHeartbeatActive
                    ? `Var ${ekfVarText}`
                    : '--',
                },
                {
                  label: 'Vibration',
                  ok: !vibeWarning,
                  detail: isHeartbeatActive
                    ? `${vibeText} m/s²`
                    : '--',
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900 border border-zinc-800"
                >
                  <span className="text-zinc-300 font-medium">{item.label}</span>
                  <span
                    className={`font-mono font-bold flex items-center gap-1.5 text-xs ${
                      item.ok ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {item.ok ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <XCircle className="h-4 w-4" />
                    )}
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
              <div className="text-xs text-emerald-300 bg-emerald-950/30 border border-emerald-800/50 rounded-lg p-3">
                No Pre-Arm blockers reported by autopilot telemetry.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {preArm.activePreArmErrors.map((err, i) => (
                  <div
                    key={i}
                    className="text-xs font-mono text-amber-200 bg-amber-950/40 border border-amber-700/50 rounded-lg px-3 py-2 flex items-start gap-2"
                  >
                    <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>{err}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end pt-2 border-t border-zinc-800">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsPreArmMenuOpen(false)}
            >
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
