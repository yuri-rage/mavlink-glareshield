// The mission, fence and rally points a telemetry log shows being downloaded over MAVFTP (mission.dat, fence.dat,
// rally.dat), rebuilt for a replay. A download streamed as MISSION_ITEM_INT already reaches the store as the log plays;
// a MAVFTP one (how Glareshield reads them when it can) is file data, which only means something once the whole file
// is put back together. Pure: scans the log's records; replay.ts applies each file when playback passes the time it
// was complete.

import { FTP_OPCODE, parseFtpPayload } from './ftp';
import { MAVLINK_MSG_ID } from './messages';
import { readTlog } from './tlog';
import { frameHeader, GCS_COMPONENT_ID, type ReplayTimeline } from './tlogReplay';

export type MissionFileKind = 'mission' | 'fence' | 'rally';

export interface ReplayMissionFile {
  kind: MissionFileKind;
  /** Playback time (timeline ms) of the frame that completed the file. */
  atMs: number;
  data: Uint8Array;
}

/** Which file a MAVFTP path is (ArduPilot serves them as @MISSION/<name>, older firmware as <name>). */
export function missionFileKind(path: string): MissionFileKind | null {
  const name = path.replace(/\0.*$/s, '').split('/').pop()?.toLowerCase();
  if (name === 'mission.dat') return 'mission';
  if (name === 'fence.dat') return 'fence';
  if (name === 'rally.dat') return 'rally';
  return null;
}

/** A frame's payload (MAVLink 1 or 2), or null when it's too short. */
function framePayload(frame: Uint8Array): Uint8Array | null {
  if (frame[0] === 0xfd && frame.length >= 12) return frame.subarray(10, 10 + frame[1]);
  if (frame[0] === 0xfe && frame.length >= 8) return frame.subarray(6, 6 + frame[1]);
  return null;
}

interface OpenFile {
  kind: MissionFileKind;
  size: number;
  chunks: Map<number, Uint8Array>;
  have: number;
}

/**
 * The mission files downloaded over MAVFTP in a log, each with the playback time it was complete. The ground
 * station's OpenFileRO names the file; the vehicle's ACK to it gives the session and the file's size; the vehicle's
 * ACKs to ReadFile / BurstReadFile carry the data by offset. A file read twice (a retry, a later download) gives
 * two entries; the later one wins when played.
 */
export function scanReplayMissionFiles(
  bytes: Uint8Array,
  timeline: Pick<ReplayTimeline, 'timesMs'>,
  gcsComponentId = GCS_COMPONENT_ID
): ReplayMissionFile[] {
  const out: ReplayMissionFile[] = [];
  /** The file the ground station last asked to open, by the request's sequence number. */
  const opening = new Map<number, MissionFileKind | null>();
  const open = new Map<number, OpenFile>();
  // The timeline holds the vehicle's frames in log order: count them to know each one's playback time.
  let vehicleIndex = -1;
  for (const r of readTlog(bytes)) {
    const h = frameHeader(r.frame);
    if (!h) continue;
    const fromGcs = h.componentId === gcsComponentId;
    if (!fromGcs) vehicleIndex++;
    if (h.messageId !== MAVLINK_MSG_ID.FILE_TRANSFER_PROTOCOL) continue;
    const payload = framePayload(r.frame);
    const msg = payload && parseFtpPayload(payload);
    if (!msg) continue;
    if (fromGcs) {
      if (msg.opcode === FTP_OPCODE.OpenFileRO) {
        opening.set(msg.seq, missionFileKind(new TextDecoder().decode(msg.data)));
        // Keep only the latest few: replies come straight back.
        if (opening.size > 16) opening.delete(opening.keys().next().value!);
      }
      continue;
    }
    if (msg.opcode !== FTP_OPCODE.Ack) continue;
    if (msg.req_opcode === FTP_OPCODE.OpenFileRO) {
      // The reply's sequence number is the request's plus one.
      const kind = opening.get((msg.seq - 1) & 0xffff);
      if (kind === undefined) continue;
      if (kind === null || msg.data.length < 4) {
        open.delete(msg.session);
        continue;
      }
      const size = new DataView(msg.data.buffer, msg.data.byteOffset, 4).getUint32(0, true);
      open.set(msg.session, { kind, size, chunks: new Map(), have: 0 });
      continue;
    }
    if (msg.req_opcode !== FTP_OPCODE.ReadFile && msg.req_opcode !== FTP_OPCODE.BurstReadFile) continue;
    const f = open.get(msg.session);
    if (!f || msg.data.length === 0 || f.chunks.has(msg.offset)) continue;
    f.chunks.set(msg.offset, msg.data.slice());
    f.have += msg.data.length;
    if (f.have < f.size) continue;
    // Put it together in order; a hole (chunks that overlap or miss) means it isn't really complete yet.
    const data = new Uint8Array(f.size);
    let filled = 0;
    for (const [offset, chunk] of [...f.chunks].sort((a, b) => a[0] - b[0])) {
      if (offset > filled) break;
      const part = chunk.subarray(Math.max(0, filled - offset), Math.max(0, Math.min(chunk.length, f.size - offset)));
      data.set(part, filled);
      filled += part.length;
    }
    if (filled < f.size) continue;
    out.push({ kind: f.kind, atMs: timeline.timesMs[Math.max(0, vehicleIndex)] ?? 0, data });
    open.delete(msg.session);
  }
  return out;
}
