// COMMAND_ACK matching (src/store/telemetryStore.ts): a command is answered only by the component it went to (a
// gimbal or camera ACKing the same command ID isn't the autopilot's answer, and doesn't overwrite the operator's
// feedback), and an ACK addressed to another ground station is ignored. Each tracked send carries its own label.
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { mavlinkConnection } = await import('../src/mavlink/connection.ts');
const { useTelemetryStore, sendTrackedCommand, matchPendingAck } = await import('../src/store/telemetryStore.ts');
const { MavlinkEncoder } = await import('../src/mavlink/encoder.ts');
const { MavlinkParser } = await import('../src/mavlink/parser.ts');

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

// Sends go to the send listeners (where pending commands are registered), not a link.
(mavlinkConnection as any).send = (d: Uint8Array) => {
  for (const cb of (mavlinkConnection as any).sendListeners) cb(d);
  return true;
};
const parser = new MavlinkParser();
const gcs = new MavlinkEncoder(255, 190);
const ack = (fromComp: number, command: number, result: number, targetSys = 255, targetComp = 190) => {
  const p = new Uint8Array(10);
  const v = new DataView(p.buffer);
  v.setUint16(0, command, true);
  p[2] = result;
  p[8] = targetSys;
  p[9] = targetComp;
  for (const pkt of parser.parse(new MavlinkEncoder(1, fromComp).packV2(77, p)))
    useTelemetryStore.getState().processPacket(pkt);
};
const settled = (p: Promise<any>): Promise<boolean> =>
  Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 30))]);

// The helper: first pending to the answering component; 0 targets match any.
check(
  'match: the component the command went to',
  matchPendingAck(
    [
      { targetSys: 1, targetComp: 154 },
      { targetSys: 1, targetComp: 1 },
    ],
    { systemId: 1, componentId: 1 }
  ) === 1
);
check(
  'match: target 0 (broadcast) takes any component',
  matchPendingAck([{ targetSys: 1, targetComp: 0 }], { systemId: 1, componentId: 154 }) === 0
);
check(
  'match: none from another system',
  matchPendingAck([{ targetSys: 2, targetComp: 1 }], { systemId: 1, componentId: 1 }) === -1
);

// A command to the autopilot (1/1); a gimbal (1/154) answers the same command ID first.
const p1 = sendTrackedCommand(gcs.createCommandLong(1, 1, 176, [1, 4, 0, 0, 0, 0, 0]), {
  label: 'Mode GUIDED',
  targetKey: 'mode',
});
ack(154, 176, 4); // the gimbal says FAILED
check("a gimbal's ACK doesn't answer the autopilot's command", !(await settled(p1)));
const fb = useTelemetryStore.getState().commandFeedback;
check('…nor overwrite the feedback', fb?.status === 'pending' && fb.label === 'Mode GUIDED', JSON.stringify(fb));

// An ACK addressed to another GCS (system 254) for the same command: not ours.
ack(1, 176, 4, 254, 190);
check('an ACK to another ground station is ignored', !(await settled(p1)));

// The autopilot's own ACK answers it.
ack(1, 176, 0);
check("the autopilot's ACK answers it", await settled(p1));
check(
  'accepted, labelled as sent',
  useTelemetryStore.getState().commandFeedback?.status === 'accepted' &&
    useTelemetryStore.getState().commandFeedback?.label === 'Mode GUIDED'
);

// Two tracked commands to different components, answered out of order: each gets its own answer and label.
const toGimbal = sendTrackedCommand(gcs.createCommandLong(1, 154, 205, [10, 0, 0, 0, 0, 0, 0]), {
  label: 'Gimbal pitch',
  targetKey: 'g',
});
const toAp = sendTrackedCommand(gcs.createCommandLong(1, 1, 205, [20, 0, 0, 0, 0, 0, 0]), {
  label: 'AP mount',
  targetKey: 'a',
});
ack(1, 205, 0);
check(
  'out of order: the autopilot ACK answers the autopilot command',
  (await settled(toAp)) && !(await settled(toGimbal))
);
ack(154, 205, 4);
const g = await toGimbal;
check('…and the gimbal ACK the gimbal command', g.result === 4);

// Two vehicles, and the active one switched: a command sent to the other (the takeoff sequence standing it down)
// still gets its answer, and the active vehicle's feedback is left alone.
{
  const { switchToVehicle } = await import('../src/mavlink/vehicleRoster.ts');
  const heartbeat = (sys: number) => {
    const hb = new Uint8Array(9);
    hb[4] = 2; // quadrotor
    hb[5] = 3; // ArduPilot
    hb[8] = 3;
    for (const pkt of parser.parse(new MavlinkEncoder(sys, 1).packV2(0, hb)))
      useTelemetryStore.getState().processPacket(pkt);
  };
  heartbeat(1);
  heartbeat(2);
  switchToVehicle(2);
  heartbeat(2);
  const disarm = sendTrackedCommand(gcs.createCommandLong(1, 1, 400, [0, 0, 0, 0, 0, 0, 0]), {
    label: 'Auto-Takeoff Stopped: Safety Disarm',
    targetKey: 'arm',
  });
  ack(1, 400, 0, 255, 190); // from vehicle 1, no longer active
  const answered = await settled(disarm);
  check('an inactive vehicle answers a command sent to it: answered', answered);
  check('…ACCEPTED', answered && (await disarm).result === 0);
  const fb = useTelemetryStore.getState().commandFeedback;
  check(
    'its toast is finished (accepted), not left pending',
    fb?.label === 'Auto-Takeoff Stopped: Safety Disarm' && fb?.status === 'accepted',
    `${fb?.label}: ${fb?.status}`
  );
  // A command to the active vehicle sent since: an ACK from the other vehicle doesn't touch its toast.
  const other = sendTrackedCommand(gcs.createCommandLong(1, 1, 400, [0, 0, 0, 0, 0, 0, 0]), { label: 'Disarm 1' });
  const mine = sendTrackedCommand(gcs.createCommandLong(2, 1, 176, [1, 4, 0, 0, 0, 0, 0]), { label: 'Loiter on 2' });
  ack(1, 400, 0, 255, 190);
  check(
    "the inactive vehicle's ACK leaves the active vehicle's toast alone",
    useTelemetryStore.getState().commandFeedback?.label === 'Loiter on 2' &&
      useTelemetryStore.getState().commandFeedback?.status === 'pending',
    `${useTelemetryStore.getState().commandFeedback?.label}: ${useTelemetryStore.getState().commandFeedback?.status}`
  );
  void other;
  void mine;
}

console.log(failures.length ? `\n${failures.length} command-ACK check(s) FAILED` : '\nAll command-ACK checks PASSED');
process.exit(failures.length ? 1 : 0);
