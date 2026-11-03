import React, { useState, useEffect, useRef } from 'react';
import { useTelemetryStore, sendTrackedCommand } from '../../store/telemetryStore';
import { useUnitsStore, UnitSystem } from '../../store/unitsStore';
import { mavlinkConnection } from '../../mavlink/connection';
import { messageRateManager } from '../../mavlink/rateManager';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import {
  MAV_CMD,
  MAVLINK_MSG_ID,
  getVehicleCategory,
  getVehicleFlightModes,
  getGuidedModeNum,
} from '../../mavlink/messages';
import {
  Shield,
  ShieldAlert,
  ArrowUp,
  Gauge,
  Navigation,
  Anchor,
  PlaneLanding,
  PlaneTakeoff,
  CircleStop,
  Play,
  RotateCcw,
  Sliders,
  Radio,
  Zap,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

function toActiveUnits(speedMs: number, system: UnitSystem): number {
  switch (system) {
    case 'ms':
      return speedMs;
    case 'kmh':
      return speedMs * 3.6;
    case 'mph':
      return speedMs * 2.23693629;
    case 'kts':
      return speedMs * 1.94384449;
  }
}

function fromActiveUnitsToMs(speedActive: number, system: UnitSystem): number {
  switch (system) {
    case 'ms':
      return speedActive;
    case 'kmh':
      return speedActive / 3.6;
    case 'mph':
      return speedActive / 2.23693629;
    case 'kts':
      return speedActive / 1.94384449;
  }
}

export const GlareshieldWidget: React.FC = () => {
  const heartbeat = useTelemetryStore((state) => state.heartbeat);
  const vfr = useTelemetryStore((state) => state.vfr);
  const gps = useTelemetryStore((state) => state.gps);
  const commandFeedback = useTelemetryStore((state) => state.commandFeedback);
  const clearCommandFeedback = useTelemetryStore((state) => state.clearCommandFeedback);
  const { formatSpeed, system, isImperial } = useUnitsStore();
  const altUnit = isImperial() ? 'ft' : 'm';
  const [manualTargetSpeedMs, setManualTargetSpeedMs] = useState<number | null>(null);
  const [sliderValue, setSliderValue] = useState<number>(0);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [showTakeoffPanel, setShowTakeoffPanel] = useState<boolean>(false);
  const [takeoffAltMeters, setTakeoffAltMeters] = useState<number>(10);
  const [autoSeqStep, setAutoSeqStep] = useState<string | null>(null);
  const [autoSeqError, setAutoSeqError] = useState<string | null>(null);
  const [mobileCompact, setMobileCompact] = useState<boolean>(false);
  const abortAutoSeqRef = useRef<boolean>(false);
  const dragStartedFromLeft = useRef(false);

  useEffect(() => {
    messageRateManager.registerRequirement('glareshield-vfr', MAVLINK_MSG_ID.VFR_HUD);
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      messageRateManager.unregisterRequirement('glareshield-vfr');
    };
  }, []);

  // Auto-dismiss ACCEPTED command feedback after 3.5s
  useEffect(() => {
    if (!commandFeedback || commandFeedback.status === 'pending') return;
    const delay = commandFeedback.status === 'accepted' ? 3500 : 9000;
    const t = setTimeout(() => {
      clearCommandFeedback();
    }, delay);
    return () => clearTimeout(t);
  }, [commandFeedback, clearCommandFeedback]);

  const encoder = mavlinkConnection.getEncoder();
  const category = getVehicleCategory(heartbeat.type);
  const commonModes = getVehicleFlightModes(heartbeat.type);
  const guidedModeNum = getGuidedModeNum(heartbeat.type);
  const targetTakeoffModeNum = category === 'plane' ? 13 : guidedModeNum;
  const targetTakeoffModeLabel = category === 'plane' ? 'TAKEOFF' : 'GUIDED';

  const isVehicleConnected =
    heartbeat.lastHeartbeatTime > 0 &&
    heartbeat.modeName !== 'DISCONNECTED' &&
    nowMs - heartbeat.lastHeartbeatTime <= 3500;

  const isInTakeoffMode = isVehicleConnected && heartbeat.customMode === targetTakeoffModeNum;
  const isTakeoffReady = isInTakeoffMode && heartbeat.isArmed;
  const armedBySequenceRef = useRef<boolean>(false);

  const sysId = heartbeat.systemId || 1;
  const compId = heartbeat.componentId || 1;

  const getFeedbackBadge = (key: string) => {
    if (!commandFeedback || commandFeedback.targetKey !== key) return null;
    if (nowMs - commandFeedback.time > 6000 && commandFeedback.status !== 'pending') return null;
    if (commandFeedback.status === 'pending') {
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400 shrink-0" />;
    }
    if (commandFeedback.status === 'accepted') {
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;
    }
    return <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />;
  };

  const getFeedbackRing = (key: string) => {
    if (!commandFeedback || commandFeedback.targetKey !== key) return '';
    if (nowMs - commandFeedback.time > 6000 && commandFeedback.status !== 'pending') return '';
    if (commandFeedback.status === 'pending') return 'ring-2 ring-sky-400/70';
    if (commandFeedback.status === 'accepted') return 'ring-2 ring-emerald-500/80';
    return 'ring-2 ring-rose-500/90 bg-rose-950/30';
  };

  const handleArm = (arm: boolean) => {
    const cmd = encoder.createArmDisarm(sysId, compId, arm);
    void sendTrackedCommand(cmd, {
      label: arm ? 'Arm Motors' : 'Disarm Motors',
      targetKey: 'arm',
    });
    setSliderValue(0);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    if (!isVehicleConnected) {
      e.preventDefault();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const clickPct = (e.clientX - rect.left) / rect.width;
    // Require drag to initiate near the left handle (within first 25% of track)
    if (clickPct <= 0.25) {
      dragStartedFromLeft.current = true;
    } else {
      dragStartedFromLeft.current = false;
      e.preventDefault();
    }
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (dragStartedFromLeft.current && isVehicleConnected) {
      setSliderValue(Number(e.target.value));
    }
  };

  const handleSliderRelease = () => {
    if (dragStartedFromLeft.current && sliderValue >= 90 && isVehicleConnected) {
      // Send explicit ARM or DISARM command (never a toggle)
      if (heartbeat.isArmed) {
        handleArm(false); // Explicit DISARM
      } else {
        handleArm(true);  // Explicit ARM
      }
    }
    dragStartedFromLeft.current = false;
    setSliderValue(0);
  };

  const handleSetMode = (modeNum: number, customLabel?: string, customKey?: string) => {
    const modeEntry = commonModes.find((m) => m.mode === modeNum);
    const label = customLabel ?? `Set Mode ${modeEntry?.label ?? modeNum}`;
    const cmd = encoder.createSetMode(sysId, compId, modeNum);
    void sendTrackedCommand(cmd, {
      label,
      targetKey: customKey ?? `mode-${modeNum}`,
    });
  };

  const activeUnit = system === 'ms' ? 'm/s' : system === 'kmh' ? 'km/h' : system === 'mph' ? 'mph' : 'kts';
  const defaultSpeedMs = category === 'plane' ? 15 : category === 'rover' ? 2 : category === 'sub' ? 1 : 5;
  const liveSpeedMs = category === 'plane'
    ? (vfr.airspeed >= 0.5 ? vfr.airspeed : defaultSpeedMs)
    : (vfr.groundspeed >= 0.5 ? vfr.groundspeed : defaultSpeedMs);
  // Always store commanded target speed in m/s internally so unit changes never distort commands
  const currentSpeedMs = manualTargetSpeedMs ?? liveSpeedMs;
  const currentTargetDisplay = Number(toActiveUnits(currentSpeedMs, system).toFixed(1));
  const coarseStep = category === 'rover' || system === 'ms' ? 2 : 5;

  const handleStepSpeed = (deltaDisplay: number) => {
    const nextDisplay = Math.max(0.5, currentTargetDisplay + deltaDisplay);
    const nextSpeedMs = Number(fromActiveUnitsToMs(nextDisplay, system).toFixed(2));
    setManualTargetSpeedMs(nextSpeedMs);
  };

  const handleResetToLiveSpeed = () => {
    setManualTargetSpeedMs(null);
  };

  const handleSetSpeed = (customSpeedMs?: number) => {
    const speedMs = customSpeedMs !== undefined ? customSpeedMs : currentSpeedMs;
    if (customSpeedMs !== undefined) {
      setManualTargetSpeedMs(customSpeedMs);
    }
    // MAV_CMD_DO_CHANGE_SPEED: param1 = type (0=airspeed, 1=groundspeed), param2 = speed (m/s)
    // In ArduPlane, type 1 sets MIN_GROUNDSPEED instead of target speed; airspeed (0) is required for planes
    const speedType = category === 'plane' ? 0 : 1;
    const cmd = encoder.createCommandLong(sysId, compId, MAV_CMD.DO_CHANGE_SPEED, [speedType, speedMs, -1, 0, 0, 0, 0]);
    void sendTrackedCommand(cmd, {
      label: `Set Speed (${currentTargetDisplay} ${activeUnit})`,
      targetKey: 'speed',
    });
  };

  const triggerRTL = () => {
    if (category === 'rover') {
      handleSetMode(11, 'Return to Launch (RTL)', 'rtl'); // Rover RTL
    } else if (category === 'plane') {
      handleSetMode(11, 'Return to Launch (RTL)', 'rtl'); // Plane RTL
    } else {
      const cmd = encoder.createCommandLong(sysId, compId, MAV_CMD.NAV_RETURN_TO_LAUNCH);
      void sendTrackedCommand(cmd, {
        label: 'Return to Launch (RTL)',
        targetKey: 'rtl',
      });
    }
  };

  const triggerLand = () => {
    const cmd = encoder.createCommandLong(sysId, compId, MAV_CMD.NAV_LAND);
    void sendTrackedCommand(cmd, {
      label: 'Land Now',
      targetKey: 'land',
    });
  };

  const triggerTakeoff = (altM = takeoffAltMeters) => {
    if (category === 'plane') {
      handleSetMode(13, 'Switch to TAKEOFF mode', 'takeoff');
      return;
    }
    const safeAlt = Math.max(1, Math.min(500, altM));
    const dispAlt = altUnit === 'ft' ? `${Math.round(safeAlt * 3.28084)} ft` : `${safeAlt.toFixed(0)} m`;
    const cmd = encoder.createCommandLong(sysId, compId, MAV_CMD.NAV_TAKEOFF, [0, 0, 0, 0, 0, 0, safeAlt]);
    void sendTrackedCommand(cmd, {
      label: `Takeoff (${dispAlt})`,
      targetKey: 'takeoff',
    });
  };

  const runAutoTakeoffSequence = async () => {
    abortAutoSeqRef.current = false;
    armedBySequenceRef.current = false;
    setAutoSeqError(null);
    const safeAlt = Math.max(1, Math.min(500, takeoffAltMeters));
    const dispAlt = altUnit === 'ft' ? `${Math.round(safeAlt * 3.28084)} ft` : `${safeAlt.toFixed(0)} m`;

    const safetyDisarmIfArmedBySeq = async () => {
      if (armedBySequenceRef.current) {
        try {
          const disarmCmd = encoder.createArmDisarm(sysId, compId, false, true);
          await sendTrackedCommand(disarmCmd, {
            label: 'Takeoff Failure: Safety Disarm',
            targetKey: 'arm',
          });
        } catch {}
        armedBySequenceRef.current = false;
      }
    };

    try {
      // Step 1: Switch to TAKEOFF mode (Plane) or GUIDED mode (Copter/Rover/Sub)
      const st1 = useTelemetryStore.getState();
      if (st1.heartbeat.customMode !== targetTakeoffModeNum) {
        setAutoSeqStep(`Step 1/${category === 'plane' ? '2' : '3'}: Switching to ${targetTakeoffModeLabel} mode…`);
        const modeAck = await sendTrackedCommand(
          encoder.createSetMode(sysId, compId, targetTakeoffModeNum),
          { label: `Auto-Takeoff: Switch to ${targetTakeoffModeLabel}`, targetKey: 'takeoff' }
        );
        if (abortAutoSeqRef.current) {
          await safetyDisarmIfArmedBySeq();
          return;
        }
        if (modeAck.result !== 0 && modeAck.result !== 5) {
          setAutoSeqError(
            `Mode switch to ${targetTakeoffModeLabel} rejected (${modeAck.resultText})${modeAck.reason ? `: ${modeAck.reason}` : ''}`
          );
          setAutoSeqStep(null);
          await safetyDisarmIfArmedBySeq();
          return;
        }
        await new Promise((r) => setTimeout(r, 350));
      }

      if (abortAutoSeqRef.current) {
        await safetyDisarmIfArmedBySeq();
        return;
      }

      // Step 2: Arm motors if not already armed
      const st2 = useTelemetryStore.getState();
      if (!st2.heartbeat.isArmed) {
        setAutoSeqStep(`Step 2/${category === 'plane' ? '2' : '3'}: Arming motors…`);
        const armAck = await sendTrackedCommand(
          encoder.createArmDisarm(sysId, compId, true),
          { label: 'Auto-Takeoff: Arm Motors', targetKey: 'takeoff' }
        );
        if (abortAutoSeqRef.current) {
          await safetyDisarmIfArmedBySeq();
          return;
        }
        if (armAck.result !== 0 && armAck.result !== 5) {
          setAutoSeqError(
            `Arming rejected (${armAck.resultText})${armAck.reason ? `: ${armAck.reason}` : ''}`
          );
          setAutoSeqStep(null);
          await safetyDisarmIfArmedBySeq();
          return;
        }
        // Vehicle was successfully armed by this sequence
        armedBySequenceRef.current = true;
        await new Promise((r) => setTimeout(r, 450));
      }

      if (abortAutoSeqRef.current) {
        await safetyDisarmIfArmedBySeq();
        return;
      }

      // For standard fixed-wing planes, switching to TAKEOFF mode (13) and arming completes takeoff readiness.
      // ArduPlane rejects NAV_TAKEOFF in GUIDED with FAILED unless it is a QuadPlane.
      if (category !== 'plane') {
        // Step 3: Send NAV_TAKEOFF (Copter/VTOL)
        setAutoSeqStep(`Step 3/3: Commanding Takeoff to ${dispAlt}…`);
        const toAck = await sendTrackedCommand(
          encoder.createCommandLong(sysId, compId, MAV_CMD.NAV_TAKEOFF, [0, 0, 0, 0, 0, 0, safeAlt]),
          { label: `Takeoff (${dispAlt})`, targetKey: 'takeoff' }
        );
        if (abortAutoSeqRef.current) {
          await safetyDisarmIfArmedBySeq();
          return;
        }
        if (toAck.result !== 0 && toAck.result !== 5) {
          setAutoSeqError(
            `Takeoff rejected (${toAck.resultText})${toAck.reason ? `: ${toAck.reason}` : ''}`
          );
          setAutoSeqStep(null);
          // Crucial safety rule: if sequence armed the vehicle and takeoff command failed, disarm immediately!
          await safetyDisarmIfArmedBySeq();
          return;
        }
      }

      setAutoSeqStep(null);
      setShowTakeoffPanel(false);
      armedBySequenceRef.current = false;
    } catch (e: any) {
      setAutoSeqError(String(e?.message ?? e));
      setAutoSeqStep(null);
      await safetyDisarmIfArmedBySeq();
    }
  };

  const handleAbortAutoSeq = () => {
    abortAutoSeqRef.current = true;
    setAutoSeqStep(null);
    setAutoSeqError('Takeoff sequence aborted by operator.');
    if (armedBySequenceRef.current) {
      // Disarm if we armed the vehicle during this sequence on the ground
      const disarmCmd = encoder.createArmDisarm(sysId, compId, false, true);
      void sendTrackedCommand(disarmCmd, {
        label: 'Auto-Takeoff Abort: Safety Disarm',
        targetKey: 'arm',
      });
      armedBySequenceRef.current = false;
    } else {
      // Switch to Loiter/Hold to arrest climb if already airborne
      handleSetMode(category === 'plane' ? 12 : 5, 'Abort Takeoff (Loiter)', 'loiter');
    }
  };

  const displayTakeoffAlt =
    altUnit === 'ft'
      ? Math.round(takeoffAltMeters * 3.28084)
      : Math.round(takeoffAltMeters);

  const handleTakeoffAltInputChange = (val: number) => {
    if (!Number.isFinite(val) || val <= 0) return;
    const meters = altUnit === 'ft' ? val / 3.28084 : val;
    setTakeoffAltMeters(Math.max(1, Math.min(500, Number(meters.toFixed(1)))));
  };

  return (
    <Card className="border-sky-500/20 bg-zinc-950/90 shadow-xl overflow-hidden relative">
      <CardContent className="p-2.5 sm:p-4 space-y-3 relative">
        {/* Inline Command Feedback Banner - absolute overlay so it does NOT shift layout */}
        {commandFeedback && (
          <div
            role="status"
            aria-live="polite"
            className={`absolute top-2 left-2.5 right-2.5 sm:top-2.5 sm:left-4 sm:right-4 z-30 flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs font-sans shadow-xl backdrop-blur-md transition-all ${
              commandFeedback.status === 'pending'
                ? 'bg-sky-950/95 border-sky-700/80 text-sky-200'
                : commandFeedback.status === 'accepted'
                  ? 'bg-emerald-950/95 border-emerald-700/80 text-emerald-200'
                  : 'bg-rose-950/95 border-rose-600/80 text-rose-100'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {commandFeedback.status === 'pending' ? (
                <Loader2 className="h-4 w-4 animate-spin text-sky-400 shrink-0" />
              ) : commandFeedback.status === 'accepted' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <span className="font-bold">{commandFeedback.label}:</span>{' '}
                <span className="font-mono font-semibold">
                  {commandFeedback.status === 'pending'
                    ? 'AWAITING ACK…'
                    : commandFeedback.resultText ?? commandFeedback.status.toUpperCase()}
                </span>
                {commandFeedback.reason && (
                  <span className="ml-1.5 text-amber-200 font-medium">
                    — {commandFeedback.reason}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={clearCommandFeedback}
              className="text-zinc-400 hover:text-white p-0.5 rounded shrink-0"
              title="Dismiss command status"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Top Control Bar: Arming Slider & Emergency Action Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 sm:gap-3 items-center">
          {/* Arm / Disarm Interlock */}
          <div
            className={`md:col-span-5 bg-zinc-900/80 border border-zinc-800 rounded-xl p-2.5 transition-opacity ${
              !isVehicleConnected ? 'opacity-65' : ''
            } ${getFeedbackRing('arm')}`}
          >
            <div className="flex items-center justify-between mb-1.5 gap-2">
              <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5 min-w-0">
                {!isVehicleConnected ? (
                  <Shield className="h-4 w-4 text-zinc-500 shrink-0" />
                ) : heartbeat.isArmed ? (
                  <ShieldAlert className="h-4 w-4 text-red-400 shrink-0" />
                ) : (
                  <Shield className="h-4 w-4 text-emerald-400 shrink-0" />
                )}
                <span className="truncate">
                  Safety Master:{' '}
                  {!isVehicleConnected
                    ? 'NO LINK (Standby)'
                    : heartbeat.isArmed
                      ? 'ARMED (Motors Live)'
                      : 'DISARMED'}
                </span>
                {getFeedbackBadge('arm')}
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] text-zinc-500 font-sans hidden sm:inline">
                  {isVehicleConnected ? 'Slide to switch' : 'Link required'}
                </span>
                <button
                  type="button"
                  onClick={() => setMobileCompact((v) => !v)}
                  className="sm:hidden inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-800/80 text-zinc-300"
                  title={mobileCompact ? 'Expand flight modes & speed' : 'Compact view'}
                >
                  {mobileCompact ? (
                    <>
                      More <ChevronDown className="h-3 w-3" />
                    </>
                  ) : (
                    <>
                      Less <ChevronUp className="h-3 w-3" />
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="relative flex items-center">
              <input
                type="range"
                min="0"
                max="100"
                disabled={!isVehicleConnected}
                value={sliderValue}
                onPointerDown={handlePointerDown}
                onChange={handleSliderChange}
                onPointerUp={handleSliderRelease}
                onPointerCancel={handleSliderRelease}
                onMouseUp={handleSliderRelease}
                onTouchEnd={handleSliderRelease}
                onKeyDown={(e) => e.preventDefault()}
                className={`w-full h-8 rounded-lg appearance-none transition-all select-none ${
                  !isVehicleConnected
                    ? 'cursor-not-allowed accent-zinc-600 bg-zinc-950/60 border border-zinc-800'
                    : heartbeat.isArmed
                      ? 'cursor-pointer accent-red-500 bg-red-950/40 border border-red-800/60'
                      : 'cursor-pointer accent-emerald-500 bg-emerald-950/40 border border-emerald-800/60'
                }`}
              />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-xs font-bold uppercase tracking-wider text-zinc-200">
                {!isVehicleConnected
                  ? 'NO LINK — Controls Locked'
                  : heartbeat.isArmed
                    ? 'Slide Right to DISARM'
                    : 'Slide Right to ARM MOTORS'}
              </div>
            </div>
          </div>

          {/* Quick Actions Bar - Vehicle Category Specific */}
          <div
            className={`md:col-span-7 grid grid-cols-2 sm:flex sm:flex-nowrap items-center gap-2 ${
              !isVehicleConnected ? 'opacity-65' : ''
            }`}
          >
            {category === 'rover' ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isVehicleConnected}
                  onClick={() => handleSetMode(4, 'Rover Hold', 'mode-4')}
                  className={`flex-1 border-rose-600/60 text-rose-300 hover:bg-rose-950/40 gap-1.5 font-bold h-10 sm:h-11 ${getFeedbackRing('mode-4')}`}
                >
                  <CircleStop className="h-4 w-4 text-rose-400" />
                  Hold
                  {getFeedbackBadge('mode-4')}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isVehicleConnected}
                  onClick={() => handleSetMode(0, 'Rover Manual', 'mode-0')}
                  className={`flex-1 border-zinc-700 hover:bg-zinc-800 gap-1.5 font-bold h-10 sm:h-11 ${getFeedbackRing('mode-0')}`}
                >
                  <Radio className="h-4 w-4 text-sky-400" />
                  Manual
                  {getFeedbackBadge('mode-0')}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isVehicleConnected}
                  onClick={() => handleSetMode(1, 'Rover Acro', 'mode-1')}
                  className={`flex-1 border-amber-600/40 text-amber-300 hover:bg-amber-950/30 gap-1.5 font-bold h-10 sm:h-11 ${getFeedbackRing('mode-1')}`}
                >
                  <Zap className="h-4 w-4 text-amber-400" />
                  Acro
                  {getFeedbackBadge('mode-1')}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isVehicleConnected}
                  onClick={() => handleSetMode(10, 'Rover Auto', 'mode-10')}
                  className={`flex-1 border-emerald-600/40 text-emerald-300 hover:bg-emerald-950/30 gap-1.5 font-bold h-10 sm:h-11 ${getFeedbackRing('mode-10')}`}
                >
                  <Play className="h-4 w-4 text-emerald-400" />
                  Auto
                  {getFeedbackBadge('mode-10')}
                </Button>
              </>
            ) : category === 'sub' ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isVehicleConnected}
                  onClick={() => handleSetMode(9, 'Sub Surface', 'mode-9')}
                  className={`flex-1 border-amber-600/40 text-amber-300 hover:bg-amber-950/30 gap-1.5 font-bold h-10 sm:h-11 ${getFeedbackRing('mode-9')}`}
                >
                  <ArrowUp className="h-4 w-4" />
                  Surface
                  {getFeedbackBadge('mode-9')}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isVehicleConnected}
                  onClick={() => handleSetMode(16, 'Sub PosHold', 'mode-16')}
                  className={`flex-1 border-sky-600/40 text-sky-300 hover:bg-sky-950/30 gap-1.5 font-bold h-10 sm:h-11 ${getFeedbackRing('mode-16')}`}
                >
                  <Anchor className="h-4 w-4" />
                  PosHold
                  {getFeedbackBadge('mode-16')}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isVehicleConnected}
                  onClick={() => handleSetMode(2, 'Sub Depth Hold', 'mode-2')}
                  className={`flex-1 border-emerald-600/40 text-emerald-300 hover:bg-emerald-950/30 gap-1.5 font-bold h-10 sm:h-11 ${getFeedbackRing('mode-2')}`}
                >
                  <Sliders className="h-4 w-4" />
                  Depth Hold
                  {getFeedbackBadge('mode-2')}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isVehicleConnected}
                  onClick={() => handleSetMode(19, 'Sub Manual', 'mode-19')}
                  className={`flex-1 border-zinc-700 hover:bg-zinc-800 gap-1.5 font-bold h-10 sm:h-11 ${getFeedbackRing('mode-19')}`}
                >
                  <Radio className="h-4 w-4 text-sky-400" />
                  Manual
                  {getFeedbackBadge('mode-19')}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isVehicleConnected}
                  onClick={() => {
                    setAutoSeqError(null);
                    setShowTakeoffPanel((prev) => !prev);
                  }}
                  className={`flex-1 border-sky-600/40 text-sky-300 hover:bg-sky-950/30 gap-1.5 font-bold h-10 sm:h-11 ${
                    showTakeoffPanel ? 'bg-sky-950/50 border-sky-400' : ''
                  } ${getFeedbackRing('takeoff')}`}
                >
                  <PlaneTakeoff className="h-4 w-4 text-sky-400" />
                  Takeoff
                  {getFeedbackBadge('takeoff')}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isVehicleConnected}
                  onClick={() =>
                    handleSetMode(
                      category === 'plane' ? 12 : 5,
                      'Pause / Loiter',
                      'loiter'
                    )
                  }
                  className={`flex-1 border-sky-600/40 text-sky-300 hover:bg-sky-950/30 gap-1.5 font-bold h-10 sm:h-11 ${getFeedbackRing('loiter')}`}
                >
                  <Anchor className="h-4 w-4" />
                  Pause / Loiter
                  {getFeedbackBadge('loiter')}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isVehicleConnected}
                  onClick={triggerRTL}
                  className={`flex-1 border-amber-600/40 text-amber-300 hover:bg-amber-950/30 gap-1.5 font-bold h-10 sm:h-11 ${getFeedbackRing('rtl')}`}
                >
                  <Navigation className="h-4 w-4" />
                  RTL (Home)
                  {getFeedbackBadge('rtl')}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isVehicleConnected}
                  onClick={triggerLand}
                  className={`flex-1 border-amber-600/40 text-amber-300 hover:bg-amber-950/30 gap-1.5 font-bold h-10 sm:h-11 ${getFeedbackRing('land')}`}
                >
                  <PlaneLanding className="h-4 w-4" />
                  Land
                  {getFeedbackBadge('land')}
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Guided Takeoff Workflow Panel (#2) */}
        {showTakeoffPanel && category !== 'rover' && category !== 'sub' && (
          <div className="bg-zinc-900/95 border border-sky-500/40 rounded-xl p-3 space-y-3 shadow-lg">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <PlaneTakeoff className="h-4 w-4 text-sky-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-sky-300">
                  Guided Takeoff Checklist & Target Altitude
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowTakeoffPanel(false)}
                className="text-zinc-400 hover:text-white p-1 rounded"
                title="Close Takeoff panel"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
              {/* Target Altitude Input & Quick Presets */}
              <div className="md:col-span-5 bg-zinc-950/70 border border-zinc-800 rounded-lg p-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="takeoff-alt-input"
                    className="text-[11px] font-bold uppercase text-zinc-400"
                  >
                    Target Altitude ({altUnit})
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      id="takeoff-alt-input"
                      type="number"
                      min={1}
                      max={500}
                      step={1}
                      value={displayTakeoffAlt}
                      onChange={(e) => handleTakeoffAltInputChange(Number(e.target.value))}
                      className="w-20 h-7 px-2 rounded bg-zinc-900 border border-zinc-700 text-right font-mono text-sm font-bold text-zinc-100 focus:outline-none focus:border-sky-500"
                    />
                    <span className="text-xs font-mono text-zinc-400">{altUnit}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  {[5, 10, 15, 25, 50].map((presetM) => {
                    const presetVal =
                      altUnit === 'ft' ? Math.round(presetM * 3.28084) : presetM;
                    const active = Math.abs(takeoffAltMeters - presetM) < 0.5;
                    return (
                      <button
                        key={presetM}
                        type="button"
                        onClick={() => setTakeoffAltMeters(presetM)}
                        className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold border transition-colors ${
                          active
                            ? 'bg-sky-600 border-sky-400 text-white'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {presetVal}
                        {altUnit}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Readiness Checklist: Mode + ARMED */}
              <div className="md:col-span-4 bg-zinc-950/70 border border-zinc-800 rounded-lg p-2.5 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5">
                    {isInTakeoffMode ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    )}
                    <span className={isInTakeoffMode ? 'text-emerald-300 font-semibold' : 'text-amber-200'}>
                      1. Flight Mode: {targetTakeoffModeLabel}
                    </span>
                  </span>
                  {!isInTakeoffMode && (
                    <button
                      type="button"
                      onClick={() => handleSetMode(targetTakeoffModeNum, `Switch to ${targetTakeoffModeLabel}`, 'takeoff-mode')}
                      className="px-2 py-0.5 rounded bg-sky-600/30 hover:bg-sky-600/50 border border-sky-500/50 text-sky-200 text-[10px] font-bold uppercase"
                    >
                      Switch to {targetTakeoffModeLabel}
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5">
                    {heartbeat.isArmed ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    )}
                    <span className={heartbeat.isArmed ? 'text-emerald-300 font-semibold' : 'text-amber-200'}>
                      2. Motors: {heartbeat.isArmed ? 'ARMED' : 'DISARMED'}
                    </span>
                  </span>
                  {!heartbeat.isArmed && (
                    <button
                      type="button"
                      onClick={() => handleArm(true)}
                      className="px-2 py-0.5 rounded bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/50 text-emerald-200 text-[10px] font-bold uppercase"
                    >
                      Arm Now
                    </button>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="md:col-span-3 flex flex-col gap-1.5">
                {autoSeqStep ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleAbortAutoSeq}
                    className="w-full font-bold h-9 gap-1.5"
                  >
                    <XCircle className="h-4 w-4" />
                    Abort Sequence
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="default"
                      size="sm"
                      disabled={!isVehicleConnected}
                      onClick={runAutoTakeoffSequence}
                      className="w-full bg-sky-600 hover:bg-sky-500 text-white font-bold h-9 text-xs gap-1.5"
                      title={
                        category === 'plane'
                          ? 'Switches to TAKEOFF mode and arms motors for launch'
                          : 'Automatically switches to GUIDED, arms motors, and commands takeoff after verifying each ACK'
                      }
                    >
                      <PlaneTakeoff className="h-3.5 w-3.5" />
                      {isTakeoffReady
                        ? category === 'plane'
                          ? 'Ready for Launch'
                          : `Takeoff to ${displayTakeoffAlt} ${altUnit}`
                        : `Auto: ${targetTakeoffModeLabel} → Arm${category === 'plane' ? '' : ` → Takeoff (${displayTakeoffAlt}${altUnit})`}`}
                    </Button>
                    {!isTakeoffReady && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!isVehicleConnected}
                        onClick={() => triggerTakeoff(takeoffAltMeters)}
                        className="w-full border-zinc-700 text-zinc-300 hover:bg-zinc-800 h-7 text-[11px]"
                        title={
                          category === 'plane'
                            ? 'Switch to TAKEOFF mode'
                            : 'Send raw MAV_CMD_NAV_TAKEOFF without switching mode or arming first'
                        }
                      >
                        {category === 'plane' ? 'TAKEOFF Mode Only' : 'Send NAV_TAKEOFF Only'}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>

            {autoSeqStep && (
              <div className="flex items-center gap-2 text-xs text-sky-300 font-mono bg-sky-950/40 border border-sky-800/60 rounded-lg px-2.5 py-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400 shrink-0" />
                <span>{autoSeqStep}</span>
              </div>
            )}

            {autoSeqError && (
              <div className="flex items-center justify-between gap-2 text-xs text-rose-200 bg-rose-950/60 border border-rose-700/60 rounded-lg px-2.5 py-1.5">
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                  <span>{autoSeqError}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setAutoSeqError(null)}
                  className="text-rose-300 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Flight Mode Selector Buttons */}
        <div
          className={`${
            mobileCompact ? 'hidden sm:grid' : 'grid'
          } grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-1.5 sm:gap-2 ${
            !isVehicleConnected ? 'opacity-60' : ''
          }`}
        >
          {commonModes.map(({ label, mode }) => {
            const isActive = isVehicleConnected && heartbeat.customMode === mode;
            const modeKey = `mode-${mode}`;
            return (
              <button
                key={mode}
                disabled={!isVehicleConnected}
                onClick={() => handleSetMode(mode, `Set Mode ${label}`, modeKey)}
                className={`py-2 px-2 rounded-lg border text-[13px] sm:text-sm font-bold font-sans transition-all text-center flex items-center justify-center gap-1.5 ${
                  isActive
                    ? 'bg-sky-500 text-white border-sky-400 shadow-md ring-1 ring-sky-300'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed'
                } ${getFeedbackRing(modeKey)}`}
              >
                <span className="tracking-normal leading-tight">{label}</span>
                {getFeedbackBadge(modeKey)}
              </button>
            );
          })}
        </div>

        {/* Bottom Section: Autopilot Targets (Vehicle-Specific Guidance) */}
        <div className={mobileCompact ? 'hidden sm:block' : 'block'}>
          {category === 'rover' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-zinc-800/60">
              {/* Target Speed Stepper for Rover */}
              <div
                className={`bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 min-w-0 ${getFeedbackRing('speed')}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="p-2 rounded-lg bg-emerald-950/40 text-emerald-400 shrink-0">
                    <Gauge className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-zinc-400 font-bold uppercase whitespace-nowrap">
                        Target Speed
                      </span>
                      {manualTargetSpeedMs !== null && (
                        <button
                          type="button"
                          onClick={handleResetToLiveSpeed}
                          title="Reset to follow vehicle speed"
                          className="text-zinc-500 hover:text-sky-400 p-0.5 rounded transition-colors"
                        >
                          <RotateCcw className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-baseline gap-1.5 mt-0.5">
                      <span className="text-lg font-mono font-bold text-zinc-100">
                        {currentTargetDisplay}{' '}
                        <span className="text-xs font-normal text-zinc-400">{activeUnit}</span>
                      </span>
                      <span className="text-[10px] text-zinc-500 font-mono truncate">
                        (Cur: {isVehicleConnected ? formatSpeed(vfr.groundspeed).full : '--'})
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 font-mono text-xs text-zinc-300"
                    onClick={() => handleStepSpeed(-coarseStep)}
                    title={`Decrease speed by ${coarseStep} ${activeUnit}`}
                  >
                    -{coarseStep}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 font-mono text-xs text-zinc-300"
                    onClick={() => handleStepSpeed(-0.5)}
                    title={`Decrease speed by 0.5 ${activeUnit}`}
                  >
                    -0.5
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 font-mono text-xs text-zinc-300"
                    onClick={() => handleStepSpeed(0.5)}
                    title={`Increase speed by 0.5 ${activeUnit}`}
                  >
                    +0.5
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 font-mono text-xs text-zinc-300"
                    onClick={() => handleStepSpeed(coarseStep)}
                    title={`Increase speed by ${coarseStep} ${activeUnit}`}
                  >
                    +{coarseStep}
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    disabled={!isVehicleConnected}
                    className="h-8 px-3 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white ml-0.5 gap-1"
                    onClick={() => handleSetSpeed()}
                  >
                    Set Spd
                    {getFeedbackBadge('speed')}
                  </Button>
                </div>
              </div>

              {/* Rover Drive Status Overview */}
              <div className="flex items-center justify-between bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-2.5">
                <div className="grid grid-cols-3 gap-2 w-full text-center">
                  <div className="p-1.5 bg-zinc-950/60 rounded-lg border border-zinc-800">
                    <span className="text-[9px] text-zinc-500 uppercase font-bold block">Throttle</span>
                    <span className="text-base font-mono font-bold text-zinc-200">
                      {isVehicleConnected ? `${vfr.throttle}%` : '--'}
                    </span>
                  </div>
                  <div className="p-1.5 bg-zinc-950/60 rounded-lg border border-zinc-800">
                    <span className="text-[9px] text-zinc-500 uppercase font-bold block">Heading</span>
                    <span className="text-base font-mono font-bold text-zinc-200">
                      {isVehicleConnected ? `${vfr.heading}°` : '--'}
                    </span>
                  </div>
                  <div className="p-1.5 bg-zinc-950/60 rounded-lg border border-zinc-800">
                    <span className="text-[9px] text-zinc-500 uppercase font-bold block">GPS Fix</span>
                    <span className="text-sm sm:text-base font-mono font-bold text-emerald-400 truncate block">
                      {isVehicleConnected ? gps.fixLabel : '--'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="pt-1 border-t border-zinc-800/60">
              {/* Target Speed Stepper (Safe in-mode speed adjustment via DO_CHANGE_SPEED) */}
              <div
                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-2.5 min-w-0 ${getFeedbackRing('speed')}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="p-2 rounded-lg bg-emerald-950/40 text-emerald-400 shrink-0">
                    <Gauge className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-zinc-400 font-bold uppercase whitespace-nowrap">
                        Target Speed
                      </span>
                      {manualTargetSpeedMs !== null && (
                        <button
                          type="button"
                          onClick={handleResetToLiveSpeed}
                          title="Reset to follow vehicle speed"
                          className="text-zinc-500 hover:text-sky-400 p-0.5 rounded transition-colors"
                        >
                          <RotateCcw className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-baseline gap-1.5 mt-0.5">
                      <span className="text-lg font-mono font-bold text-zinc-100">
                        {currentTargetDisplay}{' '}
                        <span className="text-xs font-normal text-zinc-400">{activeUnit}</span>
                      </span>
                      <span className="text-[10px] text-zinc-500 font-mono truncate">
                        (Cur:{' '}
                        {isVehicleConnected
                          ? formatSpeed(category === 'plane' ? vfr.airspeed : vfr.groundspeed).full
                          : '--'}
                        )
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 font-mono text-xs text-zinc-300"
                    onClick={() => handleStepSpeed(-coarseStep)}
                    title={`Decrease speed by ${coarseStep} ${activeUnit}`}
                  >
                    -{coarseStep}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 font-mono text-xs text-zinc-300"
                    onClick={() => handleStepSpeed(-0.5)}
                    title={`Decrease speed by 0.5 ${activeUnit}`}
                  >
                    -0.5
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 font-mono text-xs text-zinc-300"
                    onClick={() => handleStepSpeed(0.5)}
                    title={`Increase speed by 0.5 ${activeUnit}`}
                  >
                    +0.5
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 font-mono text-xs text-zinc-300"
                    onClick={() => handleStepSpeed(coarseStep)}
                    title={`Increase speed by ${coarseStep} ${activeUnit}`}
                  >
                    +{coarseStep}
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    disabled={!isVehicleConnected}
                    className="h-8 px-2.5 text-xs font-bold bg-sky-600 hover:bg-sky-700 text-white ml-0.5 gap-1"
                    onClick={() => handleSetSpeed()}
                  >
                    Set Spd
                    {getFeedbackBadge('speed')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
