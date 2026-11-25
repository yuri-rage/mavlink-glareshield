/**
 * Telemetry log checks: the record format (and that pymavlink-style readers can walk it), splitting outgoing data
 * into frames, continuing or starting a log after an interruption, and pruning to the size cap.
 *
 * Run: npx tsx tests/tlog.test.ts
 */
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const t = await import('../src/mavlink/tlog.ts');
const { MavlinkEncoder } = await import('../src/mavlink/encoder.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}

const enc = new MavlinkEncoder();
const hb = enc.createHeartbeat();
const req = enc.createParamRequestList(1, 1);

// Format
{
  const ts = Date.UTC(2026, 10, 24, 15, 4, 5) * 1000 + 123;
  const rec = t.encodeTlogRecord(ts, hb);
  check(
    'record: 8-byte big-endian µs timestamp, then the frame',
    rec.length === 8 + hb.length && Number(new DataView(rec.buffer).getBigUint64(0, false)) === ts && rec[8] === hb[0]
  );
  const file = new Uint8Array([...rec, ...t.encodeTlogRecord(ts + 250000, req)]);
  const back = t.readTlog(file);
  check(
    'read back: two records, times and frames intact',
    back.length === 2 &&
      back[1].timeUs === ts + 250000 &&
      back[1].frame.length === req.length &&
      back[0].frame.every((b, i) => b === hb[i])
  );
}

// Outgoing data split into frames
{
  const s = new t.TlogFrameSplitter();
  const two = new Uint8Array([...hb, ...req]);
  const frames = s.split(two);
  check(
    'two frames sent at once become two records',
    frames.length === 2 && frames[0].length === hb.length && frames[1].length === req.length
  );
  check('garbage is dropped', s.split(new Uint8Array([1, 2, 3, 4])).length === 0);
}

// Continue or start a new log
{
  const now = 1_800_000_000_000;
  const last = {
    name: 'a.tlog',
    sysId: 1,
    vehicleType: 2,
    startMs: now - 3_600_000,
    lastWriteMs: now - 60_000,
    bytes: 1e6,
    closed: false,
    kept: false,
    bootEpochMs: now - 7_200_000,
  };
  const here = { timeMs: now, sysId: 1, vehicleType: 2, armed: false, bootEpochMs: now - 7_200_000 + 3000 };
  const d = (l: any, n: any = here) => t.tlogResumeDecision(l, n);
  check('reload a minute later, same vehicle, same power-up: continue', d(last).resume, d(last).reason);
  check('no earlier log: new', !d(null).resume);
  check('the last log was closed (disconnect): new', !d({ ...last, closed: true }).resume);
  check(
    'a different vehicle: new',
    !d(last, { ...here, sysId: 2 }).resume && !d(last, { ...here, vehicleType: 1 }).resume
  );
  check(
    'the vehicle rebooted: new, even a minute later',
    !d(last, { ...here, bootEpochMs: now - 30_000 }).resume,
    d(last, { ...here, bootEpochMs: now - 30_000 }).reason
  );
  const late = { ...last, lastWriteMs: now - 20 * 60_000 };
  check('20 minutes later, disarmed: new', !d(late).resume);
  check('20 minutes later, still armed (same power-up): continue', d(late, { ...here, armed: true }).resume);
  check(
    'boot time unknown: the gap decides',
    d({ ...last, bootEpochMs: undefined }).resume && !d({ ...late, bootEpochMs: undefined }).resume
  );
}

// Pruning to the cap
{
  const MB = 1024 * 1024;
  const logs = [
    { name: 'old', bytes: 600 * MB, kept: false, startMs: 1 },
    { name: 'kept', bytes: 700 * MB, kept: true, startMs: 2 },
    { name: 'mid', bytes: 500 * MB, kept: false, startMs: 3 },
    { name: 'active', bytes: 400 * MB, kept: false, startMs: 4 },
  ];
  check('under the cap: nothing deleted', t.tlogsToPrune(logs, 4096 * MB, 'active').length === 0);
  check(
    'over the cap: oldest first, skipping kept and active',
    t.tlogsToPrune(logs, 1500 * MB, 'active').join() === 'old,mid'
  );
  check('just enough deleted', t.tlogsToPrune(logs, 1700 * MB, 'active').join() === 'old');
  check(
    'kept and active alone over the cap: delete what can be, no more',
    t.tlogsToPrune(logs, 100 * MB, 'active').join() === 'old,mid'
  );
}

check(
  'file name: local time and vehicle, sortable',
  /^\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d_sys7\.tlog$/.test(t.tlogFileName(Date.now(), 7))
);

{
  // After "restore defaults" clears the index, files are still listed: start time and vehicle from the name.
  const { metaFromFile } = await import('../src/lib/tlogStorage.ts');
  const start = new Date(2026, 10, 24, 15, 4, 5).getTime();
  const m = metaFromFile({ name: t.tlogFileName(start, 7), size: 1234, lastModified: start + 60_000 });
  check(
    'file without index entry: listed from its name, closed',
    m.startMs === start && m.sysId === 7 && m.bytes === 1234 && m.closed && !m.kept && m.lastWriteMs === start + 60_000
  );
}

console.log(failures.length ? `\n${failures.length} tlog check(s) FAILED` : '\nAll tlog checks PASSED');
process.exit(failures.length ? 1 : 0);
