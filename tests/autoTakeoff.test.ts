// Auto-takeoff sequence: aborts and failures stand down without ever force-disarming, an abort during the arm ACK
// still stands down what it armed, and the sequence stays with the vehicle it started on.
import { AutoTakeoffSequence, type TakeoffPlan } from '../src/lib/autoTakeoff.ts';
import { MAV_CMD } from '../src/mavlink/messages.ts';
import type { CommandAckInfo } from '../src/store/telemetryStore.ts';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

type Sent = {
  kind: 'mode' | 'arm' | 'disarm' | 'takeoff' | 'other';
  sysId: number;
  mode?: number;
  force?: boolean;
  label: string;
  reply: (result: number) => void;
};

const ACCEPTED = 0;
const FAILED = 4;
const TIMEOUT = -1;
const flush = () => new Promise((r) => setImmediate(r));

function harness(planOver: Partial<TakeoffPlan> = {}, vehicleInit = { systemId: 1, customMode: 0, isArmed: false }) {
  const vehicle = { ...vehicleInit };
  const sent: Sent[] = [];
  const descs: Omit<Sent, 'label' | 'reply'>[] = [];
  const packet = (d: Omit<Sent, 'label' | 'reply'>) => {
    descs.push(d);
    return new Uint8Array([descs.length - 1]);
  };
  const encoder = {
    createSetMode: (sysId: number, _c: number, mode: number) => packet({ kind: 'mode', sysId, mode }),
    createArmDisarm: (sysId: number, _c: number, arm: boolean, force = false) =>
      packet({ kind: arm ? 'arm' : 'disarm', sysId, force }),
    createCommandLong: (sysId: number, _c: number, cmd: number) =>
      packet({ kind: cmd === MAV_CMD.NAV_TAKEOFF ? 'takeoff' : 'other', sysId }),
  } as any;
  const state = { step: null as string | null, error: null as string | null, done: false };
  const plan: TakeoffPlan = {
    sysId: 1,
    compId: 1,
    fixedWing: false,
    takeoffModeNum: 4,
    takeoffModeLabel: 'GUIDED',
    holdModeNum: 5,
    altM: 10,
    dispAlt: '10 m',
    ...planOver,
  };
  const seq = new AutoTakeoffSequence(plan, {
    send: (p, meta) =>
      new Promise<CommandAckInfo>((resolve) => {
        sent.push({
          ...descs[p[0]],
          label: meta.label,
          reply: (result) =>
            resolve({ command: 0, result, resultText: result === TIMEOUT ? 'TIMEOUT' : `R${result}`, time: 0 }),
        });
      }),
    encoder,
    vehicle: () => vehicle,
    wait: async () => {},
    onStep: (t) => (state.step = t),
    onError: (t) => (state.error = t),
    onDone: () => (state.done = true),
  });
  const last = () => sent[sent.length - 1];
  /** Answer the newest command and let the sequence move on. */
  const answer = async (result: number) => {
    last().reply(result);
    await flush();
  };
  return { seq, sent, vehicle, state, last, answer };
}
const noForce = (sent: Sent[]) => sent.every((s) => !s.force);
const kinds = (sent: Sent[]) => sent.map((s) => s.kind + (s.kind === 'mode' ? `:${s.mode}` : '')).join(',');

// Happy path (copter): mode, arm, takeoff.
{
  const h = harness();
  void h.seq.run();
  await flush();
  await h.answer(ACCEPTED);
  await h.answer(ACCEPTED);
  await h.answer(ACCEPTED);
  check(
    'copter: GUIDED, arm, NAV_TAKEOFF, done',
    kinds(h.sent) === 'mode:4,arm,takeoff' && h.state.done,
    kinds(h.sent)
  );
}

// Abort while NAV_TAKEOFF is unanswered, the vehicle already climbing: the disarm is refused, so hold.
{
  const h = harness();
  void h.seq.run();
  await flush();
  await h.answer(ACCEPTED);
  await h.answer(ACCEPTED);
  check('copter: NAV_TAKEOFF sent', h.last().kind === 'takeoff');
  h.seq.abort();
  await flush();
  check('abort after takeoff: disarm is not forced', h.last().kind === 'disarm' && h.last().force === false);
  await h.answer(FAILED); // ArduPilot: won't disarm while flying
  check('abort after takeoff: refused disarm, so hold (LOITER)', h.last().kind === 'mode' && h.last().mode === 5);
  h.sent[2].reply(ACCEPTED); // the takeoff's own ACK arrives late
  await flush();
  check('abort after takeoff: nothing more sent', kinds(h.sent) === 'mode:4,arm,takeoff,disarm,mode:5', kinds(h.sent));
  check('abort after takeoff: never forced', noForce(h.sent));
  check('abort after takeoff: not reported done', !h.state.done && /aborted/.test(h.state.error ?? ''));
}

// Abort while the arm ACK is on its way, then arming succeeds: the arm is stood down, not left armed.
{
  const h = harness();
  void h.seq.run();
  await flush();
  await h.answer(ACCEPTED);
  check('arm pending', h.last().kind === 'arm');
  h.seq.abort();
  await flush();
  check('abort before the arm ACK: waits for it (nothing sent)', h.last().kind === 'arm', kinds(h.sent));
  h.sent[1].reply(ACCEPTED);
  await flush();
  check('arm ACK after abort: disarmed (not forced)', h.last().kind === 'disarm' && h.last().force === false);
  await h.answer(ACCEPTED);
  check('arm ACK after abort: disarm only', kinds(h.sent) === 'mode:4,arm,disarm', kinds(h.sent));
}

// Abort while the arm ACK is on its way, then arming is refused: nothing to stand down, nothing sent.
{
  const h = harness();
  void h.seq.run();
  await flush();
  await h.answer(ACCEPTED);
  h.seq.abort();
  await h.answer(FAILED);
  check('abort, then arm refused: nothing more sent', kinds(h.sent) === 'mode:4,arm', kinds(h.sent));
}

// NAV_TAKEOFF unanswered: maybe climbing. Disarm (not forced); refused, so hold.
{
  const h = harness();
  void h.seq.run();
  await flush();
  await h.answer(ACCEPTED);
  await h.answer(ACCEPTED);
  await h.answer(TIMEOUT);
  check('takeoff timeout: disarm not forced', h.last().kind === 'disarm' && h.last().force === false);
  await h.answer(FAILED);
  check('takeoff timeout, flying: hold', h.last().kind === 'mode' && h.last().mode === 5);
  check('takeoff timeout: error shown', /Takeoff rejected \(TIMEOUT\)/.test(h.state.error ?? ''), h.state.error ?? '');
}

// NAV_TAKEOFF refused on the ground: disarmed, no hold needed.
{
  const h = harness();
  void h.seq.run();
  await flush();
  await h.answer(ACCEPTED);
  await h.answer(ACCEPTED);
  await h.answer(FAILED);
  await h.answer(ACCEPTED);
  check('takeoff refused on the ground: disarm, nothing after', kinds(h.sent) === 'mode:4,arm,takeoff,disarm');
}

// Arm ACK lost, but the heartbeat says armed: stood down all the same.
{
  const h = harness();
  void h.seq.run();
  await flush();
  await h.answer(ACCEPTED);
  h.vehicle.isArmed = true;
  await h.answer(TIMEOUT);
  check('arm unanswered but armed: disarmed (not forced)', h.last().kind === 'disarm' && h.last().force === false);
}

// Already armed by the operator before the sequence: a failure doesn't disarm what it didn't arm.
{
  const h = harness({}, { systemId: 1, customMode: 4, isArmed: true });
  void h.seq.run();
  await flush();
  check('pre-armed in GUIDED: straight to NAV_TAKEOFF', kinds(h.sent) === 'takeoff');
  await h.answer(FAILED);
  check('pre-armed: takeoff refused, no disarm', kinds(h.sent) === 'takeoff', kinds(h.sent));
}

// Another vehicle becomes active after arming: no takeoff to either; the armed one is disarmed.
{
  const h = harness();
  void h.seq.run();
  await flush();
  await h.answer(ACCEPTED);
  h.last().reply(ACCEPTED);
  h.vehicle.systemId = 2;
  await flush();
  check('switch after arm: no NAV_TAKEOFF', !h.sent.some((s) => s.kind === 'takeoff'), kinds(h.sent));
  check('switch after arm: vehicle 1 disarmed', h.last().kind === 'disarm' && h.last().sysId === 1 && !h.last().force);
  check('switch after arm: says why', /Vehicle 2 is now active/.test(h.state.error ?? ''), h.state.error ?? '');
}

// Another vehicle becomes active while NAV_TAKEOFF is unanswered: left to finish its takeoff; Abort targets vehicle 1.
{
  const h = harness();
  void h.seq.run();
  await flush();
  await h.answer(ACCEPTED);
  await h.answer(ACCEPTED);
  h.vehicle.systemId = 2;
  await h.answer(ACCEPTED);
  check('switch during takeoff: nothing more sent', kinds(h.sent) === 'mode:4,arm,takeoff', kinds(h.sent));
  check(
    'every command went to vehicle 1',
    h.sent.every((s) => s.sysId === 1)
  );
}

// Fixed-wing: TAKEOFF mode, arm (no NAV_TAKEOFF); an abort during the arm ACK, flying: refused disarm, LOITER.
{
  const h = harness({ fixedWing: true, takeoffModeNum: 13, takeoffModeLabel: 'TAKEOFF', holdModeNum: 12 });
  void h.seq.run();
  await flush();
  await h.answer(ACCEPTED);
  h.seq.abort();
  await flush();
  h.sent[1].reply(ACCEPTED);
  await flush();
  check(
    'plane: abort during arm, disarm (not forced) and no LOITER before it',
    kinds(h.sent) === 'mode:13,arm,disarm' && !h.last().force,
    kinds(h.sent)
  );
  await h.answer(FAILED);
  check('plane: refused disarm, LOITER', h.last().kind === 'mode' && h.last().mode === 12);
  check('plane: never NAV_TAKEOFF, never forced', !h.sent.some((s) => s.kind === 'takeoff') && noForce(h.sent));
}

// A second Abort press sends nothing more.
{
  const h = harness();
  void h.seq.run();
  await flush();
  h.seq.abort();
  h.seq.abort();
  await flush();
  check('double abort: one hold', h.sent.filter((s) => s.kind === 'mode' && s.mode === 5).length === 1);
}

console.log(failures.length ? `\n${failures.length} auto-takeoff check(s) FAILED` : '\nAll auto-takeoff checks PASSED');
if (failures.length) process.exit(1);
