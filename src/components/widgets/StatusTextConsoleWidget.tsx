import React, { useState } from 'react';
import { useMessageSort } from '../../lib/useMessageSort';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useAudioAlertsStore } from '../../lib/audioAlerts';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Terminal, Trash2, Volume2, VolumeX, ArrowUpDown, MessageSquare } from 'lucide-react';

export const StatusTextConsoleWidget: React.FC = () => {
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

  const filtered = filterSeverity === null
    ? statusMessages
    : statusMessages.filter((m) => m.severity <= filterSeverity);

  const { sortOrder, toggleSortOrder, displayed, scrollRef: scrollContainerRef, onScroll: handleScroll } = useMessageSort(
    filtered,
    'glareshield_messages_sort'
  );

  return (
    <Card className="border-zinc-800 bg-zinc-950/90 shadow-md flex flex-col h-full min-h-[380px] sm:min-h-[540px]">
      <CardHeader className="py-1.5 px-3 sm:px-3.5 bg-zinc-900/60 border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
            <Terminal className="h-4 w-4 text-sky-400" />
            MESSAGES
          </CardTitle>

          <div className="flex items-center gap-1 sm:gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleSortOrder}
              className="h-7 px-2 text-xs font-sans font-semibold text-zinc-400 hover:text-zinc-200 gap-1"
              title={`Sort: ${sortOrder === 'newest' ? 'Newest first (click for Oldest)' : 'Oldest first (click for Newest)'}`}
            >
              <ArrowUpDown className="h-3.5 w-3.5 text-sky-400" />
              <span className="hidden sm:inline capitalize">{sortOrder}</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={toggleVoice}
              className={`h-7 px-2 text-xs font-sans font-semibold gap-1 ${
                voiceEnabled ? 'text-emerald-400 hover:text-emerald-300' : 'text-zinc-500 hover:text-zinc-300'
              }`}
              title={voiceEnabled ? 'Spoken voice callouts enabled (click to mute voice)' : 'Spoken voice callouts muted (click to enable)'}
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

      <CardContent className="p-2 sm:p-3 flex-1 flex flex-col">
        {/* Severity quick filters */}
        <div className="flex items-center gap-1.5 mb-2 overflow-x-auto pb-1 text-xs">
          <button
            onClick={() => setFilterSeverity(null)}
            className={`px-2 py-0.5 rounded text-xs font-sans font-semibold transition-colors ${
              filterSeverity === null ? 'bg-zinc-700 text-white font-bold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            All ({statusMessages.length})
          </button>
          <button
            onClick={() => setFilterSeverity(4)}
            className={`px-2 py-0.5 rounded text-xs font-sans font-semibold transition-colors ${
              filterSeverity === 4 ? 'bg-amber-900 text-amber-200 font-bold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Warnings+
          </button>
          <button
            onClick={() => setFilterSeverity(2)}
            className={`px-2 py-0.5 rounded text-xs font-sans font-semibold transition-colors ${
              filterSeverity === 2 ? 'bg-red-900 text-red-200 font-bold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Critical Only
          </button>
        </div>

        {/* Message Log Box */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 bg-black/60 rounded-xl border border-zinc-800 p-1.5 font-mono text-xs overflow-y-auto min-h-[240px] max-h-[68vh] space-y-0.5 select-text"
        >
          {displayed.length === 0 ? (
            <div className="text-zinc-600 text-center py-8 italic">
              No STATUSTEXT messages received yet.
            </div>
          ) : (
            displayed.map((msg) => (
              <div key={msg.id} className="flex items-center gap-1.5 hover:bg-zinc-900/60 py-0.5 px-1.5 rounded transition-colors text-[13px]">
                <span className="text-zinc-500 text-[11px] whitespace-nowrap font-mono">{msg.time}</span>
                <Badge variant={getSeverityBadgeVariant(msg.severity)} className="text-[10px] px-1 py-0 h-4 leading-none">
                  {msg.severityLabel}
                </Badge>
                {msg.count !== undefined && msg.count > 1 && (
                  <Badge
                    variant="outline"
                    className="text-[10px] font-mono px-1 py-0 h-4 leading-none bg-sky-950/70 border-sky-600/40 text-sky-300 font-bold shrink-0 shadow-sm"
                    title={`${msg.count} consecutive identical messages`}
                  >
                    ×{msg.count}
                  </Badge>
                )}
                <span className={`flex-1 break-all ${msg.severity <= 3 ? 'text-red-300 font-bold' : msg.severity === 4 ? 'text-amber-300' : 'text-zinc-200'}`}>
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
