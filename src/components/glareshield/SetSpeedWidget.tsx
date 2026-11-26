import React, { useEffect, useState } from 'react';

import { Gauge, RotateCcw } from 'lucide-react';

import { mavlinkConnection } from '../../mavlink/connection';
import { getVehicleCategory, MAV_CMD, MAVLINK_MSG_ID } from '../../mavlink/messages';
import { messageRateManager } from '../../mavlink/rateManager';
import { heartbeatLiveMs } from '../../mavlink/replayClock';
import { useReplaying } from '../../store/replayStore';
import { sendTrackedCommand, useTelemetryStore } from '../../store/telemetryStore';
import { UnitSystem, useUnitsStore } from '../../store/unitsStore';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { feedbackBadge, feedbackRing } from './commandFeedback';

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

  const replaying = useReplaying();
  const isVehicleConnected =
    heartbeat.lastHeartbeatTime > 0 &&
    heartbeat.modeName !== 'DISCONNECTED' &&
    nowMs - heartbeat.lastHeartbeatTime <= heartbeatLiveMs();

  const activeUnit = system === 'ms' ? 'm/s' : system === 'kmh' ? 'km/h' : system === 'mph' ? 'mph' : 'kts';
  const defaultSpeedMs = category === 'plane' ? 15 : category === 'rover' ? 2 : category === 'sub' ? 1 : 5;
  const liveSpeedMs =
    category === 'plane'
      ? vfr.airspeed >= 0.5
        ? vfr.airspeed
        : defaultSpeedMs
      : vfr.groundspeed >= 0.5
        ? vfr.groundspeed
        : defaultSpeedMs;

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

  const presets = category === 'rover' ? [1, 2, 3, 5] : category === 'plane' ? [12, 15, 18, 22] : [3, 5, 8, 12];

  return (
    <Card className="overflow-hidden border-sky-500/20 bg-zinc-950/90 shadow-xl">
      <CardContent className="space-y-3 p-3 sm:p-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-emerald-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">Set Speed</span>
            <span className="font-mono text-[10px] text-zinc-500">
              ({category === 'plane' ? 'Airspeed' : 'Groundspeed'})
            </span>
          </div>

          <div className="flex items-center gap-1.5 font-mono text-xs">
            <span className="text-[11px] font-bold uppercase text-zinc-500">Live:</span>
            <span className="font-bold text-zinc-200">
              {isVehicleConnected ? formatSpeed(category === 'plane' ? vfr.airspeed : vfr.groundspeed).full : '--'}
            </span>
          </div>
        </div>

        {/* Target Stepper & Commanded Speed */}
        <div
          className={`flex min-w-0 flex-col justify-between gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-2.5 sm:flex-row sm:items-center ${getFeedbackRing('speed')}`}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="shrink-0 rounded-lg bg-emerald-950/40 p-2 text-emerald-400">
              <Gauge className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="whitespace-nowrap text-[10px] font-bold uppercase text-zinc-400">Target Speed</span>
                {manualTargetSpeedMs !== null && (
                  <button
                    type="button"
                    onClick={handleResetToLiveSpeed}
                    title="Reset to follow vehicle speed"
                    className="rounded p-0.5 text-zinc-500 transition-colors hover:text-sky-400"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                )}
              </div>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="font-mono text-xl font-bold text-zinc-100">
                  {currentTargetDisplay} <span className="text-xs font-normal text-zinc-400">{activeUnit}</span>
                </span>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-zinc-700 px-2 font-mono text-xs text-zinc-300 hover:bg-zinc-800"
              onClick={() => handleStepSpeed(-coarseStep)}
              title={`Decrease by ${coarseStep} ${activeUnit}`}
            >
              -{coarseStep}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-zinc-700 px-2 font-mono text-xs text-zinc-300 hover:bg-zinc-800"
              onClick={() => handleStepSpeed(-0.5)}
              title={`Decrease by 0.5 ${activeUnit}`}
            >
              -0.5
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-zinc-700 px-2 font-mono text-xs text-zinc-300 hover:bg-zinc-800"
              onClick={() => handleStepSpeed(0.5)}
              title={`Increase by 0.5 ${activeUnit}`}
            >
              +0.5
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-zinc-700 px-2 font-mono text-xs text-zinc-300 hover:bg-zinc-800"
              onClick={() => handleStepSpeed(coarseStep)}
              title={`Increase by ${coarseStep} ${activeUnit}`}
            >
              +{coarseStep}
            </Button>

            <Button
              variant="default"
              size="sm"
              disabled={!isVehicleConnected || replaying}
              className="ml-0.5 h-8 gap-1 bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700"
              onClick={() => handleSetSpeed()}
            >
              Set Spd
              {getFeedbackBadge('speed')}
            </Button>
          </div>
        </div>

        {/* Quick Presets */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="mr-1 text-[10px] font-bold uppercase text-zinc-500">Presets:</span>
          {presets.map((presetMs) => {
            const presetVal = Number(toActiveUnits(presetMs, system).toFixed(1));
            const isCurrent = Math.abs(currentSpeedMs - presetMs) < 0.2;
            return (
              <button
                key={presetMs}
                type="button"
                onClick={() => setManualTargetSpeedMs(presetMs)}
                className={`rounded border px-2 py-0.5 font-mono text-[11px] font-bold transition-colors ${
                  isCurrent
                    ? 'border-emerald-400 bg-emerald-600 text-white'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
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
