/**
 * Telemetry log recorder: what it writes and to which file, against a simulated link and in-memory storage.
 * Frames held until the vehicle is known; sent frames logged; a reload continuing the log; a disconnect, another
 * vehicle or a reboot starting a new one; logging off; storage full; the size cap.
 *
 * Run: npx tsx tests/tlogRecorder.test.ts
 */
export {};
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};

const { TlogRecorder } = await import('../src/mavlink/tlogRecorder.ts');
const { createMemoryTlogStorage, loadTlogIndex } = await import('../src/lib/tlogStorage.ts');
const { useTlogStore } = await import('../src/store/tlogStore.ts');
const { readTlog } = await import('../src/mavlink/tlog.ts');
const { MavlinkEncoder } = await import('../src/mavlink/encoder.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const enc = new MavlinkEncoder();
const frame = enc.createHeartbeat(); // any valid frame: the recorder logs packet.raw as it is
let clockMs = 1_800_000_000_000;
const deps = (storage: any) => ({ storage, nowUs: () => clockMs * 1000, bootWaitMs: 15, flushMs: 10 });

/** A vehicle heartbeat (type 2 quadrotor, ArduPilot), as the connection hands it over. */
const heartbeat = (sysId = 1, armed = false, type = 2) => {
  const payload = new Uint8Array(9);
  payload[4] = type;
  payload[5] = 3;
  payload[6] = armed ? 128 : 0;
  return { version: 2, sequence: 0, systemId: sysId, componentId: 1, messageId: 0, payload, crc: 0, raw: frame } as any;
};
/** ATTITUDE with time_boot_ms: the vehicle booted `upMs` ago. */
const attitude = (upMs: number, sysId = 1) => {
  const payload = new Uint8Array(28);
  new DataView(payload.buffer).setUint32(0, upMs, true);
  return { version: 2, sequence: 0, systemId: sysId, componentId: 1, messageId: 30, payload, crc: 0, raw: frame } as any;
};
const other = () => ({ ...heartbeat(), messageId: 74, payload: new Uint8Array(4) }) as any;

async function connectAndHear(rec: any, sysId = 1, upMs = 600_000, armed = false) {
  rec.onStatus('connected', false);
  rec.onReceived(other()); // before the heartbeat: held
  rec.onReceived(heartbeat(sysId, armed));
  rec.onReceived(attitude(upMs, sysId));
  await sleep(60);
}
const records = (storage: any, name: string | null) => (name ? readTlog(storage.data.get(name) ?? new Uint8Array()) : []);

const storage = createMemoryTlogStorage();
useTlogStore.setState({ enabled: true, capMb: 2048 });

// 1. First connection: a new log, with what arrived before the heartbeat first; sent frames logged too.
const rec1 = new TlogRecorder(deps(storage));
await connectAndHear(rec1);
const first = useTlogStore.getState().active;
rec1.onSent(new Uint8Array([...enc.createHeartbeat(), ...enc.createParamRequestList(1, 1)]));
await sleep(40);
let rs = records(storage, first);
check('new log once the vehicle is heard', useTlogStore.getState().phase === 'recording' && Boolean(first), String(first));
check('held frames written first, then sent frames, each its own record', rs.length === 5 && rs.every((r) => r.timeUs === clockMs * 1000), `${rs.length} records`);
check('index: vehicle, open', loadTlogIndex()[first!]?.sysId === 1 && loadTlogIndex()[first!]?.closed === false);

// 2. Page reload a minute later, same vehicle, same power-up: a new recorder continues the same file.
clockMs += 60_000;
const before = storage.data.get(first!)!.length;
const rec2 = new TlogRecorder(deps(storage));
await connectAndHear(rec2, 1, 660_000);
check('reload a minute later: same file continued', useTlogStore.getState().active === first && storage.data.get(first!)!.length > before, String(useTlogStore.getState().decision));

// 3. Link dropped and back (not a disconnect): still the same file.
rec2.onStatus('disconnected', false);
await sleep(20);
clockMs += 10_000;
await connectAndHear(rec2, 1, 670_000);
check('dropped link and back: same file', useTlogStore.getState().active === first);

// 4. Deliberate disconnect, then connect again: a new file.
rec2.onStatus('disconnected', true);
await sleep(30);
check('disconnect closes the log', loadTlogIndex()[first!]?.closed === true && useTlogStore.getState().active === null);
clockMs += 5_000;
await connectAndHear(rec2, 1, 675_000);
const second = useTlogStore.getState().active;
check('reconnect after a disconnect: new file', Boolean(second) && second !== first, String(useTlogStore.getState().decision));

// 5. Reload, but the vehicle rebooted meanwhile: new file.
clockMs += 30_000;
const rec3 = new TlogRecorder(deps(storage));
await connectAndHear(rec3, 1, 20_000);
const third = useTlogStore.getState().active;
check('vehicle rebooted: new file', third !== second, String(useTlogStore.getState().decision));

// 6. Reload 20 minutes later while armed (same power-up): continue; disarmed: new.
clockMs += 20 * 60_000;
const upNow = 20_000 + 20 * 60_000 + 1000;
const rec4 = new TlogRecorder(deps(storage));
await connectAndHear(rec4, 1, upNow, true);
check('20 min later, armed, same power-up: continued', useTlogStore.getState().active === third, String(useTlogStore.getState().decision));
rec4.onStatus('disconnected', false);
await sleep(20);

// 7. Logging off: nothing written, the log is closed; on again: recording at the next heartbeat.
useTlogStore.setState({ enabled: false });
rec4.setEnabled(false);
await sleep(20);
const sizes = () => [...storage.data.values()].reduce((t, d) => t + d.length, 0);
const s0 = sizes();
rec4.onStatus('connected', false);
rec4.onReceived(heartbeat());
await sleep(40);
check('logging off: nothing written', sizes() === s0 && useTlogStore.getState().phase === 'idle');
useTlogStore.setState({ enabled: true });
rec4.setEnabled(true);
rec4.onReceived(heartbeat());
rec4.onReceived(attitude(upNow + 100));
await sleep(60);
check('logging on again: recording', useTlogStore.getState().phase === 'recording' && sizes() > s0);

// 8. Size cap: the oldest unkept logs go; kept ones stay.
{
  rec4.setKept(first!, true);
  const names = Object.keys(loadTlogIndex());
  useTlogStore.setState({ capMb: 0.0001 });
  await (rec4 as any).enqueue(() => (rec4 as any).prune());
  const left = Object.keys(loadTlogIndex());
  check('over the cap: oldest unkept deleted, kept and active stay', left.includes(first!) && left.includes(useTlogStore.getState().active!) && left.length < names.length && useTlogStore.getState().overCap,
    `${names.length} → ${left.length}`);
  useTlogStore.setState({ capMb: 2048 });
}

// 10. The link stays up (a bridge) while the vehicle reboots or is swapped: a new log each time; a fast vehicle
// clock or two vehicles on one link don't rotate.
{
  const st = createMemoryTlogStorage();
  const rec = new TlogRecorder(deps(st));
  clockMs += 3_600_000;
  await connectAndHear(rec, 1, 100_000);
  const a = useTlogStore.getState().active;
  // SITL sped up: the vehicle's time since boot runs ahead of the wall clock, so its boot time drifts earlier.
  clockMs += 10_000;
  rec.onReceived(attitude(100_000 + 40_000));
  await sleep(30);
  check('vehicle clock running fast (boot time drifting earlier): same log', useTlogStore.getState().active === a);
  // Two vehicles on one link: both heard, no rotation.
  rec.onReceived(heartbeat(2));
  rec.onReceived(heartbeat(1));
  await sleep(30);
  check('a second vehicle while the first is still heard: same log', useTlogStore.getState().active === a);
  // Reboot with the link up: time since boot starts over.
  await sleep(30);
  const aBefore = records(st, a).length;
  clockMs += 5_000;
  rec.onReceived(attitude(2_000));
  rec.onReceived(heartbeat(1));
  rec.onReceived(attitude(2_100));
  await sleep(60);
  const b = useTlogStore.getState().active;
  check('vehicle rebooted with the link up: old log closed, new one started', Boolean(b) && b !== a && loadTlogIndex()[a!]?.closed === true, `${a} → ${b}`);
  check('after the reboot, every new frame is in the new log, none in the old', records(st, a).length === aBefore && records(st, b).length === 3,
    `old ${aBefore} → ${records(st, a).length}, new ${records(st, b).length}`);
  const bBefore = records(st, b).length;
  // Swap: vehicle 1 goes silent, vehicle 3 appears.
  clockMs += 8_000;
  rec.onReceived(heartbeat(3));
  rec.onReceived(attitude(50_000, 3));
  await sleep(60);
  const c = useTlogStore.getState().active;
  check('vehicle swapped with the link up: new log for the new vehicle', Boolean(c) && c !== b && loadTlogIndex()[c!]?.sysId === 3, String(c));
  check('after the swap, the new vehicle\'s frames are in its log, none in the old', records(st, b).length === bBefore && records(st, c).length === 2,
    `old ${bBefore} → ${records(st, b).length}, new ${records(st, c).length}`);

  // Dropped link, then a different vehicle (the old file is still open when the new one is chosen).
  const cBefore = records(st, c).length;
  rec.onStatus('disconnected', false);
  await sleep(20);
  clockMs += 2_000;
  rec.onStatus('connected', false);
  rec.onReceived(other());
  rec.onReceived(heartbeat(4));
  rec.onReceived(attitude(9_000, 4));
  await sleep(60);
  const d4 = useTlogStore.getState().active;
  check('dropped link, then another vehicle: its frames in its own new log, none in the old', d4 !== c && records(st, c).length === cBefore && records(st, d4).length === 3,
    `old ${cBefore} → ${records(st, c).length}, new ${records(st, d4).length}`);

  // Lowering the cap deletes now.
  const before = Object.keys(loadTlogIndex()).length;
  useTlogStore.setState({ capMb: 0.0001 });
  rec.pruneNow();
  await sleep(30);
  check('lowering the cap prunes at once', Object.keys(loadTlogIndex()).length < before);
  useTlogStore.setState({ capMb: 2048 });

  // Page hide: the index has the time now, without waiting for the worker.
  clockMs += 700;
  (rec as any).chain = new Promise(() => {}); // the worker never answers (the page is going)
  rec.onPageHide();
  check('page hide records the last write time at once', loadTlogIndex()[d4!]?.lastWriteMs === clockMs);

  const logs = useTlogStore.getState().logs;
  check('the UI list holds copies, not the recorder\'s objects', logs.length > 0 && logs.every((l) => (rec as any).index[l.name] !== l));
}

// 9. Storage full: recording stops and says so.
{
  const full = createMemoryTlogStorage({ quotaBytes: 100 });
  const rec = new TlogRecorder(deps(full));
  mem.clear();
  await connectAndHear(rec, 3);
  for (let i = 0; i < 20; i++) rec.onReceived(other());
  await sleep(60);
  const st = useTlogStore.getState();
  check('storage full: stopped, with the reason', st.phase === 'stopped' && /full/.test(st.error ?? ''), st.error ?? st.phase);
}

console.log(failures.length ? `\n${failures.length} tlog recorder check(s) FAILED` : '\nAll tlog recorder checks PASSED');
process.exit(failures.length ? 1 : 0);
