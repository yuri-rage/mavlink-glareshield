import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The desktop app's own settings file (desktop/settings.ts): defaults when missing or unreadable, wrong types ignored,
// changes written and read back.
export {};

const { readSettings, SettingsFile, DEFAULT_SETTINGS } = await import('../desktop/settings.ts');

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

check('nothing: the defaults', JSON.stringify(readSettings(null)) === JSON.stringify(DEFAULT_SETTINGS));
check('a wrong type: the default', readSettings({ frameless: 'yes' }).frameless === false);
check('a value read', readSettings({ frameless: true }).frameless === true);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glareshield-settings-'));
const file = path.join(dir, 'sub', 'desktop-settings.json');
const a = new SettingsFile(file);
check('a missing file: the defaults', a.get().frameless === false);
a.set({ frameless: true });
check('written', JSON.parse(fs.readFileSync(file, 'utf8')).frameless === true);
check('read back by a new instance', new SettingsFile(file).get().frameless === true);
check('written private (0600)', process.platform === 'win32' || (fs.statSync(file).mode & 0o777) === 0o600);
fs.writeFileSync(file, '{ not json');
check('unreadable: the defaults', new SettingsFile(file).get().frameless === false);
fs.rmSync(dir, { recursive: true, force: true });

console.log(
  failures.length ? `\n${failures.length} desktop settings check(s) FAILED` : '\nAll desktop settings checks PASSED'
);
process.exit(failures.length ? 1 : 0);
