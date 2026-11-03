import React, { useState, useRef, useEffect } from 'react';
import { useConnectionStore } from '../../store/connectionStore';
import {
  useTelemetryStore,
  evaluatePreArmReadiness,
  sendTrackedCommand,
} from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { useAudioAlertsStore } from '../../lib/audioAlerts';
import { mavlinkConnection } from '../../mavlink/connection';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Modal } from '../ui/modal';
import { Input } from '../ui/input';
import {
  WifiOff,
  Shield,
  ShieldAlert,
  Activity,
  ChevronDown,
  Check,
  AlertTriangle,
  Loader2,
  RotateCcw,
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
  Volume2,
  VolumeX,
  Milestone,
  RefreshCw,
  Info,
} from 'lucide-react';
import { BandwidthProfile } from '../../mavlink/rateManager';
import { getVehicleCategory, getVehicleCategoryLabel, getVehicleFlightModes } from '../../mavlink/messages';

const STORAGE_KEY_THEME = 'mavlink_glareshield_theme';

function formatDurationClock(totalMs: number): string {
  const totalSec = Math.max(0, Math.floor(totalMs / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const Navbar: React.FC = () => {
  const {
    url,
    status,
    errorMessage,
    bandwidthProfile,
    stats,
    setUrl,
    setBandwidthProfile,
    gcsSystemId,
    setGcsSystemId,
    connect,
    disconnect,
  } = useConnectionStore();
  const heartbeat = useTelemetryStore((state) => state.heartbeat);
  const battery = useTelemetryStore((state) => state.battery);
  const gps = useTelemetryStore((state) => state.gps);
  const vfr = useTelemetryStore((state) => state.vfr);
  const position = useTelemetryStore((state) => state.position);
  const homePosition = useTelemetryStore((state) => state.homePosition);
  const sysStatus = useTelemetryStore((state) => state.sysStatus);
  const statusMessages = useTelemetryStore((state) => state.statusMessages);
  const ekf = useTelemetryStore((state) => state.ekf);
  const vibration = useTelemetryStore((state) => state.vibration);
  const hasConnectedInSession = useTelemetryStore((state) => state.hasConnectedInSession);
  const armedStartedAt = useTelemetryStore((state) => state.armedStartedAt);
  const accumulatedArmedMs = useTelemetryStore((state) => state.accumulatedArmedMs);
  const firmwareVersion = useTelemetryStore((state) => state.firmwareVersion);
  const firmwareRaw = useTelemetryStore((state) => state.firmwareRaw);
  const commandFeedback = useTelemetryStore((state) => state.commandFeedback);
  const clearCommandFeedback = useTelemetryStore((state) => state.clearCommandFeedback);
  const {
    system: unitSystem,
    setSystem: setUnitSystem,
    altitudeMode,
    setAltitudeMode,
    formatAltitude,
    formatSpeed,
    formatDistance,
    formatHomeVector,
  } = useUnitsStore();
  const {
    soundEnabled,
    voiceEnabled,
    waypointAnnounceEnabled,
    ttsStatus,
    ttsDownloadProgress,
    toggleSound,
    toggleVoice,
    toggleWaypointAnnounce,
  } = useAudioAlertsStore();

  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [inputUrl, setInputUrl] = useState(url);
  const [inputGcsSysId, setInputGcsSysId] = useState(gcsSystemId);
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
  const preArmMenuRef = useRef<HTMLDivElement | null>(null);

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
      if (preArmMenuRef.current && !preArmMenuRef.current.contains(event.target as Node)) {
        setIsPreArmMenuOpen(false);
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

  const openConnectModal = () => {
    setInputUrl(url);
    setInputGcsSysId(gcsSystemId);
    mavlinkConnection.pauseReconnect();
    setIsConnectModalOpen(true);
  };

  const handleCloseConnectModal = () => {
    setIsConnectModalOpen(false);
    mavlinkConnection.resumeReconnect();
  };

  const handleConnectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'connected') return;
    setUrl(inputUrl);
    setGcsSystemId(inputGcsSysId);
    setIsConnectModalOpen(false);
    mavlinkConnection.resumeReconnect();
    connect();
  };

  const handleDisconnect = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    disconnect();
  };

  const handleClearStorage = (e?: React.MouseEvent) => {
    if (typeof window === 'undefined') return;
    if (e?.shiftKey || window.confirm('Clear all local storage and reload the page for a clean load?')) {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (err) {
        console.error('Failed to clear storage:', err);
      }
      window.location.reload();
    }
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
            onClick={openConnectModal}
            title={`Connected: ${url} (click for Link & Page Configuration)`}
          >
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="hidden sm:inline">Connected</span>
          </Badge>
        );
      case 'connecting':
        return (
          <Badge
            variant="warning"
            className="h-7 px-2 sm:px-2.5 text-xs font-sans font-semibold gap-1.5 cursor-pointer rounded-lg flex items-center shadow-sm"
            onClick={openConnectModal}
            title="Connecting to MAVLink endpoint (click for Link & Page Configuration)..."
          >
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping shrink-0" />
            <span className="hidden sm:inline">Connecting...</span>
          </Badge>
        );
      case 'error':
        return (
          <Badge
            variant="destructive"
            className="h-7 px-2 sm:px-2.5 text-xs font-sans font-semibold gap-1.5 cursor-pointer rounded-lg flex items-center shadow-sm"
            onClick={openConnectModal}
            title="Connection error (click for Link & Page Configuration)"
          >
            <WifiOff className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">Link Error</span>
          </Badge>
        );
      default:
        return (
          <Button
            variant="default"
            size="sm"
            onClick={openConnectModal}
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
  const ekfHealthy = (ekf.flags & 0x01) !== 0 && ekf.posHorizVariance < 0.8;
  const vibeWarning =
    vibration.vibrationX > 30 ||
    vibration.vibrationY > 30 ||
    vibration.vibrationZ > 30 ||
    vibration.clipping0 > 0 ||
    vibration.clipping1 > 0 ||
    vibration.clipping2 > 0;

  const activeAltMeters = altitudeMode === 'msl' ? position.alt : vfr.alt;
  const activeSpeedMs = vehicleCategory === 'plane' ? vfr.airspeed : vfr.groundspeed;

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-md">
        {/* Top Row: Brand, Arm/Mode Flyouts, Link Rate, Settings Gear & Connection Pill */}
        <div className="px-2.5 sm:px-6 py-2 flex items-center justify-between gap-y-2 gap-x-2 sm:gap-x-3 max-w-full">
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
                <span className="font-bold text-sm sm:text-base tracking-tight text-zinc-100 hidden sm:inline">
                  GLARESHIELD
                </span>
                <div className="flex items-center gap-1 sm:gap-1.5 leading-none mt-0.5">
                  {status === 'connected' ? (
                    heartbeat.lastHeartbeatTime > 0 ? (
                      <>
                        {getVehicleIcon()}
                        <div className="flex items-baseline gap-1 sm:gap-1.5 min-w-0">
                          <span className="text-xs text-sky-300 font-sans font-medium tracking-tight max-w-[78px] sm:max-w-none truncate">
                            {vehicleCategoryLabel}
                          </span>
                          {firmwareVersion && (
                            <span
                              className="text-[10px] sm:text-[11px] text-zinc-400 font-mono font-normal tracking-tight hidden sm:inline"
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
              <div className="h-5 w-px bg-zinc-800 hidden sm:block" />
            )}

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
                >
                  {heartbeat.isArmed ? (
                    <>
                      <ShieldAlert className="h-3.5 w-3.5 animate-pulse text-red-400 shrink-0" />
                      <span>ARMED</span>
                    </>
                  ) : (
                    <>
                      <Shield className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                      <span className="hidden sm:inline">DISARMED</span>
                      <span className="sm:hidden">DISARM</span>
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
                            'Motors will power down immediately. WARNING: If vehicle is airborne, it will crash!'}
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
                  <span className="whitespace-nowrap">{heartbeat.modeName}</span>
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
            {import.meta.env.DEV && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClearStorage}
                className="h-7 px-2 text-xs font-sans text-amber-400/90 border-amber-500/40 hover:bg-amber-950/40 hover:text-amber-300 hover:border-amber-500/70 gap-1.5 rounded-lg flex items-center shadow-sm transition-colors"
                title="Dev Diagnostic: Clear local storage and reload page for a clean load (Shift+click to skip confirmation)"
              >
                <RotateCcw className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                <span className="hidden lg:inline font-mono text-[11px] font-medium">Clear Storage</span>
              </Button>
            )}

            {/* Link Rate Stats (Adjacent to Connection Button) */}
            {status === 'connected' && (
              <div
                className="h-7 hidden md:flex items-center gap-1.5 text-xs font-mono font-medium text-zinc-400 border border-zinc-800 rounded-lg px-2.5 bg-zinc-900/60"
                title={`Telemetry Link: ${stats.packetsPerSecond} packets/sec, ${(stats.bytesReceived / 1024).toFixed(1)} KB received total`}
              >
                <Activity className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                <span>{stats.packetsPerSecond} pkt/s</span>
              </div>
            )}

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
              onClick={openConnectModal}
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

        {/* Persistent Global Telemetry Status Strip (Health First, Battery, GPS, Alt/Spd, Home, Flight Time) */}
        <div className="relative border-t border-zinc-800/80 bg-zinc-900/70 min-h-[30px] flex items-center overflow-hidden">
          <div className="px-2.5 sm:px-6 py-1 flex items-center gap-3 sm:gap-5 text-[11px] font-mono overflow-x-auto no-scrollbar w-full">
            {/* Pre-Arm & Subsystem Health Pill + Popover (Rank 3 - first on mobile for immediate visibility) */}
          <div className="relative shrink-0" ref={preArmMenuRef}>
            <button
              type="button"
              onClick={() => setIsPreArmMenuOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[10px] font-sans font-bold uppercase tracking-wider transition-colors ${
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

            {isPreArmMenuOpen && (
              <div className="fixed sm:absolute left-2 sm:left-0 mt-1.5 w-80 rounded-xl bg-zinc-900/95 border border-zinc-700 shadow-2xl backdrop-blur-md p-3 z-50 text-xs font-sans space-y-2.5">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                  <span className="font-bold uppercase tracking-wider text-zinc-200 flex items-center gap-1.5">
                    {preArm.isReady ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-400" />
                    )}
                    Pre-Arm & Subsystem Health
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!isHeartbeatActive}
                    onClick={handleRunPreArmChecks}
                    className="h-6 px-2 text-[10px] font-bold border-sky-500/50 bg-sky-950/40 text-sky-200 hover:bg-sky-900/60"
                  >
                    Run Pre-Arm Check
                  </Button>
                </div>

                {/* Subsystem Grid */}
                <div className="grid grid-cols-2 gap-1.5 text-[11px]">
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
                        ? `Var ${ekf.posHorizVariance.toFixed(2)}`
                        : '--',
                    },
                    {
                      label: 'Vibration',
                      ok: !vibeWarning,
                      detail: isHeartbeatActive
                        ? `${Math.max(vibration.vibrationX, vibration.vibrationY, vibration.vibrationZ).toFixed(1)} m/s²`
                        : '--',
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between px-2 py-1 rounded bg-zinc-950/70 border border-zinc-800"
                    >
                      <span className="text-zinc-400">{item.label}</span>
                      <span
                        className={`font-mono font-bold flex items-center gap-1 ${
                          item.ok ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {item.ok ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <XCircle className="h-3 w-3" />
                        )}
                        {item.detail ?? (item.ok ? 'PASS' : 'FAIL')}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Active Pre-Arm / Arming Blocker Messages */}
                <div className="space-y-1">
                  <div className="text-[10px] font-bold uppercase text-zinc-400">
                    Active Pre-Arm / Arming Notices
                  </div>
                  {preArm.activePreArmErrors.length === 0 ? (
                    <div className="text-[11px] text-emerald-300 bg-emerald-950/30 border border-emerald-800/50 rounded px-2.5 py-1.5">
                      No PreArm blockers reported by autopilot.
                    </div>
                  ) : (
                    <div className="space-y-1 max-h-36 overflow-y-auto">
                      {preArm.activePreArmErrors.map((err, i) => (
                        <div
                          key={i}
                          className="text-[11px] font-mono text-amber-200 bg-amber-950/40 border border-amber-700/50 rounded px-2 py-1"
                        >
                          {err}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <span className="text-zinc-700">|</span>

          {/* Battery Pill */}
          <div
            className="flex items-center gap-1.5 shrink-0"
            title="Pack Voltage & Remaining Capacity"
          >
            <BatteryCharging
              className={`h-3.5 w-3.5 shrink-0 ${
                !isHeartbeatActive || battery.voltage <= 0
                  ? 'text-zinc-500'
                  : battery.remaining <= 15
                    ? 'text-red-400 animate-pulse'
                    : battery.remaining <= 25
                      ? 'text-amber-400'
                      : 'text-emerald-400'
              }`}
            />
            <span className="text-zinc-400 font-sans font-bold uppercase text-[10px]">BAT</span>
            <span
              className={`font-bold ${
                !isHeartbeatActive || battery.voltage <= 0
                  ? 'text-zinc-500'
                  : battery.remaining <= 15
                    ? 'text-red-300'
                    : battery.remaining <= 25
                      ? 'text-amber-300'
                      : 'text-zinc-100'
              }`}
            >
              {isHeartbeatActive && battery.voltage > 0
                ? `${battery.voltage.toFixed(1)}V · ${battery.remaining}%`
                : '--'}
            </span>
          </div>

          <span className="text-zinc-700">|</span>

          {/* GNSS Pill */}
          <div className="flex items-center gap-1.5 shrink-0" title="GNSS Fix & Visible Satellites">
            <Satellite
              className={`h-3.5 w-3.5 shrink-0 ${
                !isHeartbeatActive
                  ? 'text-zinc-500'
                  : gps.fixType >= 3
                    ? 'text-emerald-400'
                    : 'text-amber-400'
              }`}
            />
            <span className="text-zinc-400 font-sans font-bold uppercase text-[10px]">GPS</span>
            <span className="font-bold text-zinc-100">
              {isHeartbeatActive ? `${gps.fixLabel} (${gps.satellites})` : '--'}
            </span>
          </div>

          <span className="text-zinc-700">|</span>

          {/* Altitude & Speed Pill */}
          <div className="flex items-center gap-1.5 shrink-0" title="Active Altitude & Speed">
            <span className="text-zinc-400 font-sans font-bold uppercase text-[10px]">
              {altitudeMode.toUpperCase()}
            </span>
            <span className="font-bold text-sky-300">
              {isHeartbeatActive ? formatAltitude(activeAltMeters).full : '--'}
            </span>
            <span className="text-zinc-600">·</span>
            <span className="font-bold text-emerald-300">
              {isHeartbeatActive ? formatSpeed(activeSpeedMs).full : '--'}
            </span>
          </div>

          <span className="text-zinc-700">|</span>

          {/* Home Distance & Bearing Pill (Rank 1) */}
          <div
            className="flex items-center gap-1.5 shrink-0"
            title={
              homePosition.source !== 'none'
                ? `Home (${homePosition.source.toUpperCase()}): ${homePosition.lat.toFixed(5)}, ${homePosition.lon.toFixed(5)}`
                : 'Home Position not yet received'
            }
          >
            <Home
              className={`h-3.5 w-3.5 shrink-0 ${
                homePosition.source !== 'none' ? 'text-amber-400' : 'text-zinc-500'
              }`}
            />
            <span className="text-zinc-400 font-sans font-bold uppercase text-[10px]">HOME</span>
            <span className="font-bold text-zinc-100">
              {isHeartbeatActive && homePosition.distanceM !== null
                ? formatHomeVector(homePosition.bearingDeg, homePosition.distanceM)
                : homePosition.source !== 'none'
                  ? 'SET'
                  : '--'}
            </span>
          </div>

          <span className="text-zinc-700 hidden sm:inline">|</span>

          {/* Flight Time Pill */}
          <div
            className="hidden sm:flex items-center gap-1.5 shrink-0"
            title="Cumulative Armed Flight Time"
          >
            <Clock className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
            <span className="text-zinc-400 font-sans font-bold uppercase text-[10px]">FLT</span>
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

      {/* Link & Display Settings Modal */}
      <Modal
        isOpen={isConnectModalOpen}
        onClose={handleCloseConnectModal}
        title="Link & Display Settings"
        description="Configure your MAVLink WebSocket endpoint, display units, altitude reference, audio callouts, and telemetry bandwidth."
      >
        <form onSubmit={handleConnectSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-300">WebSocket URL or Host:Port</label>
            <Input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="ws://localhost:56781"
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-zinc-500">
              Default companion bridge endpoint is <code className="text-sky-400">ws://localhost:56781</code>. Saved automatically for page reloads.
            </p>

            {typeof window !== 'undefined' && window.location.protocol === 'https:' && inputUrl.trim().startsWith('ws://') && (
              <div className="p-2.5 rounded-lg border border-amber-500/30 bg-amber-950/25 text-amber-200 text-xs space-y-1 mt-2">
                <div className="font-semibold flex items-center gap-1.5 text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  HTTPS Mixed Content Restriction
                </div>
                <p className="text-[11px] text-zinc-300 leading-relaxed">
                  You are loading Glareshield over HTTPS. Browsers strictly block unencrypted <code className="text-amber-300">ws://</code> connections as Mixed Active Content.
                </p>
                <div className="text-[11px] text-zinc-400 space-y-0.5 pt-0.5">
                  <div>• <strong>Secure:</strong> Use <code className="text-emerald-400">wss://</code> (e.g. bridge with <code className="text-zinc-300">--ssl-cert</code> or reverse proxy).</div>
                  <div>• <strong>Firefox:</strong> In <code className="text-zinc-300">about:config</code>, set <code className="text-zinc-300">network.websocket.allowInsecureFromHTTPS</code> to <code className="text-zinc-300">true</code>.</div>
                </div>
              </div>
            )}

            {errorMessage && (
              <div className="p-2.5 rounded-lg border border-red-500/30 bg-red-950/25 text-red-300 text-xs flex items-start gap-2 mt-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-400 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  <span className="font-semibold text-red-300">Link Error: </span>
                  {errorMessage}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-300">GCS System ID</label>
            <Input
              type="number"
              min="1"
              max="255"
              value={inputGcsSysId}
              onChange={(e) => setInputGcsSysId(Number(e.target.value))}
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-zinc-500">
              Default is <code className="text-sky-400">255</code> (matches ArduPilot <code className="text-zinc-300">SYSID_MYGCS</code>). Use 254 if connecting simultaneously alongside Mission Planner on 255.
            </p>
          </div>

          {/* Speed & Distance Units (4-Way: m/s, km/h, mph, kts) */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-300">Speed & Distance Units</label>
            <div className="grid grid-cols-4 gap-2">
              {[
                { id: 'ms', label: 'm/s', desc: 'Metric SI (m/s, m, km)' },
                { id: 'kmh', label: 'km/h', desc: 'Metric (km/h, m, km)' },
                { id: 'mph', label: 'mph', desc: 'Imperial Statute (mph, ft, mi)' },
                { id: 'kts', label: 'kts', desc: 'Aviation Nautical (kts, ft, nm)' },
              ].map(({ id, label, desc }) => (
                <button
                  type="button"
                  key={id}
                  onClick={() => setUnitSystem(id as any)}
                  className={`p-2 rounded-lg border text-center transition-all ${
                    unitSystem === id
                      ? 'border-sky-500 bg-sky-950/40 text-sky-200'
                      : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700'
                  }`}
                  title={desc}
                >
                  <div className="font-sans font-bold text-xs">{label}</div>
                  <div className="text-[9px] text-zinc-500 mt-0.5 truncate">
                    {id === 'ms' || id === 'kmh' ? 'Metric' : id === 'mph' ? 'Statute' : 'Nautical'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Altitude Reference Mode (AGL vs MSL) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-300">Altitude Reference</label>
              <span className="text-[10px] text-zinc-500 font-sans">
                Currently: <span className="font-mono">{altitudeMode.toUpperCase()}</span>
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAltitudeMode('agl')}
                className={`p-2.5 rounded-lg border text-left transition-all ${
                  altitudeMode === 'agl'
                    ? 'border-emerald-500 bg-emerald-950/40 text-emerald-200'
                    : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                <div className="font-semibold text-xs flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                  AGL (Above Ground)
                </div>
                <div className="text-[10px] text-zinc-400 mt-0.5">
                  Relative height above home launch coordinate.
                </div>
              </button>

              <button
                type="button"
                onClick={() => setAltitudeMode('msl')}
                className={`p-2.5 rounded-lg border text-left transition-all ${
                  altitudeMode === 'msl'
                    ? 'border-sky-500 bg-sky-950/40 text-sky-200'
                    : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                <div className="font-semibold text-xs flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-sky-400 shrink-0" />
                  MSL (Mean Sea Level)
                </div>
                <div className="text-[10px] text-zinc-400 mt-0.5">
                  True geodetic altitude above sea level datum.
                </div>
              </button>
            </div>
          </div>

          {/* Field Theme & Audio Callouts (Rank 4 & Rank 7) */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-300">Field Visibility & Audio Callouts</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => setDaylightMode((v) => !v)}
                className={`p-2.5 rounded-lg border text-left transition-all ${
                  daylightMode
                    ? 'border-amber-500 bg-amber-950/40 text-amber-200'
                    : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700'
                }`}
              >
                <div className="font-semibold text-xs flex items-center gap-1.5">
                  {daylightMode ? <Sun className="h-3.5 w-3.5 text-amber-400" /> : <Moon className="h-3.5 w-3.5 text-sky-400" />}
                  {daylightMode ? 'Daylight' : 'Dark Cockpit'}
                </div>
                <div className="text-[10px] text-zinc-400 mt-0.5">
                  {daylightMode ? 'High-contrast sun mode' : 'Standard night/indoor'}
                </div>
              </button>

              <button
                type="button"
                onClick={toggleSound}
                className={`p-2.5 rounded-lg border text-left transition-all ${
                  soundEnabled
                    ? 'border-emerald-500 bg-emerald-950/40 text-emerald-200'
                    : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                <div className="font-semibold text-xs flex items-center gap-1.5">
                  {soundEnabled ? <Volume2 className="h-3.5 w-3.5 text-emerald-400" /> : <VolumeX className="h-3.5 w-3.5 text-zinc-500" />}
                  Alert Chimes
                </div>
                <div className="text-[10px] text-zinc-400 mt-0.5">
                  {soundEnabled ? 'Enabled' : 'Muted'}
                </div>
              </button>

              <button
                type="button"
                onClick={toggleVoice}
                className={`p-2.5 rounded-lg border text-left transition-all ${
                  voiceEnabled && soundEnabled
                    ? 'border-sky-500 bg-sky-950/40 text-sky-200'
                    : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                <div className="font-semibold text-xs flex items-center gap-1.5">
                  <Volume2 className="h-3.5 w-3.5 text-sky-400" />
                  Voice Callouts
                </div>
                <div className="text-[10px] text-zinc-400 mt-0.5">
                  {voiceEnabled && soundEnabled
                    ? ttsStatus === 'downloading'
                      ? `Downloading Betty (${ttsDownloadProgress}%)`
                      : ttsStatus === 'ready'
                      ? 'Betty Neural TTS Ready'
                      : 'Spoken modes/alerts'
                    : 'Off'}
                </div>
              </button>

              <button
                type="button"
                onClick={toggleWaypointAnnounce}
                className={`p-2.5 rounded-lg border text-left transition-all ${
                  waypointAnnounceEnabled && voiceEnabled && soundEnabled
                    ? 'border-emerald-500 bg-emerald-950/40 text-emerald-200'
                    : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                <div className="font-semibold text-xs flex items-center gap-1.5">
                  <Milestone className="h-3.5 w-3.5 text-emerald-400" />
                  Announce WPs
                </div>
                <div className="text-[10px] text-zinc-400 mt-0.5">
                  {waypointAnnounceEnabled && voiceEnabled && soundEnabled
                    ? 'Speaks "waypoint n"'
                    : 'Off'}
                </div>
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-300">Bandwidth Optimization Profile</label>
            <div className="grid grid-cols-3 gap-2">
              {(['low', 'standard', 'high'] as BandwidthProfile[]).map((p) => (
                <button
                  type="button"
                  key={p}
                  onClick={() => setBandwidthProfile(p)}
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    bandwidthProfile === p
                      ? 'border-sky-500 bg-sky-950/40 text-sky-200'
                      : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700'
                  }`}
                >
                  <div className="font-semibold text-xs capitalize">{p}</div>
                  <div className="text-[10px] text-zinc-400 mt-0.5">
                    {p === 'low'
                      ? 'SiK Radio (57.6k)'
                      : p === 'standard'
                      ? 'Standard 115k'
                      : 'High Speed WiFi'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {import.meta.env.DEV && (
            <div className="pt-2 border-t border-zinc-800">
              <div className="p-2.5 rounded-lg border border-amber-500/30 bg-amber-950/20 flex items-center justify-between gap-2">
                <div>
                  <div className="font-semibold text-xs text-amber-300 flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                    Dev Diagnostics
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    Clear local storage to test initial clean load of the page.
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleClearStorage}
                  className="h-7 px-2.5 text-xs font-semibold text-amber-400 border-amber-500/40 hover:bg-amber-950/50 hover:text-amber-300 gap-1.5 shrink-0"
                  title="Clear local storage and reload (Shift+click to skip confirmation)"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Clear & Reload
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            {status === 'connected' ? (
              <Button
                key="btn-disconnect-link"
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleDisconnect}
              >
                Disconnect Link
              </Button>
            ) : (
              <Button
                key="btn-connect-now"
                type="submit"
                variant="default"
                size="sm"
                className="bg-sky-500 hover:bg-sky-600 text-white"
              >
                Connect Now
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsConnectModalOpen(false)}>
              Close
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
};
