// The last vehicle remembered for planning offline: its type and the waypoint-radius parameters it sent.
import { useTelemetryStore } from '../src/store/telemetryStore.ts';
import { planningVehicle, useLastVehicleStore } from '../src/store/lastVehicleStore.ts';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};
const T = useTelemetryStore;
const hb = (type: number, linked = true) =>
  T.setState((s) => ({ heartbeat: { ...s.heartbeat, type, lastHeartbeatTime: linked ? Date.now() : 0, modeName: linked ? 'MANUAL' : 'DISCONNECTED' } }));
const param = (name: string, value: number) => T.setState((s) => ({ parameters: { ...s.parameters, [name]: { value, type: 9, index: 0 } } }));
const show = () => JSON.stringify(useLastVehicleStore.getState());

// A plane from a previous session left WP_RADIUS in the store before this connection.
param('WP_RADIUS', 999);
hb(1);
check('connected plane: type remembered', useLastVehicleStore.getState().type === 1, show());
check('a value from before the connection is not taken', useLastVehicleStore.getState().params.WP_RADIUS === undefined, show());
param('WP_RADIUS', 70);
param('WP_LOITER_RAD', 80);
check('radius parameters the vehicle sends are remembered', useLastVehicleStore.getState().params.WP_RADIUS === 70 && useLastVehicleStore.getState().params.WP_LOITER_RAD === 80, show());

hb(0, false);
const off = planningVehicle();
check('offline: plans with the last vehicle', off.type === 1 && off.params.WP_RADIUS === 70, JSON.stringify(off));

param('WP_RADIUS', 5); // a value changing while disconnected isn't the vehicle's
check('offline changes are not remembered', useLastVehicleStore.getState().params.WP_RADIUS === 70, show());

hb(2); // a copter connects
check('another vehicle type starts over', useLastVehicleStore.getState().type === 2 && Object.keys(useLastVehicleStore.getState().params).length === 0, show());
param('WPNAV_RADIUS_M', 1.5);
check('connected: plans with the live vehicle', planningVehicle().type === 2 && planningVehicle().params.WPNAV_RADIUS_M === 1.5, JSON.stringify(planningVehicle()));

// A plane's WP_RADIUS still in the store when a rover connects: not the rover's.
hb(0, false);
param('WP_RADIUS', 90);
hb(10); // rover
check('connected: a value left by the previous vehicle is not used', planningVehicle().type === 10 && planningVehicle().params.WP_RADIUS === undefined, JSON.stringify(planningVehicle()));
param('WP_RADIUS', 2);
check('the rover\'s own WP_RADIUS once it sends it', planningVehicle().params.WP_RADIUS === 2, JSON.stringify(planningVehicle()));

// A Copter 4.7+ was remembered (WPNAV_RADIUS_M); an older Copter (WPNAV_RADIUS, cm) connects.
hb(0, false);
hb(2);
param('WPNAV_RADIUS_M', 3);
hb(0, false);
hb(2);
param('WPNAV_RADIUS', 150);
check('an older Copter\'s WPNAV_RADIUS replaces the remembered WPNAV_RADIUS_M', planningVehicle().params.WPNAV_RADIUS === 150 && planningVehicle().params.WPNAV_RADIUS_M === undefined, JSON.stringify(planningVehicle()));

console.log(failures.length ? `\n${failures.length} last-vehicle check(s) FAILED` : '\nAll last-vehicle checks PASSED');
if (failures.length) process.exit(1);
