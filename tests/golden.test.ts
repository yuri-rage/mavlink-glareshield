/**
 * Golden-vector tests: checks the app's MAVLink layer against pymavlink (the reference implementation).
 *
 *   python3 tests/gen_vectors.py   # (re)generate vectors.json from pymavlink
 *   npx tsx tests/golden.test.ts   # run these checks (exits 1 on any failure)
 *
 * What it checks:
 *   crc     - every entry in MAVLINK_MESSAGE_CRC_EXTRA matches the dialect's crc_extra
 *   decode  - pymavlink-encoded packets parse (CRC valid) and decode to the expected values in app units
 *   encode  - app encoder payload bytes match pymavlink's for the same fields, and the app CRC verifies
 *   ftp     - packFtpMessage / parseFtpPayload agree with pymavlink FILE_TRANSFER_PROTOCOL packets
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Some modules touch localStorage at import time; give Node a no-op one.
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { MavlinkParser, decodePayload, calculateCrc } = await import('../src/mavlink/parser');
const { MavlinkEncoder } = await import('../src/mavlink/encoder');
const { MAVLINK_MESSAGE_CRC_EXTRA } = await import('../src/mavlink/messages');
const { packFtpMessage, parseFtpPayload } = await import('../src/mavlink/ftp');

const here = path.dirname(fileURLToPath(import.meta.url));
const vectorsPath = path.join(here, 'vectors.json');
if (!fs.existsSync(vectorsPath)) {
  console.error(`Missing ${vectorsPath}. Run: python3 tests/gen_vectors.py`);
  process.exit(1);
}
const V = JSON.parse(fs.readFileSync(vectorsPath, 'utf8'));

// ---------------------------------------------------------------------------
let passed = 0;
const failures: string[] = [];
const fromHex = (h: string) => Uint8Array.from(Buffer.from(h, 'hex'));
const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex');

function close(a: number, b: number) {
  return Math.abs(a - b) <= 1e-6 + 1e-6 * Math.abs(b);
}

/** Compare actual vs expected; null in expected matches undefined/null. Returns a list of mismatch descriptions. */
function diff(actual: any, expected: any, where = ''): string[] {
  if (expected === null) return actual == null ? [] : [`${where}: expected none, got ${JSON.stringify(actual)}`];
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${where}: expected array, got ${JSON.stringify(actual)}`];
    if (actual.length !== expected.length)
      return [`${where}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
    return expected.flatMap((e, i) => diff(actual[i], e, `${where}[${i}]`));
  }
  if (typeof expected === 'number') {
    return typeof actual === 'number' && close(actual, expected)
      ? []
      : [`${where}: expected ${expected}, got ${JSON.stringify(actual)}`];
  }
  return actual === expected ? [] : [`${where}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
}

function check(section: string, name: string, problems: string[]) {
  if (problems.length === 0) {
    passed++;
  } else {
    failures.push(`[${section}] ${name}\n      ${problems.join('\n      ')}`);
  }
}

function parseOne(hex: string) {
  const packets = new MavlinkParser().parse(fromHex(hex));
  return packets;
}

// --- crc -------------------------------------------------------------------
for (const [idStr, appExtra] of Object.entries(MAVLINK_MESSAGE_CRC_EXTRA)) {
  const truth = V.crc_extra[idStr];
  const name = V.msg_names[idStr] ?? `msg ${idStr}`;
  check('crc', `${name} (${idStr})`,
    truth === undefined ? [`message id ${idStr} not in ${V.dialect} dialect`]
      : appExtra === truth ? [] : [`app CRC_EXTRA ${appExtra}, pymavlink ${truth}`]);
}

// --- decode ----------------------------------------------------------------
for (const c of V.decode) {
  const packets = parseOne(c.hex);
  if (packets.length !== 1 || packets[0].messageId !== c.msgid) {
    check('decode', c.name, [`parser returned ${packets.length} packet(s) (ids: ${packets.map((p) => p.messageId)}) - CRC or framing rejected`]);
    continue;
  }
  const decoded = decodePayload(packets[0].messageId, packets[0].payload);
  check('decode', c.name, Object.entries(c.expect).flatMap(([k, v]) => diff(decoded[k], v, k)));
}

// --- encode ----------------------------------------------------------------
for (const c of V.encode) {
  const enc = new MavlinkEncoder(255, 190) as any;
  if (typeof enc[c.method] !== 'function') {
    check('encode', c.name, [`MavlinkEncoder.${c.method} does not exist`]);
    continue;
  }
  const pkt: Uint8Array = enc[c.method](...c.args);
  check('encode', c.name, comparePacket(pkt, c.msgid, c.payload, c.crc_extra));
}

/** MAVLink 2 senders may or may not trim trailing zeros, so payloads are compared zero-padded to equal length. */
function comparePacket(pkt: Uint8Array, msgid: number, truthPayloadHex: string, truthCrcExtra: number): string[] {
  const problems: string[] = [];
  if (pkt[0] !== 0xfd) return [`not a MAVLink 2 frame (magic 0x${pkt[0].toString(16)})`];
  const len = pkt[1];
  const id = pkt[7] | (pkt[8] << 8) | (pkt[9] << 16);
  if (id !== msgid) problems.push(`message id ${id}, expected ${msgid}`);
  if (pkt.length !== 10 + len + 2) problems.push(`frame length ${pkt.length} != header length ${len} + 12`);

  const appPayload = pkt.subarray(10, 10 + len);
  const truth = fromHex(truthPayloadHex);
  const n = Math.max(appPayload.length, truth.length);
  const a = new Uint8Array(n); a.set(appPayload);
  const t = new Uint8Array(n); t.set(truth);
  const badBytes: number[] = [];
  for (let i = 0; i < n; i++) if (a[i] !== t[i]) badBytes.push(i);
  if (badBytes.length) {
    problems.push(`payload differs at byte offset(s) ${badBytes.slice(0, 12).join(', ')}${badBytes.length > 12 ? ', ...' : ''}`);
    problems.push(`app:      ${toHex(appPayload)}`);
    problems.push(`pymavlink ${toHex(truth)}`);
  }
  const appCrc = pkt[10 + len] | (pkt[11 + len] << 8);
  const expectedCrc = calculateCrc(pkt, 1, 9 + len, truthCrcExtra);
  if (appCrc !== expectedCrc) problems.push(`CRC 0x${appCrc.toString(16)} does not verify with crc_extra ${truthCrcExtra}`);
  return problems;
}

// --- ftp -------------------------------------------------------------------
for (const c of V.ftp) {
  if (c.kind === 'encode') {
    const [ts, tc, seq, session, opcode, size, offset, data] = c.args;
    const pkt = packFtpMessage(ts, tc, seq, session, opcode, size, offset, Uint8Array.from(data));
    check('ftp', c.name, comparePacket(pkt, 110, c.payload, c.crc_extra));
  } else {
    const packets = parseOne(c.hex);
    if (packets.length !== 1 || packets[0].messageId !== 110) {
      check('ftp', c.name, [`parser returned ${packets.length} packet(s)`]);
      continue;
    }
    const f = parseFtpPayload(packets[0].payload);
    if (!f) {
      check('ftp', c.name, ['parseFtpPayload returned null']);
      continue;
    }
    const actual = { ...f, data: toHex(f.data) };
    check('ftp', c.name, Object.entries(c.expect).flatMap(([k, v]) => diff((actual as any)[k], v, k)));
  }
}

// ---------------------------------------------------------------------------
console.log(`pymavlink golden vectors (${V.generator}, ${V.dialect}): ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
