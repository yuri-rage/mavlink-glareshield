// The Camera widget's protocol side (src/mavlink/camera.ts): the commands it sends, as ArduPilot's AP_Camera reads
// them, and CAMERA_CAPTURE_STATUS decoded from pymavlink's bytes (full, and trimmed of trailing zeros by MAVLink 2).
export {};
const { cameraCommands, cameraTypeName, decodeCaptureStatus, formatElapsed, intervalRunning } =
  await import('../src/mavlink/camera.ts');
const { MavlinkParser } = await import('../src/mavlink/parser.ts');

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// AP_Camera: IMAGE_START_CAPTURE with param3 = 1 is one picture; param2 > 0 with param3 = 0 is an interval until stopped.
const photo = cameraCommands.photo(3);
check(
  'photo: IMAGE_START_CAPTURE, one image, its sequence',
  photo.command === 2000 && eq(photo.params, [0, 0, 1, 3, 0, 0, 0])
);
const every = cameraCommands.startInterval(2.5);
check('interval: every 2.5 s until stopped', every.command === 2000 && eq(every.params, [0, 2.5, 0, 0, 0, 0, 0]));
check('stop interval: IMAGE_STOP_CAPTURE, all cameras', cameraCommands.stopInterval().command === 2001);
// VIDEO_START_CAPTURE param3 / VIDEO_STOP_CAPTURE param2 zero: ArduPilot's legacy selector, the primary camera.
check(
  'video: VIDEO_START / STOP_CAPTURE on the primary camera',
  cameraCommands.startVideo().command === 2500 &&
    eq(cameraCommands.startVideo().params, [0, 0, 0, 0, 0, 0, 0]) &&
    cameraCommands.stopVideo().command === 2501
);
check(
  'zoom: SET_CAMERA_ZOOM continuous, in / stop',
  eq(cameraCommands.zoom(1).params.slice(0, 2), [1, 1]) &&
    eq(cameraCommands.zoom(0).params.slice(0, 2), [1, 0]) &&
    cameraCommands.zoom(-1).command === 531
);
check(
  'legacy photo: DO_DIGICAM_CONTROL param5 = 1',
  cameraCommands.legacyPhoto().command === 203 && cameraCommands.legacyPhoto().params[4] === 1
);

// pymavlink: CAMERA_CAPTURE_STATUS(time_boot_ms=1000, image_status=2, video_status=1, image_interval=2.5,
// recording_time_ms=65000, available_capacity=nan, image_count=7, camera_device_id=1).
const parse = (hex: string) => new MavlinkParser().parse(Uint8Array.from(Buffer.from(hex, 'hex')));
const full = parse('fd170000000101060100e803000000002040e8fd00000000c07f020107000000014081');
check('a pymavlink CAMERA_CAPTURE_STATUS passes the CRC check', full.length === 1 && full[0].messageId === 262);
const s = decodeCaptureStatus(full[0].payload);
check(
  'decoded: interval, recording time, states, count, camera',
  s.intervalS === 2.5 &&
    s.recordingMs === 65000 &&
    s.imageStatus === 2 &&
    s.videoStatus === 1 &&
    s.imageCount === 7 &&
    s.cameraId === 1,
  JSON.stringify(s)
);
check(
  'interval running (image_status 2)',
  intervalRunning(s) && intervalRunning({ ...s, imageStatus: 3 }) && !intervalRunning({ ...s, imageStatus: 1 })
);
// All zeros after time_boot_ms: MAVLink 2 sends 2 bytes of payload.
const trimmed = parse('fd020000000101060100e80329bf');
const t = decodeCaptureStatus(trimmed[0].payload);
check(
  'trimmed payload: idle, no count (no extension)',
  trimmed[0].payload.length === 2 && t.imageStatus === 0 && t.videoStatus === 0 && t.imageCount === -1,
  JSON.stringify(t)
);

check(
  'CAM1_TYPE names',
  cameraTypeName(4) === 'Mount (gimbal camera)' &&
    cameraTypeName(0) === 'None' &&
    cameraTypeName(undefined) === null &&
    cameraTypeName(42) === 'Type 42'
);
check(
  'elapsed',
  formatElapsed(7_400) === '0:07' && formatElapsed(750_000) === '12:30' && formatElapsed(3_723_000) === '1:02:03'
);

console.log(failures.length ? `\n${failures.length} camera check(s) FAILED` : '\nAll camera checks PASSED');
process.exit(failures.length ? 1 : 0);
