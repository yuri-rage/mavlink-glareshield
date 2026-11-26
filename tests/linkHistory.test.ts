// The Link widget's two-minute history (src/lib/messageCache.ts): a dropped link coming back keeps it (its dropout is
// what the chart shows); a reset otherwise clears it.
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { recordPacket, getLinkHistory, resetMessageCache } = await import('../src/lib/messageCache.ts');
const { MAVLINK_MSG_ID } = await import('../src/mavlink/messages.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  if (!ok) failures.push(name);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let seq = 0;
const heartbeat = () => {
  const payload = new Uint8Array(9);
  payload[4] = 1; // fixed wing
  payload[5] = 3; // ArduPilot
  recordPacket({
    messageId: MAVLINK_MSG_ID.HEARTBEAT,
    systemId: 1,
    componentId: 1,
    sequence: seq++ & 0xff,
    payload,
  } as any);
};

heartbeat();
heartbeat();
await sleep(2300);
const before = getLinkHistory().length;
check('history sampled while the link is up', before >= 2, String(before));
resetMessageCache({ keepLinkHistory: true });
check('a dropped link coming back keeps the history', getLinkHistory().length === before);
resetMessageCache();
check('any other reset clears it', getLinkHistory().length === 0);

console.log(failures.length ? `\n${failures.length} link-history check(s) FAILED` : '\nAll link-history checks PASSED');
process.exit(failures.length ? 1 : 0);
