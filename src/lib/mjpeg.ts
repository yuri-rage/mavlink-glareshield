// MJPEG stream parsing for the HUD camera.
//
// An <img> pointed at a multipart MJPEG stream gives no signal when the stream stalls or the server ends it: the
// last frame simply stays on screen (Chrome fires `load` once and `error` only when a new request fails). Reading
// the stream with fetch() instead lets the HUD see every frame, notice a stall within seconds and reconnect. That
// needs the camera (or go2rtc / the proxy in front of it) to allow CORS; without it the HUD falls back to <img>.

const SOI0 = 0xff;
const SOI1 = 0xd8;
const EOI1 = 0xd9;

/**
 * Pulls complete JPEG images out of an MJPEG byte stream by their start (FFD8) and end (FFD9) markers, so it works
 * whatever the multipart boundary or part headers are. Nested images (an EXIF thumbnail inside a frame) are kept
 * inside their parent frame.
 */
export class MjpegFrameExtractor {
  private buffer = new Uint8Array(0);
  private readonly maxBuffer: number;

  constructor(maxFrameBytes = 8 * 1024 * 1024) {
    this.maxBuffer = maxFrameBytes;
  }

  push(chunk: Uint8Array): Uint8Array[] {
    const joined = new Uint8Array(this.buffer.length + chunk.length);
    joined.set(this.buffer);
    joined.set(chunk, this.buffer.length);
    const frames: Uint8Array[] = [];

    let start = -1;
    let depth = 0;
    let consumed = 0;
    for (let i = 0; i + 1 < joined.length; i++) {
      if (joined[i] !== SOI0) continue;
      const next = joined[i + 1];
      if (next === SOI1) {
        if (depth === 0) start = i;
        depth++;
        i++;
      } else if (next === EOI1 && depth > 0) {
        depth--;
        i++;
        if (depth === 0 && start >= 0) {
          frames.push(joined.slice(start, i + 1));
          consumed = i + 1;
          start = -1;
        }
      }
    }

    // Keep an unfinished frame (from its start marker) for the next chunk; drop bytes between frames.
    const keepFrom = start >= 0 ? start : Math.max(consumed, joined.length - 1);
    this.buffer = joined.slice(keepFrom);
    if (this.buffer.length > this.maxBuffer) this.buffer = new Uint8Array(0); // corrupt stream: resync
    return frames;
  }
}

/** Reconnect delay after `attempt` consecutive failures: 1, 2, 4, 8, then 10 s. */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(10000, 1000 * Math.pow(2, Math.max(0, attempt)));
}
