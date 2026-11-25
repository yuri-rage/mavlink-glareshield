// Which altitude is shown for AGL and MSL (src/lib/displayAltitude.ts).
import { displayAltitudeM } from '../src/lib/displayAltitude.ts';

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  if (!ok) failures.push(name);
}
// A plane on the ground at home, 584 m above sea level (VFR_HUD.alt is MSL on ArduPilot).
const atHome = { alt: 584.1, relativeAlt: 0 };
check('AGL at home is 0 (not the VFR_HUD sea-level height)', displayAltitudeM('agl', atHome, 584.1) === 0, String(displayAltitudeM('agl', atHome, 584.1)));
check('AGL in flight is the height above home', displayAltitudeM('agl', { alt: 704.1, relativeAlt: 120 }, 704.1) === 120);
check('MSL from the position', displayAltitudeM('msl', atHome, 590) === 584.1);
check('MSL before a position arrives: VFR_HUD', displayAltitudeM('msl', { alt: 0, relativeAlt: 0 }, 584.1) === 584.1);
console.log(failures.length ? `\n${failures.length} display-altitude check(s) FAILED` : '\nAll display-altitude checks PASSED');
if (failures.length) process.exit(1);
