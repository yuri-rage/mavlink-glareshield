/**
 * Parameter metadata matched to vehicle and firmware version (ArduPilot ParameterRepository).
 *
 * Covers version parsing (including dev builds), which folders are tried and in what order, parsing the real
 * apm.pdef.json format (a trimmed copy of Rover-4.6 in fixtures/), and the loader: falling back past missing
 * versions, working offline from the cache, preferring the exact match, and not letting a stale request win.
 *
 * Run: npx tsx tests/paramCatalog.test.ts
 */
export {};
import { readFileSync } from 'node:fs';
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { parseFirmwareVersion, catalogCandidates, parsePdefJson, repoVehicleName, describeCatalogMatch, PARAM_REPO_BASE } = await import(
  '../src/mavlink/paramCatalog.ts'
);
const { getParamMetadata, setActiveParamCatalog } = await import('../src/mavlink/paramMetadata.ts');
const { useParamMetaStore, PARAM_META_CACHE } = await import('../src/store/paramMetaStore.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function settle(): Promise<void> {
  for (let i = 0; i < 20 && useParamMetaStore.getState().status === 'loading'; i++) await tick(5);
}

// ------------------------------------------------------------------------------------------------
// Versions and vehicles
// ------------------------------------------------------------------------------------------------
const v = (s: string) => JSON.stringify(parseFirmwareVersion(s));
check('version: release', v('4.6.2') === JSON.stringify({ major: 4, minor: 6, patch: 2, type: 'official' }));
check('version: dev build', v('4.8.0-dev') === JSON.stringify({ major: 4, minor: 8, patch: 0, type: 'dev' }));
check('version: beta with number', v('4.5.0-beta2') === JSON.stringify({ major: 4, minor: 5, patch: 0, type: 'beta' }));
check('version: rc', parseFirmwareVersion('4.6.0-rc1')?.type === 'rc');
check('version: leading V, no patch', v('V4.6') === JSON.stringify({ major: 4, minor: 6, patch: 0, type: 'official' }));
check('version: nothing usable', parseFirmwareVersion('') === null && parseFirmwareVersion('abc') === null && parseFirmwareVersion(null) === null);
check('vehicle names follow the repository folders', repoVehicleName('copter') === 'Copter' && repoVehicleName('rover') === 'Rover' && repoVehicleName('plane') === 'Plane' && repoVehicleName('sub') === 'Sub' && repoVehicleName('tracker') === 'Tracker' && repoVehicleName('generic') === null);

// ------------------------------------------------------------------------------------------------
// Which folders are tried
// ------------------------------------------------------------------------------------------------
{
  const c = catalogCandidates('Rover', parseFirmwareVersion('4.6.2')!);
  check('candidates: own major.minor first, as an exact match', c[0].folder === 'Rover-4.6' && c[0].match === 'exact' && c[0].url === `${PARAM_REPO_BASE}/Rover-4.6/apm.pdef.json`);
  check('candidates: then earlier minors, marked earlier', c[1].folder === 'Rover-4.5' && c[1].match === 'earlier' && c.slice(1, 7).map((x) => x.minor).join() === '5,4,3,2,1,0');
  check('candidates: then the previous major', c[7]?.folder === 'Rover-3.9');
  check('candidates: bounded', c.length <= 12);

  const dev = catalogCandidates('Copter', parseFirmwareVersion('4.8.0-dev')!);
  check('dev build: same major.minor first, labelled as a dev match', dev[0].folder === 'Copter-4.8' && dev[0].match === 'dev-same-minor');
  check('dev build: falls back to the last release line when its own isn\'t published', dev[1].folder === 'Copter-4.7' && dev[1].match === 'earlier');

  const beta = catalogCandidates('Plane', parseFirmwareVersion('4.6.0-beta3')!);
  check('beta build: its own minor counts as exact', beta[0].folder === 'Plane-4.6' && beta[0].match === 'exact');

  const fw = parseFirmwareVersion('4.8.0-dev')!;
  check('summary says a dev match may differ', /development/.test(describeCatalogMatch('Copter', fw, dev[0])) && /differ/.test(describeCatalogMatch('Copter', fw, dev[0])));
  check('summary says an earlier match is the nearest', /nearest/.test(describeCatalogMatch('Copter', fw, dev[1])));
}

// ------------------------------------------------------------------------------------------------
// Parsing ArduPilot's apm.pdef.json
// ------------------------------------------------------------------------------------------------
const fixture = JSON.parse(readFileSync(new URL('./fixtures/rover-4.6-pdef-sample.json', import.meta.url), 'utf8'));
const cat = parsePdefJson(fixture);
{
  check('parse: every group is read, not just the vehicle\'s', ['CRUISE_SPEED', 'ARMING_CHECK', 'BATT_MONITOR', 'BATT2_MONITOR', 'SERIAL1_PROTOCOL', 'SERVO9_FUNCTION'].every((n) => n in cat), Object.keys(cat).join(','));
  check('parse: the "json" version entry is not a parameter', !('VERSION' in cat) && !('json' in cat));
  const cs = cat.CRUISE_SPEED;
  check('parse: range {low, high}, increment, units, display name', cs.min === 0 && cs.max === 100 && cs.increment === 0.1 && cs.units === 'm/s' && cs.displayName === 'Target cruise speed in auto modes' && cs.user === 'Standard');
  const bm = cat.BATT_MONITOR;
  check('parse: values keyed by number, reboot required', bm.values?.[0] === 'Disabled' && typeof bm.values?.[4] === 'string' && bm.rebootRequired === true && bm.bitmask === undefined);
  const ac = cat.ARMING_CHECK;
  check('parse: bitmask keyed by bit number', ac.bitmask?.[0] === 'All' && ac.bitmask?.[1] === 'Barometer' && ac.bitmask?.[2] === 'Compass');
  const ro = Object.values(cat).find((m) => m.readOnly);
  check('parse: read-only flag', Boolean(ro));
  check('parse: negative value keys survive', cat.SERIAL1_PROTOCOL.values?.[-1] === 'None');
  check('parse: junk input gives an empty catalogue', Object.keys(parsePdefJson(null)).length === 0 && Object.keys(parsePdefJson({ json: { version: 0 } })).length === 0);
}

// ------------------------------------------------------------------------------------------------
// Lookups go to the active catalogue first, then the built-in descriptions
// ------------------------------------------------------------------------------------------------
{
  setActiveParamCatalog(cat);
  check('lookup: active catalogue wins', getParamMetadata('cruise_speed')?.displayName === 'Target cruise speed in auto modes');
  check('lookup: built-in fallback for names the catalogue lacks', Boolean(getParamMetadata('WPNAV_SPEED')));
  setActiveParamCatalog(null);
}

// ------------------------------------------------------------------------------------------------
// The loader: fallback, cache, offline, stale requests
// ------------------------------------------------------------------------------------------------
{
  const published = new Set(['Rover-4.6', 'Rover-4.2', 'Copter-4.8']); // e.g. no Rover-4.3 / 4.4 / 4.5 in this fake
  const cacheData = new Map<string, Response>();
  const fakeCache = {
    match: async (url: string) => cacheData.get(url)?.clone(),
    put: async (url: string, res: Response) => void cacheData.set(url, res),
  };
  (globalThis as any).caches = { open: async (name: string) => (name === PARAM_META_CACHE ? fakeCache : fakeCache) };
  let online = true;
  const fetched: string[] = [];
  (globalThis as any).fetch = async (url: string) => {
    fetched.push(url);
    if (!online) throw new TypeError('Failed to fetch');
    const folder = url.split('/').slice(-2, -1)[0];
    if (!published.has(folder)) return new Response('404: Not Found', { status: 404 });
    return new Response(JSON.stringify(fixture), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const st = () => useParamMetaStore.getState();

  st().ensure('rover', '4.6.2');
  await settle();
  check('loader: exact version found and used', st().status === 'ready' && st().source?.folder === 'Rover-4.6' && st().source?.match === 'exact' && Boolean(getParamMetadata('CRUISE_SPEED')?.displayName));
  check('loader: the catalogue is cached', cacheData.has(`${PARAM_REPO_BASE}/Rover-4.6/apm.pdef.json`));

  fetched.length = 0;
  st().ensure('rover', '4.5.1');
  await settle();
  check('loader: missing versions are skipped to the nearest earlier one', st().source?.folder === 'Rover-4.2' && st().source?.match === 'earlier', `${st().source?.folder} after ${fetched.length} requests`);
  check('loader: the summary says it is the nearest version', /nearest/.test(st().summary));

  online = false;
  fetched.length = 0;
  st().ensure('rover', '4.6.0');
  await settle();
  check('loader: offline, the cached exact version is used without the network', st().source?.folder === 'Rover-4.6' && st().source?.fromCache === true && fetched.length === 0);

  online = true;
  st().ensure('copter', '4.8.0-dev');
  await settle();
  check('loader: a dev build gets its own minor, labelled dev', st().source?.folder === 'Copter-4.8' && st().source?.match === 'dev-same-minor' && /development/.test(st().summary));

  st().ensure('generic', '4.6.0');
  check('loader: no vehicle folder, nothing loaded and nothing guessed', st().status === 'idle' && st().catalog === null && getParamMetadata('CRUISE_SPEED')?.displayName === undefined);

  st().ensure('rover', null);
  check('loader: no firmware version yet, nothing loaded', st().status === 'idle');

  // A slow request for one vehicle must not overwrite a newer one.
  let release: (() => void) | undefined;
  (globalThis as any).fetch = async (url: string) => {
    if (url.includes('Plane-4.6')) await new Promise<void>((r) => (release = r));
    const folder = url.split('/').slice(-2, -1)[0];
    if (!['Plane-4.6', 'Sub-4.5'].includes(folder)) return new Response('', { status: 404 });
    return new Response(JSON.stringify(fixture), { status: 200 });
  };
  st().ensure('plane', '4.6.0');
  await tick(5);
  st().ensure('sub', '4.5.0');
  await settle();
  release?.();
  await tick(20);
  check('loader: a superseded request does not win', st().source?.folder === 'Sub-4.5', st().source?.folder);

  online = false;
  (globalThis as any).fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  st().ensure('plane', '4.1.0');
  await settle();
  check('loader: nothing cached and offline → built-in descriptions, said plainly', st().status === 'unavailable' && /built-in/.test(st().summary));
}

// ------------------------------------------------------------------------------------------------
// Bitmasks and named values (the editors)
// ------------------------------------------------------------------------------------------------
{
  const { hasBit, withBit, setBits, bitmaskSummary, bitmaskBits, sortedValueOptions, valueLabel } = await import('../src/mavlink/paramBits.ts');
  check('bits: read and set', hasBit(6, 1) && hasBit(6, 2) && !hasBit(6, 0) && withBit(6, 0, true) === 7 && withBit(6, 2, false) === 2 && withBit(6, 1, true) === 6);
  check('bits: bit 31 works (no signed 32-bit overflow)', withBit(0, 31, true) === 2147483648 && hasBit(2147483648, 31) && setBits(2147483649).join() === '0,31');
  check('bits: float values from the vehicle are rounded', hasBit(4.0000001, 2) && setBits(3.0).join() === '0,1');
  const names = cat.ARMING_CHECK.bitmask!;
  check('bits: summary names set bits, then counts the rest', bitmaskSummary(6, names) === 'Barometer, Compass' && bitmaskSummary(14, names) === 'Barometer, Compass +1' && bitmaskSummary(0, names) === 'None');
  check('bits: unnamed set bits are still reported', bitmaskSummary(2 ** 30, { 0: 'A' }) === 'bit 30');
  check('bits: definition bits in order', bitmaskBits(names).slice(0, 4).join() === '0,1,2,3');
  const opts = sortedValueOptions(cat.SERIAL1_PROTOCOL.values!);
  check('values: numeric order, negatives first', opts[0][0] === -1 && opts.every((o, i) => i === 0 || o[0] > opts[i - 1][0]));
  check('values: a float from the vehicle finds its label', valueLabel(cat.BATT_MONITOR.values, 4.0000001) === cat.BATT_MONITOR.values![4] && valueLabel(cat.BATT_MONITOR.values, 4.5) === undefined);
}

// ------------------------------------------------------------------------------------------------
// Wildcard search and Parameter set patterns
// ------------------------------------------------------------------------------------------------
{
  const { parseParamQuery, matchesParamQuery, expandParamPatterns } = await import('../src/mavlink/paramMatch.ts');
  const names = ['BATT_MONITOR', 'BATT_CAPACITY', 'BATT2_MONITOR', 'SERIAL1_PROTOCOL', 'SERVO9_FUNCTION', 'CRUISE_SPEED', 'ARMING_CHECK', 'FS_THR_ENABLE', 'FS_GCS_ENABLE'];
  const find = (q: string) => names.filter((n) => matchesParamQuery(n, cat[n], parseParamQuery(q))).join(',');
  check('search: empty matches everything', find('') === names.join(','));
  check('search: a plain word is a substring of name, short name or description', find('batt') === 'BATT_MONITOR,BATT_CAPACITY,BATT2_MONITOR' && find('cruise') === 'CRUISE_SPEED' && find('voltage') === 'BATT_MONITOR,BATT2_MONITOR');
  check('search: a wildcard matches the whole name', find('BATT_*') === 'BATT_MONITOR,BATT_CAPACITY' && find('*_ENABLE') === 'FS_THR_ENABLE,FS_GCS_ENABLE' && find('SERVO?_FUNCTION') === 'SERVO9_FUNCTION');
  check('search: wildcards add up', find('BATT_* FS_*') === 'BATT_MONITOR,BATT_CAPACITY,FS_THR_ENABLE,FS_GCS_ENABLE');
  check('search: words narrow (all must match)', find('BATT* monitoring') === 'BATT_MONITOR,BATT2_MONITOR' && find('batt capacity') === 'BATT_CAPACITY');
  check('search: a leading - leaves matches out', find('BATT* -BATT2_*') === 'BATT_MONITOR,BATT_CAPACITY' && find('-batt') === 'SERIAL1_PROTOCOL,SERVO9_FUNCTION,CRUISE_SPEED,ARMING_CHECK,FS_THR_ENABLE,FS_GCS_ENABLE');
  check('search: quotes keep words together, case ignored', find('"target speed"') === 'CRUISE_SPEED' && find('"speed target"') === '' && find('batt_*') === 'BATT_MONITOR,BATT_CAPACITY', `${find('"target speed"')} / ${find('batt_*')}`);
  check('search: commas separate terms; regex characters are literal', find('BATT_*,FS_*').split(',').length === 4 && find('BATT.*') === '');

  const set = expandParamPatterns(['CRUISE_SPEED', 'BATT*', '-BATT2_*', 'NOT_A_PARAM', 'BATT_MONITOR'], names);
  check('set: exact names keep their place, patterns add alphabetically, - excludes, no repeats',
    set.map((e) => e.name).join(',') === 'CRUISE_SPEED,BATT_CAPACITY,BATT_MONITOR,NOT_A_PARAM', set.map((e) => e.name).join(','));
  check('set: names the vehicle lacks are listed as missing', set.find((e) => e.name === 'NOT_A_PARAM')?.present === false && set.find((e) => e.name === 'CRUISE_SPEED')?.present === true);
  check('set: lower-case entries work', expandParamPatterns(['fs_*'], names).map((e) => e.name).join(',') === 'FS_GCS_ENABLE,FS_THR_ENABLE');
}

// ------------------------------------------------------------------------------------------------
// param-control fills what the widget doesn't set from the metadata
// ------------------------------------------------------------------------------------------------
{
  const { effectiveParamControl } = await import('../src/components/widgets/custom/panelModel.ts');
  const filled = effectiveParamControl({ paramId: 'CRUISE_SPEED' }, cat.CRUISE_SPEED);
  check('param-control: range, step and unit come from the metadata', filled.min === 0 && filled.max === 100 && filled.step === 0.1 && filled.unit === 'm/s');
  const own = effectiveParamControl({ paramId: 'CRUISE_SPEED', min: 1, unit: 'kn' }, cat.CRUISE_SPEED);
  check('param-control: what the widget sets wins', own.min === 1 && own.unit === 'kn' && own.max === 100);
  const opts = effectiveParamControl({ paramId: 'BATT_MONITOR' }, cat.BATT_MONITOR).options!;
  check('param-control: named values become the dropdown', opts[0].value === 0 && opts[0].label === 'Disabled' && opts.length === Object.keys(cat.BATT_MONITOR.values!).length);
  check('param-control: the widget\'s own options win', effectiveParamControl({ paramId: 'BATT_MONITOR', options: [{ label: 'Off', value: 0 }] }, cat.BATT_MONITOR).options!.length === 1);
  check('param-control: a bitmask is not turned into a dropdown', effectiveParamControl({ paramId: 'ARMING_CHECK' }, cat.ARMING_CHECK).options === undefined);
  check('param-control: no metadata, unchanged', JSON.stringify(effectiveParamControl({ paramId: 'X', step: 2 }, null)) === JSON.stringify({ paramId: 'X', step: 2 }));
}

console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll parameter catalogue checks passed');
process.exit(failures.length ? 1 : 0);
