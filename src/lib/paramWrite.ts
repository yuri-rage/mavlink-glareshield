// A parameter write confirmed by the vehicle: PARAM_SET, then wait for its PARAM_VALUE echo (once more if none comes,
// for a slow or lossy link). The echoed value says whether it took: the vehicle may refuse or clamp it.

import type { MavlinkEncoder } from '../mavlink/encoder';
import type { MavlinkPacket } from '../mavlink/parser';
import { writeOutcome, type WriteOutcome } from './paramCompare';

const PARAM_VALUE = 22;
/** How long to wait for each echo. */
export const PARAM_ECHO_TIMEOUT_MS = 1500;

export interface ParamWriteDeps {
  send: (packet: Uint8Array) => boolean;
  onPacket: (listener: (packet: MavlinkPacket) => void) => () => void;
  encoder: Pick<MavlinkEncoder, 'createParamSet'>;
  decode: (messageId: number, payload: Uint8Array) => any;
  /** Checked before each try: a stopped batch sends no second one. */
  stopped?: () => boolean;
  timeoutMs?: number;
}

export async function writeParamVerified(
  target: { sysId: number; compId: number },
  name: string,
  value: number,
  paramType: number,
  deps: ParamWriteDeps
): Promise<{ outcome: WriteOutcome; echoed?: number }> {
  const { sysId, compId } = target;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (deps.stopped?.()) return { outcome: 'no-answer' };
    let sent = true;
    const echoed = await new Promise<number | undefined>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      // The vehicle's own echo only: a gimbal, companion or another vehicle may have a parameter of that name.
      const unsub = deps.onPacket((packet) => {
        if (packet.messageId !== PARAM_VALUE || packet.systemId !== sysId || packet.componentId !== compId) return;
        const data = deps.decode(packet.messageId, packet.payload);
        if (data?.param_id?.trim().toUpperCase() === name.toUpperCase()) finish(data.param_value);
      });
      const finish = (v: number | undefined) => {
        if (timer) clearTimeout(timer);
        unsub();
        resolve(v);
      };
      timer = setTimeout(() => finish(undefined), deps.timeoutMs ?? PARAM_ECHO_TIMEOUT_MS);
      if (!deps.send(deps.encoder.createParamSet(sysId, compId, name, value, paramType))) {
        sent = false;
        finish(undefined);
      }
    });
    if (echoed !== undefined) return { outcome: writeOutcome(value, echoed), echoed };
    // Not sent (no link, or a replay): retrying won't help.
    if (!sent) return { outcome: 'no-answer' };
  }
  return { outcome: 'no-answer' };
}
