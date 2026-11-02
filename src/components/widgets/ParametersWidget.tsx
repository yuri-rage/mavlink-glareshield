import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTelemetryStore } from '../../store/telemetryStore';
import { mavlinkConnection } from '../../mavlink/connection';
import { paramManager, ParamManagerStatus } from '../../mavlink/paramManager';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Sliders, RefreshCw, Check, Search, Zap, X } from 'lucide-react';

const ROW_HEIGHT = 30;
const VIEWPORT_HEIGHT = 240;
const BUFFER = 8;

export function formatParamValue(val: number): string {
  if (val === undefined || val === null || isNaN(val)) return '-';
  if (Number.isInteger(val)) return val.toString();
  if (Math.abs(val) < 0.0001 && val !== 0) {
    return Number(val.toPrecision(3)).toString();
  }
  return parseFloat(val.toFixed(4)).toString();
}

export const ParametersWidget: React.FC = () => {
  // Use selector so this component ONLY re-renders when parameters change,
  // NOT on 50Hz attitude, GPS, or VFR_HUD telemetry updates.
  const parameters = useTelemetryStore((state) => state.parameters);

  const [search, setSearch] = useState('');
  const [editingParam, setEditingParam] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [savedSuccess, setSavedSuccess] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [paramStatus, setParamStatus] = useState<ParamManagerStatus>({
    isFetching: false,
    method: 'idle',
    paramCount: 0,
  });

  useEffect(() => {
    return paramManager.onStatusChange((st) => setParamStatus(st));
  }, []);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const encoder = mavlinkConnection.getEncoder();

  const handleFetchAll = () => {
    paramManager.fetchParameters();
  };

  const handleStartEdit = (paramId: string, currentVal: number) => {
    setEditingParam(paramId);
    setEditValue(currentVal.toString());
  };

  const handleSaveParam = (paramId: string) => {
    const num = parseFloat(editValue);
    if (!isNaN(num)) {
      const hb = useTelemetryStore.getState().heartbeat;
      const p = parameters[paramId];
      const cmd = encoder.createParamSet(hb.systemId || 1, hb.componentId || 1, paramId, num, p ? p.type : 9);
      mavlinkConnection.send(cmd);

      setSavedSuccess(paramId);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => {
        setSavedSuccess((cur) => (cur === paramId ? null : cur));
      }, 2000);
      setEditingParam(null);
    }
  };

  const paramKeys = useMemo(() => Object.keys(parameters), [parameters]);

  const filteredKeys = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = q ? paramKeys.filter((k) => k.toLowerCase().includes(q)) : [...paramKeys];
    return matched.sort((a, b) => a.localeCompare(b));
  }, [paramKeys, search]);

  const hasAnyDefaults = paramStatus.hasDefaults || Object.values(parameters).some((p) => p.defaultValue !== undefined);

  // Virtual window calculation
  const totalCount = filteredKeys.length;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
  const endIndex = Math.min(totalCount, Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + BUFFER);
  const visibleKeys = useMemo(() => filteredKeys.slice(startIndex, endIndex), [filteredKeys, startIndex, endIndex]);

  const topPadding = startIndex * ROW_HEIGHT;
  const bottomPadding = Math.max(0, (totalCount - endIndex) * ROW_HEIGHT);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    setScrollTop(0);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  };

  return (
    <Card className="border-zinc-800 bg-zinc-950/90 shadow-md flex flex-col h-full min-h-[300px]">
      <CardHeader className="py-2.5 px-4 bg-zinc-900/60 border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
              <Sliders className="h-4 w-4 text-sky-400" />
              ARDUPILOT PARAMETER MANAGER ({paramKeys.length})
            </CardTitle>
            {paramStatus.method === 'ftp' && (
              <Badge variant="info" className="text-[9px] font-mono gap-0.5">
                <Zap className="h-2.5 w-2.5" /> MAVFTP
              </Badge>
            )}
            {paramStatus.method === 'legacy' && (
              <Badge variant="secondary" className="text-[9px] font-mono">
                STREAM
              </Badge>
            )}
          </div>

          <Button
            variant={paramStatus.isFetching ? 'destructive' : 'outline'}
            size="sm"
            onClick={paramStatus.isFetching ? () => paramManager.cancelFetch() : handleFetchAll}
            className={`h-7 px-2.5 text-xs font-bold gap-1 transition-colors ${
              paramStatus.isFetching
                ? 'bg-red-500/10 border-red-500/50 text-red-400 hover:bg-red-500/20 hover:text-red-300'
                : 'text-zinc-300 hover:text-white'
            }`}
            title={paramStatus.isFetching ? 'Cancel parameter fetch' : 'Fetch parameters from vehicle'}
          >
            {paramStatus.isFetching ? (
              <>
                <X className="h-3.5 w-3.5 text-red-400" />
                <span>Cancel</span>
              </>
            ) : (
              <>
                <RefreshCw className="h-3.5 w-3.5 text-sky-400" />
                <span>Fetch Params</span>
              </>
            )}
          </Button>
        </div>
        {paramStatus.message && paramStatus.isFetching && (
          <p className="text-[10px] text-sky-400 font-mono mt-1 animate-pulse">
            {paramStatus.message}
          </p>
        )}
      </CardHeader>

      <CardContent className="p-3 flex-1 flex flex-col space-y-2">
        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-500" />
          <Input
            type="text"
            placeholder="Search parameters (e.g. BATT, WPNAV, RTL)..."
            value={search}
            onChange={handleSearchChange}
            className="h-8 pl-8 text-xs font-mono"
          />
        </div>

        {/* Param List Table (Virtualized) */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 bg-black/60 rounded-xl border border-zinc-850 overflow-y-auto max-h-[240px]"
        >
          {filteredKeys.length === 0 ? (
            <div className="text-zinc-600 text-center py-8 text-xs italic">
              {paramKeys.length === 0
                ? 'No parameters loaded. Click "Fetch Params" to load from flight controller.'
                : 'No matching parameters found.'}
            </div>
          ) : (
            <table className="w-full text-xs font-mono">
              <thead className="bg-zinc-900/90 sticky top-0 border-b border-zinc-800 text-zinc-400 text-left z-10 backdrop-blur-sm">
                <tr>
                  <th className="py-1.5 px-3">Parameter</th>
                  <th className="py-1.5 px-3">Value</th>
                  {hasAnyDefaults && <th className="py-1.5 px-3 text-right">Default</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900">
                {topPadding > 0 && (
                  <tr>
                    <td colSpan={hasAnyDefaults ? 3 : 2} style={{ height: `${topPadding}px` }} />
                  </tr>
                )}
                {visibleKeys.map((key) => {
                  const item = parameters[key];
                  if (!item) return null;
                  const isEditing = editingParam === key;
                  const isSaved = savedSuccess === key;
                  const defVal = item.defaultValue !== undefined ? item.defaultValue : item.value;
                  const isAtDefault = item.defaultValue === undefined || item.defaultValue === item.value;

                  return (
                    <tr key={key} className="h-[30px] hover:bg-zinc-900/40">
                      <td className="py-1 px-3 font-semibold text-zinc-200 truncate max-w-[180px]" title={key}>
                        {key}
                      </td>
                      <td className="py-1 px-3 font-mono">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              step="any"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSaveParam(key);
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  setEditingParam(null);
                                }
                              }}
                              className="h-6 w-24 text-xs font-mono px-1 py-0 bg-black/90 border-sky-500 focus:ring-1 focus:ring-sky-500 text-sky-300"
                              autoFocus
                            />
                            <button
                              onClick={() => handleSaveParam(key)}
                              className="h-5 px-1.5 text-[10px] bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded border border-emerald-500/40 font-sans font-semibold"
                              title="Save parameter"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingParam(null)}
                              className="h-5 px-1 text-[10px] text-zinc-400 hover:text-zinc-200"
                              title="Cancel"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <span
                            onClick={() => handleStartEdit(key, item.value)}
                            className="inline-flex items-center gap-1.5 text-sky-400 hover:text-sky-300 hover:bg-sky-500/10 hover:underline px-1 py-0.5 -mx-1 rounded cursor-pointer transition-colors"
                            title={`Click to edit ${key} (raw: ${item.value})`}
                          >
                            <span>{formatParamValue(item.value)}</span>
                            {isSaved && (
                              <span className="text-emerald-400 text-[10px] inline-flex items-center gap-0.5 animate-pulse font-sans">
                                <Check className="h-2.5 w-2.5" /> Saved
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                      {hasAnyDefaults && (
                        <td
                          className={`py-1 px-3 font-mono text-right truncate max-w-[120px] ${
                            isAtDefault ? 'text-zinc-600' : 'text-zinc-200 font-medium'
                          }`}
                          title={`Default: ${defVal}`}
                        >
                          {formatParamValue(defVal)}
                        </td>
                      )}
                    </tr>
                  );
                })}
                {bottomPadding > 0 && (
                  <tr>
                    <td colSpan={hasAnyDefaults ? 3 : 2} style={{ height: `${bottomPadding}px` }} />
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
