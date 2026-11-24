// Guided actions: the commands as each vehicle handles them.
import { changeAltitude, orbit, setHome, canOrbit, canChangeAltitude, MAV_CMD_DO_CHANGE_ALTITUDE, MAV_CMD_DO_REPOSITION, MAV_CMD_DO_SET_HOME } from '../src/mavlink/guidedActions.ts';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};
const here = { lat: 35.001, lon: -106.002, isTarget: false };

let p = changeAltitude('plane', 'AUTO', 120, here);
check('plane: DO_CHANGE_ALTITUDE, alt in param1, relative frame in param2', p?.spec.command === MAV_CMD_DO_CHANGE_ALTITUDE && p.spec.params[0] === 120 && p.spec.params[1] === 3 && !p.switchesToGuided, JSON.stringify(p?.spec));
check('plane in AUTO: says the next waypoint sets its own', /next waypoint/.test(p!.note), p!.note);
p = changeAltitude('copter', 'GUIDED', 40, { lat: 35.01, lon: -106.01, isTarget: true });
check('copter in GUIDED: reposition to the target at the new height', p?.spec.command === MAV_CMD_DO_REPOSITION && p.spec.params[4] === 350100000 && p.spec.params[5] === -1060100000 && p.spec.params[6] === 40 && !p.switchesToGuided && /Fly-to target/.test(p.note), JSON.stringify(p?.spec));
p = changeAltitude('copter', 'AUTO', 40, here);
check('copter in AUTO: switches to GUIDED (flag set), says the mission pauses', p?.switchesToGuided === true && p.spec.params[1] === 1 && /mission pauses/.test(p.note), p?.note);
check('copter without a position: nothing to send', changeAltitude('copter', 'GUIDED', 40, null) === null);
check('rover: no altitude change', changeAltitude('rover', 'GUIDED', 40, here) === null && !canChangeAltitude('rover'));
check('height of 0 or less refused', changeAltitude('plane', 'GUIDED', 0, here) === null && changeAltitude('plane', 'GUIDED', NaN, here) === null);

const o = orbit(35, -106, 100, 150, true);
check('plane orbit: reposition, radius param3, CCW param4 = 1, change-mode flag', o?.command === MAV_CMD_DO_REPOSITION && o.params[2] === 150 && o.params[3] === 1 && o.params[1] === 1 && o.params[6] === 100 && o.frame === 3, JSON.stringify(o));
check('clockwise: param4 = 0', orbit(35, -106, 100, 150, false)?.params[3] === 0);
check('no radius: nothing', orbit(35, -106, 100, 0, false) === null);
check('only Plane orbits a point', canOrbit('plane') && !canOrbit('copter') && !canOrbit('rover'));

const h = setHome({ lat: 35.5, lon: -106.5, altMslM: 1890.5 });
check('set home at a point: param1 0, GLOBAL frame, MSL altitude', h.command === MAV_CMD_DO_SET_HOME && h.params[0] === 0 && h.frame === 0 && h.params[4] === 355000000 && h.params[6] === 1890.5, JSON.stringify(h));
check('set home to the vehicle: param1 1', setHome(null).params[0] === 1);

console.log(failures.length ? `\n${failures.length} guided-action check(s) FAILED` : '\nAll guided-action checks PASSED');
if (failures.length) process.exit(1);
