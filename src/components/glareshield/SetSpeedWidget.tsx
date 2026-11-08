import { feedbackBadge, feedbackRing } from './commandFeedback';
import React, { useState, useEffect } from 'react';
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
} from '../../mavlink/messages';
import {
  Gauge,
  RotateCcw,
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

export const SetSpeedWidget: React.FC = () => {
  const heartbeat = useTelemetryStore((state) => state.heartbeat);
  const vfr = useTelemetryStore((state) => state.vfr);
  const commandFeedback = useTelemetryStore((state) => state.commandFeedback);
  const { formatSpeed, system } = useUnitsStore();
  const [manualTargetSpeedMs, setManualTargetSpeedMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    messageRateManager.registerRequirement('setspeed-vfr', MAVLINK_MSG_ID.VFR_HUD);
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      messageRateManager.unregisterRequirement('setspeed-vfr');
    };
  }, []);

  const encoder = mavlinkConnection.getEncoder();
  const category = getVehicleCategory(heartbeat.type);
  const sysId = heartbeat.systemId || 1;
  const compId = heartbeat.componentId || 1;

  const isVehicleConnected =
    heartbeat.lastHeartbeatTime > 0 &&
    heartbeat.modeName !== 'DISCONNECTED' &&
    nowMs - heartbeat.lastHeartbeatTime <= 3500;

  const activeUnit = system === 'ms' ? 'm/s' : system === 'kmh' ? 'km/h' : system === 'mph' ? 'mph' : 'kts';
  const defaultSpeedMs = category === 'plane' ? 15 : category === 'rover' ? 2 : category === 'sub' ? 1 : 5;
  const liveSpeedMs = category === 'plane'
    ? (vfr.airspeed >= 0.5 ? vfr.airspeed : defaultSpeedMs)
    : (vfr.groundspeed >= 0.5 ? vfr.groundspeed : defaultSpeedMs);

  const currentSpeedMs = manualTargetSpeedMs ?? liveSpeedMs;
  const currentTargetDisplay = Number(toActiveUnits(currentSpeedMs, system).toFixed(1));
  const coarseStep = category === 'rover' || system === 'ms' ? 2 : 5;

  const getFeedbackBadge = (key: string) => feedbackBadge(commandFeedback, key, nowMs, 'h-3.5 w-3.5');
  const getFeedbackRing = (key: string) => feedbackRing(commandFeedback, key, nowMs);

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
    const speedType = category === 'plane' ? 0 : 1;
    const cmd = encoder.createCommandLong(sysId, compId, MAV_CMD.DO_CHANGE_SPEED, [speedType, speedMs, -1, 0, 0, 0, 0]);
    void sendTrackedCommand(cmd, {
      label: `Set Speed (${currentTargetDisplay} ${activeUnit})`,
      targetKey: 'speed',
    });
  };

  const presets = category === 'rover'
    ? [1, 2, 3, 5]
    : category === 'plane'
      ? [12, 15, 18, 22]
      : [3, 5, 8, 12];

  return (
    <Card className="border-sky-500/20 bg-zinc-950/90 shadow-xl overflow-hidden">
      <CardContent className="p-3 sm:p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-emerald-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">
              Set Speed
            </span>
            <span className="text-[10px] text-zinc-500 font-mono">
              ({category === 'plane' ? 'Airspeed' : 'Groundspeed'})
            </span>
          </div>

          <div className="flex items-center gap-1.5 font-mono text-xs">
            <span className="text-zinc-500 text-[11px] uppercase font-bold">Live:</span>
            <span className="font-bold text-zinc-200">
              {isVehicleConnected
                ? formatSpeed(category === 'plane' ? vfr.airspeed : vfr.groundspeed).full
                : '--'}
            </span>
          </div>
        </div>

        {/* Target Stepper & Commanded Speed */}
        <div
          className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-2.5 min-w-0 ${getFeedbackRing('speed')}`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
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
                <span className="text-xl font-mono font-bold text-zinc-100">
                  {currentTargetDisplay}{' '}
                  <span className="text-xs font-normal text-zinc-400">{activeUnit}</span>
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 font-mono text-xs text-zinc-300 border-zinc-700 hover:bg-zinc-800"
              onClick={() => handleStepSpeed(-coarseStep)}
              title={`Decrease by ${coarseStep} ${activeUnit}`}
            >
              -{coarseStep}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 font-mono text-xs text-zinc-300 border-zinc-700 hover:bg-zinc-800"
              onClick={() => handleStepSpeed(-0.5)}
              title={`Decrease by 0.5 ${activeUnit}`}
            >
              -0.5
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 font-mono text-xs text-zinc-300 border-zinc-700 hover:bg-zinc-800"
              onClick={() => handleStepSpeed(0.5)}
              title={`Increase by 0.5 ${activeUnit}`}
            >
              +0.5
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 font-mono text-xs text-zinc-300 border-zinc-700 hover:bg-zinc-800"
              onClick={() => handleStepSpeed(coarseStep)}
              title={`Increase by ${coarseStep} ${activeUnit}`}
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

        {/* Quick Presets */}
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          <span className="text-[10px] uppercase font-bold text-zinc-500 mr-1">Presets:</span>
          {presets.map((presetMs) => {
            const presetVal = Number(toActiveUnits(presetMs, system).toFixed(1));
            const isCurrent = Math.abs(currentSpeedMs - presetMs) < 0.2;
            return (
              <button
                key={presetMs}
                type="button"
                onClick={() => setManualTargetSpeedMs(presetMs)}
                className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold border transition-colors ${
                  isCurrent
                    ? 'bg-emerald-600 border-emerald-400 text-white'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {presetVal} {activeUnit}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
