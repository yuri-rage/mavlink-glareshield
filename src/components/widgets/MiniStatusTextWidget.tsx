// A compact STATUSTEXT log: one message per line, newest at the top or the bottom. Sized like the control widgets by
// default and growing with the row it sits in (the list never sets the card's height, it fills what the card is given).

import React, { useState } from 'react';
import { useTelemetryStore } from '../../store/telemetryStore';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Terminal, Trash2 } from 'lucide-react';
import { useMessageSort } from '../../lib/useMessageSort';

/** Severity filters, cycled by the header button: show messages at or above this severity (lower is worse). */
const FILTERS = [
  { max: 7, label: 'All' },
  { max: 4, label: 'Warn+' },
  { max: 2, label: 'Crit' },
] as const;

const lineTone = (sev: number) =>
  sev <= 2 ? 'text-red-300 font-bold' : sev === 3 ? 'text-red-300' : sev === 4 ? 'text-amber-300' : sev === 5 ? 'text-sky-200' : 'text-zinc-200';

const sevTone = (sev: number) =>
  sev <= 3 ? 'text-red-400' : sev === 4 ? 'text-amber-400' : sev === 5 ? 'text-sky-400' : 'text-zinc-500';

/** Short severity tags that fit a narrow column. */
const SEV_SHORT = ['EMRG', 'ALRT', 'CRIT', 'ERR', 'WARN', 'NOTE', 'INFO', 'DBG'];

export const MiniStatusTextWidget: React.FC = () => {
  const messages = useTelemetryStore((s) => s.statusMessages);
  const clearMessages = useTelemetryStore((s) => s.clearMessages);
  const [filter, setFilter] = useState(0);
  const { max, label } = FILTERS[filter];
  const filtered = max >= 7 ? messages : messages.filter((m) => m.severity <= max);
  // Its own remembered order, separate from the full console's.
  const { sortOrder, toggleSortOrder, displayed: shown, scrollRef, onScroll } = useMessageSort(filtered, 'glareshield_mini_messages_sort');
  const newestFirst = sortOrder === 'newest';

  return (
    <Card className="h-full flex flex-col border-zinc-800 bg-zinc-950/90 shadow-md">
      <CardHeader className="py-1.5 px-3 sm:px-3.5 bg-zinc-900/60 border-b border-zinc-800">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5 truncate">
            <Terminal className="h-3.5 w-3.5 shrink-0 text-sky-400" />
            <span className="truncate">Messages</span>
          </CardTitle>
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setFilter((f) => (f + 1) % FILTERS.length)}
              className={`h-6 px-1.5 rounded text-[11px] font-semibold font-sans transition-colors ${
                filter === 0 ? 'text-zinc-400 hover:text-zinc-200' : filter === 1 ? 'bg-amber-900/70 text-amber-200' : 'bg-red-900/70 text-red-200'
              }`}
              title="Severity filter (click to change)"
              aria-label={`Severity filter: ${label}`}
            >
              {label} · {shown.length}
            </button>
            <button
              type="button"
              onClick={toggleSortOrder}
              className="h-6 w-6 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-200"
              title={newestFirst ? 'Newest at the top (click for newest at the bottom)' : 'Newest at the bottom (click for newest at the top)'}
              aria-label={newestFirst ? 'Order: newest first' : 'Order: oldest first'}
            >
              {newestFirst ? <ArrowDownWideNarrow className="h-3.5 w-3.5" /> : <ArrowUpNarrowWide className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={clearMessages}
              className="h-6 w-6 flex items-center justify-center rounded text-zinc-500 hover:text-red-400"
              title="Clear messages"
              aria-label="Clear messages"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-2 flex-1 flex flex-col min-h-0">
        {/* Absolutely positioned so the list fills the card instead of sizing it. */}
        <div className="relative flex-1 min-h-[104px]">
          <div ref={scrollRef} onScroll={onScroll} className="absolute inset-0 overflow-y-auto rounded-lg bg-black/50 border border-zinc-800 px-1.5 py-1 font-mono text-xs select-text">
            {shown.length === 0 ? (
              <div className="h-full flex items-center justify-center text-zinc-600 italic text-[11px]">
                {messages.length === 0 ? 'No messages yet' : `No ${label} messages`}
              </div>
            ) : (
              <ul className="space-y-px">
                {shown.map((m) => (
                  <li key={m.id} className="flex items-baseline gap-1.5 leading-snug min-w-0" title={`${m.time} ${m.severityLabel}: ${m.text}`}>
                    <span className="text-[10.5px] text-zinc-500 tabular-nums shrink-0">{m.time}</span>
                    <span className={`text-[10px] font-bold shrink-0 w-8 ${sevTone(m.severity)}`}>{SEV_SHORT[m.severity] ?? m.severityLabel}</span>
                    <span className={`truncate ${lineTone(m.severity)}`}>{m.text}</span>
                    {m.count !== undefined && m.count > 1 && <span className="text-[10.5px] text-sky-400 font-bold shrink-0">×{m.count}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
