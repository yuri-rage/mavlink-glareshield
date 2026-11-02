import { mavlinkConnection } from './connection';
import { MAVLINK_MSG_ID } from './messages';
import { MavlinkPacket } from './parser';
import { useTelemetryStore } from '../store/telemetryStore';

// MAVFTP OpCodes
export const FTP_OPCODE = {
  None: 0,
  TerminateSession: 1,
  ResetSessions: 2,
  ListDirectory: 3,
  OpenFileRO: 4,
  ReadFile: 5,
  CreateFile: 6,
  WriteFile: 7,
  RemoveFile: 8,
  CreateDirectory: 9,
  RemoveDirectory: 10,
  OpenFileWO: 11,
  TruncateFile: 12,
  Rename: 13,
  CalcFileCRC32: 14,
  BurstReadFile: 15,
  Ack: 128,
  Nack: 129,
} as const;

// MAVFTP Error codes
export const FTP_ERR = {
  None: 0,
  Fail: 1,
  FailErrno: 2,
  InvalidDataSize: 3,
  InvalidSession: 4,
  NoSuchFile: 5,
  NoFirstList: 6,
  ByteOffsetInvalid: 7,
  FileExists: 8,
  FileProtected: 9,
  FileNotFound: 10,
  EndOfFile: 6, // ArduPilot uses 6 for EOF
} as const;

export interface FtpParsedMessage {
  seq: number;
  session: number;
  opcode: number;
  size: number;
  req_opcode: number;
  burst_complete: number;
  offset: number;
  data: Uint8Array;
}

function addRange(ranges: [number, number][], start: number, end: number): [number, number][] {
  if (start >= end) return ranges;
  const merged: [number, number][] = [];
  let inserted = false;
  let curStart = start;
  let curEnd = end;

  for (const [rStart, rEnd] of ranges) {
    if (rEnd < curStart) {
      merged.push([rStart, rEnd]);
    } else if (rStart > curEnd) {
      if (!inserted) {
        merged.push([curStart, curEnd]);
        inserted = true;
      }
      merged.push([rStart, rEnd]);
    } else {
      curStart = Math.min(curStart, rStart);
      curEnd = Math.max(curEnd, rEnd);
    }
  }
  if (!inserted) {
    merged.push([curStart, curEnd]);
  }
  return merged;
}

function findGaps(ranges: [number, number][], targetTotal: number): [number, number][] {
  const gaps: [number, number][] = [];
  let expectedStart = 0;
  for (const [rStart, rEnd] of ranges) {
    if (rStart > expectedStart) {
      gaps.push([expectedStart, Math.min(rStart, targetTotal)]);
    }
    expectedStart = Math.max(expectedStart, rEnd);
    if (expectedStart >= targetTotal) break;
  }
  if (expectedStart < targetTotal) {
    gaps.push([expectedStart, targetTotal]);
  }
  return gaps;
}

export function parseFtpPayload(rawPayload: Uint8Array): FtpParsedMessage | null {
  // MAVLink FILE_TRANSFER_PROTOCOL layout:
  // byte 0: target_network
  // byte 1: target_system
  // byte 2: target_component
  // bytes 3..253: FTP payload (12 bytes header + up to 239 bytes data)
  // In MAVLink 2, trailing zeros may have been trimmed by the vehicle.
  // Pad payload up to 254 bytes so all fields (header and data) are properly reconstructed!
  if (rawPayload.length < 3) return null;

  const fullPayload = new Uint8Array(254);
  fullPayload.set(rawPayload.subarray(0, Math.min(rawPayload.length, 254)));

  const view = new DataView(fullPayload.buffer, fullPayload.byteOffset + 3, 251);

  const seq = view.getUint16(0, true);
  const session = view.getUint8(2);
  const opcode = view.getUint8(3);
  const size = view.getUint8(4);
  const req_opcode = view.getUint8(5);
  const burst_complete = view.getUint8(6);
  // byte 7 is padding
  const offset = view.getUint32(8, true);

  // Extract up to size bytes from offset 15 (offset 12 in the 251-byte FTP message)
  const actualLen = Math.min(size, 239);
  const data = fullPayload.subarray(15, 15 + actualLen);

  return {
    seq,
    session,
    opcode,
    size,
    req_opcode,
    burst_complete,
    offset,
    data,
  };
}

export function packFtpMessage(
  targetSystem: number,
  targetComponent: number,
  seq: number,
  session: number,
  opcode: number,
  size: number,
  offset: number,
  data?: Uint8Array
): Uint8Array {
  // MAVLink FILE_TRANSFER_PROTOCOL message payload is exactly 254 bytes:
  // 3 bytes routing + 251 bytes FTP packet (12 bytes header + 239 bytes data).
  // Zero-padding is mandatory so strings/filenames are properly null-terminated.
  const payload = new Uint8Array(254);

  payload[0] = 0; // target_network
  payload[1] = targetSystem;
  payload[2] = targetComponent;

  const view = new DataView(payload.buffer, payload.byteOffset + 3, 251);
  view.setUint16(0, seq, true);
  view.setUint8(2, session);
  view.setUint8(3, opcode);
  view.setUint8(4, size);
  view.setUint8(5, 0); // req_opcode
  view.setUint8(6, 0); // burst_complete
  view.setUint8(7, 0); // padding
  view.setUint32(8, offset, true);

  if (data && data.length > 0) {
    const copyLen = Math.min(data.length, 239);
    payload.set(data.subarray(0, copyLen), 15);
  }

  const encoder = mavlinkConnection.getEncoder();
  return encoder.packV2(MAVLINK_MSG_ID.FILE_TRANSFER_PROTOCOL, payload);
}

export class MavFtpClient {
  private seq = 0;
  private currentAbort: (() => void) | null = null;

  private nextSeq(): number {
    const s = this.seq;
    this.seq = (this.seq + 1) & 0xffff;
    return s;
  }

  /**
   * Aborts any currently executing MAVFTP transfer.
   */
  public abortCurrent(): boolean {
    if (this.currentAbort) {
      console.log('[MAVFTP] Aborting active file transfer...');
      const abortFn = this.currentAbort;
      this.currentAbort = null;
      abortFn();
      return true;
    }
    return false;
  }

  /**
   * Reads an entire file using high-speed MAVFTP (e.g. '@PARAM/param.pck' or 'mission.dat').
   * Uses BurstReadFile (opcode 15) with 239-byte chunks for maximum line-rate throughput,
   * with automatic fallback to lockstep ReadFile (opcode 5) if burst is unsupported.
   * Returns Uint8Array with the complete file contents, or null if MAVFTP fails.
   */
  public async readFile(
    targetSys?: number,
    targetComp?: number,
    filePath = '@PARAM/param.pck',
    chunkSize = 239,
    timeoutMs = 1500,
    onProgress?: (bytesReceived: number, totalBytes: number) => void
  ): Promise<Uint8Array | null> {
    const hb = useTelemetryStore.getState().heartbeat;
    const sysId = targetSys ?? hb.systemId ?? 1;
    const compId = targetComp ?? hb.componentId ?? 1;

    return new Promise((resolve) => {
      let isDone = false;
      let session = 0;
      let fileOpened = false;
      let offset = 0;
      let fileSize = -1;
      let useBurst = true;
      let highestOffset = 0;
      let receivedRanges: [number, number][] = [];
      let buffer = new Uint8Array(65536);
      let stepTimer: any = null;
      let retryCount = 0;

      this.currentAbort = () => {
        if (isDone) return;
        console.log(`[MAVFTP] Transfer of ${filePath} was cancelled.`);
        finish(null);
      };

      const checkCompletionAndFillGaps = (targetTotal: number): boolean => {
        const gaps = findGaps(receivedRanges, targetTotal);
        if (gaps.length === 0) {
          console.log(`[MAVFTP] Completed reading ${filePath} without holes (${targetTotal} bytes verified).`);
          finish(buffer.subarray(0, targetTotal));
          return true;
        }

        if (retryCount >= 4) {
          console.warn(`[MAVFTP] Failed to fill ${gaps.length} holes in ${filePath} after retries, aborting corrupted file.`);
          finish(null);
          return false;
        }

        retryCount++;
        const [gapStart, gapEnd] = gaps[0];
        console.warn(`[MAVFTP] Detected ${gaps.length} missing holes in ${filePath} (re-requesting gap ${gapStart}-${gapEnd}, attempt ${retryCount})...`);
        requestSingleChunk(gapStart);
        return false;
      };

      const finish = (result: Uint8Array | null) => {
        if (isDone) return;
        isDone = true;
        this.currentAbort = null;
        if (stepTimer) clearTimeout(stepTimer);
        unsubscribe();

        if (result && onProgress) {
          onProgress(result.length, result.length);
        }

        // If file was opened on vehicle session, terminate it cleanly and give autopilot worker time to close fd
        if (fileOpened) {
          fileOpened = false;
          const term = packFtpMessage(
            sysId,
            compId,
            this.nextSeq(),
            session,
            FTP_OPCODE.TerminateSession,
            0,
            0
          );
          mavlinkConnection.send(term);
          setTimeout(() => resolve(result), 60);
        } else {
          resolve(result);
        }
      };

      const setStepTimeout = (action: () => void, ms = timeoutMs) => {
        if (stepTimer) clearTimeout(stepTimer);
        stepTimer = setTimeout(() => {
          if (isDone) return;
          if (retryCount < 3) {
            retryCount++;
            console.log(`[MAVFTP] Inactivity timeout on ${filePath} at offset ${highestOffset} (retry ${retryCount})...`);
            action();
          } else {
            console.warn(`[MAVFTP] Timeout reading ${filePath}, falling back...`);
            finish(null);
          }
        }, ms);
      };

      const requestBurst = (fromOffset: number) => {
        if (isDone) return;
        const msg = packFtpMessage(
          sysId,
          compId,
          this.nextSeq(),
          session,
          FTP_OPCODE.BurstReadFile,
          chunkSize,
          fromOffset
        );
        mavlinkConnection.send(msg);
        setStepTimeout(() => requestBurst(highestOffset));
      };

      const requestSingleChunk = (fromOffset: number) => {
        if (isDone) return;
        const msg = packFtpMessage(
          sysId,
          compId,
          this.nextSeq(),
          session,
          FTP_OPCODE.ReadFile,
          chunkSize,
          fromOffset
        );
        mavlinkConnection.send(msg);
        setStepTimeout(() => requestSingleChunk(highestOffset));
      };

      // Listen for incoming FTP responses
      const unsubscribe = mavlinkConnection.onPacket((packet: MavlinkPacket) => {
        if (isDone) return;
        if (packet.messageId !== MAVLINK_MSG_ID.FILE_TRANSFER_PROTOCOL) return;

        const ftp = parseFtpPayload(packet.payload);
        if (!ftp) return;

        // Phase 1: Waiting for OpenFileRO ACK/NACK
        if (!fileOpened) {
          // Strictly ignore any stray packet that is NOT responding to OpenFileRO
          // (e.g. trailing EOF NACK from a preceding file's burst read)
          if (ftp.req_opcode !== FTP_OPCODE.OpenFileRO) {
            return;
          }

          if (ftp.opcode === FTP_OPCODE.Nack) {
            const errCode = ftp.data[0];
            if (retryCount < 2) {
              retryCount++;
              console.log(`[MAVFTP] OpenFileRO Nack (code=${errCode}) for ${filePath}, terminating stale session and retrying (attempt ${retryCount + 1})...`);
              const termMsg = packFtpMessage(sysId, compId, this.nextSeq(), session, FTP_OPCODE.TerminateSession, 0, 0);
              mavlinkConnection.send(termMsg);
              setTimeout(() => {
                if (!isDone) openFile();
              }, 80);
              return;
            }

            console.warn(`[MAVFTP] Received Nack for ${filePath} (code=${errCode ?? 'unknown'}), falling back...`);
            finish(null);
            return;
          }

          if (ftp.opcode === FTP_OPCODE.Ack) {
            if (stepTimer) clearTimeout(stepTimer);
            retryCount = 0;
            session = ftp.session;
            fileOpened = true;

            if (ftp.data.length >= 4) {
              const dv = new DataView(ftp.data.buffer, ftp.data.byteOffset, ftp.data.byteLength);
              fileSize = dv.getUint32(0, true);
              console.log(`[MAVFTP] OpenFileRO succeeded for ${filePath}. Session: ${session}, Size: ${fileSize} bytes.`);
              if (fileSize > 0) {
                buffer = new Uint8Array(fileSize);
              }
            } else {
              console.log(`[MAVFTP] OpenFileRO succeeded for ${filePath}. Session: ${session} (size not reported).`);
            }

            if (onProgress) {
              onProgress(0, fileSize > 0 ? fileSize : 0);
            }

            if (fileSize === 0) {
              console.log(`[MAVFTP] File ${filePath} is empty (0 bytes).`);
              finish(new Uint8Array(0));
              return;
            }

            // Start fast burst read
            requestBurst(0);
            return;
          }
          return;
        }

        // Phase 2: Reading file content (fileOpened === true)
        // Strictly ignore any packet not responding to ReadFile or BurstReadFile
        if (ftp.req_opcode !== FTP_OPCODE.ReadFile && ftp.req_opcode !== FTP_OPCODE.BurstReadFile) {
          return;
        }

        // Check if NACK during read
        if (ftp.opcode === FTP_OPCODE.Nack) {
          const errCode = ftp.data[0];
          // If error is EndOfFile (code 6), verify that no gaps exist before finishing
          if (errCode === FTP_ERR.EndOfFile) {
            console.log(`[MAVFTP] Reached EOF on ${filePath}: ${highestOffset} bytes reported. Verifying integrity...`);
            checkCompletionAndFillGaps(highestOffset);
            return;
          }

          // If BurstReadFile got rejected with Nack, fallback to standard ReadFile
          if (ftp.req_opcode === FTP_OPCODE.BurstReadFile && useBurst) {
            console.log(`[MAVFTP] BurstReadFile not supported on vehicle for ${filePath}, falling back to lockstep ReadFile...`);
            useBurst = false;
            retryCount = 0;
            requestSingleChunk(highestOffset);
            return;
          }

          console.warn(`[MAVFTP] Received Nack for ${filePath} during read (code=${errCode ?? 'unknown'}), falling back...`);
          finish(null);
          return;
        }

        // Check ACK for ReadFile or BurstReadFile
        if (
          ftp.opcode === FTP_OPCODE.Ack &&
          (ftp.req_opcode === FTP_OPCODE.ReadFile || ftp.req_opcode === FTP_OPCODE.BurstReadFile)
        ) {
          retryCount = 0;
          const chunkLen = ftp.data.length;
          const chunkOffset = ftp.offset;

          if (chunkLen > 0) {
            // Expand buffer if needed
            if (chunkOffset + chunkLen > buffer.length) {
              const newLen = Math.max(buffer.length * 2, chunkOffset + chunkLen + 1024);
              const newBuf = new Uint8Array(newLen);
              newBuf.set(buffer);
              buffer = newBuf;
            }

            buffer.set(ftp.data, chunkOffset);
            highestOffset = Math.max(highestOffset, chunkOffset + chunkLen);
            receivedRanges = addRange(receivedRanges, chunkOffset, chunkOffset + chunkLen);

            if (onProgress) {
              onProgress(highestOffset, fileSize > 0 ? fileSize : 0);
            }
          }

          // Check if entire file received without holes
          if (fileSize > 0 && highestOffset >= fileSize) {
            checkCompletionAndFillGaps(fileSize);
            return;
          }

          if (ftp.req_opcode === FTP_OPCODE.BurstReadFile) {
            // During burst, reset inactivity timeout on each received packet
            setStepTimeout(() => requestBurst(highestOffset), 1200);

            // If burst finished but we still need more bytes
            if (ftp.burst_complete) {
              if (fileSize > 0 && highestOffset < fileSize) {
                requestBurst(highestOffset);
              } else if (ftp.size < chunkSize) {
                // Short read indicates EOF
                checkCompletionAndFillGaps(highestOffset);
              }
            }
          } else {
            // In lockstep ReadFile mode
            if (ftp.size < chunkSize || (fileSize > 0 && highestOffset >= fileSize)) {
              checkCompletionAndFillGaps(fileSize > 0 ? fileSize : highestOffset);
            } else {
              requestSingleChunk(highestOffset);
            }
          }
        }
      });

      // Step 1: Open file
      const openFile = () => {
        const pathBytes = new TextEncoder().encode(filePath);
        const pathWithNull = new Uint8Array(pathBytes.length + 1);
        pathWithNull.set(pathBytes);
        pathWithNull[pathBytes.length] = 0;

        const openMsg = packFtpMessage(
          sysId,
          compId,
          this.nextSeq(),
          0,
          FTP_OPCODE.OpenFileRO,
          pathBytes.length,
          0,
          pathWithNull
        );
        mavlinkConnection.send(openMsg);
        setStepTimeout(() => openFile());
      };

      openFile();
    });
  }
}

export const mavFtpClient = new MavFtpClient();