/**
 * ESC telemetry beyond four ESCs: ESC_TELEMETRY_5_TO_8 (and 9_TO_12) land at their places in the store, the ESC
 * multi-bars show as many ESCs as report, and those widgets ask for every block. Frames packed by pymavlink.
 *
 * Run: npx tsx tests/esc.test.ts
 */
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { MavlinkParser } = await import('../src/mavlink/parser.ts');
const { useTelemetryStore } = await import('../src/store/telemetryStore.ts');
const { extractMultiBarItems, requiredMessageIds } = await import('../src/components/widgets/custom/panelModel.ts');
const { MAVLINK_MSG_ID } = await import('../src/mavlink/messages.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}
const frame = (hex: string) => new MavlinkParser().parse(Uint8Array.from(Buffer.from(hex, 'hex')))[0];
const st = () => useTelemetryStore.getState();

check('before any ESC telemetry: 4 ESCs shown', extractMultiBarItems('esc-rpm', st()).length === 4);
st().processPacket(
  frame(
    'fd2c0000000101162b00dc05dc05dc05dc05e8034c04b00414050a000b000c000d008813ec135014b414010001000100010028292a2b8738'
  )
);
check('ESCs 1-4 only: still 4', st().esc.count === 4 && extractMultiBarItems('esc-rpm', st()).length === 4);
st().processPacket(
  frame(
    'fd2c0000000101172b00dc05dc05dc05dc05d00734089808fc0814001500160017007017d41738189c18010001000100010032333435112c'
  )
);
const e = st().esc;
check(
  'ESCs 5-8 stored at their places, 1-4 kept',
  e.count === 8 &&
    e.rpm[0] === 5000 &&
    e.rpm[3] === 5300 &&
    e.rpm[4] === 6000 &&
    e.rpm[7] === 6300 &&
    e.temperature[5] === 51 &&
    e.current[6] === 22,
  JSON.stringify(e.rpm)
);
const rpm = extractMultiBarItems('esc-rpm', st());
check(
  'the ESC RPM bars show all 8, labeled ESC1-ESC8',
  rpm.length === 8 && rpm[7].label === 'ESC8' && rpm[7].value === 6300,
  rpm.map((i: any) => `${i.label}=${i.value}`).join(' ')
);
check(
  'temperature and current bars too',
  extractMultiBarItems('esc-temp', st()).length === 8 && extractMultiBarItems('esc-current', st())[4].value === 20
);
st().processPacket(
  frame(
    'fd2c0000000101162b00dc05dc05dc05dc05e8034c04b00414050a000b000c000d008813ec135014b414010001000100010028292a2b8738'
  )
);
check("a later 1-4 block doesn't shrink it back", st().esc.count === 8 && st().esc.rpm[4] === 6000);
const def = {
  id: 'w',
  name: 'W',
  category: 'telemetry',
  displayType: 'multi-bar',
  multiBarConfig: { group: 'esc-rpm' },
} as any;
const ids = requiredMessageIds(def);
check(
  'ESC widgets ask for every block',
  [
    MAVLINK_MSG_ID.ESC_TELEMETRY_1_TO_4,
    MAVLINK_MSG_ID.ESC_TELEMETRY_5_TO_8,
    MAVLINK_MSG_ID.ESC_TELEMETRY_9_TO_12,
  ].every((id) => ids.includes(id)),
  JSON.stringify(ids)
);

console.log(failures.length ? `\n${failures.length} ESC check(s) FAILED` : '\nAll ESC checks PASSED');
process.exit(failures.length ? 1 : 0);
