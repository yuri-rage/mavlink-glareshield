// The default voice: the device's own on low-memory devices and iOS, the neural voice elsewhere.
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { defaultVoiceEngine } = await import('../src/lib/audioAlerts.ts');
const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failures.push(name);
};
check('2 GB device: device voice', defaultVoiceEngine({ deviceMemory: 2, userAgent: 'Mozilla/5.0 (Linux; Android 13)' }) === 'browser');
check('8 GB desktop: neural', defaultVoiceEngine({ deviceMemory: 8, userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }) === 'neural');
check('iPhone: device voice', defaultVoiceEngine({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }) === 'browser');
check('iPad reporting as a Mac (touch): device voice', defaultVoiceEngine({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 }) === 'browser');
check('a Mac without touch, memory unknown (Safari): neural', defaultVoiceEngine({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 }) === 'neural');
check('no navigator (tests, SSR): neural', defaultVoiceEngine(undefined) === 'neural');
console.log(failures.length ? `\n${failures.length} voice-engine check(s) FAILED` : '\nAll voice-engine checks PASSED');
process.exit(failures.length ? 1 : 0);
