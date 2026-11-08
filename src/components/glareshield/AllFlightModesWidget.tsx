import { feedbackBadge, feedbackRing } from './commandFeedback';
import React, { useState, useEffect } from 'react';
import { useTelemetryStore, sendTrackedCommand } from '../../store/telemetryStore';
import { mavlinkConnection } from '../../mavlink/connection';
import { Card, CardContent } from '../ui/card';
import {
  getAllVehicleFlightModes,
  getVehicleCategoryLabel,
} from '../../mavlink/messages';
import {
  Sliders,
  Search,
} from 'lucide-react';

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

  const isVehicleConnected =
    heartbeat.lastHeartbeatTime > 0 &&
    heartbeat.modeName !== 'DISCONNECTED' &&
    nowMs - heartbeat.lastHeartbeatTime <= 3500;

  const allModes = getAllVehicleFlightModes(heartbeat.type);
  const filteredModes = filterQuery.trim()
    ? allModes.filter((m) =>
        m.label.toLowerCase().includes(filterQuery.trim().toLowerCase())
      )
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
    <Card className="border-sky-500/20 bg-zinc-950/90 shadow-xl overflow-hidden">
      <CardContent className="p-3 sm:p-4 space-y-3">
        {/* Header: Title, Vehicle Type, Active Mode & Quick Filter */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <Sliders className="h-4 w-4 text-sky-400 shrink-0" />
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">
              Flight Modes
            </span>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 font-mono">
              {getVehicleCategoryLabel(heartbeat.type)}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-zinc-500 text-[11px] uppercase font-bold">Active:</span>
              <span className="px-2 py-0.5 rounded-md text-xs font-mono font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40">
                {isVehicleConnected ? heartbeat.modeName : 'DISCONNECTED'}
              </span>
            </div>

            <div className="relative">
              <input
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Filter…"
                className="w-24 sm:w-28 h-7 pl-6 pr-2 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-sky-500 font-mono"
              />
              <Search className="h-3 w-3 text-zinc-500 absolute left-2 top-2 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Responsive Grid of All Selectable Modes */}
        <div
          className={`grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-1.5 sm:gap-2 ${
            !isVehicleConnected ? 'opacity-60' : ''
          }`}
        >
          {filteredModes.map(({ label, mode }) => {
            const isActive = isVehicleConnected && heartbeat.customMode === mode;
            const modeKey = `all-mode-${mode}`;
            return (
              <button
                key={mode}
                disabled={!isVehicleConnected}
                onClick={() => handleSetMode(mode, label, modeKey)}
                className={`py-2 px-2 rounded-lg border text-xs sm:text-[13px] font-bold font-sans transition-all text-center flex items-center justify-center gap-1.5 ${
                  isActive
                    ? 'bg-sky-500 text-white border-sky-400 shadow-md ring-1 ring-sky-300 font-extrabold'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed'
                } ${getFeedbackRing(modeKey)}`}
              >
                <span className="tracking-normal leading-tight truncate">{label}</span>
                {getFeedbackBadge(modeKey)}
              </button>
            );
          })}
          {filteredModes.length === 0 && (
            <div className="col-span-full py-4 text-center text-xs text-zinc-500 italic">
              No flight modes matching "{filterQuery}"
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
