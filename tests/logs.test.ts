/**
 * Onboard logs: list-entry to file-number mapping, the LOG_DATA assembler, and the log manager against a fake
 * vehicle (list with a lost entry, MAVFTP when the file matches, LOG_DATA with lost packets when it doesn't,
 * cancel).
 *
 * Run: npx tsx tests/logs.test.ts
 */
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { logFileNumber, logFileName, downloadName, LogAssembler, logManager } = await import('../src/mavlink/logManager.ts');
const { mavlinkConnection } = await import('../src/mavlink/connection.ts');
const { mavFtpClient } = await import('../src/mavlink/ftp.ts');
const { MAVLINK_MSG_ID } = await import('../src/mavlink/messages.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}

// ------------------------------------------------------------------------------------------------
// File names
// ------------------------------------------------------------------------------------------------
check('file number: entries count back from LASTLOG', logFileNumber(1, 3, 9) === 7 && logFileNumber(3, 3, 9) === 9);
check('file number: wraps at LOG_MAX_FILES', logFileNumber(1, 5, 2) === 498 && logFileNumber(1, 5, 2, 100) === 98);
check('file name is 8 digits', logFileName(7) === '00000007.BIN');
check('download name without a time', downloadName({ id: 4, size: 1, timeUtc: 0 }) === 'log_4.bin');
check('download name with the start time', /^log_4_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.bin$/.test(downloadName({ id: 4, size: 1, timeUtc: 1762500000 })));

// ------------------------------------------------------------------------------------------------
// Assembler
// ------------------------------------------------------------------------------------------------
{
  const a = new LogAssembler(250); // blocks at 0, 90, 180 (last one 70 bytes)
  const block = (ofs: number, n = 90) => new Uint8Array(n).fill(ofs / 90 + 1);
  check('assembler: first gap of an empty log is all of it', JSON.stringify(a.firstGap()) === '[0,250]');
  a.add(0, block(0));
  a.add(180, block(180, 70));
  check('assembler: gap between received blocks', JSON.stringify(a.firstGap()) === '[90,90]' && !a.complete);
  check('assembler: a duplicate adds nothing', a.add(0, block(0)) === false && a.received === 160);
  check('assembler: a misaligned offset is ignored', a.add(45, block(0)) === false);
  a.add(90, block(90));
  check('assembler: complete, bytes in place', a.complete && a.firstGap() === null && a.data[0] === 1 && a.data[90] === 2 && a.data[249] === 3);
}

// ------------------------------------------------------------------------------------------------
// Fake vehicle
// ------------------------------------------------------------------------------------------------
const conn = mavlinkConnection as any;
const emit = (messageId: number, payload: Uint8Array) => {
  const packet = { version: 2, sequence: 0, systemId: 1, componentId: 1, messageId, payload, crc: 0, raw: new Uint8Array() };
  conn.packetListeners.forEach((l: (p: unknown) => void) => l(packet));
};
interface FakeLog {
  size: number;
  time: number;
  data: Uint8Array;
}
const logs: FakeLog[] = [120_000, 4_500, 3_000].map((size, i) => ({
  size,
  time: i === 2 ? 0 : 1_762_500_000 + i * 1000,
  data: Uint8Array.from({ length: size }, (_, k) => (k * 7 + i) % 251),
}));
let dropFirstListEntry2 = true;
let dropEvery = 0; // drop every Nth LOG_DATA on the first stream
let dataRequests = 0;
const sent: string[] = [];
let streaming: { cancel: boolean } | null = null;

async function stream(id: number, ofs: number, count: number) {
  if (streaming) streaming.cancel = true;
  const me = { cancel: false };
  streaming = me;
  dataRequests++;
  const log = logs[id - 1];
  const end = Math.min(log.size, ofs + count);
  let n = 0;
  while (ofs < end && !me.cancel) {
    const chunk = log.data.subarray(ofs, Math.min(end, ofs + 90));
    if (!(dataRequests === 1 && dropEvery && n % dropEvery === 3)) {
      const p = new Uint8Array(97);
      const dv = new DataView(p.buffer);
      dv.setUint32(0, ofs, true);
      dv.setUint16(4, id, true);
      p[6] = chunk.length;
      p.set(chunk, 7);
      emit(MAVLINK_MSG_ID.LOG_DATA, p);
    }
    ofs += chunk.length;
    n++;
    if (n % 200 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  if (!me.cancel && end >= log.size) {
    const p = new Uint8Array(97);
    new DataView(p.buffer).setUint32(0, log.size, true);
    new DataView(p.buffer).setUint16(4, id, true);
    emit(MAVLINK_MSG_ID.LOG_DATA, p);
  }
}

conn.status = 'connected';
conn.send = (d: Uint8Array) => {
  const id = d[7] | (d[8] << 8) | (d[9] << 16);
  const pl = d.slice(10, 10 + d[1]);
  const full = new Uint8Array(32);
  full.set(pl);
  const dv = new DataView(full.buffer);
  if (id === MAVLINK_MSG_ID.LOG_REQUEST_LIST) {
    const start = dv.getUint16(0, true);
    const end = dv.getUint16(2, true);
    sent.push(`list ${start}-${end}`);
    setTimeout(() => {
      for (let e = Math.max(1, start); e <= Math.min(end, logs.length); e++) {
        if (e === 2 && dropFirstListEntry2) {
          dropFirstListEntry2 = false;
          continue;
        }
        const p = new Uint8Array(14);
        const v = new DataView(p.buffer);
        v.setUint32(0, logs[e - 1].time, true);
        v.setUint32(4, logs[e - 1].size, true);
        v.setUint16(8, e, true);
        v.setUint16(10, logs.length, true);
        v.setUint16(12, Math.min(end, logs.length), true);
        emit(MAVLINK_MSG_ID.LOG_ENTRY, p);
      }
    }, 5);
  } else if (id === MAVLINK_MSG_ID.LOG_REQUEST_DATA) {
    const ofs = dv.getUint32(0, true);
    const count = dv.getUint32(4, true);
    const logId = dv.getUint16(8, true);
    sent.push(`data ${logId} ${ofs}+${count === 0xffffffff ? 'all' : count}`);
    setTimeout(() => void stream(logId, ofs, count), 1);
  } else if (id === MAVLINK_MSG_ID.LOG_REQUEST_END) {
    sent.push('end');
    if (streaming) streaming.cancel = true;
  }
};

// MAVFTP: files 7, 8, 9 under /APM/LOGS, LASTLOG 9; file 9 (the active log) has grown since it was listed.
const ftpReads: string[] = [];
(mavFtpClient as any).readFile = async (_s: number, _c: number, path: string, _cs: number, _t: number, onProgress?: (r: number, t: number) => void, opts: { expectedSize?: number } = {}) => {
  ftpReads.push(path);
  if (path === '/APM/LOGS/LASTLOG.TXT') return new TextEncoder().encode('9\r\n');
  const m = path.match(/^\/APM\/LOGS\/0000000(\d)\.BIN$/);
  if (!m) return null;
  const log = logs[Number(m[1]) - 7];
  const onDisk = Number(m[1]) === 9 ? log.size + 500 : log.size;
  if (opts.expectedSize !== undefined && opts.expectedSize !== onDisk) return null;
  onProgress?.(log.size, log.size);
  return log.data.slice();
};

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

// List, with one entry lost on the first pass.
const list = await logManager.listLogs(1, 1);
check('list: every entry, the lost one asked for again', list.numLogs === 3 && list.entries.map((e) => e.id).join(',') === '1,2,3' && sent.includes('list 2-2'), sent.join(' | '));
check('list: ends with LOG_REQUEST_END so logging resumes', sent[sent.length - 1] === 'end');

// Entry 1 = file 7, sizes match: MAVFTP.
let lastProgress = { received: 0, total: 0, method: '' };
const r1 = await logManager.download(list.entries[0], list, 1, 1, (p) => (lastProgress = p));
check('download: MAVFTP when the file matches', r1.method === 'mavftp' && same(r1.data, logs[0].data) && ftpReads.includes('/APM/LOGS/00000007.BIN'), ftpReads.join(' '));
check('download: MAVFTP progress reported', lastProgress.method === 'mavftp' && lastProgress.received === logs[0].size);

// Entry 3 = file 9, still growing: MAVFTP refused, LOG_DATA with lost packets.
sent.length = 0;
dropEvery = 7;
dataRequests = 0;
const r3 = await logManager.download(list.entries[2], list, 1, 1, () => {});
check('download: falls back to LOG_DATA when the file size differs', r3.method === 'mavlink');
check('download: lost LOG_DATA packets are asked for again, bytes exact', same(r3.data, logs[2].data) && sent.filter((s) => s.startsWith('data 3')).length > 1, sent.join(' | '));
check('download: LOG_DATA ends with LOG_REQUEST_END', sent[sent.length - 1] === 'end');

// Cancel during a LOG_DATA download.
(mavFtpClient as any).readFile = async () => null; // no MAVFTP on this vehicle
sent.length = 0;
dropEvery = 0;
dataRequests = 0;
const slowLog = logs[0];
const pending = logManager.download({ id: 1, size: slowLog.size, timeUtc: 0 }, list, 1, 1, (p) => {
  if (p.received > 10_000) logManager.cancel();
});
let cancelErr = '';
try {
  await pending;
} catch (e) {
  cancelErr = (e as Error).message;
}
check('cancel: rejects with Cancelled and sends LOG_REQUEST_END', cancelErr === 'Cancelled' && sent.includes('end') && !logManager.busy, `${cancelErr} | ${sent.join(' | ')}`);

// A vehicle that never answers (armed).
conn.send = () => {};
let listErr = '';
try {
  await logManager.listLogs(1, 1);
} catch (e) {
  listErr = (e as Error).message;
}
check('list: no answer gives a plain error', /did not answer/.test(listErr), listErr);

console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join('; ')}` : '\nAll log checks passed');
process.exit(failures.length ? 1 : 0);
