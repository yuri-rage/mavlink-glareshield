/**
 * The last known home survives a reload: it is saved with the mission cache and restored before reconnecting, so
 * the map can open there. Only a move of home itself is written, not its distance/bearing updates.
 *
 * Run: npx tsx tests/homeCache.test.ts
 */
export {};
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const KEY = 'mavlink_glareshield_nav_cache';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}
/** A fresh copy of the store, as after a page load with the current localStorage. */
let n = 0;
const load = async () => (await import(`../src/store/telemetryStore.ts?load=${++n}` as string)).useTelemetryStore;

// 1. A saved HOME_POSITION home comes back, ahead of the mission's item 0.
mem.set(
  KEY,
  JSON.stringify({
    home: { lat: 35.1, lon: -106.6, alt: 1600, source: 'home_msg' },
    missionWaypoints: [{ seq: 0, command: 16, lat: 1, lon: 2, alt: 3, current: false }],
  })
);
{
  const h = (await load()).getState().homePosition;
  check('saved home restored, preferred over wp0', h.source === 'home_msg' && h.lat === 35.1 && h.lon === -106.6 && h.alt === 1600, JSON.stringify(h));
}

// 2. No saved home: the mission's item 0, as before.
mem.set(KEY, JSON.stringify({ missionWaypoints: [{ seq: 0, command: 16, lat: 1, lon: 2, alt: 3, current: false }] }));
{
  const h = (await load()).getState().homePosition;
  check('no saved home: falls back to wp0', h.source === 'wp0' && h.lat === 1);
}

// 3. A bad saved home (0,0, out of range, junk) is ignored.
for (const bad of [
  { lat: 0, lon: 0, alt: 0, source: 'home_msg' },
  { lat: 95, lon: 0, alt: 0, source: 'home_msg' },
  { lat: 'x', lon: 1, alt: 0, source: 'home_msg' },
  { lat: 35, lon: -106, alt: 0, source: 'none' },
]) {
  mem.set(KEY, JSON.stringify({ home: bad }));
  const h = (await load()).getState().homePosition;
  check(`bad saved home ignored: ${JSON.stringify(bad)}`, h.source === 'none');
}

// 4. Home set during a session is saved; distance/bearing updates alone are not written.
mem.delete(KEY);
{
  const store = await load();
  store.setState({ homePosition: { lat: 36.2, lon: -105.1, alt: 2000, distanceM: null, bearingDeg: null, source: 'home_msg' } });
  await sleep(500);
  const saved = JSON.parse(mem.get(KEY) ?? '{}');
  check('home from the vehicle is saved', saved.home?.lat === 36.2 && saved.home?.source === 'home_msg', JSON.stringify(saved.home));

  let writes = 0;
  const realSet = (globalThis as any).localStorage.setItem;
  (globalThis as any).localStorage.setItem = (k: string, v: string) => {
    if (k === KEY) writes++;
    realSet(k, v);
  };
  for (let i = 0; i < 5; i++) {
    store.setState({ homePosition: { ...store.getState().homePosition, distanceM: 10 + i, bearingDeg: i } });
  }
  await sleep(500);
  check('distance/bearing updates alone are not written', writes === 0, `${writes} writes`);
  (globalThis as any).localStorage.setItem = realSet;
}

console.log(failures.length ? `\n${failures.length} home cache check(s) FAILED` : '\nAll home cache checks PASSED');
process.exit(failures.length ? 1 : 0);
