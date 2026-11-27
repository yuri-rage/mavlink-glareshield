// Settings, in tabs: Link (how to reach the vehicle), Display (units, altitude, theme), Alerts (chimes and voice),
// Traffic & terrain (ADS-B, terrain data), Data (telemetry logs, restore defaults), About (this build, updates, the
// documentation and the source). One control style throughout: a
// segmented choice with the chosen option's meaning beneath it.

import React, { useEffect, useRef, useState } from 'react';

import { AlertTriangle, Check, Copy, ExternalLink, RefreshCw, Share2, Shield, Smartphone } from 'lucide-react';

import { desktopApi, isDesktop, type SerialPortListing } from '../../desktop/api';
import { useAudioAlertsStore, type VoiceEngine } from '../../lib/audioAlerts';
import { DOC_LINKS, REPO_URL, repoFile } from '../../lib/links';
import { maskToken, pairingAppUrl, pairingUrl } from '../../lib/pairing';
import { BUILD, buildLabel, checkForUpdate, useUpdateStore } from '../../lib/updateCheck';
import { getWssHost, isLoopbackWs, mavlinkConnection, SERIAL_BAUD_RATES } from '../../mavlink/connection';
import type { BandwidthProfile } from '../../mavlink/rateManager';
import { getSerialApi, requestSerialDevice } from '../../mavlink/transport';
import { useConnectionStore } from '../../store/connectionStore';
import { useLayoutStore, type ContentWidth } from '../../store/layoutStore';
import { useUnitsStore, type AltitudeMode, type UnitSystem } from '../../store/unitsStore';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Modal } from '../ui/modal';
import { QrCode } from '../ui/QrCode';
import { AdsbSettings } from './AdsbSettings';
import { RestoreDefaults } from './RestoreDefaults';
import { Segmented } from './Segmented';
import { TerrainSettings } from './TerrainSettings';
import { TlogSettings } from './TlogSettings';

export type SettingsTab = 'link' | 'display' | 'alerts' | 'traffic' | 'data' | 'about';
const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'link', label: 'Link' },
  { id: 'display', label: 'Display' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'traffic', label: 'Traffic & terrain' },
  { id: 'data', label: 'Data' },
  { id: 'about', label: 'About' },
];

/** This build (with its commit), an update check, the documentation and the source. */
/** The desktop app's update line in About: its updater's state in words. */
function desktopUpdateText(st: ReturnType<typeof useUpdateStore.getState>['desktop']): string | null {
  switch (st?.kind) {
    case 'checking':
      return 'Checking for a newer version…';
    case 'available':
      return `Glareshield ${st.version} is available: downloading…`;
    case 'downloading':
      return `Downloading the update: ${st.percent}%`;
    case 'ready':
      return `Glareshield ${st.version} is downloaded: use Update in the top bar to restart into it.`;
    case 'none':
      return 'This is the latest version.';
    case 'error':
      return `The update check failed: ${st.message}`;
    case 'unavailable':
      return 'Updates come with the installed app (the AppImage or the Windows installer).';
    default:
      return null;
  }
}

const AboutPanel: React.FC = () => {
  const available = useUpdateStore((s) => s.available);
  const desktopUpdate = useUpdateStore((s) => s.desktop);
  const desk = desktopApi();
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const check = async () => {
    // The desktop app updates itself (electron-updater); its page is bundled, so the web check doesn't apply.
    if (desk) {
      desk.update.check();
      return;
    }
    setChecking(true);
    await checkForUpdate();
    setChecking(false);
    setChecked(true);
  };
  const link = 'inline-flex items-center gap-1 text-sky-300 hover:text-sky-200 hover:underline';
  return (
    <div className="space-y-4" role="tabpanel" aria-label="About">
      <div className="flex items-center gap-3">
        <img src="/logo-64.png" alt="" className="h-10 w-10 shrink-0 object-contain" />
        <div className="min-w-0">
          <div className="text-sm font-bold tracking-tight text-zinc-100">Glareshield</div>
          <div className="text-[11px] text-zinc-400">A web ground control station for ArduPilot</div>
        </div>
      </div>
      <div className="space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-zinc-400">
            {desk && (
              <>
                Desktop app <span className="font-mono text-zinc-200">{desk.version}</span>
                {' · '}
              </>
            )}
            Build <span className="font-mono text-zinc-200">{buildLabel()}</span>
            {BUILD.sha && (
              <>
                {' · '}
                <a href={`${REPO_URL}/commit/${BUILD.sha}`} target="_blank" rel="noreferrer" className={link}>
                  {BUILD.sha.slice(0, 7)}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </>
            )}
          </span>
          {BUILD.id === 'dev' && !desk ? (
            <span className="text-[11px] text-zinc-500">Development server: no update checks</span>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              onClick={check}
              disabled={checking || desktopUpdate?.kind === 'checking' || desktopUpdate?.kind === 'downloading'}
            >
              {checking || desktopUpdate?.kind === 'checking' ? 'Checking…' : 'Check for updates'}
            </Button>
          )}
        </div>
        {desk ? (
          desktopUpdateText(desktopUpdate) && (
            <p
              className={`text-[11px] ${desktopUpdate?.kind === 'error' ? 'text-red-300' : desktopUpdate?.kind === 'none' ? 'text-emerald-300' : 'text-amber-300'}`}
            >
              {desktopUpdateText(desktopUpdate)}
            </p>
          )
        ) : available ? (
          <p className="text-[11px] text-amber-300">
            A newer build ({available}) is available: use <strong>Update</strong> in the navbar to reload into it.
          </p>
        ) : (
          checked && <p className="text-[11px] text-emerald-300">This is the latest build.</p>
        )}
      </div>
      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Documentation</div>
        <ul className="space-y-1 text-xs">
          {DOC_LINKS.map((d) => (
            <li key={d.href} className="flex flex-wrap items-baseline gap-x-2">
              <a href={d.href} target="_blank" rel="noreferrer" className={link}>
                {d.label}
                <ExternalLink className="h-3 w-3" />
              </a>
              <span className="text-[11px] text-zinc-500">{d.hint}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-1 text-xs">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Source</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <a href={REPO_URL} target="_blank" rel="noreferrer" className={link}>
            Repository
            <ExternalLink className="h-3 w-3" />
          </a>
          <a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer" className={link}>
            Report an issue
            <ExternalLink className="h-3 w-3" />
          </a>
          <a href={repoFile('LICENSE')} target="_blank" rel="noreferrer" className={link}>
            License: GPL-3.0
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
};

interface Props {
  open: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
  daylightMode: boolean;
  setDaylightMode: (on: boolean) => void;
}

/**
 * Pair another device with the bridge this one is paired with (its link has a token): the same link the bridge's QR
 * code holds, as a QR code to scan and as text to copy or share. Over wss:// it opens the bridge first (that device's
 * one-time certificate step), which then opens Glareshield there, connected.
 */
const PairAnotherDevice: React.FC<{ url: string }> = ({ url }) => {
  const [copied, setCopied] = useState(false);
  // Hidden until asked for: the QR code and link carry the pairing token (screen sharing, someone looking on).
  const [shown, setShown] = useState(false);
  const link = typeof window !== 'undefined' ? pairingUrl(url, pairingAppUrl(window.location.href)) : null;
  if (!link) return null;
  if (!shown)
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setShown(true)}
        className="gap-1.5 border-emerald-500/40 text-xs text-emerald-300 hover:bg-emerald-950/40"
        title="Show the QR code and link that pair another device with this bridge (they hold its token)"
      >
        <Smartphone className="h-3.5 w-3.5" />
        Pair another device…
      </Button>
    );
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };
  return (
    <div className="space-y-1.5 rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-2.5 text-xs">
      <div className="flex items-center justify-between gap-1.5 font-semibold text-emerald-300">
        <span className="flex items-center gap-1.5">
          <Smartphone className="h-3.5 w-3.5 shrink-0" />
          Pair another device
        </span>
        <button
          type="button"
          onClick={() => setShown(false)}
          className="rounded px-1.5 text-[11px] font-normal text-zinc-400 hover:text-zinc-200"
        >
          Hide
        </button>
      </div>
      <QrCode text={link} title="Pairing QR code for this bridge" className="mx-auto h-44 w-44 rounded-md sm:mx-0" />
      <p className="text-[11px] leading-relaxed text-zinc-300">
        Scan this with the other device&apos;s camera, or open the link on it, to connect it to this bridge. It holds
        the pairing token: show or send it only to yourself.{' '}
        {link.startsWith('https://') && !link.includes('#link=')
          ? 'It opens the bridge first: accept its certificate there, and Glareshield opens, connected.'
          : ''}
      </p>
      <div className="flex items-center gap-1.5">
        <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-[11px]" />
        <Button type="button" variant="outline" size="sm" onClick={copy} className="shrink-0 gap-1" title="Copy">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
        {canShare && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void navigator.share({ title: 'Glareshield bridge', url: link }).catch(() => {})}
            className="shrink-0 gap-1"
            title="Share"
          >
            <Share2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
};

export const SettingsDialog: React.FC<Props> = ({
  open,
  onClose,
  initialTab = 'link',
  daylightMode,
  setDaylightMode,
}) => {
  const {
    url,
    linkKind,
    serialBaud,
    setLinkKind,
    setSerialBaud,
    udpPort,
    tcpTarget,
    setUdpPort,
    setTcpTarget,
    serialPath,
    setSerialPath,
    status,
    errorMessage,
    setUrl,
    gcsSystemId,
    setGcsSystemId,
    connect,
    disconnect,
    bandwidthProfile,
    setBandwidthProfile,
  } = useConnectionStore();
  const { system: unitSystem, setSystem: setUnitSystem, altitudeMode, setAltitudeMode } = useUnitsStore();
  const { contentWidth, setContentWidth } = useLayoutStore();
  const {
    soundEnabled,
    voiceEnabled,
    waypointAnnounceEnabled,
    ttsStatus,
    voiceEngine,
    setVoiceEngine,
    ttsDownloadProgress,
    toggleSound,
    toggleVoice,
    toggleWaypointAnnounce,
  } = useAudioAlertsStore();
  const serialApi = getSerialApi();

  const [tab, setTab] = useState<SettingsTab>(initialTab);
  /** Connect itself was pressed (pointer, or Enter/Space on it), not submitted by Enter in a field. */
  const connectPressedRef = useRef(false);
  // The link form: what's typed, applied by Connect.
  const [inputUrl, setInputUrl] = useState(url);
  const [urlFocused, setUrlFocused] = useState(false);
  const [inputLinkKind, setInputLinkKind] = useState(linkKind);
  const [inputSerialBaud, setInputSerialBaud] = useState(serialBaud);
  // The desktop app's UDP / TCP links (src/desktop/api.ts).
  const desktop = isDesktop();
  const [inputUdpPort, setInputUdpPort] = useState(String(udpPort));
  const [inputTcpTarget, setInputTcpTarget] = useState(tcpTarget);
  // The desktop app lists the serial ports here, as other ground stations do, instead of a picker on Connect.
  const [serialPorts, setSerialPorts] = useState<SerialPortListing[] | null>(null);
  // The chosen port's path (/dev/ttyACM0, COM5); applied by Connect.
  const [serialPortName, setSerialPortName] = useState<string>(serialPath);
  const refreshSerialPorts = () => {
    void desktopApi()
      ?.serial.list()
      .then((ports) => {
        setSerialPorts(ports);
        // Nothing chosen yet, or the chosen port is gone: the first one listed (a USB device before built-in UARTs).
        setSerialPortName((cur) => (ports.some((p) => p.path === cur) ? cur : (ports[0]?.path ?? '')));
      });
  };
  useEffect(() => {
    if (open && desktop && inputLinkKind === 'serial') refreshSerialPorts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, desktop, inputLinkKind]);
  const [serialPickerNotice, setSerialPickerNotice] = useState<string | null>(null);
  // Kept as typed (an empty field stays empty, not 0); checked when the settings are applied.
  const [inputGcsSysId, setInputGcsSysId] = useState(String(gcsSystemId));

  // Each opening starts from the saved settings, on the tab asked for.
  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setInputUrl(url);
    setInputLinkKind(linkKind);
    setInputSerialBaud(serialBaud);
    setInputUdpPort(String(udpPort));
    setInputTcpTarget(tcpTarget);
    setSerialPortName(serialPath);
    setSerialPickerNotice(null);
    setInputGcsSysId(String(gcsSystemId));
    // Only on opening: the form isn't reset while it's being edited.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTab]);

  const sysIdValid = (() => {
    const n = Number(inputGcsSysId);
    return Number.isInteger(n) && n >= 1 && n <= 255;
  })();

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    // Enter in a field connects only on the Link tab: in another tab (a threshold, a clearance) it isn't a Connect.
    // The browser reports such an implicit submit as a click of the Connect button, so a real press of it is marked.
    const pressed = connectPressedRef.current;
    connectPressedRef.current = false;
    if (tab !== 'link' && !pressed) return;
    if (status === 'connected') return;
    if (inputLinkKind === 'serial' && desktop) {
      // The desktop app opens the port chosen in the list itself, by path.
      if (!serialPortName) {
        setSerialPickerNotice('Choose a serial port first (plug the radio or flight controller in, then ⟳).');
        return;
      }
      setSerialPickerNotice(null);
      setSerialPath(serialPortName);
      setSerialBaud(inputSerialBaud);
    } else if (inputLinkKind === 'serial') {
      // The device picker needs the user gesture, so it must be the first thing awaited here.
      const picked = await requestSerialDevice();
      if (!picked) {
        setSerialPickerNotice(
          'No device selected. Choose the telemetry radio or flight controller in the browser prompt.'
        );
        return;
      }
      setSerialPickerNotice(null);
      setSerialBaud(inputSerialBaud);
    }
    if (inputLinkKind === 'udp') setUdpPort(Number(inputUdpPort));
    if (inputLinkKind === 'tcp') setTcpTarget(inputTcpTarget);
    setLinkKind(inputLinkKind);
    setUrl(inputUrl);
    // A whole number 1-255, else the ID stays as it was.
    if (sysIdValid) setGcsSystemId(Number(inputGcsSysId));
    onClose();
    connect();
  };

  const voiceOn = voiceEnabled && soundEnabled;
  const voiceHint =
    voiceOn && voiceEngine === 'browser'
      ? 'Spoken modes and alerts, in the device voice.'
      : voiceOn
        ? ttsStatus === 'downloading'
          ? `Downloading the neural voice (${ttsDownloadProgress}%).`
          : ttsStatus === 'ready'
            ? 'Spoken modes and alerts (neural voice ready).'
            : 'Spoken modes and alerts.'
        : soundEnabled
          ? 'Off.'
          : 'Off (chimes are muted).';

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Settings"
      description="Link, display, alerts, traffic and terrain, and data kept in this browser."
      anchor="top"
    >
      <form onSubmit={handleConnect} className="space-y-4">
        {/* Stuck at the dialog's scroll edge (its 24 px padding), across its full width: nothing scrolls into view above it. */}
        <div
          className="sticky -top-6 z-10 -mx-6 flex flex-wrap gap-1 border-b border-zinc-800 bg-zinc-950 px-6 pb-2 pt-2"
          role="tablist"
          aria-label="Settings sections"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={
                'shrink-0 rounded-md px-2.5 py-1 text-xs transition-colors ' +
                (tab === t.id ? 'bg-zinc-800 font-medium text-zinc-100' : 'text-zinc-400 hover:text-zinc-200')
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'link' && (
          <div className="space-y-4" role="tabpanel" aria-label="Link">
            <Segmented
              label="Link type"
              value={inputLinkKind}
              disabled={status === 'connected'}
              onChange={(k) => {
                setInputLinkKind(k);
                setSerialPickerNotice(null);
              }}
              options={[
                { value: 'websocket', label: 'WebSocket' },
                { value: 'serial', label: serialApi === 'web-usb-serial' ? 'USB (WebUSB)' : 'USB serial' },
                // A browser can't open these; the desktop app can.
                ...(desktop
                  ? [
                      {
                        value: 'udp' as const,
                        label: 'UDP',
                        hint: 'Listens for the vehicle, as Mission Planner does: SITL, a companion computer, or a radio bridge sending to this machine.',
                      },
                      {
                        value: 'tcp' as const,
                        label: 'TCP',
                        hint: 'Connects to the vehicle: SITL, or a serial-to-TCP adapter.',
                      },
                    ]
                  : []),
              ]}
              aside={
                status === 'connected' ? (
                  <span className="text-[10px] text-zinc-500">Disconnect to change</span>
                ) : undefined
              }
            />

            {inputLinkKind === 'serial' &&
              (serialApi === null ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-950/25 p-2.5 text-[11px] leading-relaxed text-amber-200">
                  This browser cannot open USB serial devices. Use Chrome or Edge on a desktop, or Chrome on Android, or
                  connect through the companion bridge over WebSocket.
                </div>
              ) : (
                <div className="space-y-2">
                  {desktop && (
                    <label className="flex items-center justify-between gap-2 text-xs font-medium text-zinc-300">
                      Port
                      <span className="flex min-w-0 items-center gap-1.5">
                        <select
                          value={serialPortName}
                          onChange={(e) => setSerialPortName(e.target.value)}
                          disabled={status === 'connected'}
                          aria-label="Serial port"
                          className="h-8 min-w-0 max-w-[16rem] rounded-md border border-zinc-800 bg-zinc-950 px-2 font-mono text-xs text-zinc-200"
                        >
                          {serialPorts === null && <option value="">Listing…</option>}
                          {serialPorts?.length === 0 && <option value="">No serial ports found</option>}
                          {serialPorts?.map((p) => (
                            <option key={p.path} value={p.path}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={refreshSerialPorts}
                          disabled={status === 'connected'}
                          className="h-8 w-8 shrink-0 p-0"
                          title="List the serial ports again (after plugging a device in)"
                          aria-label="Refresh serial ports"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    </label>
                  )}
                  {serialApi === 'web-serial' && (
                    <label className="flex items-center justify-between gap-2 text-xs font-medium text-zinc-300">
                      Baud rate
                      <select
                        value={inputSerialBaud}
                        onChange={(e) => setInputSerialBaud(Number(e.target.value))}
                        disabled={status === 'connected'}
                        className="h-8 w-32 rounded-md border border-zinc-800 bg-zinc-950 px-2 font-mono text-xs text-zinc-200"
                      >
                        {SERIAL_BAUD_RATES.map((baud) => (
                          <option key={baud} value={baud}>
                            {baud}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <p className="text-[11px] leading-relaxed text-zinc-500">
                    {serialApi === 'web-serial' ? (
                      <>
                        Telemetry radios (SiK) usually run at <code className="text-sky-400">57600</code>; a flight
                        controller&apos;s own USB port ignores the baud rate.{' '}
                        {desktop ? (
                          <>
                            On Linux, opening a port needs the <code>dialout</code> (or <code>uucp</code>) group.
                          </>
                        ) : (
                          <>
                            <strong>Connect</strong> opens the browser&apos;s port picker; reconnects reuse the chosen
                            port.
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        Android has no Web Serial, so the board is opened over WebUSB. This reaches a flight
                        controller&apos;s own USB port (a USB virtual COM port); FTDI and CP210x telemetry radios are
                        not supported this way.
                      </>
                    )}
                  </p>
                  {serialPickerNotice && (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-950/25 p-2 text-[11px] text-amber-200">
                      {serialPickerNotice}
                    </div>
                  )}
                </div>
              ))}

            {inputLinkKind === 'udp' && (
              <label className="flex items-center justify-between gap-2 text-xs font-medium text-zinc-300">
                Listen on UDP port
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={inputUdpPort}
                  onChange={(e) => setInputUdpPort(e.target.value)}
                  disabled={status === 'connected'}
                  className="h-8 w-28 font-mono text-xs"
                />
              </label>
            )}
            {inputLinkKind === 'tcp' && (
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-zinc-300">Vehicle host:port</span>
                <Input
                  type="text"
                  value={inputTcpTarget}
                  onChange={(e) => setInputTcpTarget(e.target.value)}
                  disabled={status === 'connected'}
                  placeholder="127.0.0.1:5760"
                  className="font-mono text-xs"
                />
              </label>
            )}

            {inputLinkKind === 'websocket' && (
              <div className="space-y-2">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-zinc-300">WebSocket URL or host:port</span>
                  {/* The pairing token stays masked until the field is being edited. */}
                  <Input
                    type="text"
                    value={urlFocused ? inputUrl : maskToken(inputUrl)}
                    data-no-autofocus
                    onFocus={() => setUrlFocused(true)}
                    onBlur={() => setUrlFocused(false)}
                    onChange={(e) => setInputUrl(e.target.value)}
                    placeholder="ws://localhost:56781"
                    className="font-mono text-xs"
                  />
                </label>
                <p className="text-[11px] text-zinc-500">
                  The companion bridge listens on <code className="text-sky-400">ws://localhost:56781</code> by default.
                </p>
                {typeof window !== 'undefined' &&
                  window.location.protocol === 'https:' &&
                  inputUrl.trim().startsWith('ws://') &&
                  !isLoopbackWs(inputUrl.trim()) && (
                    <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-950/25 p-2.5 text-xs text-amber-200">
                      <div className="flex items-center gap-1.5 font-semibold text-amber-300">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        HTTPS blocks ws://
                      </div>
                      <p className="text-[11px] leading-relaxed text-zinc-300">
                        This page is served over HTTPS, so the browser blocks unencrypted{' '}
                        <code className="text-amber-300">ws://</code> links to other hosts. Use{' '}
                        <code className="text-emerald-400">wss://</code> (the bridge with{' '}
                        <code className="text-zinc-300">--ssl-cert</code>, or a reverse proxy). In Firefox,{' '}
                        <code className="text-zinc-300">network.websocket.allowInsecureFromHTTPS</code> in about:config
                        allows it.
                      </p>
                    </div>
                  )}
                {(() => {
                  const wssHost = getWssHost(inputUrl);
                  if (!wssHost) return null;
                  return (
                    <div className="space-y-1 rounded-lg border border-sky-500/30 bg-sky-950/25 p-2.5 text-xs text-sky-200">
                      <div className="flex items-center gap-1.5 font-semibold text-sky-300">
                        <Shield className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                        Self-signed certificate
                      </div>
                      <p className="text-[11px] leading-relaxed text-zinc-300">
                        With a self-signed certificate the browser needs a one-time trust step: open{' '}
                        <a
                          href={`https://${wssHost}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 font-mono text-sky-400 hover:underline"
                        >
                          https://{wssHost}
                          <ExternalLink className="inline h-2.5 w-2.5" />
                        </a>{' '}
                        in a new tab, accept the certificate warning, then connect.
                      </p>
                    </div>
                  );
                })()}
              </div>
            )}

            {inputLinkKind === 'websocket' && linkKind === 'websocket' && <PairAnotherDevice url={url} />}

            {errorMessage && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-950/25 p-2.5 text-xs text-red-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                <div className="text-[11px] leading-relaxed">
                  <span className="font-semibold text-red-300">Link error: </span>
                  {errorMessage}
                </div>
              </div>
            )}

            <label className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-zinc-300">GCS system ID</span>
              <Input
                type="number"
                min="1"
                max="255"
                value={inputGcsSysId}
                onChange={(e) => setInputGcsSysId(e.target.value)}
                className="h-8 w-24 font-mono text-xs"
              />
            </label>
            <p className={`-mt-2 text-[11px] ${sysIdValid ? 'text-zinc-500' : 'text-amber-300'}`}>
              {sysIdValid ? (
                <>
                  255 matches ArduPilot&apos;s <code className="text-zinc-300">SYSID_MYGCS</code>; use 254 alongside
                  Mission Planner on 255.
                </>
              ) : (
                `A whole number from 1 to 255; until then the ID stays ${gcsSystemId}.`
              )}
            </p>

            <Segmented<BandwidthProfile>
              label="Telemetry rate"
              value={bandwidthProfile}
              onChange={setBandwidthProfile}
              options={[
                { value: 'low', label: 'Low', hint: 'For a SiK radio at 57.6k: the essentials, at low rates.' },
                { value: 'standard', label: 'Standard', hint: 'For a 115k link.' },
                { value: 'high', label: 'High', hint: 'For a fast link (Wi-Fi, USB): everything, at high rates.' },
              ]}
            />
          </div>
        )}

        {tab === 'display' && (
          <div className="space-y-4" role="tabpanel" aria-label="Display">
            <Segmented<UnitSystem>
              label="Speed and distance"
              value={unitSystem}
              onChange={setUnitSystem}
              options={[
                { value: 'ms', label: 'm/s', hint: 'Metric: m/s, m, km.' },
                { value: 'kmh', label: 'km/h', hint: 'Metric: km/h, m, km.' },
                { value: 'mph', label: 'mph', hint: 'Statute: mph, ft, mi.' },
                { value: 'kts', label: 'kts', hint: 'Nautical: knots, ft, NM.' },
              ]}
            />
            <Segmented<AltitudeMode>
              label="Altitude"
              value={altitudeMode}
              onChange={setAltitudeMode}
              options={[
                { value: 'agl', label: 'AGL', hint: 'Height above home (where the vehicle armed or home was set).' },
                { value: 'msl', label: 'MSL', hint: 'Altitude above mean sea level.' },
              ]}
            />
            <Segmented<ContentWidth>
              label="Content width"
              value={contentWidth}
              onChange={setContentWidth}
              options={[
                {
                  value: 'standard',
                  label: 'Standard',
                  hint: 'Scrolling (Flow) tabs up to 1280 px wide, centered: suits laptops and HD screens. Cockpit tabs always fill the window.',
                },
                {
                  value: 'wide',
                  label: 'Wide',
                  hint: 'Scrolling (Flow) tabs up to 1680 px: more room on large monitors. Cockpit tabs always fill the window.',
                },
                {
                  value: 'full',
                  label: 'Full',
                  hint: 'Scrolling (Flow) tabs across the whole window: for ultrawide and 4K screens.',
                },
              ]}
            />
            <Segmented<boolean>
              label="Theme"
              value={daylightMode}
              onChange={setDaylightMode}
              options={[
                { value: false, label: 'Dark cockpit', hint: 'For night and indoors.' },
                { value: true, label: 'Daylight', hint: 'High contrast, for sunlight.' },
              ]}
            />
          </div>
        )}

        {tab === 'alerts' && (
          <div className="space-y-4" role="tabpanel" aria-label="Alerts">
            <Segmented<boolean>
              label="Alert chimes"
              value={soundEnabled}
              onChange={(on) => on !== soundEnabled && toggleSound()}
              options={[
                { value: true, label: 'On', hint: 'Chimes for arming, warnings and link loss.' },
                { value: false, label: 'Muted', hint: 'No sound at all (voice too).' },
              ]}
            />
            <Segmented<boolean>
              label="Voice callouts"
              value={voiceOn}
              disabled={!soundEnabled}
              onChange={(on) => on !== voiceEnabled && toggleVoice()}
              options={[
                { value: true, label: 'On', hint: voiceHint },
                { value: false, label: 'Off', hint: voiceHint },
              ]}
            />
            <Segmented<VoiceEngine>
              label="Voice"
              value={voiceEngine}
              disabled={!voiceOn}
              onChange={setVoiceEngine}
              options={[
                {
                  value: 'neural',
                  label: 'Neural (~60 MB)',
                  hint: 'A natural voice: downloads a ~60 MB model once and uses 150-250 MB of memory.',
                },
                {
                  value: 'browser',
                  label: 'Device voice',
                  hint: "The browser's own speech: light, but varies by device.",
                },
              ]}
            />
            <Segmented<boolean>
              label="Announce waypoints"
              value={waypointAnnounceEnabled && voiceOn}
              disabled={!voiceOn}
              onChange={(on) => on !== waypointAnnounceEnabled && toggleWaypointAnnounce()}
              options={[
                { value: true, label: 'On', hint: 'Speaks "reached waypoint n" in missions.' },
                { value: false, label: 'Off' },
              ]}
            />
          </div>
        )}

        {tab === 'traffic' && (
          <div className="space-y-5" role="tabpanel" aria-label="Traffic and terrain">
            <AdsbSettings />
            <TerrainSettings />
          </div>
        )}

        {tab === 'about' && <AboutPanel />}

        {tab === 'data' && (
          <div className="space-y-5" role="tabpanel" aria-label="Data">
            <TlogSettings onReplayStarted={onClose} />
            <div className="border-t border-zinc-800 pt-3">
              <RestoreDefaults />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-zinc-800 pt-3">
          {/* Different keys: the same <button> turned into the submit button during the click, and the click then
              submitted the form (connecting again). */}
          {/* Connect / Disconnect belong to the Link tab (the navbar has its own button everywhere else). */}
          {tab !== 'link' ? (
            <span className="w-20" />
          ) : status === 'connected' ? (
            <Button key="disconnect" type="button" variant="destructive" size="sm" onClick={() => disconnect()}>
              Disconnect
            </Button>
          ) : (
            <span className="flex items-center gap-2">
              {/* Trying (a first attempt, or retrying after failures): it can be stopped here, not only replaced. */}
              {mavlinkConnection.willRetry() && (status === 'connecting' || Boolean(errorMessage)) && (
                <Button
                  key="stop"
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => disconnect()}
                  className="border-red-500/50 text-red-300 hover:bg-red-950/40 hover:text-red-200"
                  title="Stop trying to connect"
                >
                  Stop
                </Button>
              )}
              <Button
                key="connect"
                type="submit"
                onPointerDown={() => (connectPressedRef.current = true)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (connectPressedRef.current = true)}
                variant="default"
                size="sm"
                disabled={inputLinkKind === 'serial' && serialApi === null}
                className="bg-sky-500 text-white hover:bg-sky-600"
              >
                Connect
              </Button>
            </span>
          )}
          <span
            className="font-mono text-[10px] text-zinc-500"
            title={BUILD.sha ? `Build ${BUILD.id} (commit ${BUILD.sha})` : `Build ${BUILD.id}`}
          >
            Glareshield {buildLabel()}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </form>
    </Modal>
  );
};
