// A parameter write confirmed by the vehicle's echo (src/lib/paramWrite.ts): the inline edit and the file compare's
// writes report Saved only when the vehicle echoes the value, and say so when it keeps another or doesn't answer.
import { writeParamVerified } from '../src/lib/paramWrite.ts';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

/** A fake link: `reply(name, sent value)` says what the vehicle (sys 1, comp 1) or another component echoes. */
function link(
  reply: (name: string, value: number) => { value: number; sysId?: number; compId?: number }[] | null,
  sendOk = true
) {
  const listeners = new Set<(p: any) => void>();
  let sends = 0;
  return {
    sends: () => sends,
    deps: {
      send: (p: Uint8Array) => {
        if (!sendOk) return false;
        sends++;
        const { name, value } = JSON.parse(new TextDecoder().decode(p));
        const echoes = reply(name, value) ?? [];
        setTimeout(() => {
          for (const e of echoes)
            for (const l of [...listeners])
              l({ messageId: 22, systemId: e.sysId ?? 1, componentId: e.compId ?? 1, payload: { name, v: e.value } });
        }, 5);
        return true;
      },
      onPacket: (l: (p: any) => void) => (listeners.add(l), () => listeners.delete(l)),
      encoder: {
        createParamSet: (_s: number, _c: number, name: string, value: number) =>
          new TextEncoder().encode(JSON.stringify({ name, value })),
      },
      decode: (_id: number, payload: any) => ({
        param_id: payload.name.padEnd(16, '\0').replace(/\0+$/, ''),
        param_value: payload.v,
      }),
      timeoutMs: 50,
    },
  };
}
const T = { sysId: 1, compId: 1 };

let l = link((_n, v) => [{ value: v }]);
let r = await writeParamVerified(T, 'WPNAV_SPEED', 500, 4, l.deps);
check('echoed as written: ok', r.outcome === 'ok' && r.echoed === 500 && l.sends() === 1);

l = link(() => [{ value: 0.1 }]);
r = await writeParamVerified(T, 'ATC_RAT_RLL_P', 0.1, 9, l.deps);
check('float32 echo (0.100000001): ok', r.outcome === 'ok');

l = link(() => [{ value: 2000 }]);
r = await writeParamVerified(T, 'WPNAV_SPEED', 99999, 4, l.deps);
check('clamped or refused: kept, with the value the vehicle kept', r.outcome === 'kept' && r.echoed === 2000);

l = link(() => null);
r = await writeParamVerified(T, 'WPNAV_SPEED', 500, 4, l.deps);
check('no echo: no-answer, after one retry', r.outcome === 'no-answer' && l.sends() === 2, `${l.sends()} sends`);

let tries = 0;
l = link((_n, v) => (++tries === 1 ? null : [{ value: v }]));
r = await writeParamVerified(T, 'WPNAV_SPEED', 500, 4, l.deps);
check('first echo lost, second arrives: ok', r.outcome === 'ok' && l.sends() === 2);

l = link((_n, v) => [{ value: v + 1, compId: 154 }]);
r = await writeParamVerified(T, 'WPNAV_SPEED', 500, 4, l.deps);
check("another component's echo (a gimbal) doesn't count", r.outcome === 'no-answer');

l = link((_n, v) => [{ value: v }], false);
r = await writeParamVerified(T, 'WPNAV_SPEED', 500, 4, l.deps);
check('not sent (no link, replay): no-answer, no retry', r.outcome === 'no-answer' && l.sends() === 0);

l = link(() => null);
r = await writeParamVerified(T, 'WPNAV_SPEED', 500, 4, { ...l.deps, stopped: () => l.sends() >= 1 });
check('a stopped batch sends no second try', r.outcome === 'no-answer' && l.sends() === 1);

console.log(failures.length ? `\n${failures.length} param-write check(s) FAILED` : '\nAll param-write checks PASSED');
if (failures.length) process.exit(1);
