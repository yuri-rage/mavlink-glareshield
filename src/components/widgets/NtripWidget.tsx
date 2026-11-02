import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { rtcmInjector, RtcmInjectorState, NtripConfig, RTCM_TYPE_NAMES } from '../../mavlink/rtcmInjector';
import { useTelemetryStore } from '../../store/telemetryStore';
import {
  Satellite,
  Radio,
  Usb,
  Wifi,
  Play,
  Square,
  AlertCircle,
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

const STORAGE_KEY = 'mavlink_ntrip_config';

export const NtripWidget: React.FC = () => {
  const [injectorState, setInjectorState] = useState<RtcmInjectorState>(() => (rtcmInjector as any).state);
  const [sourceMode, setSourceMode] = useState<'ntrip' | 'serial'>('ntrip');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Settings
  const [ntripConfig, setNtripConfig] = useState<NtripConfig>(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) return JSON.parse(saved);
      }
    } catch {}
    return {
      host: 'rtk2go.com',
      port: 2101,
      mountpoint: 'TEST-BASE',
      username: 'testuser@example.com',
      password: 'none',
      protocol: 'http',
      sendGga: true,
    };
  });

  const [serialBaud, setSerialBaud] = useState<number>(115200);

  // Vehicle GPS Status from store
  const gps = useTelemetryStore((s) => s.gps);
  const baseStationPosition = useTelemetryStore((s) => s.baseStationPosition);

  useEffect(() => {
    return rtcmInjector.onStateChange((st) => {
      setInjectorState(st);
    });
  }, []);

  const saveConfig = (updated: NtripConfig) => {
    setNtripConfig(updated);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      }
    } catch {}
  };

  const handleHostChange = (raw: string) => {
    let text = raw.trim();
    text = text.replace(/^https?:\/\//i, '').replace(/^wss?:\/\//i, '');
    if (text.includes('/')) {
      const slashIdx = text.indexOf('/');
      const hostPart = text.slice(0, slashIdx);
      const mountPart = text.slice(slashIdx + 1);
      let host = hostPart;
      let port = ntripConfig.port;
      if (hostPart.includes(':')) {
        const [h, p] = hostPart.split(':');
        host = h;
        port = parseInt(p, 10) || port;
      }
      saveConfig({ ...ntripConfig, host, port, mountpoint: mountPart });
    } else if (text.includes(':')) {
      const [h, p] = text.split(':');
      saveConfig({ ...ntripConfig, host: h, port: parseInt(p, 10) || ntripConfig.port });
    } else {
      saveConfig({ ...ntripConfig, host: text });
    }
  };

  const handleConnectNtrip = async () => {
    if (!ntripConfig.host || !ntripConfig.mountpoint) {
      alert('Please enter both host and mountpoint for the NTRIP caster.');
      return;
    }
    try {
      await rtcmInjector.connectNtrip(ntripConfig);
    } catch (err: any) {
      console.error('NTRIP connect failed:', err);
    }
  };

  const handleConnectSerial = async () => {
    try {
      await rtcmInjector.connectSerial(serialBaud);
    } catch (err: any) {
      console.error('Serial connect failed:', err);
    }
  };

  const handleDisconnect = async () => {
    await rtcmInjector.disconnect();
  };

  // Determine RTK Fix Status Badge
  const getRtkBadge = () => {
    const fixType = gps.fixType;
    if (fixType === 6) {
      return (
        <Badge variant="outline" className="bg-emerald-950/80 border-emerald-500/80 text-emerald-400 font-mono text-[10px] gap-1 px-2 py-0.5 shadow-sm shadow-emerald-950">
          <CheckCircle2 className="h-3 w-3 text-emerald-400 animate-pulse" />
          RTK Fixed (3D)
        </Badge>
      );
    }
    if (fixType === 5) {
      return (
        <Badge variant="outline" className="bg-amber-950/80 border-amber-500/80 text-amber-400 font-mono text-[10px] gap-1 px-2 py-0.5">
          <Activity className="h-3 w-3 text-amber-400 animate-pulse" />
          RTK Float (3D)
        </Badge>
      );
    }
    if (fixType === 3 || fixType === 4) {
      return (
        <Badge variant="outline" className="bg-sky-950/60 border-sky-600/60 text-sky-400 font-mono text-[10px] px-2 py-0.5">
          3D DGPS / Fix
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-zinc-900 border-zinc-700 text-zinc-400 font-mono text-[10px] px-2 py-0.5">
        No RTK ({gps.fixType ? `Fix ${gps.fixType}` : 'No Fix'})
      </Badge>
    );
  };

  const isConnected = injectorState.status === 'connected' || injectorState.status === 'streaming';
  const isConnecting = injectorState.status === 'connecting';

  return (
    <Card className="flex flex-col h-full bg-zinc-950 border-zinc-800 text-zinc-100 overflow-hidden shadow-lg">
      <CardHeader className="py-2.5 px-3 border-b border-zinc-800 bg-zinc-900/60 flex flex-row items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-950/50 text-emerald-400 border border-emerald-800/40">
            <Radio className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-zinc-200">
              RTK / RTCM3 Injector
            </div>
            <div className="text-[10px] text-zinc-400 font-sans">
              Base Station & NTRIP Injection
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* RTK Fix Status */}
          {getRtkBadge()}

          {/* Connection Status Badge */}
          {injectorState.status === 'streaming' ? (
            <Badge variant="outline" className="bg-emerald-950/80 border-emerald-500 text-emerald-300 font-mono text-[10px] px-2 py-0.5 animate-pulse">
              STREAMING
            </Badge>
          ) : injectorState.status === 'connected' ? (
            <Badge variant="outline" className="bg-emerald-950/50 border-emerald-600 text-emerald-400 font-mono text-[10px] px-2 py-0.5">
              CONNECTED
            </Badge>
          ) : injectorState.status === 'connecting' ? (
            <Badge variant="outline" className="bg-amber-950/50 border-amber-600 text-amber-400 font-mono text-[10px] px-2 py-0.5 animate-pulse">
              CONNECTING
            </Badge>
          ) : injectorState.status === 'error' ? (
            <Badge variant="outline" className="bg-red-950/60 border-red-500 text-red-400 font-mono text-[10px] px-2 py-0.5">
              ERROR
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-zinc-900 border-zinc-800 text-zinc-400 font-mono text-[10px] px-2 py-0.5">
              OFFLINE
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-3 space-y-3 flex-1 overflow-y-auto font-sans text-xs">
        {/* Source Selector: NTRIP Caster vs USB Serial Device */}
        <div className="grid grid-cols-2 gap-1.5 bg-zinc-900/80 border border-zinc-800/80 p-1 rounded-lg">
          <button
            type="button"
            disabled={isConnected || isConnecting}
            onClick={() => setSourceMode('ntrip')}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md font-semibold text-xs transition-colors ${
              sourceMode === 'ntrip'
                ? 'bg-zinc-800 text-sky-400 shadow-sm border border-zinc-700/60'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Wifi className="h-3.5 w-3.5" />
            NTRIP Caster
          </button>
          <button
            type="button"
            disabled={isConnected || isConnecting}
            onClick={() => setSourceMode('serial')}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md font-semibold text-xs transition-colors ${
              sourceMode === 'serial'
                ? 'bg-zinc-800 text-sky-400 shadow-sm border border-zinc-700/60'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Usb className="h-3.5 w-3.5" />
            USB Base Station
          </button>
        </div>

        {/* Source Settings Panel */}
        {sourceMode === 'ntrip' ? (
          <div className="space-y-2 bg-zinc-900/40 border border-zinc-800/60 p-2.5 rounded-lg">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="sm:col-span-2 space-y-1">
                <label className="text-[10px] text-zinc-400 uppercase font-bold">Caster Host / IP</label>
                <input
                  type="text"
                  disabled={isConnected || isConnecting}
                  value={ntripConfig.host}
                  onChange={(e) => handleHostChange(e.target.value)}
                  placeholder="e.g. rtk2go.com or rtk2go.com:2101/TEST-BASE"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1 text-xs font-mono text-zinc-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-zinc-400 uppercase font-bold">Port</label>
                <input
                  type="number"
                  disabled={isConnected || isConnecting}
                  value={ntripConfig.port}
                  onChange={(e) => saveConfig({ ...ntripConfig, port: parseInt(e.target.value, 10) || 2101 })}
                  placeholder="2101"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1 text-xs font-mono text-zinc-100 focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-400 uppercase font-bold">Mountpoint</label>
                <input
                  type="text"
                  disabled={isConnected || isConnecting}
                  value={ntripConfig.mountpoint}
                  onChange={(e) => saveConfig({ ...ntripConfig, mountpoint: e.target.value })}
                  placeholder="e.g. BASE_RTK"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1 text-xs font-mono text-zinc-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-zinc-400 uppercase font-bold">Protocol</label>
                <select
                  disabled={isConnected || isConnecting}
                  value={ntripConfig.protocol || 'http'}
                  onChange={(e) => saveConfig({ ...ntripConfig, protocol: e.target.value as any })}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono text-zinc-100 focus:outline-none focus:border-sky-500"
                >
                  <option value="http">HTTP Streaming (Default)</option>
                  <option value="websocket">WebSocket / Direct Proxy</option>
                </select>
              </div>
            </div>

            {/* Toggle Advanced Auth & VRS GGA */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showAdvanced ? 'Hide Authentication & VRS Settings' : 'Show Authentication & VRS Settings'}
              </button>

              {showAdvanced && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 pt-2 border-t border-zinc-800">
                  <div className="space-y-1">
                    <label className="text-[10px] text-zinc-400 uppercase font-bold">Username</label>
                    <input
                      type="text"
                      disabled={isConnected || isConnecting}
                      value={ntripConfig.username || ''}
                      onChange={(e) => saveConfig({ ...ntripConfig, username: e.target.value })}
                      placeholder="Optional"
                      className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1 text-xs font-mono text-zinc-100 focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-zinc-400 uppercase font-bold">Password</label>
                    <input
                      type="password"
                      disabled={isConnected || isConnecting}
                      value={ntripConfig.password || ''}
                      onChange={(e) => saveConfig({ ...ntripConfig, password: e.target.value })}
                      placeholder="Optional"
                      className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1 text-xs font-mono text-zinc-100 focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div className="sm:col-span-2 flex items-center justify-between pt-1">
                    <span className="text-[11px] text-zinc-300">
                      Send NMEA GGA VRS Feedback (Every 10s)
                    </span>
                    <input
                      type="checkbox"
                      disabled={isConnected || isConnecting}
                      checked={ntripConfig.sendGga !== false}
                      onChange={(e) => saveConfig({ ...ntripConfig, sendGga: e.target.checked })}
                      className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-sky-500 focus:ring-0"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2.5 bg-zinc-900/40 border border-zinc-800/60 p-2.5 rounded-lg">
            <div className="space-y-1">
              <label className="text-[10px] text-zinc-400 uppercase font-bold">Serial Baud Rate</label>
              <select
                disabled={isConnected || isConnecting}
                value={serialBaud}
                onChange={(e) => setSerialBaud(parseInt(e.target.value, 10))}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs font-mono text-zinc-100 focus:outline-none focus:border-sky-500"
              >
                <option value={115200}>115,200 baud (u-blox ZED-F9P Default)</option>
                <option value={230400}>230,400 baud</option>
                <option value={460800}>460,800 baud (High-Speed RTK)</option>
                <option value={921600}>921,600 baud</option>
                <option value={57600}>57,600 baud</option>
                <option value={38400}>38,400 baud</option>
                <option value={9600}>9,600 baud</option>
              </select>
            </div>
            <div className="text-[11px] text-zinc-400">
              Connects directly to an RTK base station connected via USB (e.g. SparkFun RTK Surveyor, Holybro H-RTK, ArduSimple).
            </div>
          </div>
        )}

        {/* Action Button: Connect / Disconnect */}
        <div>
          {isConnected || isConnecting ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDisconnect}
              className="w-full gap-2 font-medium text-xs h-9 border-zinc-700 bg-zinc-900/90 text-zinc-300 hover:bg-zinc-800 hover:text-red-400 hover:border-red-900/60 transition-colors"
            >
              <Square className="h-3.5 w-3.5 fill-current text-zinc-400" />
              Disconnect RTCM Stream
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={sourceMode === 'ntrip' ? handleConnectNtrip : handleConnectSerial}
              className="w-full gap-2 font-bold text-xs h-9 bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-950"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              {sourceMode === 'ntrip' ? 'Connect to NTRIP Caster' : 'Select & Connect USB Base Station'}
            </Button>
          )}
        </div>

        {/* Error message */}
        {injectorState.error && (
          <div className="p-2 rounded bg-red-950/40 border border-red-800/60 text-red-400 text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{injectorState.error}</span>
          </div>
        )}

        {/* Live Stream Telemetry & Performance HUD */}
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-lg p-2.5 space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center justify-between">
            <span>Injection Statistics</span>
            <span className="font-mono text-zinc-500">Msg 233 (GPS_RTCM_DATA)</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-zinc-950/70 border border-zinc-800/60 rounded p-1.5">
              <span className="text-[10px] text-zinc-500 block">Data Rate</span>
              <span className="text-sm font-mono font-bold text-sky-400">
                {(injectorState.dataRateBps / 1024).toFixed(1)} <span className="text-[10px] font-normal text-zinc-500">KB/s</span>
              </span>
            </div>

            <div className="bg-zinc-950/70 border border-zinc-800/60 rounded p-1.5">
              <span className="text-[10px] text-zinc-500 block">Inject Rate</span>
              <span className="text-sm font-mono font-bold text-emerald-400">
                {injectorState.packetRateHz} <span className="text-[10px] font-normal text-zinc-500">Hz</span>
              </span>
            </div>

            <div className="bg-zinc-950/70 border border-zinc-800/60 rounded p-1.5">
              <span className="text-[10px] text-zinc-500 block">Total Injected</span>
              <span className="text-sm font-mono font-bold text-zinc-200">
                {(injectorState.bytesInjected / 1024).toFixed(1)} <span className="text-[10px] font-normal text-zinc-500">KB</span>
              </span>
            </div>

            <div className="bg-zinc-950/70 border border-zinc-800/60 rounded p-1.5">
              <span className="text-[10px] text-zinc-500 block">MAVLink Packets</span>
              <span className="text-sm font-mono font-bold text-zinc-200">
                {injectorState.packetsSent}
              </span>
            </div>
          </div>

          {/* Base Station ARP Location if received from stream */}
          {baseStationPosition && (
            <div className="pt-1.5 border-t border-zinc-800/60 flex items-center justify-between text-[11px] font-mono text-zinc-400">
              <span className="flex items-center gap-1.5 text-blue-400 font-semibold">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-600 text-white font-bold text-[10px]">B</span>
                Base Station ARP
              </span>
              <span className="text-zinc-200">
                {baseStationPosition.lat.toFixed(6)}°, {baseStationPosition.lon.toFixed(6)}°
                {baseStationPosition.alt !== undefined ? ` (${baseStationPosition.alt.toFixed(1)}m)` : ''}
              </span>
            </div>
          )}
        </div>

        {/* Detected RTCM3 Message Types */}
        <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-lg p-2.5 space-y-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            RTCM3 Messages Detected
          </div>

          {Object.keys(injectorState.detectedTypes).length === 0 ? (
            <div className="text-[11px] text-zinc-500 italic py-1">
              No RTCM3 messages received yet. Connect to a stream to inspect frames.
            </div>
          ) : (
            <div className="overflow-hidden rounded border border-zinc-800/70 bg-zinc-950/70">
              <table className="w-full text-left text-[11px] font-mono">
                <thead>
                  <tr className="border-b border-zinc-800/80 bg-zinc-900/50 text-[10px] text-zinc-400 uppercase tracking-wider">
                    <th className="py-1 px-2.5 w-16">Type</th>
                    <th className="py-1 px-2.5 font-sans font-medium text-zinc-400">Description</th>
                    <th className="py-1 px-2.5 text-right w-20">Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/40">
                  {Object.values(injectorState.detectedTypes).map((t) => (
                    <tr key={t.type} className="hover:bg-zinc-900/40 transition-colors">
                      <td className="py-1 px-2.5 font-bold text-sky-400">{t.type}</td>
                      <td className="py-1 px-2.5 font-sans text-zinc-300 truncate max-w-[160px]">{t.name}</td>
                      <td className="py-1 px-2.5 text-right text-zinc-400 font-mono">{t.count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
