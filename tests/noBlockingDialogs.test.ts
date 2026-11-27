// No native alert / confirm / prompt in the app: they block the page's JavaScript while open, the 1 Hz heartbeat to
// the vehicle included, which an armed vehicle with FS_GCS_ENABLE takes as a lost ground station. Use askConfirm() or
// showNotice() (src/store/confirmStore.ts).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name)) files.push(p);
  }
};
walk(src);

// A call, not a mention: `alert(`, `window.confirm(`, `prompt(`; not `askConfirm(`, `.confirmLabel`, or a comment.
const call = /(?<![\w.$])(?:window\.)?(alert|confirm|prompt)\s*\(/;
const hits: string[] = [];
for (const f of files) {
  readFileSync(f, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const code = line
        .replace(/\/\*.*?\*\//g, '')
        .replace(/\/\/.*$/, '')
        .replace(/^\s*\*.*$/, '');
      if (call.test(code)) hits.push(`${path.relative(src, f)}:${i + 1}: ${line.trim()}`);
    });
}

if (hits.length) {
  console.log(`FAIL  native blocking dialogs in src (use askConfirm / showNotice):\n  ${hits.join('\n  ')}`);
  process.exit(1);
}
console.log(`PASS  no native alert/confirm/prompt in ${files.length} source files`);
