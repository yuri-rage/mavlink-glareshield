import React, { useState } from 'react';
import { useTelemetryStore } from '../../store/telemetryStore';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Terminal, Trash2, Volume2, VolumeX, AlertTriangle, Info } from 'lucide-react';

export const StatusTextConsoleWidget: React.FC = () => {
  const statusMessages = useTelemetryStore((state) => state.statusMessages);
  const clearMessages = useTelemetryStore((state) => state.clearMessages);
  const [filterSeverity, setFilterSeverity] = useState<number | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);

  const getSeverityBadgeVariant = (sev: number) => {
    if (sev <= 2) return 'destructive'; // Emergency, Alert, Critical
    if (sev <= 4) return 'warning'; // Error, Warning
    if (sev <= 5) return 'info'; // Notice
    return 'secondary'; // Info, Debug
  };

  const filtered = filterSeverity === null
    ? statusMessages
    : statusMessages.filter((m) => m.severity <= filterSeverity);

  return (
    <Card className="border-zinc-800 bg-zinc-950/90 shadow-md flex flex-col h-full min-h-[300px]">
      <CardHeader className="py-2.5 px-4 bg-zinc-900/60 border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
            <Terminal className="h-4 w-4 text-sky-400" />
            MAVLINK STATUSTEXT CONSOLE
          </CardTitle>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSoundEnabled(!soundEnabled)}
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
              title="Clear Console"
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
            className={`px-2 py-0.5 rounded text-[11px] font-sans font-semibold transition-colors ${
              filterSeverity === null ? 'bg-zinc-700 text-white font-bold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            All ({statusMessages.length})
          </button>
          <button
            onClick={() => setFilterSeverity(4)}
            className={`px-2 py-0.5 rounded text-[11px] font-sans font-semibold transition-colors ${
              filterSeverity === 4 ? 'bg-amber-900 text-amber-200 font-bold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Warnings+
          </button>
          <button
            onClick={() => setFilterSeverity(2)}
            className={`px-2 py-0.5 rounded text-[11px] font-sans font-semibold transition-colors ${
              filterSeverity === 2 ? 'bg-red-900 text-red-200 font-bold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Critical Only
          </button>
        </div>

        {/* Message Log Box */}
        <div className="flex-1 bg-black/60 rounded-xl border border-zinc-850 p-1.5 font-mono text-xs overflow-y-auto max-h-[260px] space-y-0.5 select-text">
          {filtered.length === 0 ? (
            <div className="text-zinc-600 text-center py-8 italic">
              No STATUSTEXT messages received yet.
            </div>
          ) : (
            filtered.map((msg) => (
              <div key={msg.id} className="flex items-center gap-1.5 hover:bg-zinc-900/60 py-0.5 px-1.5 rounded transition-colors text-[11px]">
                <span className="text-zinc-500 text-[10px] whitespace-nowrap font-mono">{msg.time}</span>
                <Badge variant={getSeverityBadgeVariant(msg.severity)} className="text-[8.5px] px-1 py-0 h-3.5 leading-none">
                  {msg.severityLabel}
                </Badge>
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
