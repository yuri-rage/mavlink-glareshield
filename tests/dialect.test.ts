/**
 * The generated dialect (scripts/gen-mavlink-dialect.py, ArduPilot's ardupilotmega.xml): the app's own CRC table
 * agrees with it, the parser accepts messages it has no decoder for, and the generic decoder reads frames packed by
 * pymavlink (truncated payloads, 64-bit values, text, extension fields).
 *
 * Run: npx tsx tests/dialect.test.ts
 */
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { DIALECT_MESSAGES } = await import('../src/mavlink/dialect.generated.ts');
const { MAVLINK_MESSAGE_CRC_EXTRA } = await import('../src/mavlink/messages.ts');
const { MavlinkParser } = await import('../src/mavlink/parser.ts');
const { decodeAny, messageName, payloadLength } = await import('../src/mavlink/dialectDecode.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}
const frame = (hex: string) => new MavlinkParser().parse(Uint8Array.from(Buffer.from(hex, 'hex')))[0];
const field = (fs: any[], n: string) => fs.find((f) => f.name === n);

check('the dialect has ArduPilot\'s messages', Object.keys(DIALECT_MESSAGES).length >= 300 && messageName(178) === 'AHRS2' && messageName(152) === 'MEMINFO');
check('every message is in the parser\'s CRC table, with the dialect\'s CRC', Object.entries(DIALECT_MESSAGES).every(([id, m]) => MAVLINK_MESSAGE_CRC_EXTRA[Number(id)] === m[1]));

const a = frame('fd180000000101b20000cdcccc3dcdcc4cbe0000404000509a448093dc1400afd1c041ef');
check('AHRS2 (no decoder in the app) gets through the parser', a?.messageId === 178);
const af = decodeAny(178, a.payload)!;
check('AHRS2 decoded: floats, degE7 ints, units', Math.abs(field(af, 'roll').value - 0.1) < 1e-6 && field(af, 'lat').value === 350000000 && field(af, 'lat').units === 'degE7' && field(af, 'roll').units === 'rad');
const g = frame('fd34000000010118000040222018240a06008193dc14feaed1c0f46b18007800c80059012823030c586c1800e8030000d00700002c010000409c0000a08c40b6');
const gf = decodeAny(24, g.payload)!;
check('GPS_RAW_INT: 64-bit time exact, extension fields flagged', field(gf, 'time_usec').value === 1700000000123456 && field(gf, 'yaw').value === 36000 && field(gf, 'yaw').ext && !field(gf, 'lat').ext && field(gf, 'alt').units === 'mm');
const s = frame('fd100000000101fd00000648656c6c6f2066726f6d205349544cb2d8');
const sf = decodeAny(253, s.payload)!;
check('STATUSTEXT: char array as text', field(sf, 'text').value === 'Hello from SITL' && field(sf, 'severity').value === 6);
const mi = frame('fd070000000101980000001060ea000001a102');
check('MEMINFO: a v2 payload with trailing zeros trimmed still decodes (zero-padded)', mi.payload.length < payloadLength(152) && field(decodeAny(152, mi.payload)!, 'freemem32').value === 65536, `${mi.payload.length} of ${payloadLength(152)} bytes`);
check('unknown message: null', decodeAny(65000, new Uint8Array()) === null && messageName(65000) === null);

console.log(failures.length ? `\n${failures.length} dialect check(s) FAILED` : '\nAll dialect checks PASSED');
process.exit(failures.length ? 1 : 0);
