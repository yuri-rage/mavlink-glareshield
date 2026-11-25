// The build ID (scripts/buildInfo.mjs) and noticing a newer deploy (src/lib/updateCheck.ts).
import { describeBuild } from '../scripts/buildInfo.mjs';
import { buildLabel, newerDeploy } from '../src/lib/updateCheck.ts';

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  if (!ok) failures.push(name);
}

const sha = '55b37e4a1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f';
const b = describeBuild({ sha, date: '2026-11-25' });
check('ID from the commit date and short hash', b.id === '2026.11.25-55b37e4' && b.date === '2026.11.25' && b.sha === sha, JSON.stringify(b));
check('uncommitted changes: marked +, with the build time', describeBuild({ sha, date: '2026-11-25', dirty: true, now: new Date('2026-11-25T14:03:09Z') }).id === '2026.11.25-55b37e4+t140309');
const noGit = describeBuild({ sha: null, date: null, now: new Date('2026-11-25T14:03:09Z') });
check('without a commit: the build time keeps IDs distinct', noGit.id === '2026.11.25-t140309' && noGit.sha === null, noGit.id);

check('label: date and short hash', buildLabel(b) === '2026.11.25 · 55b37e4', buildLabel(b));
check('label: dirty', buildLabel(describeBuild({ sha, date: '2026-11-25', dirty: true })) === '2026.11.25 · 55b37e4+');
check('label: dev', buildLabel({ id: 'dev', sha: null, date: null, dirty: false }) === 'dev');

check('same deploy: nothing to offer', newerDeploy(b.id, { id: b.id }) === null);
check('another deploy: offered', newerDeploy(b.id, { id: '2026.11.26-0a1b2c3' }) === '2026.11.26-0a1b2c3');
check('dev server: never offered', newerDeploy('dev', { id: '2026.11.26-0a1b2c3' }) === null);
check('unreadable answers ignored', [null, 'x', {}, { id: 5 }, { id: '' }, { id: 'x'.repeat(65) }].every((v) => newerDeploy(b.id, v) === null));

console.log(failures.length ? `\n${failures.length} build-info check(s) FAILED` : '\nAll build-info checks PASSED');
if (failures.length) process.exit(1);
