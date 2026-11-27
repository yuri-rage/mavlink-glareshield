// A refused disarm, and the force disarm offered in its place. ArduPilot refuses a GCS disarm while it thinks it is
// flying, which keeps a mistaken slide from stopping the motors in the air; but a vehicle that has landed without
// detecting it (a bounce, a slope, a tip-over, a bad baro) refuses too, and only a forced disarm (COMPONENT_ARM_DISARM
// P2 21196) stops its motors. So it is always offered, after a confirmation that says what it does.

import type { MavlinkEncoder } from '../mavlink/encoder';
import type { ConfirmRequest } from '../store/confirmStore';
import type { CommandAckInfo } from '../store/telemetryStore';

/** MAV_RESULT values that mean the vehicle said no: TEMPORARILY_REJECTED, DENIED, FAILED. */
export function disarmRefused(ack: CommandAckInfo): boolean {
  return ack.result === 1 || ack.result === 2 || ack.result === 4;
}

export const FORCE_DISARM_CONFIRM: ConfirmRequest = {
  title: 'Force disarm?',
  message: [
    'The vehicle refused to disarm: it thinks it is still flying (or it landed without detecting it).',
    'A forced disarm stops the motors at once, wherever the vehicle is. If it is in the air, it will fall.',
  ],
  confirmLabel: 'Force disarm',
  danger: true,
};

export interface ForceDisarmDeps {
  ask: (req: ConfirmRequest) => Promise<boolean>;
  send: (packet: Uint8Array, meta: { label: string; targetKey: string }) => Promise<CommandAckInfo>;
  encoder: Pick<MavlinkEncoder, 'createArmDisarm'>;
}

/** Ask, and on a yes send the forced disarm to this vehicle. Resolves with its ACK, or null when declined. */
export async function offerForceDisarm(
  sysId: number,
  compId: number,
  deps: ForceDisarmDeps
): Promise<CommandAckInfo | null> {
  if (!(await deps.ask(FORCE_DISARM_CONFIRM))) return null;
  return deps.send(deps.encoder.createArmDisarm(sysId, compId, false, true), {
    label: 'Force Disarm',
    targetKey: 'arm',
  });
}
