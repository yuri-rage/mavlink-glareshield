import React, { useState, useRef, useEffect } from 'react';
import { useConnectionStore } from '../../store/connectionStore';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
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
  Car,
  Plane,
  Ship,
  Anchor,
  Compass,
  Disc,
  ChevronDown,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { BandwidthProfile } from '../../mavlink/rateManager';
import { getVehicleCategory, getVehicleCategoryLabel, getVehicleFlightModes } from '../../mavlink/messages';

export const Navbar: React.FC = () => {
  const { url, status, bandwidthProfile, stats, setUrl, setBandwidthProfile, gcsSystemId, setGcsSystemId, connect, disconnect } =
    useConnectionStore();
  const heartbeat = useTelemetryStore((state) => state.heartbeat);
  const firmwareVersion = useTelemetryStore((state) => state.firmwareVersion);
  const firmwareRaw = useTelemetryStore((state) => state.firmwareRaw);
  const { system: unitSystem, setSystem: setUnitSystem, altitudeMode, setAltitudeMode } = useUnitsStore();

  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [inputUrl, setInputUrl] = useState(url);
  const [inputGcsSysId, setInputGcsSysId] = useState(gcsSystemId);

  // Dropdown states for Arm & Mode flyouts
  const [isArmMenuOpen, setIsArmMenuOpen] = useState(false);
  const [armConfirmAction, setArmConfirmAction] = useState<
    'arm' | 'disarm' | 'force_arm' | 'force_disarm' | null
  >(null);
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const armMenuRef = useRef<HTMLDivElement | null>(null);
  const modeMenuRef = useRef<HTMLDivElement | null>(null);

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
    mavlinkConnection.send(cmd);
  };

  const handleSetMode = (modeNum: number) => {
    const encoder = mavlinkConnection.getEncoder();
    const sysId = heartbeat.systemId || 1;
    const compId = heartbeat.componentId || 1;
    const cmd = encoder.createSetMode(sysId, compId, modeNum);
    mavlinkConnection.send(cmd);
  };

  const openConnectModal = () => {
    setInputUrl(url);
    setInputGcsSysId(gcsSystemId);
    setIsConnectModalOpen(true);
  };

  const handleConnectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setUrl(inputUrl);
    setGcsSystemId(inputGcsSysId);
    connect();
    setIsConnectModalOpen(false);
  };

  const vehicleCategory = getVehicleCategory(heartbeat.type);
  const vehicleCategoryLabel = getVehicleCategoryLabel(heartbeat.type);
  const availableModes = getVehicleFlightModes(heartbeat.type);

  const getVehicleIcon = (sizeClass = 'h-4 w-4') => {
    switch (vehicleCategory) {
      case 'rover':
        return heartbeat.type === 11 ? (
          <Ship className={`${sizeClass} text-cyan-400 shrink-0`} />
        ) : (
          <Car className={`${sizeClass} text-emerald-400 shrink-0`} />
        );
      case 'plane':
        return <Plane className={`${sizeClass} text-sky-400 shrink-0`} />;
      case 'sub':
        return <Anchor className={`${sizeClass} text-blue-400 shrink-0`} />;
      case 'tracker':
        return <Compass className={`${sizeClass} text-amber-400 shrink-0`} />;
      case 'copter':
      default:
        return <Disc className={`${sizeClass} text-sky-400 shrink-0`} />;
    }
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'connected':
        return (
          <Badge
            variant="success"
            className="h-7 px-2 sm:px-2.5 text-xs font-mono font-semibold gap-1.5 cursor-pointer rounded-lg flex items-center hover:bg-emerald-950/80 transition-colors shadow-sm"
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
            className="h-7 px-2 sm:px-2.5 text-xs font-mono font-semibold gap-1.5 cursor-pointer rounded-lg flex items-center shadow-sm"
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
            className="h-7 px-2 sm:px-2.5 text-xs font-mono font-semibold gap-1.5 cursor-pointer rounded-lg flex items-center shadow-sm"
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
            className="h-7 px-2 sm:px-2.5 text-xs font-mono font-semibold bg-sky-500 hover:bg-sky-600 text-white gap-1.5 rounded-lg flex items-center shadow-sm"
            title="Connect to MAVLink endpoint & open Page Configuration"
          >
            <WifiOff className="h-3.5 w-3.5 shrink-0" />
            <span>Connect</span>
          </Button>
        );
    }
  };

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-md px-2.5 sm:px-6 py-2 flex items-center justify-between gap-y-2 gap-x-2 sm:gap-x-3 max-w-full overflow-hidden">
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
              <div className="text-xs sm:text-[13px] text-sky-300 flex items-center gap-1 sm:gap-1.5 font-mono font-medium leading-tight">
                {status === 'connected' ? (
                  <>
                    {getVehicleIcon('h-3.5 w-3.5 sm:h-4 sm:w-4')}
                    <span className="tracking-tight max-w-[55px] sm:max-w-none truncate">{vehicleCategoryLabel}</span>
                    {firmwareVersion && (
                      <span
                        className="text-[10px] sm:text-[11px] text-zinc-400 font-mono font-normal tracking-tight hidden md:inline"
                        title={firmwareRaw || `Firmware: ${firmwareVersion}`}
                      >
                        {firmwareVersion}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-zinc-500 text-xs">Standby</span>
                )}
              </div>
            </div>
          </div>

          <div className="h-5 w-px bg-zinc-800 hidden sm:block" />

          {/* Arm Status Pill (Left of Mode) with Dropdown Flyout */}
          {status === 'connected' && (
            <div className="relative shrink-0" ref={armMenuRef}>
              <Badge
                variant={heartbeat.isArmed ? 'destructive' : 'secondary'}
                className={`h-7 px-2 sm:px-2.5 text-xs font-mono font-semibold gap-1 sm:gap-1.5 cursor-pointer select-none transition-all shadow-sm rounded-lg flex items-center ${
                  isArmMenuOpen ? 'ring-2 ring-sky-400 bg-zinc-800' : 'hover:brightness-110'
                }`}
                onClick={() => {
                  setIsArmMenuOpen(!isArmMenuOpen);
                  setArmConfirmAction(null);
                  setIsModeMenuOpen(false);
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
                            className="w-full text-center text-[10px] text-red-400/80 hover:text-red-300 font-mono underline pt-1 block"
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
                            className="w-full text-center text-[10px] text-zinc-500 hover:text-amber-400 font-mono underline pt-1 block"
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
          {status === 'connected' && (
            <div className="relative shrink-0" ref={modeMenuRef}>
              <Badge
                variant="info"
                className={`h-7 px-2 sm:px-2.5 text-xs font-mono font-semibold gap-1 sm:gap-1.5 cursor-pointer select-none transition-all shadow-sm rounded-lg flex items-center ${
                  isModeMenuOpen ? 'ring-2 ring-sky-400 bg-sky-950/80' : 'hover:brightness-110'
                }`}
                onClick={() => {
                  setIsModeMenuOpen(!isModeMenuOpen);
                  setIsArmMenuOpen(false);
                }}
                title="Click to switch flight mode"
              >
                <span className="truncate max-w-[65px] xs:max-w-[100px] sm:max-w-none">{heartbeat.modeName}</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-60 ml-0.5 shrink-0" />
              </Badge>

              {/* Flight Mode Selector Flyout */}
              {isModeMenuOpen && (
                <div className="absolute left-0 sm:left-auto mt-2 w-52 rounded-xl bg-zinc-900/95 border border-zinc-700/80 shadow-2xl backdrop-blur-md p-2 z-50 animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400 font-mono flex items-center justify-between border-b border-zinc-800/80 pb-1.5 mb-1.5">
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
                          className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-mono font-medium flex items-center justify-between transition-colors ${
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

        {/* Right: Telemetry Rate & Connection Status */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 justify-end ml-auto shrink-0">
          {/* Link Rate Stats (Adjacent to Connection Button) */}
          {status === 'connected' && (
            <div
              className="h-7 hidden sm:flex items-center gap-1.5 sm:gap-2 text-xs font-mono font-medium text-zinc-400 border border-zinc-800 rounded-lg px-2.5 bg-zinc-900/60"
              title={`Telemetry Link: ${stats.packetsPerSecond} packets/sec, ${(stats.bytesReceived / 1024).toFixed(1)} KB received total`}
            >
              <Activity className="h-3.5 w-3.5 text-sky-400 shrink-0" />
              <span>{stats.packetsPerSecond} pkt/s</span>
              <span className="text-zinc-600 hidden md:inline">•</span>
              <span className="hidden md:inline">{(stats.bytesReceived / 1024).toFixed(0)} KB in</span>
            </div>
          )}

          {/* Connection Status & Settings Pill (Far Right) */}
          {getStatusBadge()}
        </div>
      </header>

      {/* Link & Display Settings Modal */}
      <Modal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        title="Link & Display Settings"
        description="Configure your MAVLink WebSocket endpoint, display units, altitude reference, and telemetry bandwidth."
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
                  <div className="font-mono font-bold text-xs">{label}</div>
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
              <span className="text-[10px] text-zinc-500 font-mono">
                Currently: {altitudeMode.toUpperCase()}
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

          <div className="flex items-center justify-between pt-2">
            {status === 'connected' ? (
              <Button type="button" variant="destructive" size="sm" onClick={disconnect}>
                Disconnect Link
              </Button>
            ) : (
              <Button type="submit" variant="default" size="sm" className="bg-sky-500 hover:bg-sky-600 text-white">
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
