// The vehicle's camera, through ArduPilot's camera library (AP_Camera, CAMn_TYPE): the commands the Camera widget sends
// and the status it reads back. ArduPilot takes the commands itself and passes them to the camera's backend (a
// servo or relay trigger, a gimbal camera through its mount driver, a MAVLink camera, RunCam, scripting).
//
// What ArduPilot reports can't say what a camera can do: its CAMERA_INFORMATION advertises image capture only, even
// for gimbal cameras that record video and zoom. So every control is offered, and the command's answer says whether
// the camera did it (FAILED: this backend can't). Likewise CAMERA_CAPTURE_STATUS's video state is real only for some
// backends (a gimbal camera's driver); the base backend always says idle. So "recording" is what the last accepted
// Start or Stop said, or the status when it reports recording.

import { MAV_CMD } from './messages';

export type Params7 = [number, number, number, number, number, number, number];
export interface CameraCommand {
  command: number;
  params: Params7;
}
const cmd = (command: number, p1 = 0, p2 = 0, p3 = 0, p4 = 0, p5 = 0): CameraCommand => ({
  command,
  params: [p1, p2, p3, p4, p5, 0, 0],
});

/** COMMAND_LONG for each camera command; target camera 0: all cameras (the first one, for video). */
export const cameraCommands = {
  /** One photo. param4, the capture sequence number, guards against a retransmitted command taking two. */
  photo: (sequence: number) => cmd(MAV_CMD.IMAGE_START_CAPTURE, 0, 0, 1, sequence),
  /** A photo every `intervalS` seconds until stopped (an interval of 0 would be one photo to ArduPilot). */
  startInterval: (intervalS: number) => cmd(MAV_CMD.IMAGE_START_CAPTURE, 0, intervalS, 0),
  stopInterval: () => cmd(MAV_CMD.IMAGE_STOP_CAPTURE),
  /** Video on stream 0 (ArduPilot: the primary camera), with no status messages asked for (they're streamed). */
  startVideo: () => cmd(MAV_CMD.VIDEO_START_CAPTURE),
  stopVideo: () => cmd(MAV_CMD.VIDEO_STOP_CAPTURE),
  /** Continuous zoom: -1 out, 1 in, 0 stop (ZOOM_TYPE_CONTINUOUS). */
  zoom: (direction: -1 | 0 | 1) => cmd(MAV_CMD.SET_CAMERA_ZOOM, 1, direction),
  /** Older firmware without IMAGE_START_CAPTURE: DO_DIGICAM_CONTROL, param5 = 1 takes a picture. */
  legacyPhoto: () => cmd(MAV_CMD.DO_DIGICAM_CONTROL, 0, 0, 0, 0, 1),
};

/** The shortest interval offered; cameras typically need about 2 s between photos. */
export const MIN_INTERVAL_S = 0.5;

/** CAMn_TYPE, as ArduPilot names it. */
export function cameraTypeName(type: number | undefined): string | null {
  switch (type) {
    case undefined:
      return null;
    case 0:
      return 'None';
    case 1:
      return 'Servo';
    case 2:
      return 'Relay';
    case 3:
      return 'GoPro in Solo Gimbal';
    case 4:
      return 'Mount (gimbal camera)';
    case 5:
      return 'MAVLink';
    case 6:
      return 'MAVLink camera v2';
    case 7:
      return 'Scripting';
    case 8:
      return 'RunCam';
    default:
      return `Type ${type}`;
  }
}

export interface CaptureStatus {
  /** 0 idle, 1 capturing, 2 interval set but idle, 3 interval set and capturing. */
  imageStatus: number;
  /** 0 idle, 1 recording (only some backends report it). */
  videoStatus: number;
  intervalS: number;
  recordingMs: number;
  /** Photos taken (extension field; -1 when absent). */
  imageCount: number;
  /** 1-based camera instance (extension field; 0 when absent). */
  cameraId: number;
}

/**
 * CAMERA_CAPTURE_STATUS (262), from its wire order: time_boot_ms u32 @0, image_interval f32 @4, recording_time_ms
 * u32 @8, available_capacity f32 @12, image_status u8 @16, video_status u8 @17, then the extensions image_count
 * i32 @18 and camera_device_id u8 @22. MAVLink 2 trims trailing zero bytes, so it's read zero-padded.
 */
export function decodeCaptureStatus(payload: Uint8Array): CaptureStatus {
  const buf = new Uint8Array(23);
  buf.set(payload.subarray(0, 23));
  const v = new DataView(buf.buffer);
  return {
    intervalS: v.getFloat32(4, true),
    recordingMs: v.getUint32(8, true),
    imageStatus: v.getUint8(16),
    videoStatus: v.getUint8(17),
    imageCount: payload.length > 18 ? v.getInt32(18, true) : -1,
    cameraId: v.getUint8(22),
  };
}

/** Whether a photo interval is running, from the status (image_status 2 or 3). */
export const intervalRunning = (s: CaptureStatus | null) => s !== null && (s.imageStatus & 2) !== 0;

/** "0:07", "12:30", "1:02:03": a recording's length. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
