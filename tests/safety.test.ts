/**
 * Safety and correctness fixes from the codebase review:
 *
 *  - COMMAND_ACK MAV_RESULT_IN_PROGRESS keeps a command pending until the final result
 *  - Parameters: stored values from an earlier connection are flagged and refreshed; another vehicle clears them
 *  - Profile import lists every way an imported widget can act on the vehicle (composites, parameter writes,
 *    built-ins), not only plain command buttons
 *  - Saved widgets are sanitized on load without overriding their owner's confirmation settings
 *
 * Run: npx tsx tests/safety.test.ts
 */
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { mavlinkConnection } = await import('../src/mavlink/connection.ts');
const { useTelemetryStore, sendTrackedCommand } = await import('../src/store/telemetryStore.ts');
const { paramManager } = await import('../src/mavlink/paramManager.ts');
const { mavFtpClient } = await import('../src/mavlink/ftp.ts');
const { MAVLINK_MSG_ID } = await import('../src/mavlink/messages.ts');
const { sanitizeWidgetDefinition } = await import('../src/lib/widgetValidation.ts');
const { profileVehicleControls, widgetVehicleControls } = await import('../src/lib/vehicleControls.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const conn = mavlinkConnection as any;
const sent: Uint8Array[] = [];
conn.transport = { send: async (d: Uint8Array) => void sent.push(d) };
conn.status = 'connected';
const emit = (messageId: number, payload: Uint8Array, systemId = 1, componentId = 1) => {
  const packet = { version: 2, sequence: 0, systemId, componentId, messageId, payload, crc: 0, raw: new Uint8Array() };
  conn.packetListeners.forEach((l: (p: unknown) => void) => l(packet));
};
const heartbeat = (systemId: number, type: number) => {
  const p = new Uint8Array(9);
  p[4] = type; // MAV_TYPE
  p[5] = 3; // MAV_AUTOPILOT_ARDUPILOTMEGA
  p[6] = 0x80;
  p[8] = 3;
  emit(MAVLINK_MSG_ID.HEARTBEAT, p, systemId, 1);
};
const ack = (command: number, result: number) => {
  const p = new Uint8Array(10);
  new DataView(p.buffer).setUint16(0, command, true);
  p[2] = result;
  emit(MAVLINK_MSG_ID.COMMAND_ACK, p);
};

// ------------------------------------------------------------------------------------------------
// COMMAND_ACK IN_PROGRESS
// ------------------------------------------------------------------------------------------------
{
  heartbeat(1, 10);
  const enc = mavlinkConnection.getEncoder();
  const CMD = 183; // MAV_CMD_DO_SET_SERVO
  let settled: { result: number; resultText: string } | null = null;
  void sendTrackedCommand(enc.createCommandLong(1, 1, CMD, [5, 1500, 0, 0, 0, 0, 0]), { label: 'Servo test' }).then(
    (a) => (settled = a)
  );
  ack(CMD, 5); // IN_PROGRESS
  await wait(20);
  check('IN_PROGRESS does not settle the command', settled === null);
  check('IN_PROGRESS shows as pending feedback', useTelemetryStore.getState().commandFeedback?.status === 'pending');
  ack(CMD, 0); // ACCEPTED
  await wait(20);
  check('the final ACCEPTED settles it', (settled as { result: number } | null)?.result === 0, JSON.stringify(settled));
  check('feedback shows accepted', useTelemetryStore.getState().commandFeedback?.status === 'accepted');
  let plain: { result: number } | null = null;
  void sendTrackedCommand(enc.createCommandLong(1, 1, CMD, [5, 1500, 0, 0, 0, 0, 0])).then((a) => (plain = a));
  ack(CMD, 4); // FAILED, no IN_PROGRESS first
  await wait(20);
  check('a plain final ACK still settles at once', (plain as { result: number } | null)?.result === 4);
}

// ------------------------------------------------------------------------------------------------
// Parameters across connections
// ------------------------------------------------------------------------------------------------
{
  const pm = paramManager as any;
  let status: any = {};
  paramManager.onStatusChange((s) => (status = s));
  // A full list for vehicle 1 (Rover), as a download leaves it.
  heartbeat(1, 10);
  const list = { RTL_SPEED: { value: 2, type: 9, index: 0 }, WP_SPEED: { value: 1.6, type: 9, index: 1 } };
  pm.applyFullList(list, 'ftp', 'test');
  check('list loaded: counted, not old', status.paramCount === 2 && !status.fromPreviousConnection);

  // The link drops.
  conn.setStatus('disconnected');
  check('after a disconnect the count resets and values are flagged as old', status.paramCount === 0 && status.fromPreviousConnection === true);
  check('…and the values are kept for the same vehicle', Object.keys(useTelemetryStore.getState().parameters).length === 2);

  // Same vehicle back: a background read is started (MAVFTP), which clears the flag.
  const reads: string[] = [];
  (mavFtpClient as any).readFile = async (_s: number, _c: number, path: string) => {
    reads.push(path);
    return null; // no MAVFTP: the flag stays, the Parameters widget refreshes instead
  };
  conn.transport = { send: async () => {} };
  conn.status = 'connected';
  heartbeat(1, 10);
  await wait(400);
  check('same vehicle back: values are read again in the background', reads.some((r) => r.includes('param.pck')), reads.join(' '));
  check('…and stay flagged until that succeeds', status.fromPreviousConnection === true);

  // A second vehicle heard alongside the first (a shared network) doesn't touch the list.
  heartbeat(2, 10);
  check('a second vehicle heard at the same time keeps the list', Object.keys(useTelemetryStore.getState().parameters).length === 2);

  // A different vehicle replacing it (the first has been quiet): its list is not the stored one.
  pm.ownerSeenAt = Date.now() - 6000;
  heartbeat(2, 10);
  check('another vehicle clears the stored values', Object.keys(useTelemetryStore.getState().parameters).length === 0);
  check('…and the old-values flag', !status.fromPreviousConnection && status.paramCount === 0);
}

// ------------------------------------------------------------------------------------------------
// Import warnings: everything that can act on the vehicle
// ------------------------------------------------------------------------------------------------
{
  const profile = {
    customWidgets: [
      { id: 'a', name: 'Plain readout', category: 'custom', displayType: 'stat-card', binding: { messageName: 'VFR_HUD', fieldName: 'groundspeed' } },
      { id: 'b', name: 'Speed knob', category: 'control', displayType: 'param-control', paramControl: { paramId: 'WP_SPEED', confirmation: false } },
      { id: 'c', name: 'Tuning set', category: 'control', displayType: 'param-set', paramSet: { params: ['ATC_STR_RAT_*'], confirmation: false } },
      {
        id: 'd',
        name: 'Combo',
        category: 'custom',
        displayType: 'composite',
        panels: [
          { displayType: 'action-button', action: { label: 'Relay on', commandId: 181, params: [0, 1, 0, 0, 0, 0, 0] } },
          { displayType: 'builtin', widgetId: 'built-in-glareshield' },
        ],
      },
    ],
    tabs: [{ id: 't', title: 'T', widgets: [{ instanceId: 'x', widgetId: 'built-in-logs' }, { instanceId: 'y', widgetId: 'built-in-hud' }] }],
  } as any;
  const found = profileVehicleControls(profile);
  const byName = Object.fromEntries(found.map((f) => [f.name, f]));
  check('import warning: a plain readout is not listed', !byName['Plain readout']);
  check('import warning: parameter control', byName['Speed knob']?.controls.join() === 'writes parameter WP_SPEED');
  check('import warning: parameter set', /writes parameters ATC_STR_RAT_\*/.test(byName['Tuning set']?.controls.join() ?? ''));
  check('import warning: composite panels, including a built-in with controls', byName['Combo']?.controls.length === 2, JSON.stringify(byName['Combo']));
  check('import warning: built-ins with controls placed on tabs', byName['Onboard Logs']?.builtin === true && !byName['Heads-Up Display (HUD)']);
  check('widget import uses the same detection', widgetVehicleControls(profile.customWidgets[1]).length === 1);

  // Sanitizing: imports force confirmation; loading your own saved widgets keeps your setting.
  const imported = sanitizeWidgetDefinition(profile.customWidgets[1]);
  const loaded = sanitizeWidgetDefinition(profile.customWidgets[1], { forceConfirmation: false });
  check('import forces confirmation on parameter writes', imported.paramControl?.confirmation === true);
  check('loading a saved widget keeps its owner\'s choice', loaded.paramControl?.confirmation === false);
  const loadedSet = sanitizeWidgetDefinition(profile.customWidgets[2], { forceConfirmation: false });
  check('…for parameter sets too', loadedSet.paramSet?.confirmation === false);
  const importedCombo = sanitizeWidgetDefinition(profile.customWidgets[3]);
  check('import forces confirmation inside composite panels', importedCombo.panels?.[0].action?.confirmation === true);
  const broken = sanitizeWidgetDefinition({ id: 'z', name: 'z', category: 'custom', displayType: 'param-control', paramControl: 'nonsense' } as any, { forceConfirmation: false });
  check('a malformed saved parameter control is dropped, not loaded as is', broken.paramControl === undefined);
}

console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join('; ')}` : '\nAll safety checks passed');
process.exit(failures.length ? 1 : 0);
