// Which vehicle is active with several on one link (src/mavlink/vehicleRoster.ts).
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { decideHeartbeat, observePacket, resetRoster, switchToVehicle, dismissTakeoverOffer, onActiveVehicleChange, useVehicleRosterStore, SILENT_MS } = await import(
  '../src/mavlink/vehicleRoster.ts'
);

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  if (!ok) failures.push(name);
}

// Pure rules.
check('first vehicle: active', decideHeartbeat({ activeSystemId: null, activeLastHeard: 0, multiSeen: false }, 3, 1000).kind === 'activate');
check('active heard, another: noted together', JSON.stringify(decideHeartbeat({ activeSystemId: 1, activeLastHeard: 1000, multiSeen: false }, 2, 2000)) === '{"kind":"none","multi":true}');
check('only vehicle went silent, another: taken over', decideHeartbeat({ activeSystemId: 1, activeLastHeard: 1000, multiSeen: false }, 2, 1000 + SILENT_MS + 1).kind === 'activate');
check('after two together, active silent: offered, not taken', decideHeartbeat({ activeSystemId: 1, activeLastHeard: 1000, multiSeen: true }, 2, 1000 + SILENT_MS + 1).kind === 'offer');

// Packets in sequence.
const HB = 0, GPI = 33;
const hb = (sys: number, armed = false) => [{ messageId: HB, systemId: sys, componentId: 1, payload: new Uint8Array() } as any, { type: 1, autopilot: 3, base_mode: armed ? 0x80 : 0, custom_mode: 0 }] as const;
const gcs = (sys: number) => [{ messageId: HB, systemId: sys, componentId: 190, payload: new Uint8Array() } as any, { type: 6, autopilot: 8, base_mode: 0, custom_mode: 0 }] as const;
const switches: string[] = [];
onActiveVehicleChange((to, from) => switches.push(`${from}->${to}`));
const st = () => useVehicleRosterStore.getState();

resetRoster();
let t = 10_000;
observePacket(...gcs(255), t);
check('a GCS heartbeat is not a vehicle', st().activeSystemId === null && Object.keys(st().vehicles).length === 0);
observePacket(...hb(1), t);
observePacket(...hb(2), (t += 100));
check('first heard is active; both listed', st().activeSystemId === 1 && Object.keys(st().vehicles).length === 2, JSON.stringify(st().activeSystemId));
check('no switch event for the first vehicle', switches.length === 0, switches.join());
observePacket({ messageId: GPI, systemId: 2, componentId: 1, payload: new Uint8Array() } as any, { lat: -35.36, lon: 149.17, relative_alt: 120.5, hdg: 90, rawHdg: 9000 }, (t += 600));
const v2 = st().vehicles[2];
check('other vehicle position listed', v2?.lat === -35.36 && v2?.relAlt === 120.5 && v2?.heading === 90, JSON.stringify(v2));
// Vehicle 1 goes silent; 2 keeps sending.
t += SILENT_MS + 1000;
observePacket(...hb(2), t);
check('active silent, other heard: offered', st().takeoverOffer === 2 && st().activeSystemId === 1, JSON.stringify({ o: st().takeoverOffer, a: st().activeSystemId }));
dismissTakeoverOffer();
observePacket(...hb(2), (t += 1000));
check('dismissed: not offered again', st().takeoverOffer === null);
// A third vehicle: keeping waiting covers it too (no offer bouncing between the others).
observePacket(...hb(3), (t += 100));
observePacket(...hb(2), (t += 100));
check('keep waiting: no offer of any other vehicle', st().takeoverOffer === null && st().activeSystemId === 1);
observePacket(...hb(1), (t += 1000));
check('active back: still active, nothing switched', st().activeSystemId === 1 && switches.length === 0);
switchToVehicle(2);
check('user switch: active 2, event once', st().activeSystemId === 2 && switches.join() === '1->2', switches.join());
switchToVehicle(2);
check('switching to the active one: no event', switches.length === 1);

// One vehicle at a time (rebooted with another ID): taken over at once.
resetRoster();
switches.length = 0;
t = 100_000;
observePacket(...hb(1), t);
observePacket(...hb(7), (t += SILENT_MS + 500));
check('single vehicle replaced: taken over, with a switch event', st().activeSystemId === 7 && switches.join() === '1->7', switches.join());

console.log(failures.length ? `\n${failures.length} vehicle-roster check(s) FAILED` : '\nAll vehicle-roster checks PASSED');
if (failures.length) process.exit(1);
