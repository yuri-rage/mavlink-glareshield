import React, { useState } from 'react';

import { ArrowUpDown, MessageSquare, Terminal, Trash2, Volume2, VolumeX } from 'lucide-react';

import { useAudioAlertsStore } from '../../lib/audioAlerts';
import { useMessageSort } from '../../lib/useMessageSort';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useInPane } from '../dashboard/paneContext';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

export const StatusTextConsoleWidget: React.FC = () => {
  // In a Cockpit pane: fill it (no minimum heights; lists scroll inside).
  const inPane = useInPane();
  const statusMessages = useTelemetryStore((state) => state.statusMessages);
  const clearMessages = useTelemetryStore((state) => state.clearMessages);
  const { soundEnabled, toggleSound, voiceEnabled, toggleVoice } = useAudioAlertsStore();
  const [filterSeverity, setFilterSeverity] = useState<number | null>(null);

  const getSeverityBadgeVariant = (sev: number) => {
    if (sev <= 2) return 'destructive'; // Emergency, Alert, Critical
    if (sev <= 4) return 'warning'; // Error, Warning
    if (sev <= 5) return 'info'; // Notice
    return 'secondary'; // Info, Debug
  };

  const filtered =
    filterSeverity === null ? statusMessages : statusMessages.filter((m) => m.severity <= filterSeverity);

  const {
    sortOrder,
    toggleSortOrder,
    displayed,
    scrollRef: scrollContainerRef,
    onScroll: handleScroll,
  } = useMessageSort(filtered, 'glareshield_messages_sort');

  return (
    <Card
      className={`flex h-full flex-col border-zinc-800 bg-zinc-950/90 shadow-md ${inPane ? 'min-h-0' : 'min-h-[380px] sm:min-h-[540px]'}`}
    >
      <CardHeader className="border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5 sm:px-3.5">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-300">
            <Terminal className="h-4 w-4 text-sky-400" />
            MESSAGES
          </CardTitle>

          <div className="flex items-center gap-1 sm:gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleSortOrder}
              className="h-7 gap-1 px-2 font-sans text-xs font-semibold text-zinc-400 hover:text-zinc-200"
              title={`Sort: ${sortOrder === 'newest' ? 'Newest first (click for Oldest)' : 'Oldest first (click for Newest)'}`}
            >
              <ArrowUpDown className="h-3.5 w-3.5 text-sky-400" />
              <span className="hidden capitalize sm:inline">{sortOrder}</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={toggleVoice}
              className={`h-7 gap-1 px-2 font-sans text-xs font-semibold ${
                voiceEnabled ? 'text-emerald-400 hover:text-emerald-300' : 'text-zinc-500 hover:text-zinc-300'
              }`}
              title={
                voiceEnabled
                  ? 'Spoken voice callouts enabled (click to mute voice)'
                  : 'Spoken voice callouts muted (click to enable)'
              }
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{voiceEnabled ? 'Voice On' : 'Voice Off'}</span>
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSound}
              className="h-7 w-7 text-zinc-400 hover:text-zinc-200"
              title={soundEnabled ? 'Mute alert chime' : 'Enable alert chime'}
            >
              {soundEnabled ? <Volume2 className="h-3.5 w-3.5 text-sky-400" /> : <VolumeX className="h-3.5 w-3.5" />}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={clearMessages}
              className="h-7 w-7 text-zinc-400 hover:text-red-400"
              title="Clear Messages"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col p-2 sm:p-3">
        {/* Severity quick filters */}
        <div className="mb-2 flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          <button
            onClick={() => setFilterSeverity(null)}
            className={`rounded px-2 py-0.5 font-sans text-xs font-semibold transition-colors ${
              filterSeverity === null ? 'bg-zinc-700 font-bold text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            All ({statusMessages.length})
          </button>
          <button
            onClick={() => setFilterSeverity(4)}
            className={`rounded px-2 py-0.5 font-sans text-xs font-semibold transition-colors ${
              filterSeverity === 4 ? 'bg-amber-900 font-bold text-amber-200' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Warnings+
          </button>
          <button
            onClick={() => setFilterSeverity(2)}
            className={`rounded px-2 py-0.5 font-sans text-xs font-semibold transition-colors ${
              filterSeverity === 2 ? 'bg-red-900 font-bold text-red-200' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Critical Only
          </button>
        </div>

        {/* Message Log Box */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className={`flex-1 overflow-y-auto rounded-xl border border-zinc-800 bg-black/60 p-1.5 font-mono text-xs ${inPane ? 'min-h-0' : 'max-h-[68vh] min-h-[240px]'} select-text space-y-0.5`}
        >
          {displayed.length === 0 ? (
            <div className="py-8 text-center italic text-zinc-600">No STATUSTEXT messages received yet.</div>
          ) : (
            displayed.map((msg) => (
              <div
                key={msg.id}
                className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[13px] transition-colors hover:bg-zinc-900/60"
              >
                <span className="whitespace-nowrap font-mono text-[11px] text-zinc-500">{msg.time}</span>
                <Badge
                  variant={getSeverityBadgeVariant(msg.severity)}
                  className="h-4 px-1 py-0 text-[10px] leading-none"
                >
                  {msg.severityLabel}
                </Badge>
                {msg.count !== undefined && msg.count > 1 && (
                  <Badge
                    variant="outline"
                    className="h-4 shrink-0 border-sky-600/40 bg-sky-950/70 px-1 py-0 font-mono text-[10px] font-bold leading-none text-sky-300 shadow-sm"
                    title={`${msg.count} identical messages`}
                  >
                    ×{msg.count}
                  </Badge>
                )}
                <span
                  className={`flex-1 break-all ${msg.severity <= 3 ? 'font-bold text-red-300' : msg.severity === 4 ? 'text-amber-300' : 'text-zinc-200'}`}
                >
                  {msg.text}
                </span>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
};
