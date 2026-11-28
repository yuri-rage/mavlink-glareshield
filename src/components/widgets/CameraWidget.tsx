// The vehicle's camera (mavlink/camera.ts): take a photo, photos at an interval, record video, zoom. Each button shows
// the vehicle's answer (a camera that can't do it answers FAILED). Reads back the photos taken (CAMERA_FEEDBACK) and
// the capture state (CAMERA_CAPTURE_STATUS, streamed while the widget is shown). Nothing needs a confirmation: a
// camera command doesn't move the vehicle.

import React, { useEffect, useRef, useState } from 'react';

import { Camera, Circle, Square, Timer, ZoomIn, ZoomOut } from 'lucide-react';

import {
  cameraCommands,
  cameraTypeName,
  decodeCaptureStatus,
  formatElapsed,
  intervalRunning,
  MIN_INTERVAL_S,
  type CameraCommand,
  type CaptureStatus,
} from '../../mavlink/camera';
import { mavlinkConnection } from '../../mavlink/connection';
import { MAVLINK_MSG_ID } from '../../mavlink/messages';
import { paramManager } from '../../mavlink/paramManager';
import { decodePacket } from '../../mavlink/parser';
import { messageRateManager } from '../../mavlink/rateManager';
import { heartbeatLiveMs } from '../../mavlink/replayClock';
import { useReplaying } from '../../store/replayStore';
import { sendTrackedCommand, useTelemetryStore } from '../../store/telemetryStore';
import { feedbackBadge, feedbackRing } from '../glareshield/commandFeedback';
import { Card, CardContent } from '../ui/card';

const RATE_ID = 'camera-widget';
/** MAV_RESULT values the widget acts on. */
const ACCEPTED = 0;
const UNSUPPORTED = 3;

export const CameraWidget: React.FC = () => {
  const sysId = useTelemetryStore((s) => s.heartbeat.systemId);
  const compId = useTelemetryStore((s) => s.heartbeat.componentId) || 1;
  const lastHeartbeat = useTelemetryStore((s) => s.heartbeat.lastHeartbeatTime);
  const disconnected = useTelemetryStore((s) => s.heartbeat.modeName === 'DISCONNECTED');
  const camType = useTelemetryStore((s) => s.parameters['CAM1_TYPE']?.value);
  const commandFeedback = useTelemetryStore((s) => s.commandFeedback);
  const replaying = useReplaying();

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [photos, setPhotos] = useState<{ count: number; lastAt: number | null }>({ count: 0, lastAt: null });
  const [recordingSince, setRecordingSince] = useState<number | null>(null);
  const [intervalOn, setIntervalOn] = useState(false);
  const [intervalS, setIntervalS] = useState('2');
  const sequence = useRef(1);
  const zooming = useRef<-1 | 1 | null>(null);

  const linked = lastHeartbeat > 0 && !disconnected && nowMs - lastHeartbeat <= heartbeatLiveMs();
  const canSend = linked && !replaying;

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // A new vehicle or link: nothing carried over.
  useEffect(() => {
    setStatus(null);
    setPhotos({ count: 0, lastAt: null });
    setRecordingSince(null);
    setIntervalOn(false);
  }, [sysId]);

  // The capture state streams while the widget is shown; photos arrive as CAMERA_FEEDBACK (an event, never asked for).
  useEffect(() => {
    messageRateManager.registerRequirement(RATE_ID, MAVLINK_MSG_ID.CAMERA_CAPTURE_STATUS);
    messageRateManager.registerRequirement(RATE_ID, MAVLINK_MSG_ID.CAMERA_FEEDBACK);
    const off = mavlinkConnection.onPacket((p) => {
      if (p.systemId !== useTelemetryStore.getState().heartbeat.systemId) return;
      if (p.messageId === MAVLINK_MSG_ID.CAMERA_CAPTURE_STATUS) {
        const s = decodeCaptureStatus(p.payload);
        setStatus(s);
        if (s.imageCount >= 0) setPhotos((ph) => (s.imageCount > ph.count ? { ...ph, count: s.imageCount } : ph));
        // A camera that reports recording (a gimbal camera's driver): believe it, timed from what it says.
        if (s.videoStatus === 1) setRecordingSince((since) => since ?? Date.now() - s.recordingMs);
      } else if (p.messageId === MAVLINK_MSG_ID.CAMERA_FEEDBACK) {
        const f = decodePacket(p);
        const taken = Math.max(f.completed_captures ?? 0, (f.img_idx ?? 0) + 1);
        setPhotos((ph) => ({ count: Math.max(ph.count + 1, taken), lastAt: Date.now() }));
      }
    });
    return () => {
      off();
      messageRateManager.unregisterRequirement(RATE_ID);
    };
  }, []);

  // The camera's type, read once per vehicle (for the header: which camera, or none set up).
  useEffect(() => {
    if (sysId > 0 && linked && camType === undefined) paramManager.requestParam(sysId, compId, 'CAM1_TYPE');
  }, [sysId, compId, linked, camType]);

  const packet = (cmd: CameraCommand) =>
    mavlinkConnection.getEncoder().createCommandLong(sysId || 1, compId, cmd.command, cmd.params);
  const send = (cmd: CameraCommand, label: string, targetKey: string) =>
    sendTrackedCommand(packet(cmd), { label, targetKey });
  const accepted = (r: number) => r === ACCEPTED;

  const takePhoto = async () => {
    const ack = await send(cameraCommands.photo(sequence.current++), 'Take photo', 'cam-photo');
    // Firmware without IMAGE_START_CAPTURE: the older trigger.
    if (ack.result === UNSUPPORTED) await send(cameraCommands.legacyPhoto(), 'Take photo', 'cam-photo');
  };

  const intervalValue = Number(intervalS);
  const intervalValid = Number.isFinite(intervalValue) && intervalValue >= MIN_INTERVAL_S;
  const intervalActive = intervalOn || intervalRunning(status);
  const toggleInterval = async () => {
    if (intervalActive) {
      const ack = await send(cameraCommands.stopInterval(), 'Stop photo interval', 'cam-interval');
      if (accepted(ack.result)) setIntervalOn(false);
    } else if (intervalValid) {
      const ack = await send(
        cameraCommands.startInterval(intervalValue),
        `Photo every ${intervalValue} s`,
        'cam-interval'
      );
      if (accepted(ack.result)) setIntervalOn(true);
    }
  };

  const recording = recordingSince !== null;
  const toggleVideo = async () => {
    if (recording) {
      const ack = await send(cameraCommands.stopVideo(), 'Stop recording', 'cam-video');
      if (accepted(ack.result)) setRecordingSince(null);
    } else {
      const ack = await send(cameraCommands.startVideo(), 'Start recording', 'cam-video');
      if (accepted(ack.result)) setRecordingSince(Date.now());
    }
  };

  // Zoom while held: in or out on press, stop on release (or when the pointer leaves the button).
  const zoomStart = (direction: -1 | 1) => {
    if (!canSend || zooming.current !== null) return;
    zooming.current = direction;
    void send(cameraCommands.zoom(direction), direction > 0 ? 'Zoom in' : 'Zoom out', 'cam-zoom');
  };
  const zoomStop = () => {
    if (zooming.current === null) return;
    zooming.current = null;
    mavlinkConnection.send(packet(cameraCommands.zoom(0)));
  };

  const badge = (key: string) => feedbackBadge(commandFeedback, key, nowMs, 'h-3.5 w-3.5');
  const ring = (key: string) => feedbackRing(commandFeedback, key, nowMs);
  const typeName = cameraTypeName(camType);
  const noCamera = camType === 0;
  const btn =
    'flex min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <Card className="overflow-hidden border-sky-500/20 bg-zinc-950/90 shadow-xl">
      <CardContent className="space-y-2.5 p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 pb-2">
          <div className="flex min-w-0 items-center gap-2">
            <Camera className="h-4 w-4 shrink-0 text-sky-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">Camera</span>
            {typeName && !noCamera && (
              <span className="truncate font-mono text-[10px] text-zinc-500">({typeName})</span>
            )}
          </div>
          <div
            className="shrink-0 font-mono text-[11px] text-zinc-400"
            title="Photos the camera has taken: since the vehicle started when it reports a count, else since this widget opened"
          >
            {photos.count > 0 ? `${photos.count} photo${photos.count === 1 ? '' : 's'}` : 'No photos yet'}
            {photos.lastAt !== null && (
              <span className="text-zinc-500"> · {formatElapsed(nowMs - photos.lastAt)} ago</span>
            )}
          </div>
        </div>

        {noCamera && (
          <p className="rounded-md border border-amber-500/30 bg-amber-950/30 px-2 py-1 text-[11px] text-amber-200">
            No camera is set up on the vehicle (CAM1_TYPE is 0): commands will be refused.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={`${btn} border-sky-500/40 bg-sky-950/40 text-sky-100 hover:bg-sky-900/60 ${ring('cam-photo')}`}
            disabled={!canSend}
            onClick={() => void takePhoto()}
          >
            <Camera className="h-4 w-4 shrink-0" />
            <span className="truncate">Photo</span>
            {badge('cam-photo')}
          </button>
          <button
            type="button"
            className={`${btn} ${recording ? 'border-red-500/70 bg-red-950/60 text-red-100 hover:bg-red-900/60' : 'border-zinc-700 bg-zinc-900/60 text-zinc-200 hover:bg-zinc-800'} ${ring('cam-video')}`}
            disabled={!canSend}
            onClick={() => void toggleVideo()}
            aria-pressed={recording}
          >
            {recording ? (
              <Square className="h-3.5 w-3.5 shrink-0 fill-current" />
            ) : (
              <Circle className="h-3.5 w-3.5 shrink-0 fill-red-500 text-red-500" />
            )}
            <span className="truncate">
              {recording ? `Stop ${formatElapsed(nowMs - (recordingSince ?? nowMs))}` : 'Record'}
            </span>
            {badge('cam-video')}
          </button>
        </div>

        <div
          className={`flex items-center gap-2 rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-1.5 ${ring('cam-interval')}`}
        >
          <Timer className="ml-1 h-3.5 w-3.5 shrink-0 text-zinc-400" />
          <label className="flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-400">
            <span className="whitespace-nowrap">Every</span>
            <input
              type="number"
              inputMode="decimal"
              min={MIN_INTERVAL_S}
              step={0.5}
              value={intervalS}
              onChange={(e) => setIntervalS(e.target.value)}
              disabled={intervalActive}
              aria-label="Seconds between photos"
              className="h-7 w-14 rounded border border-zinc-700 bg-zinc-950 px-1.5 text-right font-mono text-xs text-zinc-100 disabled:opacity-60"
            />
            <span>s</span>
          </label>
          <button
            type="button"
            className={`${btn} ml-auto py-1 ${intervalActive ? 'border-amber-500/60 bg-amber-950/50 text-amber-100 hover:bg-amber-900/60' : 'border-zinc-700 bg-zinc-900/60 text-zinc-200 hover:bg-zinc-800'}`}
            disabled={!canSend || (!intervalActive && !intervalValid)}
            onClick={() => void toggleInterval()}
            aria-pressed={intervalActive}
            title={intervalValid ? undefined : `At least ${MIN_INTERVAL_S} s`}
          >
            {intervalActive ? 'Stop' : 'Start'}
            {badge('cam-interval')}
          </button>
        </div>

        <div
          className={`flex items-center gap-2 rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-1.5 ${ring('cam-zoom')}`}
        >
          <span className="ml-1 text-[11px] text-zinc-400">Zoom (hold)</span>
          <div className="ml-auto flex items-center gap-1.5">
            {badge('cam-zoom')}
            {([-1, 1] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-label={d > 0 ? 'Zoom in' : 'Zoom out'}
                className={`${btn} touch-none select-none border-zinc-700 bg-zinc-900/60 px-3 py-1 text-zinc-200 hover:bg-zinc-800`}
                disabled={!canSend}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  zoomStart(d);
                }}
                onPointerUp={zoomStop}
                onPointerCancel={zoomStop}
                onLostPointerCapture={zoomStop}
                onKeyDown={(e) => {
                  if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) zoomStart(d);
                }}
                onKeyUp={zoomStop}
                onBlur={zoomStop}
              >
                {d > 0 ? <ZoomIn className="h-4 w-4" /> : <ZoomOut className="h-4 w-4" />}
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
