// The Takeoff checklist's "Auto: Takeoff": switch to the takeoff mode, arm, then (all but a fixed-wing plane)
// NAV_TAKEOFF. Kept out of the widget so the abort and failure paths can be tested.
//
// Standing down never force-disarms. A GCS disarm without the force code is refused by ArduPilot while it thinks it
// is flying (Copter: not land_complete; Plane: is_flying), so it disarms on the ground and is refused in the air;
// refused or unanswered, the vehicle is told to hold (LOITER / QLOITER) instead. A forced disarm stops the motors
// wherever the vehicle is.

import type { MavlinkEncoder } from '../mavlink/encoder';
import { MAV_CMD } from '../mavlink/messages';
import type { CommandAckInfo } from '../store/telemetryStore';

export interface TakeoffPlan {
  /** The vehicle this sequence is for: fixed when it starts, so an abort reaches the vehicle it armed. */
  sysId: number;
  compId: number;
  /** A fixed-wing plane takes off in TAKEOFF mode once armed: no NAV_TAKEOFF step. */
  fixedWing: boolean;
  takeoffModeNum: number;
  takeoffModeLabel: string;
  /** Where a stand-down holds when the vehicle won't disarm (it's flying): LOITER, or QLOITER for a VTOL. */
  holdModeNum: number;
  altM: number;
  /** The altitude as shown to the operator (e.g. "10 m"). */
  dispAlt: string;
}

export interface TakeoffDeps {
  send: (packet: Uint8Array, meta: { label: string; targetKey: string }) => Promise<CommandAckInfo>;
  encoder: Pick<MavlinkEncoder, 'createSetMode' | 'createArmDisarm' | 'createCommandLong'>;
  /** The active vehicle, now. */
  vehicle: () => { systemId: number; customMode: number; isArmed: boolean };
  wait: (ms: number) => Promise<void>;
  onStep: (text: string | null) => void;
  onError: (text: string | null) => void;
  /** The sequence finished: the vehicle is taking off (or, fixed-wing, armed for launch). */
  onDone?: () => void;
}

/** ACCEPTED, or IN_PROGRESS (the final answer is still to come, and nothing refused it). */
const accepted = (ack: CommandAckInfo) => ack.result === 0 || ack.result === 5;
const why = (ack: CommandAckInfo) => `${ack.resultText}${ack.reason ? `: ${ack.reason}` : ''}`;

export class AutoTakeoffSequence {
  private aborted = false;
  private finished = false;
  private armedBySequence = false;
  private takeoffCommanded = false;
  private stoodDown = false;
  /** An arm is on its way: an abort waits for its ACK (a hold to a plane just armed on the ground would throttle up). */
  private armPending = false;

  constructor(
    private readonly plan: TakeoffPlan,
    private readonly deps: TakeoffDeps
  ) {}

  /** The operator's Abort: stand down what this sequence armed, else hold where the vehicle is. */
  abort(): void {
    if (this.aborted || this.finished) return;
    this.aborted = true;
    this.deps.onStep(null);
    this.deps.onError('Takeoff sequence aborted by operator.');
    if (this.armedBySequence) void this.standDown('Auto-Takeoff Abort');
    else if (!this.armPending) void this.hold('Abort Takeoff (Loiter)');
  }

  async run(): Promise<void> {
    const { plan, deps } = this;
    const { sysId, compId } = plan;
    const steps = plan.fixedWing ? 2 : 3;
    try {
      if (this.stopped()) return;
      if (deps.vehicle().customMode !== plan.takeoffModeNum) {
        deps.onStep(`Step 1/${steps}: Switching to ${plan.takeoffModeLabel} mode…`);
        const modeAck = await deps.send(deps.encoder.createSetMode(sysId, compId, plan.takeoffModeNum), {
          label: `Auto-Takeoff: Switch to ${plan.takeoffModeLabel}`,
          targetKey: 'mode-takeoff',
        });
        if (this.stopped()) return;
        if (!accepted(modeAck)) return this.fail(`Mode switch to ${plan.takeoffModeLabel} rejected (${why(modeAck)})`);
        await deps.wait(350);
      }

      if (this.stopped()) return;
      if (!deps.vehicle().isArmed) {
        deps.onStep(`Step 2/${steps}: Arming motors…`);
        this.armPending = true;
        const armAck = await deps.send(deps.encoder.createArmDisarm(sysId, compId, true), {
          label: 'Auto-Takeoff: Arm Motors',
          targetKey: 'mode-takeoff',
        });
        this.armPending = false;
        // Known before anything else: an abort while the ACK was on its way must still stand down what it armed.
        // An unanswered arm counts when the vehicle says it is armed.
        if (accepted(armAck) || (this.sameVehicle() && deps.vehicle().isArmed)) {
          this.armedBySequence = true;
          // A fixed-wing plane armed in TAKEOFF mode is taking off.
          if (plan.fixedWing) this.takeoffCommanded = true;
        }
        if (this.stopped()) return;
        if (!accepted(armAck)) return this.fail(`Arming rejected (${why(armAck)})`);
        await deps.wait(450);
      }

      if (this.stopped()) return;
      if (!plan.fixedWing) {
        deps.onStep(`Step 3/3: Commanding Takeoff to ${plan.dispAlt}…`);
        this.takeoffCommanded = true;
        const toAck = await deps.send(
          deps.encoder.createCommandLong(sysId, compId, MAV_CMD.NAV_TAKEOFF, [0, 0, 0, 0, 0, 0, plan.altM]),
          { label: `Takeoff (${plan.dispAlt})`, targetKey: 'mode-takeoff' }
        );
        if (this.stopped()) return;
        if (!accepted(toAck)) return this.fail(`Takeoff rejected (${why(toAck)})`);
      }

      this.finished = true;
      deps.onStep(null);
      deps.onDone?.();
    } catch (e: any) {
      await this.fail(String(e?.message ?? e));
    }
  }

  private sameVehicle(): boolean {
    return this.deps.vehicle().systemId === this.plan.sysId;
  }

  /**
   * Whether the sequence should go no further: aborted (abort() already acted; an arm it didn't know of yet is stood
   * down here), or another vehicle became active.
   */
  private stopped(): boolean {
    if (this.aborted) {
      if (this.armedBySequence) void this.standDown('Auto-Takeoff Abort');
      return true;
    }
    if (!this.sameVehicle()) {
      this.finished = true;
      this.deps.onStep(null);
      this.deps.onError(
        `Vehicle ${this.deps.vehicle().systemId} is now active: the takeoff sequence for vehicle ${this.plan.sysId} stopped.`
      );
      // Armed by this sequence and left sitting on the ground: disarm it. One already taking off is left to finish
      // (it ends in a hover, or a fixed-wing loiter).
      if (this.armedBySequence && !this.takeoffCommanded) void this.standDown('Auto-Takeoff Stopped');
      return true;
    }
    return false;
  }

  private async fail(message: string): Promise<void> {
    this.finished = true;
    this.deps.onError(message);
    this.deps.onStep(null);
    if (this.armedBySequence) await this.standDown('Takeoff Failure');
  }

  /** Disarm (never forced) what this sequence armed; refused or unanswered (flying), hold instead. Once. */
  private async standDown(reason: string): Promise<void> {
    if (this.stoodDown) return;
    this.stoodDown = true;
    this.armedBySequence = false;
    const { sysId, compId } = this.plan;
    try {
      const ack = await this.deps.send(this.deps.encoder.createArmDisarm(sysId, compId, false), {
        label: `${reason}: Safety Disarm`,
        targetKey: 'arm',
      });
      if (ack.result === 0 || ack.result === -2) return; // disarmed, or the link is down (a hold wouldn't go either)
      await this.hold(`${reason}: Hold (won't disarm in flight)`);
    } catch {}
  }

  private async hold(label: string): Promise<void> {
    const { sysId, compId, holdModeNum } = this.plan;
    await this.deps.send(this.deps.encoder.createSetMode(sysId, compId, holdModeNum), {
      label,
      targetKey: 'mode-loiter',
    });
  }
}
