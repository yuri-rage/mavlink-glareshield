// The service worker keeps the neural voice's CDN runtime cached (public/sw.js): its URL prefixes must match the ones
// the voice library actually fetches, or the voice silently stops working offline after a library upgrade.
import fs from 'node:fs';

export {};
const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  if (!ok) failures.push(name);
}

const lib = fs.readFileSync('node_modules/@diffusionstudio/vits-web/dist/vits-web.js', 'utf8');
const sw = fs.readFileSync('public/sw.js', 'utf8');
const prefixes = [...sw.matchAll(/'(https:\/\/[^']+)'/g)].map((m) => m[1]);
// The library's own constants: B (ONNX runtime wasm path) and x (phonemizer, without its extension).
const urls = [...lib.matchAll(/"(https:\/\/(?:cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)[^"]+)"/g)].map((m) => m[1]);
check('the library still fetches from these CDNs', urls.length === 2, JSON.stringify(urls));
for (const u of urls) {
  check(
    `cached by the service worker: ${u}`,
    prefixes.some((p) => u.startsWith(p) || `${u}/`.startsWith(p)),
    prefixes.join(' ')
  );
}

console.log(failures.length ? `\n${failures.length} voice-cache check(s) FAILED` : '\nAll voice-cache checks PASSED');
process.exit(failures.length ? 1 : 0);
