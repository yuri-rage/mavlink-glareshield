import React, { useState, useEffect, useRef } from 'react';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore, UnitSystem } from '../../store/unitsStore';
import { mavlinkConnection } from '../../mavlink/connection';
import { messageRateManager } from '../../mavlink/rateManager';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  MAV_CMD,
  MAVLINK_MSG_ID,
  getVehicleCategory,
  getVehicleFlightModes,
} from '../../mavlink/messages';
import {
  Shield,
  ShieldAlert,
  Compass,
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
  Car,
  Zap,
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
  const { formatSpeed, system } = useUnitsStore();
  const [manualTargetSpeed, setManualTargetSpeed] = useState<number | null>(null);
  const [sliderValue, setSliderValue] = useState<number>(0);
  const dragStartedFromLeft = useRef(false);

  useEffect(() => {
    messageRateManager.registerRequirement('glareshield-vfr', MAVLINK_MSG_ID.VFR_HUD);
    return () => {
      messageRateManager.unregisterRequirement('glareshield-vfr');
    };
  }, []);

  const encoder = mavlinkConnection.getEncoder();
  const category = getVehicleCategory(heartbeat.type);
  const commonModes = getVehicleFlightModes(heartbeat.type);

  const sysId = heartbeat.systemId || 1;
  const compId = heartbeat.componentId || 1;

  const handleArm = (arm: boolean) => {
    const cmd = encoder.createArmDisarm(sysId, compId, arm);
    mavlinkConnection.send(cmd);
    setSliderValue(0);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
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
    if (dragStartedFromLeft.current) {
      setSliderValue(Number(e.target.value));
    }
  };

  const handleSliderRelease = () => {
    if (dragStartedFromLeft.current && sliderValue >= 90) {
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

  const handleSetMode = (modeNum: number) => {
    const cmd = encoder.createSetMode(sysId, compId, modeNum);
    mavlinkConnection.send(cmd);
  };

  const activeUnit = system === 'ms' ? 'm/s' : system === 'kmh' ? 'km/h' : system === 'mph' ? 'mph' : 'kts';
  const defaultSpeedMs = category === 'plane' ? 15 : category === 'rover' ? 2 : category === 'sub' ? 1 : 5;
  const liveSpeedMs = vfr.groundspeed >= 0.5 ? vfr.groundspeed : defaultSpeedMs;
  const autoTargetInActive = Math.round(toActiveUnits(liveSpeedMs, system));
  const currentTargetSpeed = manualTargetSpeed ?? autoTargetInActive;

  const handleStepSpeed = (delta: number) => {
    setManualTargetSpeed(Math.max(1, currentTargetSpeed + delta));
  };

  const handleResetToLiveSpeed = () => {
    setManualTargetSpeed(null);
  };

  const handleSetSpeed = (customSpeedMs?: number) => {
    const speedMs = customSpeedMs !== undefined ? customSpeedMs : fromActiveUnitsToMs(currentTargetSpeed, system);
    if (customSpeedMs !== undefined) {
      setManualTargetSpeed(Math.round(toActiveUnits(customSpeedMs, system)));
    }
    // MAV_CMD_DO_CHANGE_SPEED: param1 = type (0=airspeed, 1=groundspeed), param2 = speed (m/s)
    const cmd = encoder.createCommandLong(sysId, compId, MAV_CMD.DO_CHANGE_SPEED, [1, speedMs, -1, 0, 0, 0, 0]);
    mavlinkConnection.send(cmd);
  };

  const triggerRTL = () => {
    if (category === 'rover') {
      handleSetMode(11); // Rover RTL
    } else if (category === 'plane') {
      handleSetMode(11); // Plane RTL
    } else {
      const cmd = encoder.createCommandLong(sysId, compId, MAV_CMD.NAV_RETURN_TO_LAUNCH);
      mavlinkConnection.send(cmd);
    }
  };

  const triggerLand = () => {
    const cmd = encoder.createCommandLong(sysId, compId, MAV_CMD.NAV_LAND);
    mavlinkConnection.send(cmd);
  };

  const triggerTakeoff = () => {
    const cmd = encoder.createCommandLong(sysId, compId, MAV_CMD.NAV_TAKEOFF, [0, 0, 0, 0, 0, 0, 10]); // 10m takeoff
    mavlinkConnection.send(cmd);
  };

  return (
    <Card className="border-sky-500/20 bg-zinc-950/90 shadow-xl overflow-hidden">
      <CardContent className="p-3 sm:p-4 space-y-4">
        {/* Top Control Bar: Arming Slider & Emergency Action Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          {/* Arm / Disarm Interlock */}
          <div className="md:col-span-5 bg-zinc-900/80 border border-zinc-800 rounded-xl p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                {heartbeat.isArmed ? (
                  <ShieldAlert className="h-4 w-4 text-red-400" />
                ) : (
                  <Shield className="h-4 w-4 text-emerald-400" />
                )}
                Safety Master: {heartbeat.isArmed ? 'ARMED (Motors Live)' : 'DISARMED'}
              </span>
              <span className="text-[10px] text-zinc-500 font-sans">Slide to switch</span>
            </div>

            <div className="relative flex items-center">
              <input
                type="range"
                min="0"
                max="100"
                value={sliderValue}
                onPointerDown={handlePointerDown}
                onChange={handleSliderChange}
                onPointerUp={handleSliderRelease}
                onPointerCancel={handleSliderRelease}
                onMouseUp={handleSliderRelease}
                onTouchEnd={handleSliderRelease}
                onKeyDown={(e) => e.preventDefault()}
                className={`w-full h-8 rounded-lg appearance-none cursor-pointer transition-all select-none ${
                  heartbeat.isArmed
                    ? 'accent-red-500 bg-red-950/40 border border-red-800/60'
                    : 'accent-emerald-500 bg-emerald-950/40 border border-emerald-800/60'
                }`}
              />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-xs font-bold uppercase tracking-wider text-zinc-200">
                {heartbeat.isArmed ? 'Slide Right to DISARM' : 'Slide Right to ARM MOTORS'}
              </div>
            </div>
          </div>

          {/* Quick Actions Bar - Vehicle Category Specific */}
          <div className="md:col-span-7 flex flex-wrap sm:flex-nowrap items-center gap-2">
            {category === 'rover' ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSetMode(4)} // Rover HOLD mode
                  className="flex-1 border-rose-600/60 text-rose-300 hover:bg-rose-950/40 gap-1.5 font-bold h-11"
                >
                  <CircleStop className="h-4 w-4 text-rose-400" />
                  Hold
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSetMode(0)} // Rover MANUAL mode
                  className="flex-1 border-zinc-700 hover:bg-zinc-800 gap-1.5 font-bold h-11"
                >
                  <Radio className="h-4 w-4 text-sky-400" />
                  Manual
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSetMode(1)} // Rover ACRO mode
                  className="flex-1 border-amber-600/40 text-amber-300 hover:bg-amber-950/30 gap-1.5 font-bold h-11"
                >
                  <Zap className="h-4 w-4 text-amber-400" />
                  Acro
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSetMode(10)} // Rover AUTO mode
                  className="flex-1 border-emerald-600/40 text-emerald-300 hover:bg-emerald-950/30 gap-1.5 font-bold h-11"
                >
                  <Play className="h-4 w-4 text-emerald-400" />
                  Auto
                </Button>
              </>
            ) : category === 'sub' ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSetMode(9)} // ArduSub SURFACE
                  className="flex-1 border-amber-600/40 text-amber-300 hover:bg-amber-950/30 gap-1.5 font-bold h-11"
                >
                  <ArrowUp className="h-4 w-4" />
                  Surface
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSetMode(16)} // ArduSub POSHOLD
                  className="flex-1 border-sky-600/40 text-sky-300 hover:bg-sky-950/30 gap-1.5 font-bold h-11"
                >
                  <Anchor className="h-4 w-4" />
                  PosHold
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSetMode(2)} // ArduSub ALT_HOLD (Depth hold)
                  className="flex-1 border-emerald-600/40 text-emerald-300 hover:bg-emerald-950/30 gap-1.5 font-bold h-11"
                >
                  <Sliders className="h-4 w-4" />
                  Depth Hold
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSetMode(19)} // ArduSub MANUAL
                  className="flex-1 border-zinc-700 hover:bg-zinc-800 gap-1.5 font-bold h-11"
                >
                  <Radio className="h-4 w-4 text-sky-400" />
                  Manual
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={triggerTakeoff}
                  className="flex-1 border-sky-600/40 text-sky-300 hover:bg-sky-950/30 gap-1.5 font-bold h-11"
                >
                  <PlaneTakeoff className="h-4 w-4 text-sky-400" />
                  Takeoff
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSetMode(category === 'plane' ? 12 : 5)} // Loiter
                  className="flex-1 border-sky-600/40 text-sky-300 hover:bg-sky-950/30 gap-1.5 font-bold h-11"
                >
                  <Anchor className="h-4 w-4" />
                  Pause / Loiter
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={triggerRTL}
                  className="flex-1 border-amber-600/40 text-amber-300 hover:bg-amber-950/30 gap-1.5 font-bold h-11"
                >
                  <Navigation className="h-4 w-4" />
                  RTL (Home)
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={triggerLand}
                  className="flex-1 border-amber-600/40 text-amber-300 hover:bg-amber-950/30 gap-1.5 font-bold h-11"
                >
                  <PlaneLanding className="h-4 w-4" />
                  Land
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Flight Mode Selector Buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-1.5 sm:gap-2">
          {commonModes.map(({ label, mode }) => {
            const isActive = heartbeat.customMode === mode;
            return (
              <button
                key={mode}
                onClick={() => handleSetMode(mode)}
                className={`py-2 px-2 rounded-lg border text-[13px] sm:text-sm font-bold font-sans transition-all text-center flex items-center justify-center ${
                  isActive
                    ? 'bg-sky-500 text-white border-sky-400 shadow-md ring-1 ring-sky-300'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white'
                }`}
              >
                <span className="tracking-normal leading-tight">{label}</span>
              </button>
            );
          })}
        </div>

        {/* Bottom Section: Autopilot Targets (Vehicle-Specific Guidance) */}
        {category === 'rover' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-zinc-800/60">
            {/* Target Speed Stepper + Speed Presets for Rover */}
            <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-emerald-950/40 text-emerald-400">
                    <Gauge className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-zinc-400 font-bold uppercase block truncate">Target Speed</span>
                      {manualTargetSpeed !== null && (
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
                        {currentTargetSpeed} <span className="text-xs font-normal text-zinc-400">{activeUnit}</span>
                      </span>
                      <span className="text-[10px] text-zinc-500 font-mono truncate">
                        (Cur: {formatSpeed(vfr.groundspeed).full})
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 font-bold text-xs"
                    onClick={() => handleStepSpeed(-1)}
                    title={`Decrease speed by 1 ${activeUnit}`}
                  >
                    -1
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 font-bold text-xs"
                    onClick={() => handleStepSpeed(1)}
                    title={`Increase speed by 1 ${activeUnit}`}
                  >
                    +1
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    className="h-8 px-3 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white ml-1"
                    onClick={() => handleSetSpeed()}
                  >
                    Set Spd
                  </Button>
                </div>
              </div>

              {/* Speed Preset Quick Chips */}
              <div className="flex items-center gap-1.5 pt-1 border-t border-zinc-800/40">
                <span className="text-[10px] text-zinc-500 font-sans">Presets:</span>
                {[0.5, 1.0, 2.0, 3.0, 5.0].map((spdMs) => {
                  const spdActive = Math.round(toActiveUnits(spdMs, system));
                  const isCurrent = currentTargetSpeed === spdActive;
                  return (
                    <button
                      key={spdMs}
                      onClick={() => handleSetSpeed(spdMs)}
                      className={`px-2 py-0.5 rounded text-[11px] font-sans font-semibold transition-colors border ${
                        isCurrent
                          ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-300'
                          : 'bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {spdActive} {activeUnit}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Rover Drive Status Overview */}
            <div className="flex items-center justify-between bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-2.5">
              <div className="grid grid-cols-3 gap-2 w-full text-center">
                <div className="p-1.5 bg-zinc-950/60 rounded-lg border border-zinc-800">
                  <span className="text-[9px] text-zinc-500 uppercase font-bold block">Throttle</span>
                  <span className="text-base font-mono font-bold text-zinc-200">
                    {vfr.throttle}%
                  </span>
                </div>
                <div className="p-1.5 bg-zinc-950/60 rounded-lg border border-zinc-800">
                  <span className="text-[9px] text-zinc-500 uppercase font-bold block">Heading</span>
                  <span className="text-base font-mono font-bold text-zinc-200">
                    {vfr.heading}°
                  </span>
                </div>
                <div className="p-1.5 bg-zinc-950/60 rounded-lg border border-zinc-800">
                  <span className="text-[9px] text-zinc-500 uppercase font-bold block">GPS Fix</span>
                  <span className="text-sm sm:text-base font-mono font-bold text-emerald-400 truncate block">
                    {gps.fixLabel}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="pt-1 border-t border-zinc-800/60">
            {/* Target Speed Stepper (Safe in-mode speed adjustment via DO_CHANGE_SPEED) */}
            <div className="flex items-center justify-between bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-2.5 min-w-0">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="p-2 rounded-lg bg-emerald-950/40 text-emerald-400 shrink-0">
                  <Gauge className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-zinc-400 font-bold uppercase block truncate">Target Speed</span>
                    {manualTargetSpeed !== null && (
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
                      {currentTargetSpeed} <span className="text-xs font-normal text-zinc-400">{activeUnit}</span>
                    </span>
                    <span className="text-[10px] text-zinc-500 font-mono truncate">
                      (Cur: {formatSpeed(vfr.groundspeed).full})
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 font-bold text-xs"
                  onClick={() => handleStepSpeed(-1)}
                  title={`Decrease speed by 1 ${activeUnit}`}
                >
                  -1
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 font-bold text-xs"
                  onClick={() => handleStepSpeed(1)}
                  title={`Increase speed by 1 ${activeUnit}`}
                >
                  +1
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  className="h-8 px-2.5 text-xs font-bold bg-sky-600 hover:bg-sky-700 text-white ml-0.5"
                  onClick={() => handleSetSpeed()}
                >
                  Set Spd
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
