// MAVLink Inspector: every message on the link, by system and component, with its rate and count; select one for
// its latest fields, decoded from the dialect (ArduPilot's ardupilotmega.xml) with their units. Filter by name or ID,
// pause to read, clear to start over. Collecting runs only while the widget is shown.

import React, { useEffect, useState } from 'react';

import { Pause, Play, Search, Trash2, Waves } from 'lucide-react';

import { InspectorCollector, type InspectorEntry } from '../../lib/mavlinkInspector';
import { cn } from '../../lib/utils';
import { mavlinkConnection } from '../../mavlink/connection';
import { decodeAny, messageName, type DecodedField } from '../../mavlink/dialectDecode';
import { useInPane } from '../dashboard/paneContext';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

export const inspector = new InspectorCollector((fn) => mavlinkConnection.onPacket(fn));

const name = (id: number) => messageName(id) ?? `MSG ${id}`;

function fmtValue(v: DecodedField['value']): string {
  const one = (x: number | string) =>
    typeof x === 'number' && !Number.isInteger(x) ? String(+x.toPrecision(7)) : String(x);
  if (Array.isArray(v)) {
    const shown = v.slice(0, 32).map(one).join(', ');
    return v.length > 32 ? `[${shown}, … ${v.length - 32} more]` : `[${shown}]`;
  }
  return typeof v === 'string' && v === '' ? '""' : one(v);
}

/** Who a component is, for the group headings. */
function componentLabel(compId: number): string {
  if (compId === 1) return 'autopilot';
  if (compId === 154 || (compId >= 171 && compId <= 175)) return 'gimbal';
  if (compId === 100 || (compId >= 101 && compId <= 105)) return 'camera';
  if (compId === 156) return 'ADS-B';
  if (compId === 158) return 'peripheral';
  if (compId === 190) return 'GCS';
  if (compId === 191 || (compId >= 192 && compId <= 194)) return 'companion';
  return `component ${compId}`;
}

export const InspectorWidget: React.FC = () => {
  // In a Cockpit pane: fill it (no minimum heights; lists scroll inside).
  const inPane = useInPane();
  const [, setTick] = useState(0);
  const refresh = () => setTick((n) => n + 1);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  // Read from the shared collector, so every Inspector shows the same state.
  const paused = inspector.paused;

  useEffect(() => {
    const stop = inspector.start();
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return () => {
      stop();
      clearInterval(t);
    };
  }, []);

  const f = filter.trim().toLowerCase();
  const entries = [...inspector.entries.values()].filter(
    (e) => !f || name(e.msgId).toLowerCase().includes(f) || String(e.msgId) === f
  );
  const groups = (() => {
    const m = new Map<string, InspectorEntry[]>();
    for (const e of entries) {
      const k = `${e.sysId}:${e.compId}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    for (const list of m.values()) list.sort((a, b) => name(a.msgId).localeCompare(name(b.msgId)));
    return [...m.entries()].sort((a, b) => {
      const [as, ac] = a[0].split(':').map(Number);
      const [bs, bc] = b[0].split(':').map(Number);
      return as - bs || ac - bc;
    });
  })();
  const total = entries.reduce((s, e) => s + inspector.rate(e), 0);
  const sel = selected ? inspector.entries.get(selected) : undefined;
  const fields = sel ? decodeAny(sel.msgId, sel.lastPayload) : null;

  return (
    <Card className="flex h-full flex-col border-zinc-800 bg-zinc-950/90 shadow-md">
      <CardHeader className="border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5">
        <CardTitle className="flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-wider text-zinc-300">
          <span className="flex items-center gap-1.5">
            <Waves className="h-4 w-4 text-sky-400" />
            MAVLink Inspector
          </span>
          <span className="flex items-center gap-1.5 font-normal normal-case tracking-normal">
            <span className="font-mono text-[10px] text-zinc-500">
              {entries.length} types · {total.toFixed(0)} msg/s
            </span>
            <button
              type="button"
              onClick={() => {
                inspector.setPaused(!inspector.paused);
                refresh();
              }}
              title={paused ? 'Resume' : 'Pause (freeze the values to read them)'}
              className={cn(
                'rounded-md border px-1.5 py-0.5',
                paused ? 'border-amber-500/60 text-amber-300' : 'border-zinc-800 text-zinc-300 hover:bg-zinc-800'
              )}
            >
              {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            </button>
            <button
              type="button"
              onClick={() => {
                inspector.clear();
                setSelected(null);
                refresh();
              }}
              title="Clear counts"
              className="rounded-md border border-zinc-800 px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-800"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-2 p-2 text-xs">
        <label className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2">
          <Search className="h-3 w-3 text-zinc-500" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name or ID"
            className="h-7 min-w-0 flex-1 bg-transparent text-xs text-zinc-200 outline-none"
            aria-label="Filter messages"
          />
        </label>
        <div
          className={`grid min-h-0 flex-1 gap-2 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] ${inPane ? 'grid-rows-2 @2xl:grid-rows-1' : ''}`}
        >
          <div
            className={`${inPane ? 'min-h-0' : 'max-h-[60vh] min-h-[8rem]'} overflow-y-auto rounded-md border border-zinc-800`}
          >
            {groups.length === 0 && (
              <p className="p-2 text-zinc-500">
                {inspector.entries.size > 0
                  ? `No messages match "${filter.trim()}".`
                  : mavlinkConnection.getStatus() === 'connected'
                    ? 'Waiting for messages…'
                    : 'Connect to see the messages on the link.'}
              </p>
            )}
            {groups.map(([k, list]) => {
              const [sys, comp] = k.split(':').map(Number);
              return (
                <div key={k}>
                  <div className="sticky top-0 bg-zinc-900 px-2 py-0.5 font-mono text-[10px] font-bold text-zinc-400">
                    sys {sys} · comp {comp} ({componentLabel(comp)})
                  </div>
                  {list.map((e) => {
                    const r = inspector.rate(e);
                    return (
                      <button
                        key={e.key}
                        type="button"
                        onClick={() => setSelected(e.key === selected ? null : e.key)}
                        className={cn(
                          'flex w-full items-center gap-2 px-2 py-0.5 text-left font-mono text-[11px] hover:bg-zinc-800',
                          e.key === selected && 'bg-sky-950/60 text-sky-200',
                          r === 0 && 'text-zinc-500'
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{name(e.msgId)}</span>
                        <span className="w-10 text-right text-zinc-500">{e.msgId}</span>
                        <span className="w-14 text-right">{r >= 10 ? r.toFixed(0) : r.toFixed(1)} Hz</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <div
            className={`${inPane ? 'min-h-0' : 'max-h-[60vh] min-h-[8rem]'} overflow-y-auto rounded-md border border-zinc-800`}
          >
            {!sel ? (
              <p className="p-2 text-zinc-500">Select a message for its latest fields.</p>
            ) : (
              <div>
                <div className="sticky top-0 flex items-center justify-between gap-2 bg-zinc-900 px-2 py-1 font-mono text-[11px]">
                  <span className="font-bold text-sky-300">{name(sel.msgId)}</span>
                  <span className="text-[10px] text-zinc-500">
                    #{sel.msgId} · {sel.count} · v{sel.version} · {sel.lastPayload.length} B ·{' '}
                    {((inspector.clock() - sel.lastAt) / 1000).toFixed(1)} s ago
                  </span>
                </div>
                {!fields ? (
                  <p className="p-2 font-mono text-[11px] text-zinc-400">
                    Not in the dialect: {Array.from(sel.lastPayload, (b) => b.toString(16).padStart(2, '0')).join(' ')}
                  </p>
                ) : (
                  <table className="w-full font-mono text-[11px]">
                    <tbody>
                      {fields.map((fd) => (
                        <tr key={fd.name} className="border-t border-zinc-900 align-top">
                          <td className="px-2 py-0.5 text-zinc-400" title={fd.type + (fd.ext ? ' (extension)' : '')}>
                            {fd.name}
                            {fd.ext && <span className="text-zinc-600">*</span>}
                          </td>
                          <td className="break-all px-2 py-0.5 text-zinc-100">{fmtValue(fd.value)}</td>
                          <td className="px-2 py-0.5 text-zinc-500">{fd.units}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
