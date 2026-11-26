// Leaving or changing the live link: the failsafe note names each vehicle's own parameters, the confirmation doesn't
// block the page (an in-app dialog, answered asynchronously), and a link change starts the vehicle roster over.
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { gcsFailsafeNote, confirmLeavingLiveLink, liveVehicle } = await import('../src/mavlink/replay.ts');
const { useTelemetryStore } = await import('../src/store/telemetryStore.ts');
const { askConfirm, answerConfirm, useConfirmStore } = await import('../src/store/confirmStore.ts');
const { observePacket, useVehicleRosterStore, onLinkDown, resetRoster } =
  await import('../src/mavlink/vehicleRoster.ts');
const { mavlinkConnection } = await import('../src/mavlink/connection.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  if (!ok) failures.push(name);
}

// Plane: FS_GCS_ENABL, with its short and long failsafe timeouts. Copter: FS_GCS_ENABLE / FS_GCS_TIMEOUT.
const PLANE = 1;
const COPTER = 2;
const plane = gcsFailsafeNote(
  { FS_GCS_ENABL: { value: 1 }, FS_SHORT_TIMEOUT: { value: 1.5 }, FS_LONG_TIMEOUT: { value: 5 } },
  PLANE
);
check('Plane, on: names FS_GCS_ENABL', /FS_GCS_ENABL = 1/.test(plane) && !/FS_GCS_ENABLE/.test(plane), plane);
check('Plane, on: its short and long timeouts', /1\.5 s \(short failsafe\) and 5 s \(long\)/.test(plane), plane);
check('Plane, unknown: names FS_GCS_ENABL', /\(FS_GCS_ENABL\) is on/.test(gcsFailsafeNote({}, PLANE)));
check('Plane, off', /off \(FS_GCS_ENABL = 0\)/.test(gcsFailsafeNote({ FS_GCS_ENABL: { value: 0 } }, PLANE)));
const copter = gcsFailsafeNote({ FS_GCS_ENABLE: { value: 2 }, FS_GCS_TIMEOUT: { value: 3 } }, COPTER);
check('Copter, on: FS_GCS_ENABLE and FS_GCS_TIMEOUT', /FS_GCS_ENABLE = 2.*about 3 s/.test(copter), copter);
check('Copter, unknown', /\(FS_GCS_ENABLE\) is on/.test(gcsFailsafeNote({}, COPTER)));

// The in-app confirmation: a promise answered by the dialog's buttons; a newer question cancels an older one.
(globalThis as any).document ??= {};
const first = askConfirm({ title: 'A', message: ['?'], confirmLabel: 'Go' });
check('a question is open', useConfirmStore.getState().open?.title === 'A');
const second = askConfirm({ title: 'B', message: ['?'], confirmLabel: 'Go' });
check('a newer question cancels the older', (await first) === false && useConfirmStore.getState().open?.title === 'B');
answerConfirm(true);
check('confirm resolves true and closes', (await second) === true && useConfirmStore.getState().open === null);
const third = askConfirm({ title: 'C', message: ['?'], confirmLabel: 'Go' });
answerConfirm(false);
check('cancel resolves false', (await third) === false);

// A link change starts the roster over, even after a drop (when the roster is kept to reconnect to the same vehicle).
const HB = 0;
const hb = (sys: number, armed = false) =>
  [
    { messageId: HB, systemId: sys, componentId: 1, payload: new Uint8Array() } as any,
    { type: 1, autopilot: 3, base_mode: armed ? 0x80 : 0, custom_mode: 0 },
  ] as const;
resetRoster();
observePacket(...hb(1, true), 1000);
onLinkDown(false); // dropped: kept
check('a drop keeps the active vehicle', useVehicleRosterStore.getState().activeSystemId === 1);
mavlinkConnection.setLink({ kind: 'websocket', url: 'ws://other-bridge.example:56781' } as any);
check(
  'another link: the roster starts over',
  useVehicleRosterStore.getState().activeSystemId === null &&
    Object.keys(useVehicleRosterStore.getState().vehicles).length === 0
);
observePacket(...hb(7), 2000);
check("the new link's first vehicle is active", useVehicleRosterStore.getState().activeSystemId === 7);

// A dropped link reconnecting by itself: the store's heartbeat is cleared, but the roster keeps the vehicle, so
// leaving it for a replay still asks (an armed vehicle named as such) and Stop & reconnect can be offered.
resetRoster();
observePacket(...hb(3, true), 5000);
onLinkDown(false);
useTelemetryStore.setState((st) => ({ heartbeat: { ...st.heartbeat, lastHeartbeatTime: 0, isArmed: false, type: 0 } }));
const lv = liveVehicle();
check(
  'after a drop: the live vehicle comes from the roster, armed, reconnecting',
  lv?.sysId === 3 && lv.armed && lv.reconnecting,
  JSON.stringify(lv)
);
const asked = confirmLeavingLiveLink();
check(
  'after a drop: leaving it for a replay asks, naming it armed and reconnecting',
  /Vehicle 3 is ARMED/.test(useConfirmStore.getState().open?.title ?? '') &&
    /reconnecting/.test(useConfirmStore.getState().open?.message.join(' ') ?? ''),
  JSON.stringify(useConfirmStore.getState().open)
);
answerConfirm(false);
check('cancel: no replay', (await asked) === false);
resetRoster();
check('after a deliberate disconnect (roster reset): nothing to leave, no question', liveVehicle() === null);

console.log(failures.length ? `\n${failures.length} live-link check(s) FAILED` : '\nAll live-link checks PASSED');
process.exit(failures.length ? 1 : 0);
