// The voice engine: the default per device, and switching to the device voice really stopping the neural one (no
// respawn from the prewarm, no abandoned callout spoken late, the prewarm redone when it comes back). A fake Worker
// stands in for Piper.
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

// Fakes: a Worker that answers init at once and each synthesis after 50 ms, and browser speech that records.
const workers: FakeWorker[] = [];
const spoken: string[] = [];
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  synthRequests: string[] = [];
  constructor() {
    workers.push(this);
  }
  postMessage(msg: { type: string; id?: number; text?: string }) {
    if (this.terminated) return;
    if (msg.type === 'init')
      setTimeout(() => !this.terminated && this.onmessage?.({ data: { type: 'status', status: 'ready' } }), 5);
    if (msg.type === 'synthesize') {
      this.synthRequests.push(msg.text!);
      setTimeout(
        () =>
          !this.terminated && this.onmessage?.({ data: { type: 'result', id: msg.id, wavBuffer: new ArrayBuffer(8) } }),
        50
      );
    }
  }
  terminate() {
    this.terminated = true;
  }
}
(globalThis as any).Worker = FakeWorker;
(globalThis as any).window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  speechSynthesis: { speak: (u: { text: string }) => spoken.push(u.text), cancel: () => {}, getVoices: () => [] },
};
(globalThis as any).SpeechSynthesisUtterance = class {
  constructor(public text: string) {}
};

const { defaultVoiceEngine, useAudioAlertsStore, speakCallout } = await import('../src/lib/audioAlerts.ts');
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

check(
  '2 GB device: device voice',
  defaultVoiceEngine({ deviceMemory: 2, userAgent: 'Mozilla/5.0 (Linux; Android 13)' }) === 'browser'
);
check(
  '8 GB desktop: neural',
  defaultVoiceEngine({ deviceMemory: 8, userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }) === 'neural'
);
check(
  'iPhone: device voice',
  defaultVoiceEngine({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }) === 'browser'
);
check(
  'iPad reporting as a Mac (touch): device voice',
  defaultVoiceEngine({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    platform: 'MacIntel',
    maxTouchPoints: 5,
  }) === 'browser'
);
check(
  'a Mac without touch, memory unknown (Safari): neural',
  defaultVoiceEngine({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 }) === 'neural'
);
check('no navigator (tests, SSR): neural', defaultVoiceEngine(undefined) === 'neural');

const store = useAudioAlertsStore;
store.setState({ soundEnabled: true, voiceEnabled: true });

// Neural on: the worker starts, becomes ready, and 400 ms later the prewarm starts synthesizing.
store.getState().setVoiceEngine('neural');
await wait(450);
check(
  'neural: one worker, prewarm under way',
  workers.length === 1 && workers[0].synthRequests.length >= 1,
  `${workers.length} workers, ${workers[0]?.synthRequests.length} requests`
);

// Switch to the device voice mid-prewarm: the worker stops and no new one is started by the prewarm.
store.getState().setVoiceEngine('browser');
await wait(400);
check(
  'device voice mid-prewarm: worker stopped, none started again',
  workers.length === 1 && workers[0].terminated,
  `${workers.length} workers`
);

// A callout being synthesized when the neural voice is turned off isn't spoken late by the device voice.
store.getState().setVoiceEngine('neural');
await wait(20); // ready, prewarm timer pending
spoken.length = 0;
speakCallout('Altitude hold');
store.getState().setVoiceEngine('browser');
await wait(120);
check('abandoned callout not spoken after the switch', !spoken.includes('Altitude hold'), JSON.stringify(spoken));
check('the switch itself is announced by the device voice', spoken.includes('Device voice'), JSON.stringify(spoken));

// Back to neural: the prewarm runs again on the new worker (it was reset when released).
const before = workers.length;
store.getState().setVoiceEngine('neural');
await wait(500);
const w = workers[workers.length - 1];
check(
  'back to neural: a new worker, prewarmed again',
  workers.length === before + 1 && w.synthRequests.some((t) => t === 'Motors armed'),
  `${workers.length} workers, ${JSON.stringify(w?.synthRequests)}`
);

console.log(failures.length ? `\n${failures.length} voice-engine check(s) FAILED` : '\nAll voice-engine checks PASSED');
process.exit(failures.length ? 1 : 0);
