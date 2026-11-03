import React, { useState, useEffect, useRef } from 'react';
import { useTelemetryStore, sendTrackedCommand } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { mavlinkConnection } from '../../mavlink/connection';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import {
  MAV_CMD,
  MAV_TYPE,
  getVehicleCategory,
  getGuidedModeNum,
  getAutoModeNum,
} from '../../mavlink/messages';
import {
  Shield,
  ShieldAlert,
  ArrowUp,
  Navigation,
  Anchor,
  PlaneLanding,
  PlaneTakeoff,
  CircleStop,
  Play,
  Sliders,
  Radio,
  Zap,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  X,
} from 'lucide-react';

export const ArmingModesWidget: React.FC = () => {
  const heartbeat = useTelemetryStore((state) => state.heartbeat);
  const commandFeedback = useTelemetryStore((state) => state.commandFeedback);
  const { isImperial } = useUnitsStore();
  const altUnit = isImperial() ? 'ft' : 'm';
  const [sliderValue, setSliderValue] = useState<number>(0);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [showTakeoffPanel, setShowTakeoffPanel] = useState<boolean>(false);
  const [takeoffAltMeters, setTakeoffAltMeters] = useState<number>(10);
  const [autoSeqStep, setAutoSeqStep] = useState<string | null>(null);
  const [autoSeqError, setAutoSeqError] = useState<string | null>(null);
  const abortAutoSeqRef = useRef<boolean>(false);
  const dragStartedFromLeft = useRef(false);
  const armedBySequenceRef = useRef<boolean>(false);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const encoder = mavlinkConnection.getEncoder();
  const category = getVehicleCategory(heartbeat.type);
  const isBoat = heartbeat.type === MAV_TYPE.SURFACE_BOAT;
  const guidedModeNum = getGuidedModeNum(heartbeat.type);
  const autoModeNum = getAutoModeNum(heartbeat.type);
  const targetTakeoffModeNum = category === 'plane' ? 13 : guidedModeNum;
  const targetTakeoffModeLabel = category === 'plane' ? 'TAKEOFF' : 'GUIDED';

  const isVehicleConnected =
    heartbeat.lastHeartbeatTime > 0 &&
    heartbeat.modeName !== 'DISCONNECTED' &&
    nowMs - heartbeat.lastHeartbeatTime <= 3500;

  const isInTakeoffMode = isVehicleConnected && heartbeat.customMode === targetTakeoffModeNum;
  const isTakeoffReady = isInTakeoffMode && heartbeat.isArmed;

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
      if (heartbeat.isArmed) {
        handleArm(false);
      } else {
        handleArm(true);
      }
    }
    dragStartedFromLeft.current = false;
    setSliderValue(0);
  };

  const handleSetMode = (modeNum: number, label: string, targetKey: string) => {
    const cmd = encoder.createSetMode(sysId, compId, modeNum);
    void sendTrackedCommand(cmd, {
      label,
      targetKey,
    });
  };

  const triggerRTL = () => {
    if (category === 'rover' || category === 'plane') {
      handleSetMode(11, 'Return to Launch (RTL)', 'mode-rtl');
    } else {
      const cmd = encoder.createCommandLong(sysId, compId, MAV_CMD.NAV_RETURN_TO_LAUNCH);
      void sendTrackedCommand(cmd, {
        label: 'Return to Launch (RTL)',
        targetKey: 'mode-rtl',
      });
    }
  };

  const triggerLand = () => {
    const cmd = encoder.createCommandLong(sysId, compId, MAV_CMD.NAV_LAND);
    void sendTrackedCommand(cmd, {
      label: 'Land Now',
      targetKey: 'mode-land',
    });
  };

  const triggerTakeoff = (altM = takeoffAltMeters) => {
    if (category === 'plane') {
      handleSetMode(13, 'Switch to TAKEOFF mode', 'mode-takeoff');
      return;
    }
    const safeAlt = Math.max(1, Math.min(500, altM));
    const dispAlt = altUnit === 'ft' ? `${Math.round(safeAlt * 3.28084)} ft` : `${safeAlt.toFixed(0)} m`;
    const cmd = encoder.createCommandLong(sysId, compId, MAV_CMD.NAV_TAKEOFF, [0, 0, 0, 0, 0, 0, safeAlt]);
    void sendTrackedCommand(cmd, {
      label: `Takeoff (${dispAlt})`,
      targetKey: 'mode-takeoff',
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
      const st1 = useTelemetryStore.getState();
      if (st1.heartbeat.customMode !== targetTakeoffModeNum) {
        setAutoSeqStep(`Step 1/${category === 'plane' ? '2' : '3'}: Switching to ${targetTakeoffModeLabel} mode…`);
        const modeAck = await sendTrackedCommand(
          encoder.createSetMode(sysId, compId, targetTakeoffModeNum),
          { label: `Auto-Takeoff: Switch to ${targetTakeoffModeLabel}`, targetKey: 'mode-takeoff' }
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

      const st2 = useTelemetryStore.getState();
      if (!st2.heartbeat.isArmed) {
        setAutoSeqStep(`Step 2/${category === 'plane' ? '2' : '3'}: Arming motors…`);
        const armAck = await sendTrackedCommand(
          encoder.createArmDisarm(sysId, compId, true),
          { label: 'Auto-Takeoff: Arm Motors', targetKey: 'mode-takeoff' }
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
        armedBySequenceRef.current = true;
        await new Promise((r) => setTimeout(r, 450));
      }

      if (abortAutoSeqRef.current) {
        await safetyDisarmIfArmedBySeq();
        return;
      }

      if (category !== 'plane') {
        setAutoSeqStep(`Step 3/3: Commanding Takeoff to ${dispAlt}…`);
        const toAck = await sendTrackedCommand(
          encoder.createCommandLong(sysId, compId, MAV_CMD.NAV_TAKEOFF, [0, 0, 0, 0, 0, 0, safeAlt]),
          { label: `Takeoff (${dispAlt})`, targetKey: 'mode-takeoff' }
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
      const disarmCmd = encoder.createArmDisarm(sysId, compId, false, true);
      void sendTrackedCommand(disarmCmd, {
        label: 'Auto-Takeoff Abort: Safety Disarm',
        targetKey: 'arm',
      });
      armedBySequenceRef.current = false;
    } else {
      handleSetMode(category === 'plane' ? 12 : 5, 'Abort Takeoff (Loiter)', 'mode-loiter');
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

  // Active mode helpers
  const isHoldActive = isVehicleConnected && heartbeat.customMode === 4;
  const isManualActive = isVehicleConnected && (category === 'sub' ? heartbeat.customMode === 19 : heartbeat.customMode === 0);
  const isSteeringActive = isVehicleConnected && category === 'rover' && !isBoat && heartbeat.customMode === 3;
  const isLoiterActive =
    isVehicleConnected &&
    (category === 'plane'
      ? heartbeat.customMode === 12
      : isBoat
        ? heartbeat.customMode === 5
        : heartbeat.customMode === 5);
  const isAcroActive = isVehicleConnected && heartbeat.customMode === 1;
  const isAutoActive = isVehicleConnected && heartbeat.customMode === autoModeNum;
  const isRtlActive =
    isVehicleConnected &&
    (category === 'copter' ? heartbeat.customMode === 6 : heartbeat.customMode === 11);
  const isLandActive =
    isVehicleConnected &&
    (category === 'plane' ? heartbeat.customMode === 20 : heartbeat.customMode === 9);

  return (
    <Card className="border-sky-500/20 bg-zinc-950/90 shadow-xl overflow-hidden">
      <CardContent className="p-2 sm:p-2.5 space-y-2.5">
        {/* Top Control Bar: Arming Slider & 5 Quick Mode Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 sm:gap-2.5 items-center">
          {/* Arm / Disarm Interlock (Made less wide: md:col-span-4) */}
          <div
            className={`md:col-span-4 bg-zinc-900/80 border border-zinc-800 rounded-xl p-2 transition-opacity ${
              !isVehicleConnected ? 'opacity-65' : ''
            } ${getFeedbackRing('arm')}`}
          >
            <div className="flex items-center justify-between mb-1 gap-2">
              <span className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1.5 min-w-0">
                {!isVehicleConnected ? (
                  <Shield className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                ) : heartbeat.isArmed ? (
                  <ShieldAlert className="h-3.5 w-3.5 text-red-400 shrink-0" />
                ) : (
                  <Shield className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                )}
                <span className="truncate">
                  Master:{' '}
                  {!isVehicleConnected
                    ? 'NO LINK'
                    : heartbeat.isArmed
                      ? 'ARMED (Live)'
                      : 'DISARMED'}
                </span>
                {getFeedbackBadge('arm')}
              </span>
              <span className="text-[10px] text-zinc-500 font-sans hidden sm:inline shrink-0">
                {isVehicleConnected ? 'Slide right' : 'Offline'}
              </span>
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
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-[11px] font-bold uppercase tracking-wider text-zinc-200">
                {!isVehicleConnected
                  ? 'NO LINK — Locked'
                  : heartbeat.isArmed
                    ? 'Slide to DISARM'
                    : 'Slide to ARM'}
              </div>
            </div>
          </div>

          {/* 5 Quick Action Modes (md:col-span-8) */}
          <div
            className={`md:col-span-8 grid grid-cols-2 sm:grid-cols-5 gap-1.5 sm:gap-2 ${
              !isVehicleConnected ? 'opacity-65' : ''
            }`}
          >
            {category === 'rover' ? (
              <>
                {/* 1. Hold */}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isVehicleConnected}
                  onClick={() => handleSetMode(4, 'Rover Hold', 'mode-4')}
                  className={`border-rose-600/60 text-rose-300 hover:bg-rose-950/40 gap-1 font-bold h-10 ${
                    isHoldActive ? 'bg-rose-950/60 border-rose-400 ring-1 ring-rose-400 shadow-sm' : ''
                  } ${getFeedbackRing('mode-4')}`}
                >
                  <CircleStop className="h-4 w-4 text-rose-400 shrink-0" />
                  <span className="truncate">Hold</span>
                  {getFeedbackBadge('mode-4')}
                </Button>

                {/* 2. Manual */}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isVehicleConnected}
                  onClick={() => handleSetMode(0, 'Rover Manual', 'mode-0')}
                  className={`border-zinc-700 hover:bg-zinc-800 text-zinc-200 gap-1 font-bold h-10 ${
                    isManualActive ? 'bg-zinc-800 border-sky-400 ring-1 ring-sky-400 text-white shadow-sm' : ''
                  } ${getFeedbackRing('mode-0')}`}
                >
                  <Radio className="h-4 w-4 text-sky-400 shrink-0" />
                  <span className="truncate">Manual</span>
                  {getFeedbackBadge('mode-0')}
                </Button>

                {/* 3. Steering for rovers, Loiter for boats */}
                {isBoat ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!isVehicleConnected}
                    onClick={() => handleSetMode(5, 'Boat Loiter', 'mode-5')}
                    className={`border-cyan-600/50 text-cyan-300 hover:bg-cyan-950/40 gap-1 font-bold h-10 ${
                      isLoiterActive ? 'bg-cyan-950/60 border-cyan-400 ring-1 ring-cyan-400 shadow-sm' : ''
                    } ${getFeedbackRing('mode-5')}`}
                  >
                    <Anchor className="h-4 w-4 text-cyan-400 shrink-0" />
                    <span className="truncate">Loiter</span>
                    {getFeedbackBadge('mode-5')}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!isVehicleConnected}
                    onClick={() => handleSetMode(3, 'Rover Steering', 'mode-3')}
                    className={`border-sky-600/50 text-sky-300 hover:bg-sky-950/40 gap-1 font-bold h-10 ${
                      isSteeringActive ? 'bg-sky-950/60 border-sky-400 ring-1 ring-sky-400 shadow-sm' : ''
                    } ${getFeedbackRing('mode-3')}`}
                  >
                    <Navigation className="h-4 w-4 text-sky-400 shrink-0" />
                    <span className="truncate">Steering</span>
                    {getFeedbackBadge('mode-3')}
                  </Button>
                )}

                {/* 4. Acro */}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isVehicleConnected}
                  onClick={() => handleSetMode(1, 'Rover Acro', 'mode-1')}
                  className={`border-amber-600/50 text-amber-300 hover:bg-amber-950/40 gap-1 font-bold h-10 ${
                    isAcroActive ? 'bg-amber-950/60 border-amber-400 ring-1 ring-amber-400 shadow-sm' : ''
                  } ${getFeedbackRing('mode-1')}`}
                >
                  <Zap className="h-4 w-4 text-amber-400 shrink-0" />
                  <span className="truncate">Acro</span>
                  {getFeedbackBadge('mode-1')}
                </Button>

                {/* 5. Auto */}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isVehicleConnected}
                  onClick={() => handleSetMode(10, 'Rover Auto', 'mode-10')}
                  className={`border-emerald-600/50 text-emerald-300 hover:bg-emerald-950/40 gap-1 font-bold h-10 ${
                    isAutoActive ? 'bg-emerald-950/60 border-emerald-400 ring-1 ring-emerald-400 shadow-sm' : ''
                  } ${getFeedbackRing('mode-10')}`}
                >
                  <Play className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span className="truncate">Auto</span>
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
                  className={`border-amber-600/50 text-amber-300 hover:bg-amber-950/40 gap-1 font-bold h-10 ${getFeedbackRing('mode-9')}`}
                >
                  <ArrowUp className="h-4 w-4 text-amber-400 shrink-0" />
                  <span className="truncate">Surface</span>
                  {getFeedbackBadge('mode-9')}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isVehicleConnected}
                  onClick={() => handleSetMode(16, 'Sub PosHold', 'mode-16')}
                  className={`border-sky-600/50 text-sky-300 hover:bg-sky-950/40 gap-1 font-bold h-10 ${getFeedbackRing('mode-16')}`}
                >
                  <Anchor className="h-4 w-4 text-sky-400 shrink-0" />
                  <span className="truncate">PosHold</span>
                  {getFeedbackBadge('mode-16')}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isVehicleConnected}
                  onClick={() => handleSetMode(2, 'Sub Depth Hold', 'mode-2')}
                  className={`border-emerald-600/50 text-emerald-300 hover:bg-emerald-950/40 gap-1 font-bold h-10 ${getFeedbackRing('mode-2')}`}
                >
                  <Sliders className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span className="truncate">Depth</span>
                  {getFeedbackBadge('mode-2')}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isVehicleConnected}
                  onClick={() => handleSetMode(19, 'Sub Manual', 'mode-19')}
                  className={`border-zinc-700 hover:bg-zinc-800 text-zinc-200 gap-1 font-bold h-10 ${
                    isManualActive ? 'bg-zinc-800 border-sky-400 ring-1 ring-sky-400 shadow-sm' : ''
                  } ${getFeedbackRing('mode-19')}`}
                >
                  <Radio className="h-4 w-4 text-sky-400 shrink-0" />
                  <span className="truncate">Manual</span>
                  {getFeedbackBadge('mode-19')}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isVehicleConnected}
                  onClick={() => handleSetMode(3, 'Sub Auto', 'mode-3')}
                  className={`border-emerald-600/50 text-emerald-300 hover:bg-emerald-950/40 gap-1 font-bold h-10 ${
                    isAutoActive ? 'bg-emerald-950/60 border-emerald-400 ring-1 ring-emerald-400 shadow-sm' : ''
                  } ${getFeedbackRing('mode-3')}`}
                >
                  <Play className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span className="truncate">Auto</span>
                  {getFeedbackBadge('mode-3')}
                </Button>
              </>
            ) : (
              /* Airborne Vehicles (Copter, Plane, VTOL, Generic) */
              <>
                {/* 1. Takeoff */}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isVehicleConnected}
                  onClick={() => {
                    setAutoSeqError(null);
                    setShowTakeoffPanel((prev) => !prev);
                  }}
                  className={`border-sky-600/50 text-sky-300 hover:bg-sky-950/40 gap-1 font-bold h-10 ${
                    showTakeoffPanel ? 'bg-sky-950/60 border-sky-400 ring-1 ring-sky-400 shadow-sm' : ''
                  } ${getFeedbackRing('mode-takeoff')}`}
                >
                  <PlaneTakeoff className="h-4 w-4 text-sky-400 shrink-0" />
                  <span className="truncate">Takeoff</span>
                  {getFeedbackBadge('mode-takeoff')}
                </Button>

                {/* 2. Auto (Added for airborne vehicles per user request) */}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isVehicleConnected}
                  onClick={() => handleSetMode(autoModeNum, 'Auto Mission', 'mode-auto')}
                  className={`border-emerald-600/50 text-emerald-300 hover:bg-emerald-950/40 gap-1 font-bold h-10 ${
                    isAutoActive ? 'bg-emerald-950/60 border-emerald-400 ring-1 ring-emerald-400 shadow-sm' : ''
                  } ${getFeedbackRing('mode-auto')}`}
                >
                  <Play className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span className="truncate">Auto</span>
                  {getFeedbackBadge('mode-auto')}
                </Button>

                {/* 3. Pause / Loiter */}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isVehicleConnected}
                  onClick={() =>
                    handleSetMode(
                      category === 'plane' ? 12 : 5,
                      'Pause / Loiter',
                      'mode-loiter'
                    )
                  }
                  className={`border-cyan-600/50 text-cyan-300 hover:bg-cyan-950/40 gap-1 font-bold h-10 ${
                    isLoiterActive ? 'bg-cyan-950/60 border-cyan-400 ring-1 ring-cyan-400 shadow-sm' : ''
                  } ${getFeedbackRing('mode-loiter')}`}
                >
                  <Anchor className="h-4 w-4 text-cyan-400 shrink-0" />
                  <span className="truncate">Loiter</span>
                  {getFeedbackBadge('mode-loiter')}
                </Button>

                {/* 4. RTL (Home) */}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isVehicleConnected}
                  onClick={triggerRTL}
                  className={`border-amber-600/50 text-amber-300 hover:bg-amber-950/40 gap-1 font-bold h-10 ${
                    isRtlActive ? 'bg-amber-950/60 border-amber-400 ring-1 ring-amber-400 shadow-sm' : ''
                  } ${getFeedbackRing('mode-rtl')}`}
                >
                  <Navigation className="h-4 w-4 text-amber-400 shrink-0" />
                  <span className="truncate">RTL</span>
                  {getFeedbackBadge('mode-rtl')}
                </Button>

                {/* 5. Land */}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isVehicleConnected}
                  onClick={triggerLand}
                  className={`border-amber-600/50 text-amber-300 hover:bg-amber-950/40 gap-1 font-bold h-10 ${
                    isLandActive ? 'bg-amber-950/60 border-amber-400 ring-1 ring-amber-400 shadow-sm' : ''
                  } ${getFeedbackRing('mode-land')}`}
                >
                  <PlaneLanding className="h-4 w-4 text-amber-400 shrink-0" />
                  <span className="truncate">Land</span>
                  {getFeedbackBadge('mode-land')}
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Guided Takeoff Workflow Panel */}
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
                      onClick={() => handleSetMode(targetTakeoffModeNum, `Switch to ${targetTakeoffModeLabel}`, 'mode-takeoff')}
                      className="px-2 py-0.5 rounded bg-sky-600/30 hover:bg-sky-600/50 border border-sky-500/50 text-sky-200 text-[10px] font-bold uppercase"
                    >
                      Switch
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
                          : 'Automatically switches to GUIDED, arms motors, and commands takeoff'
                      }
                    >
                      <PlaneTakeoff className="h-3.5 w-3.5" />
                      {isTakeoffReady
                        ? category === 'plane'
                          ? 'Ready for Launch'
                          : `Takeoff to ${displayTakeoffAlt} ${altUnit}`
                        : `Auto: Takeoff (${displayTakeoffAlt}${altUnit})`}
                    </Button>
                    {!isTakeoffReady && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!isVehicleConnected}
                        onClick={() => triggerTakeoff(takeoffAltMeters)}
                        className="w-full border-zinc-700 text-zinc-300 hover:bg-zinc-800 h-7 text-[11px]"
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
      </CardContent>
    </Card>
  );
};
