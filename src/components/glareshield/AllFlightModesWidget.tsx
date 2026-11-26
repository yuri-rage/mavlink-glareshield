import React, { useEffect, useState } from 'react';

import { Search, Sliders } from 'lucide-react';

import { mavlinkConnection } from '../../mavlink/connection';
import { getAllVehicleFlightModes, getVehicleCategoryLabel } from '../../mavlink/messages';
import { heartbeatLiveMs } from '../../mavlink/replayClock';
import { useReplaying } from '../../store/replayStore';
import { sendTrackedCommand, useTelemetryStore } from '../../store/telemetryStore';
import { Card, CardContent } from '../ui/card';
import { feedbackBadge, feedbackRing } from './commandFeedback';

export const AllFlightModesWidget: React.FC = () => {
  const heartbeat = useTelemetryStore((state) => state.heartbeat);
  const commandFeedback = useTelemetryStore((state) => state.commandFeedback);
  const [filterQuery, setFilterQuery] = useState<string>('');
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const encoder = mavlinkConnection.getEncoder();
  const sysId = heartbeat.systemId || 1;
  const compId = heartbeat.componentId || 1;

  const replaying = useReplaying();
  const isVehicleConnected =
    heartbeat.lastHeartbeatTime > 0 &&
    heartbeat.modeName !== 'DISCONNECTED' &&
    nowMs - heartbeat.lastHeartbeatTime <= heartbeatLiveMs();

  const allModes = getAllVehicleFlightModes(heartbeat.type);
  const filteredModes = filterQuery.trim()
    ? allModes.filter((m) => m.label.toLowerCase().includes(filterQuery.trim().toLowerCase()))
    : allModes;

  const getFeedbackBadge = (key: string) => feedbackBadge(commandFeedback, key, nowMs, 'h-3 w-3');
  const getFeedbackRing = (key: string) => feedbackRing(commandFeedback, key, nowMs);

  const handleSetMode = (modeNum: number, label: string, targetKey: string) => {
    const cmd = encoder.createSetMode(sysId, compId, modeNum);
    void sendTrackedCommand(cmd, {
      label: `Set Mode ${label}`,
      targetKey,
    });
  };

  return (
    <Card className="overflow-hidden border-sky-500/20 bg-zinc-950/90 shadow-xl">
      <CardContent className="space-y-3 p-3 sm:p-4">
        {/* Header: Title, Vehicle Type, Active Mode & Quick Filter */}
        <div className="flex flex-col justify-between gap-2 border-b border-zinc-800/80 pb-2.5 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-center gap-2">
            <Sliders className="h-4 w-4 shrink-0 text-sky-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">Flight Modes</span>
            <span className="rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-[11px] font-semibold text-zinc-400">
              {getVehicleCategoryLabel(heartbeat.type)}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-[11px] font-bold uppercase text-zinc-500">Active:</span>
              <span className="rounded-md border border-sky-500/40 bg-sky-500/20 px-2 py-0.5 font-mono text-xs font-bold text-sky-300">
                {isVehicleConnected ? heartbeat.modeName : 'DISCONNECTED'}
              </span>
            </div>

            <div className="relative">
              <input
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Filter…"
                className="h-7 w-24 rounded-lg border border-zinc-800 bg-zinc-900 pl-6 pr-2 font-mono text-xs text-zinc-200 placeholder-zinc-500 focus:border-sky-500 focus:outline-none sm:w-28"
              />
              <Search className="pointer-events-none absolute left-2 top-2 h-3 w-3 text-zinc-500" />
            </div>
          </div>
        </div>

        {/* Responsive Grid of All Selectable Modes */}
        <div
          className={`grid grid-cols-2 gap-1.5 @sm:grid-cols-3 @md:grid-cols-4 @lg:grid-cols-6 @2xl:grid-cols-8 sm:gap-2 ${
            !isVehicleConnected ? 'opacity-60' : ''
          }`}
        >
          {filteredModes.map(({ label, mode }) => {
            const isActive = isVehicleConnected && heartbeat.customMode === mode;
            const modeKey = `all-mode-${mode}`;
            return (
              <button
                key={mode}
                disabled={!isVehicleConnected || replaying}
                onClick={() => handleSetMode(mode, label, modeKey)}
                className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-center font-sans text-xs font-bold transition-all sm:text-[13px] ${
                  isActive
                    ? 'border-sky-400 bg-sky-500 font-extrabold text-white shadow-md ring-1 ring-sky-300'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed'
                } ${getFeedbackRing(modeKey)}`}
              >
                <span className="truncate leading-tight tracking-normal">{label}</span>
                {getFeedbackBadge(modeKey)}
              </button>
            );
          })}
          {filteredModes.length === 0 && (
            <div className="col-span-full py-4 text-center text-xs italic text-zinc-500">
              No flight modes matching "{filterQuery}"
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
