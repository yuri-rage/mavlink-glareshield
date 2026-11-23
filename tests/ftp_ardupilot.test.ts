/**
 * MAVFTP client vs. a simulated ArduPilot vehicle.
 *
 * The simulator follows ArduPilot's own source rather than an idealised echo server, because the
 * differences are exactly where real-vehicle bugs hide:
 *
 *   libraries/GCS_MAVLink/GCS_FTP.cpp
 *     - setup_reply():        reply.seq_number = request.seq_number + 1
 *     - burst read:           every packet in a burst increments seq again
 *     - resend cache:         a request whose seq + 1 equals the last reply's seq gets that reply again
 *                             (this is how a retry with the SAME seq recovers a lost ACK)
 *     - one fd per session:   CreateFile / OpenFileRO while a file is open -> NAK Fail
 *     - TerminateSession on an already-closed session -> ACK
 *     - open of a missing file -> NAK FailErrno, errno ENOENT
 *     - ResetSessions closes the open file whatever its session
 *
 *   libraries/AP_Filesystem/AP_Filesystem_Mission.cpp + AP_Mission::get_item()
 *     - reading @MISSION/mission.dat regenerates it from storage: seq = index, current = 0,
 *       autocontinue = 1, altitude round-tripped through integer centimetres.
 *       So a correct upload does NOT read back byte-identical.
 *
 * Run: npx tsx tests/ftp_ardupilot.test.ts
 */
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { mavlinkConnection } = await import('../src/mavlink/connection.ts');
const { mavFtpClient, parseFtpPayload, FTP_OPCODE } = await import('../src/mavlink/ftp.ts');
const { MavlinkParser } = await import('../src/mavlink/parser.ts');
const { packDatFile } = await import('../src/mavlink/missionFileParser.ts');

const ACK = 128, NAK = 129;
const ERR_FAIL = 1, ERR_FAIL_ERRNO = 2, ERR_EOF = 6, ERR_INVALID_SESSION = 4, ENOENT = 2;
const TIMEOUT_MS = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------------------------------------
// Simulated vehicle
// ------------------------------------------------------------------------------------------------
interface SimOptions {
  loss?: number;                                       // probability each request and each reply is lost
  seed?: number;
  dropReply?: (req: Req, nth: number) => boolean;      // deterministic reply loss (nth = how many times this opcode was answered)
  delayReply?: (req: Req) => number;                   // extra latency for a reply, ms
  nakWrite?: (req: Req) => boolean;                    // vehicle rejects this WriteFile
  files?: Record<string, Uint8Array>;                  // pre-existing readable files
  noRally?: boolean;                                   // a vehicle without rally points: rally.dat refused, rally
                                                       // MISSION_REQUEST_LIST / MISSION_COUNT answered MAV_MISSION_UNSUPPORTED
}
interface Req { seq: number; session: number; opcode: number; size: number; offset: number; data: Uint8Array }

class ArduPilotFtpSim {
  committed: Record<string, Uint8Array> = {};
  fd: null | { mode: 'r' | 'w'; path: string; buf: Uint8Array; len: number } = null;
  requests: string[] = [];
  private lastReply: { seq: number; session: number; bytes: Uint8Array } | null = null;
  private answered: Record<number, number> = {};
  private rng: () => number;
  private parser = new MavlinkParser();

  constructor(private o: SimOptions = {}) {
    let s = o.seed ?? 1;
    this.rng = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    Object.assign(this.committed, o.files ?? {});
  }

  install() {
    (mavlinkConnection as any).status = 'connected';
    (mavlinkConnection as any).send = (bytes: Uint8Array) => { this.onRequest(bytes); return true; };
  }

  private lost() { return (this.o.loss ?? 0) > 0 && this.rng() < (this.o.loss ?? 0); }

  private emit(bytes: Uint8Array, delay = 2) {
    if (this.lost()) return;
    const pkt = { version: 2, sequence: 0, systemId: 1, componentId: 1, messageId: 110, payload: bytes, crc: 0, raw: bytes };
    setTimeout(() => { for (const l of (mavlinkConnection as any).packetListeners) l(pkt); }, delay);
  }

  private reply(req: Req, opcode: number, offset: number, data: Uint8Array, opts: { burstComplete?: number; seqBump?: number } = {}) {
    const p = new Uint8Array(254);
    const v = new DataView(p.buffer, 3);
    const seq = (req.seq + (opts.seqBump ?? 1)) & 0xffff;
    v.setUint16(0, seq, true);
    v.setUint8(2, req.session);
    v.setUint8(3, opcode);
    v.setUint8(4, data.length);
    v.setUint8(5, req.opcode);
    v.setUint8(6, opts.burstComplete ?? 0);
    v.setUint32(8, offset, true);
    p.set(data, 15);
    this.lastReply = { seq, session: req.session, bytes: p };
    const nth = (this.answered[req.opcode] = (this.answered[req.opcode] ?? 0) + 1);
    if (this.o.dropReply?.(req, nth)) return;
    this.emit(p, 2 + (this.o.delayReply?.(req) ?? 0));
  }

  private nak(req: Req, code: number, errno?: number) { this.reply(req, NAK, 0, errno === undefined ? Uint8Array.of(code) : Uint8Array.of(code, errno)); }

  requestsSeen: number[] = [];

  /** Answer a mission-protocol message the way ArduPilot does for a mission type it doesn't have. */
  private missionProtocol(frame: { messageId: number; payload: Uint8Array }) {
    this.requestsSeen.push(frame.messageId);
    // MISSION_REQUEST_LIST (43): mission_type at byte 2. MISSION_COUNT (44): at byte 4.
    const p = new Uint8Array(8);
    p.set(frame.payload.subarray(0, 8));
    const missionType = frame.messageId === 43 ? p[2] : p[4];
    if (!this.o.noRally || missionType !== 2) return;
    const ack = Uint8Array.of(255, 190, 3 /* MAV_MISSION_UNSUPPORTED */, 2);
    const pkt = { version: 2, sequence: 0, systemId: 1, componentId: 1, messageId: 47, payload: ack, crc: 0, raw: ack };
    setTimeout(() => { for (const l of (mavlinkConnection as any).packetListeners) l(pkt); }, 2);
  }

  private onRequest(bytes: Uint8Array) {
    if (this.lost()) return;
    const frames = this.parser.parse(bytes);
    if (frames.length === 1 && (frames[0].messageId === 43 || frames[0].messageId === 44)) return this.missionProtocol(frames[0]);
    if (frames.length !== 1 || frames[0].messageId !== 110) return;
    const full = new Uint8Array(254);
    full.set(frames[0].payload.subarray(0, 254));         // undo MAVLink 2 zero-trimming
    const f = parseFtpPayload(full)!;
    const req: Req = { seq: f.seq, session: f.session, opcode: f.opcode, size: f.size, offset: f.offset, data: f.data };
    this.requests.push(`${req.opcode}#${req.seq}`);

    // GCS_FTP resend cache: a retried request (same seq) gets the cached reply again
    if (this.lastReply && this.lastReply.session === req.session && ((req.seq + 1) & 0xffff) === this.lastReply.seq) {
      this.emit(this.lastReply.bytes);
      return;
    }

    const name = () => new TextDecoder().decode(req.data.subarray(0, req.size)).replace(/\0.*$/, '');
    switch (req.opcode) {
      case FTP_OPCODE.CreateFile: {
        if (this.fd) return this.nak(req, ERR_FAIL);
        if (this.o.noRally && name().endsWith('rally.dat')) return this.nak(req, ERR_FAIL_ERRNO, ENOENT);
        this.fd = { mode: 'w', path: name(), buf: new Uint8Array(65536), len: 0 };
        return this.reply(req, ACK, 0, new Uint8Array(0));
      }
      case FTP_OPCODE.WriteFile: {
        if (!this.fd || this.fd.mode !== 'w') return this.nak(req, ERR_INVALID_SESSION);
        if (this.o.nakWrite?.(req)) return this.nak(req, ERR_FAIL);
        this.fd.buf.set(req.data.subarray(0, req.size), req.offset);
        this.fd.len = Math.max(this.fd.len, req.offset + req.size);
        return this.reply(req, ACK, req.offset, new Uint8Array(0));
      }
      case FTP_OPCODE.TerminateSession: {
        if (this.fd?.mode === 'w') this.committed[this.fd.path] = this.fd.buf.slice(0, this.fd.len);
        this.fd = null;
        return this.reply(req, ACK, 0, new Uint8Array(0));
      }
      case FTP_OPCODE.OpenFileRO: {
        if (this.fd) return this.nak(req, ERR_FAIL);
        const path = name();
        const stored = this.o.noRally && path.endsWith('rally.dat') ? undefined : this.committed[path];
        // AP_Filesystem open() fails with errno set; GCS_FTP replies FailErrno with the errno.
        if (!stored) return this.nak(req, ERR_FAIL_ERRNO, ENOENT);
        const buf = path.startsWith('@MISSION/') ? regenerateMissionDat(stored, path.endsWith('rally.dat')) : stored.slice();
        this.fd = { mode: 'r', path, buf, len: buf.length };
        return this.reply(req, ACK, 0, new Uint8Array(new Uint32Array([buf.length]).buffer));
      }
      case FTP_OPCODE.ReadFile: {
        if (!this.fd || this.fd.mode !== 'r') return this.nak(req, ERR_INVALID_SESSION);
        if (req.offset >= this.fd.len) return this.nak(req, ERR_EOF);
        return this.reply(req, ACK, req.offset, this.fd.buf.subarray(req.offset, Math.min(req.offset + req.size, this.fd.len)));
      }
      case FTP_OPCODE.BurstReadFile: {
        if (!this.fd || this.fd.mode !== 'r') return this.nak(req, ERR_INVALID_SESSION);
        if (req.offset >= this.fd.len) return this.nak(req, ERR_EOF);
        let bump = 1;
        for (let off = req.offset; off < this.fd.len; off += 239, bump++) {
          const end = Math.min(off + 239, this.fd.len);
          this.reply(req, ACK, off, this.fd.buf.subarray(off, end), { burstComplete: end >= this.fd.len ? 1 : 0, seqBump: bump });
        }
        return;
      }
      case FTP_OPCODE.ResetSessions: {
        this.fd = null;
        return this.reply(req, ACK, 0, new Uint8Array(0));
      }
    }
  }
}

/** What AP_Filesystem_Mission::read() hands back for a stored mission.dat (or rally.dat: AP_Rally keeps altitude as
 *  int16 metres, so whole metres). */
function regenerateMissionDat(stored: Uint8Array, rally = false): Uint8Array {
  const out = stored.slice();
  const v = new DataView(out.buffer);
  for (let i = 0, o = 10; o + 38 <= out.length; i++, o += 38) {
    const alt = v.getFloat32(o + 24, true);
    v.setFloat32(o + 24, rally ? Math.round(alt) : Math.round(alt * 100) * 0.01, true); // rally: int16 m; mission: int32 cm
    v.setUint16(o + 28, i, true);   // seq = index
    out[o + 35] = 0;                // current: only the executing nav command
    out[o + 36] = 1;                // autocontinue forced
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------------------------------------
function missionFixture(n = 40): Uint8Array {
  const items = [{ seq: 0, command: 16, current: 1, frame: 0, x: 37.7749, y: -122.4194, z: 10.37, autocontinue: 1 }] as any[];
  items.push({ seq: 1, command: 22, frame: 3, x: 0, y: 0, z: 20, autocontinue: 1 });
  for (let i = 2; i < n; i++) items.push({ seq: i, command: 16, frame: 3, x: 37.7749 + i * 1e-4, y: -122.4194 + i * 1e-4, z: 30.33, autocontinue: 1 });
  return packDatFile(items, 0);
}
const same = (a: Uint8Array | null | undefined, b: Uint8Array) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);

// ------------------------------------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------------------------------------
const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}

async function upload(sim: ArduPilotFtpSim, data: Uint8Array, path = '@MISSION/mission.dat') {
  sim.install();
  const ok = await mavFtpClient.writeFile(1, 1, path, data, 239, TIMEOUT_MS);
  await sleep(50);                                     // let any trailing Terminate land
  return ok;
}

const DATA = missionFixture();
const PATH = '@MISSION/mission.dat';

// 1. Clean link: one upload, accepted, no second upload, session closed.
{
  const sim = new ArduPilotFtpSim();
  const ok = await upload(sim, DATA);
  const creates = sim.requests.filter((r) => r.startsWith(`${FTP_OPCODE.CreateFile}#`)).length;
  check('clean link: writeFile reports success', ok === true);
  check('clean link: vehicle committed the exact bytes', same(sim.committed[PATH], DATA));
  check('clean link: exactly one CreateFile (no retry storm)', creates === 1, `CreateFile sent ${creates}x`);
  check('clean link: session closed afterwards', sim.fd === null);
  check('read-back is regenerated by ArduPilot (sanity: not byte-identical), yet the upload still counts as success',
    !same(regenerateMissionDat(DATA), DATA) && ok === true);
}

// 2. The CreateFile ACK is lost once. The vehicle already has the file open, so a retry with a NEW seq
//    gets NAK Fail; a retry with the SAME seq is answered from the resend cache.
{
  const sim = new ArduPilotFtpSim({ dropReply: (r, nth) => r.opcode === FTP_OPCODE.CreateFile && nth === 1 });
  const ok = await upload(sim, DATA);
  check('lost CreateFile ACK: upload still succeeds', ok === true, sim.requests.slice(0, 4).join(' '));
  check('lost CreateFile ACK: vehicle committed the exact bytes', same(sim.committed[PATH], DATA));
  check('lost CreateFile ACK: session closed afterwards', sim.fd === null);
}

// 3. One WriteFile ACK arrives after the client timeout (congested radio). The stale ACK must not
//    advance the offset for a different chunk.
{
  let delayed = false;
  const sim = new ArduPilotFtpSim({
    delayReply: (r) => (r.opcode === FTP_OPCODE.WriteFile && r.offset === 239 && !delayed ? ((delayed = true), TIMEOUT_MS * 1.5) : 0),
  });
  const ok = await upload(sim, DATA);
  await sleep(TIMEOUT_MS * 2);
  check('late WriteFile ACK: upload succeeds', ok === true);
  check('late WriteFile ACK: vehicle file intact', same(sim.committed[PATH], DATA));
}

// 4. Lossy link, both directions. Never report success for a corrupt file; never strand the session.
for (const loss of [0.1, 0.2]) {
  let succeeded = 0, corruptSuccess = 0, stranded = 0;
  const runs = 10;
  for (let seed = 1; seed <= runs; seed++) {
    const sim = new ArduPilotFtpSim({ loss, seed });
    const ok = await upload(sim, DATA);
    await sleep(TIMEOUT_MS);                           // allow cleanup traffic to finish
    if (ok) succeeded++;
    if (ok && !same(sim.committed[PATH], DATA)) corruptSuccess++;
    if (sim.fd !== null) stranded++;
  }
  check(`${loss * 100}% loss: never reports success for a corrupt file`, corruptSuccess === 0, `${corruptSuccess}/${runs}`);
  check(`${loss * 100}% loss: never leaves the vehicle session open`, stranded === 0, `${stranded}/${runs} stranded`);
  // 20% each way is ~36% round-trip loss; with 3 retries per step some uploads legitimately fall back to item-by-item.
  const floor = loss < 0.15 ? runs : runs / 2;
  check(`${loss * 100}% loss: at least ${floor}/${runs} uploads succeed`, succeeded >= floor, `${succeeded}/${runs}`);
}

// 5. Vehicle rejects a chunk: the upload fails AND the session is closed so the next FTP op works without stray Terminate.
{
  const file = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7 + 3) & 0xff);
  const sim = new ArduPilotFtpSim({
    nakWrite: (r) => r.offset === 239 * 2,
    files: { '@PARAM/param.pck': file },
  });
  sim.install();
  const ok = await mavFtpClient.writeFile(1, 1, PATH, DATA, 239, TIMEOUT_MS);
  check('WriteFile NAK: upload reports failure', ok === false);
  // Start the next transfer immediately to verify that stray TerminateSession does not kill it
  const got = await mavFtpClient.readFile(1, 1, '@PARAM/param.pck', 239, TIMEOUT_MS);
  check('immediate read after failed write completes without stray Terminate interference', same(got, file));
  check('WriteFile NAK: session closed so later transfers are not blocked', sim.fd === null);
}

// 6. Reads use ArduPilot seq numbering too (seq + 1, incrementing within a burst).
{
  const file = Uint8Array.from({ length: 4000 }, (_, i) => (i * 7 + 3) & 0xff);
  const sim = new ArduPilotFtpSim({ files: { '@PARAM/param.pck': file } });
  sim.install();
  const got = await mavFtpClient.readFile(1, 1, '@PARAM/param.pck', 239, TIMEOUT_MS);
  await sleep(50);
  check('burst read with ArduPilot seq numbering returns the exact file', same(got, file), `${got?.length ?? 0} bytes`);
  check('burst read closes its session', sim.fd === null);
}

// 7. A missing file is answered at once: no retries (each would cost a round trip, e.g. probing log folders).
{
  const sim = new ArduPilotFtpSim({ files: {} });
  sim.install();
  const got = await mavFtpClient.readFile(1, 1, '/APM/LOGS/LASTLOG.TXT', 239, TIMEOUT_MS);
  const opens = sim.requests.filter((r) => r.startsWith(`${FTP_OPCODE.OpenFileRO}#`)).length;
  check('missing file: null after a single open, no retries', got === null && opens === 1, sim.requests.join(' '));
}

// 8. A file left open by an earlier transfer: ResetSessions clears it and the read goes ahead.
{
  const file = Uint8Array.from({ length: 700 }, (_, i) => (i * 11) & 0xff);
  const sim = new ArduPilotFtpSim({ files: { '@PARAM/param.pck': file } });
  sim.install();
  sim.fd = { mode: 'r', path: 'stale', buf: new Uint8Array(1), len: 1 };
  const got = await mavFtpClient.readFile(1, 1, '@PARAM/param.pck', 239, TIMEOUT_MS);
  check('stale open file: sessions reset, then the read succeeds', same(got, file) && sim.requests.some((r) => r.startsWith(`${FTP_OPCODE.ResetSessions}#`)), sim.requests.slice(0, 4).join(' '));
}

// 9. Planning: upload a draft, read it back from the vehicle and judge it, end to end. The vehicle regenerates
// mission.dat (seq, current, autocontinue, altitude in cm), which must still count as verified.
{
  const { missionManager } = await import('../src/mavlink/missionManager.ts');
  const d = await import('../src/mavlink/missionDraft.ts');
  let draft = d.draftFromItems([{ seq: 0, command: 16, frame: 0, x: 37.7749, y: -122.4194, z: 10 }]);
  draft = d.insertItems(draft, 1, [{ ...d.newWaypoint(draft, 1, 0, 0), command: 22, z: 20.004 }]);
  for (let i = 0; i < 5; i++) draft = d.appendWaypoint(draft, 37.775 + i * 1e-4, -122.419 + i * 1e-4);
  draft = d.updateItem(draft, 3, { z: 33.337, param1: 2.5 });
  draft = d.insertItems(draft, 5, [{ command: 177, frame: 2, param1: 3, param2: 2, param3: 0, param4: 0, x: 0, y: 0, z: 0, autocontinue: 1 }]);

  const sim = new ArduPilotFtpSim();
  sim.install();
  const res = await missionManager.uploadMissionAndReadBack(d.draftToItems(draft), 1, 1);
  await sleep(50);
  const verdict = d.checkReadBack(draft, res.readBack);
  check('draft upload over MAVFTP: accepted and read back', res.success && res.method === 'ftp' && res.readBack.length === draft.items.length, `${res.success} ${res.method} ${res.readBack.length}`);
  check('draft upload: vehicle-regenerated read-back counts as verified', verdict.status === 'verified', JSON.stringify(verdict.comparison));

  // A MAVFTP download (here the read-back) takes home from mission.dat's item 0, as a streamed download does, and
  // marks it as from the vehicle; it never overrides a HOME_POSITION home.
  {
    const { useTelemetryStore } = await import('../src/store/telemetryStore.ts');
    const st = useTelemetryStore.getState();
    check('MAVFTP download: home from item 0, marked as from the vehicle',
      st.homePosition.source === 'wp0' && Math.abs(st.homePosition.lat - 37.7749) < 1e-6 && st.homeFromVehicle === true,
      `${st.homePosition.source} ${st.homePosition.lat} ${st.homeFromVehicle}`);
    useTelemetryStore.setState({ homePosition: { lat: 10, lon: 20, alt: 0, distanceM: null, bearingDeg: null, source: 'home_msg' } });
    new ArduPilotFtpSim({ files: { '@MISSION/mission.dat': packDatFile(d.draftToItems(draft), 0) } }).install();
    await missionManager.fetchWaypoints(1, 1);
    await sleep(50);
    check('MAVFTP download: a HOME_POSITION home is not overridden', useTelemetryStore.getState().homePosition.lat === 10);
  }

  // The vehicle keeps all but the last item (e.g. storage full): the route differs and must not pass.
  const short = new ArduPilotFtpSim();
  short.install();
  const res2 = await missionManager.uploadMissionAndReadBack(d.draftToItems(draft), 1, 1);
  await sleep(50);
  const stored = short.committed['@MISSION/mission.dat'];
  const truncated = d.draftToItems(d.removeItems(draft, [draft.items.length - 1]));
  short.committed['@MISSION/mission.dat'] = packDatFile(truncated, 0);
  const res3Read = await missionManager.fetchWaypoints(1, 1);
  const verdict2 = d.checkReadBack(draft, res3Read);
  check('draft upload: a vehicle copy missing an item is a mismatch', Boolean(stored) && res2.success && verdict2.status === 'mismatch', verdict2.comparison.structural.join('; '));

  check('draft upload: nothing read back is unreadable, not verified', d.checkReadBack(draft, []).status === 'unreadable');

  // Clearing the mission: ArduPilot keeps home as item 0, so a home-only upload reads back as one item and verifies.
  const homeOnly = d.draftFromItems([{ seq: 0, command: 16, frame: 0, x: 37.7749, y: -122.4194, z: 10 }]);
  new ArduPilotFtpSim().install();
  const cleared = await missionManager.uploadMissionAndReadBack(d.draftToItems(homeOnly), 1, 1);
  await sleep(50);
  check('clearing the mission (home only) reads back home and verifies', cleared.success && cleared.readBack.length === 1 && d.checkReadBack(homeOnly, cleared.readBack).status === 'verified',
    `${cleared.readBack.length} ${d.checkReadBack(homeOnly, cleared.readBack).status}`);

  // Review fixes: a failed read keeps the uploaded mission on the map; a throw never leaves a transfer stuck.
  const { useTelemetryStore } = await import('../src/store/telemetryStore.ts');
  let last: any = null;
  const unsub = missionManager.onStatusChange((st: any) => (last = st));
  const realFetch = missionManager.fetchWaypoints.bind(missionManager);
  (missionManager as any).fetchWaypoints = async () => {
    useTelemetryStore.setState({ missionWaypoints: [] }); // what a failed stream leaves behind
    return [];
  };
  new ArduPilotFtpSim().install();
  const unreadable = await missionManager.uploadMissionAndReadBack(d.draftToItems(draft), 1, 1);
  await sleep(50);
  check('failed read-back: upload still reported, map keeps the uploaded mission',
    unreadable.success && unreadable.readBack.length === 0 && useTelemetryStore.getState().missionWaypoints.length === draft.items.length,
    String(useTelemetryStore.getState().missionWaypoints.length));
  check('failed read-back: transfer not left in progress', last && !last.isFetching && !last.isUploading);

  (missionManager as any).fetchWaypoints = async () => {
    throw new Error('link lost');
  };
  new ArduPilotFtpSim().install();
  const thrown = await missionManager.uploadMissionAndReadBack(d.draftToItems(draft), 1, 1);
  await sleep(50);
  check('throw during read-back: reported as failed with the reason', !thrown.success && /link lost/.test(thrown.error ?? ''), thrown.error);
  check('throw during read-back: transfer not left in progress', last && !last.isFetching && !last.isUploading && last.method === 'idle');
  (missionManager as any).fetchWaypoints = realFetch;
  new ArduPilotFtpSim().install();
  const after = await missionManager.uploadMissionAndReadBack(d.draftToItems(draft), 1, 1);
  await sleep(50);
  check('after a throw: the next upload goes ahead', after.success && d.checkReadBack(draft, after.readBack).status === 'verified', after.error);
  unsub();
  const p = d.checkReadBack(draft, res.readBack.map((w: any) => (w.seq === 3 ? { ...w, param4: 45 } : w)));
  check('draft upload: a param the vehicle stored differently is reported, route still verified', p.status === 'params-differ' && p.comparison.params.length === 1);
}

// 10. Rally points: upload a rally draft, read it back (the vehicle regenerates rally.dat: seq, alt in cm) and judge.
{
  const { missionManager } = await import('../src/mavlink/missionManager.ts');
  const rd = await import('../src/mavlink/rallyDraft.ts');
  const { useTelemetryStore } = await import('../src/store/telemetryStore.ts');
  let rally = rd.rallyDraftFromPoints([]);
  rally = rd.addRallyPoint(rally, null, 37.7801234, -122.4101234).draft;
  rally = rd.addRallyPoint(rally, null, 37.7702345, -122.4302345).draft;
  rally = rd.updateRallyPoint(rally, 1, { alt: 45.337, frame: 0 });

  new ArduPilotFtpSim().install();
  const res = await missionManager.uploadRallyAndReadBack(rd.rallyDraftToItems(rally), 1, 1);
  await sleep(50);
  const verdict = rd.checkRallyReadBack(rally, res.readBack);
  check('rally upload over MAVFTP: accepted and read back', res.success && res.method === 'ftp' && res.readBack.length === 2, `${res.success} ${res.method} ${res.readBack.length}`);
  check('rally upload: regenerated read-back (alt in whole metres, frame kept) verifies', verdict.status === 'verified', verdict.differences.join('; '));
  check('rally upload: the map shows the read-back with its frame', useTelemetryStore.getState().rallyPoints[1]?.frame === 0);

  // Clearing all rally points: nothing uploaded, nothing back, verified (unlike a mission, empty is a valid answer).
  new ArduPilotFtpSim().install();
  const cleared = await missionManager.uploadRallyAndReadBack([], 1, 1);
  await sleep(50);
  // The read fails after an acknowledged upload: unreadable, and the map keeps the uploaded rally points.
  const realFetchRally = missionManager.fetchRally.bind(missionManager);
  (missionManager as any).fetchRally = async () => {
    missionManager.lastRallyReadOk = false; // a timed-out stream
    return [];
  };
  new ArduPilotFtpSim().install();
  const unread = await missionManager.uploadRallyAndReadBack(rd.rallyDraftToItems(rally), 1, 1);
  await sleep(50);
  check('rally read-back fails: unreadable, map keeps the uploaded points',
    unread.success && !unread.readOk && rd.checkRallyReadBack(rally, unread.readBack, unread.readOk).status === 'unreadable' && useTelemetryStore.getState().rallyPoints.length === 2,
    String(useTelemetryStore.getState().rallyPoints.length));
  // Clearing all rally points with a failed read: the empty result proves nothing, so it is not verified.
  new ArduPilotFtpSim().install();
  const clearUnread = await missionManager.uploadRallyAndReadBack([], 1, 1);
  await sleep(50);
  (missionManager as any).fetchRally = realFetchRally;
  check('clearing rally points with a failed read: unreadable, not verified',
    clearUnread.success && rd.checkRallyReadBack({ points: [] }, clearUnread.readBack, clearUnread.readOk).status === 'unreadable');

  check('clearing rally points verifies', cleared.success && cleared.readOk && rd.checkRallyReadBack({ points: [] }, cleared.readBack, cleared.readOk).status === 'verified', `${cleared.success} ${cleared.readBack.length} ${cleared.error ?? ''}`);
}

// 11. A vehicle without rally points: its "unsupported" answer ends the download at once, is remembered for the
// vehicle (no more asking), and an upload says why it failed.
{
  const { missionManager } = await import('../src/mavlink/missionManager.ts');
  const rd = await import('../src/mavlink/rallyDraft.ts');
  const { useTelemetryStore } = await import('../src/store/telemetryStore.ts');
  // One rally point already on the map (from before): an incomplete download must keep it, and report it.
  const known = [{ seq: 0, lat: 37.78, lon: -122.41, alt: 30, frame: 3 }];
  useTelemetryStore.setState({ rallySupport: 'unknown', rallyPoints: known });

  const sim = new ArduPilotFtpSim({ noRally: true });
  sim.install();
  const t0 = Date.now();
  const got = await missionManager.fetchRally(1, 1);
  const took = Date.now() - t0;
  check('no rally: download stops at the vehicle\'s answer, not after the retries', took < 1500, `${took} ms`);
  check('incomplete rally download: map keeps its points, and they are what is returned (counts agree)',
    useTelemetryStore.getState().rallyPoints === known && got === known, `${got.length}`);
  check('no rally: remembered as unsupported, read not counted as complete', useTelemetryStore.getState().rallySupport === 'unsupported' && !missionManager.lastRallyReadOk);

  const asked = sim.requestsSeen.length;
  await missionManager.fetchRally(1, 1);
  check('no rally: not asked again once known', sim.requestsSeen.length === asked);

  useTelemetryStore.setState({ rallySupport: 'unknown' });
  const sim2 = new ArduPilotFtpSim({ noRally: true });
  sim2.install();
  const rally = rd.addRallyPoint({ points: [] }, null, 37.78, -122.41).draft;
  const up = await missionManager.uploadRallyAndReadBack(rd.rallyDraftToItems(rally), 1, 1);
  await sleep(50);
  check('no rally: upload fails, saying rally points are not supported', !up.success && /not supported/.test(up.error ?? ''), up.error);
  check('no rally: upload refusal also remembered', useTelemetryStore.getState().rallySupport === 'unsupported');
}

console.log(failures.length ? `\n${failures.length} MAVFTP ArduPilot-sim check(s) FAILED` : '\nAll MAVFTP ArduPilot-sim checks PASSED');
process.exit(failures.length ? 1 : 0);
