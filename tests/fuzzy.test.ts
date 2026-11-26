// Fuzzy search (src/lib/fuzzy.ts), as the Add Widget catalog uses it.
export {};
const { fuzzyScore, fuzzyFilter } = await import('../src/lib/fuzzy.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  if (!ok) failures.push(name);
}

const items = [
  { name: 'Arm & Modes', description: 'The slide-to-arm interlock and quick mode buttons.' },
  { name: 'Battery', description: 'Bus voltage, current draw, remaining capacity %.' },
  { name: 'Heads-Up Display (HUD)', description: 'Attitude, airspeed, altitude tapes.' },
  { name: 'Map', description: 'Leaflet GPS map with vehicle heading vector.' },
  { name: 'Logs', description: "The vehicle's DataFlash logs and this browser's telemetry logs." },
  { name: 'Parameters', description: 'Searchable parameter table.' },
];
const names = (q: string) => fuzzyFilter(items, q, (i) => [i.name, i.description]).map((i) => i.name);

check('empty query: everything, in order', names('').join() === items.map((i) => i.name).join());
check('a name prefix ranks first', names('bat')[0] === 'Battery', names('bat').join());
check(
  'letters in order, not together: "hud" and "hds"',
  names('hud')[0].startsWith('Heads') && names('hds')[0].startsWith('Heads')
);
check('every word must match: "bat volt"', names('bat volt').join() === 'Battery', names('bat volt').join());
check('a word from the description', names('dataflash').join() === 'Logs');
check('nothing matches: empty', names('zzz').length === 0);
check('case does not matter', names('MAP')[0] === 'Map');
check('the name outranks the description', names('map')[0] === 'Map', names('map').join());
check(
  'a word start beats letters scattered inside a word',
  (fuzzyScore('pa', ['Parameters']) ?? 0) > (fuzzyScore('pa', ['Map table']) ?? 0)
);

console.log(failures.length ? `\n${failures.length} fuzzy check(s) FAILED` : '\nAll fuzzy checks PASSED');
process.exit(failures.length ? 1 : 0);
