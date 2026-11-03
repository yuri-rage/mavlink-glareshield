import * as ort from 'onnxruntime-web';
import * as tts from '@diffusionstudio/vits-web';

const DEFAULT_VOICE_ID: tts.VoiceId = 'en_US-amy-medium';
// VITS length_scale multiplier: 0.87 (~15% faster cadence) at natural vocal pitch
const SPEECH_LENGTH_SCALE_MULTIPLIER = 0.87;

// Ensure single-threaded WASM inside the worker when crossOriginIsolated is false
// so SharedArrayBuffer / COOP+COEP headers are not required (preserving cross-origin map tiles).
if (typeof self !== 'undefined' && !self.crossOriginIsolated) {
  try {
    Object.defineProperty(self.navigator, 'hardwareConcurrency', {
      get: () => 1,
      configurable: true,
    });
  } catch {
    // Ignore if navigator.hardwareConcurrency is non-configurable
  }
  ort.env.wasm.numThreads = 1;
}

// Cache the compiled ONNX InferenceSession in worker memory so subsequent callouts
// synthesize in ~25-40ms without re-reading or re-compiling the 60MB model.
let cachedSessionPromise: Promise<ort.InferenceSession> | null = null;
let cachedModelByteLength = 0;

const origBlobArrayBuffer = Blob.prototype.arrayBuffer;
Blob.prototype.arrayBuffer = function (this: Blob) {
  if (
    cachedSessionPromise &&
    cachedModelByteLength > 0 &&
    this.size === cachedModelByteLength
  ) {
    // Model session is already compiled in WASM memory; return a lightweight stub
    // with matching byteLength to avoid re-reading 60MB from OPFS on every utterance.
    return Promise.resolve(
      Object.defineProperty(new ArrayBuffer(0), 'byteLength', {
        value: cachedModelByteLength,
      })
    );
  }
  return origBlobArrayBuffer.call(this);
};

function wrapSessionForCadence(session: ort.InferenceSession): ort.InferenceSession {
  const origRun = session.run.bind(session);
  (session as any).run = (feeds: any, ...rest: any[]) => {
    try {
      if (feeds?.scales?.data && feeds.scales.data.length >= 2) {
        feeds.scales.data[1] = feeds.scales.data[1] * SPEECH_LENGTH_SCALE_MULTIPLIER;
      }
    } catch {
      // Ignore if tensor layout differs
    }
    return origRun(feeds, ...rest);
  };
  return session;
}

const origCreate = ort.InferenceSession.create.bind(ort.InferenceSession);
(ort.InferenceSession as any).create = (
  bufferOrPath: any,
  options?: ort.InferenceSession.SessionOptions
) => {
  const byteLen = bufferOrPath?.byteLength ?? 0;
  if (cachedSessionPromise && byteLen > 0 && byteLen === cachedModelByteLength) {
    return cachedSessionPromise;
  }
  if (byteLen > 0) {
    cachedModelByteLength = byteLen;
    cachedSessionPromise = origCreate(bufferOrPath, options).then(wrapSessionForCadence);
    cachedSessionPromise.catch(() => {
      cachedSessionPromise = null;
      cachedModelByteLength = 0;
    });
    return cachedSessionPromise;
  }
  return origCreate(bufferOrPath, options).then(wrapSessionForCadence);
};

// Serialize synthesis operations in the worker so WASM phonemizer and ONNX session
// are never invoked concurrently.
let workerQueue: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>) {
  workerQueue = workerQueue.then(task).catch((err) => {
    console.warn('[PiperTTS Worker] Task error:', err);
  });
}

self.onmessage = (event: MessageEvent) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'init') {
    const voiceId: tts.VoiceId = msg.voiceId || DEFAULT_VOICE_ID;
    enqueue(async () => {
      try {
        const storedVoices = await tts.stored();
        for (const storedVoice of storedVoices) {
          if (storedVoice !== voiceId) {
            await tts.remove(storedVoice).catch(() => {});
          }
        }
        if (!storedVoices.includes(voiceId)) {
          self.postMessage({ type: 'status', status: 'downloading', progress: 0 });
          await tts.download(voiceId, (prog) => {
            const pct = prog.total > 0 ? Math.round((prog.loaded * 100) / prog.total) : 0;
            self.postMessage({ type: 'status', status: 'downloading', progress: pct });
          });
        }
        self.postMessage({ type: 'status', status: 'ready' });
      } catch (err: any) {
        self.postMessage({
          type: 'status',
          status: 'error',
          error: String(err?.message ?? err),
        });
      }
    });
  } else if (msg.type === 'synthesize') {
    const { id, text, voiceId = DEFAULT_VOICE_ID } = msg;
    enqueue(async () => {
      try {
        const wavBlob = await tts.predict({
          text,
          voiceId,
        });
        const wavBuffer = await origBlobArrayBuffer.call(wavBlob);
        (self as any).postMessage(
          { type: 'result', id, text, wavBuffer },
          [wavBuffer]
        );
      } catch (err: any) {
        self.postMessage({
          type: 'error',
          id,
          text,
          error: String(err?.message ?? err),
        });
      }
    });
  }
};

export {};
