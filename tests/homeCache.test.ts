/**
 * The last known home survives a reload, for centring the map before a fix. It is kept apart from the live home: a
 * saved home may be another site or vehicle, so it must never stand in for what the vehicle reports (or block the
 * live sources, which only fill an empty home). Only a move of home itself is written, not its distance/bearing.
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

// 1. A saved home is the last known home only; the live home starts empty, so live sources can fill it.
mem.set(KEY, JSON.stringify({ home: { lat: 35.1, lon: -106.6 } }));
{
  const st = (await load()).getState();
  check('saved home restored as lastKnownHome', st.lastKnownHome?.lat === 35.1 && st.lastKnownHome?.lon === -106.6, JSON.stringify(st.lastKnownHome));
  check('live home not taken from the saved one', st.homePosition.source === 'none', st.homePosition.source);
}

// 2. With a cached mission, the live home comes from its item 0, as before; the last known home is separate.
mem.set(KEY, JSON.stringify({ home: { lat: 35.1, lon: -106.6 }, missionWaypoints: [{ seq: 0, command: 16, lat: 1, lon: 2, alt: 3, current: false }] }));
{
  const st = (await load()).getState();
  check('cached mission item 0 still gives the live home', st.homePosition.source === 'wp0' && st.homePosition.lat === 1);
  check('…and the last known home is kept apart', st.lastKnownHome?.lat === 35.1);
}

// 3. Bad saved values (0,0, out of range, junk, old format with a source) don't crash and aren't used wrongly.
for (const bad of [{ lat: 0, lon: 0 }, { lat: 95, lon: 0 }, { lat: 'x', lon: 1 }, 'home', null]) {
  mem.set(KEY, JSON.stringify({ home: bad }));
  const st = (await load()).getState();
  check(`bad saved home ignored: ${JSON.stringify(bad)}`, st.lastKnownHome === null && st.homePosition.source === 'none');
}
mem.set(KEY, JSON.stringify({ home: { lat: 35, lon: -106, alt: 0, source: 1 } }));
{
  const st = (await load()).getState();
  check('old-format saved home: position used, its source never reaches the live home', st.lastKnownHome?.lat === 35 && st.homePosition.source === 'none');
}

// 4. Home set during a session is saved; distance/bearing updates alone are not written; a session with no live
//    home keeps the earlier one.
mem.set(KEY, JSON.stringify({ home: { lat: 30, lon: -100 } }));
{
  const store = await load();
  store.setState({ fencePoints: [] }); // something to save, with no live home
  await sleep(500);
  check('no live home this session: the earlier home is kept', JSON.parse(mem.get(KEY) ?? '{}').home?.lat === 30);

  store.setState({ homePosition: { lat: 36.2, lon: -105.1, alt: 2000, distanceM: null, bearingDeg: null, source: 'home_msg' } });
  await sleep(500);
  check('home from the vehicle is saved', JSON.parse(mem.get(KEY) ?? '{}').home?.lat === 36.2);

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
