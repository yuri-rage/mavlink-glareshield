// Hooks and small pieces shared by the custom widget panels.

import React, { useEffect, useState } from 'react';
import { useTelemetryStore, sendTrackedCommand } from '../../../store/telemetryStore';
import { readBinding, type AlertState, type BindingReading, type UnitSystem } from '../../../lib/widgetValues';
import type { CustomWidgetDefinition, WidgetDataBinding } from '../../../types/widget';
import { describeAck, type AckView } from './panelModel';
import type { ColorScheme } from './palette';

/** Re-read bound values at this rate (and on unit / definition changes). */
const READ_INTERVAL_MS = 125;

/**
 * Binding readings re-evaluated on a fixed clock, so staleness is noticed even when nothing arrives. `staleAfterSec`
 * is one timeout for all of them, or one per binding.
 */
export function useBindingReadings(
  bindings: WidgetDataBinding[],
  system: UnitSystem,
  staleAfterSec?: number | readonly (number | undefined)[]
): BindingReading[] {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (bindings.length === 0) return;
    const timer = setInterval(() => setTick((t) => (t + 1) % 1_000_000), READ_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [bindings.length]);
  const state = useTelemetryStore.getState();
  const now = Date.now();
  return bindings.map((b, i) =>
    readBinding(b, state, system, typeof staleAfterSec === 'object' ? staleAfterSec[i] : staleAfterSec, now)
  );
}

/** The vehicle's system and component IDs, for addressing commands. */
export function useVehicleTarget() {
  const sysId = useTelemetryStore((s) => s.heartbeat.systemId || 1);
  const compId = useTelemetryStore((s) => s.heartbeat.componentId || 1);
  return { sysId, compId };
}

/** Sends a command and tracks the vehicle's COMMAND_ACK (or timeout) for display under the control. */
export function useCommandSender() {
  const [ack, setAck] = useState<AckView | null>(null);
  /** `onResult` hears the outcome (accepted / in progress / rejected, which includes no response). */
  const send = (packet: Uint8Array, label: string, onResult?: (status: AckView['status']) => void) => {
    setAck({ status: 'pending', text: 'Sent, awaiting acknowledgement', time: Date.now() });
    void sendTrackedCommand(packet, { label }).then((info) => {
      const view = describeAck(info);
      setAck(view);
      onResult?.(view.status);
    });
  };
  return { ack, send };
}

export const AckChip: React.FC<{ ack: AckView | null }> = ({ ack }) => {
  if (!ack) return null;
  const tone =
    ack.status === 'accepted'
      ? 'text-emerald-400 bg-emerald-950/40 border-emerald-800/40'
      : ack.status === 'rejected'
        ? 'text-red-400 bg-red-950/40 border-red-800/40'
        : 'text-amber-400 bg-amber-950/40 border-amber-800/40';
  return (
    <p className={`text-[10px] font-mono text-center px-1.5 py-0.5 rounded border ${tone} ${ack.status === 'pending' ? 'animate-pulse' : ''}`}>
      {ack.text} · {new Date(ack.time).toLocaleTimeString()}
    </p>
  );
};

export interface SchemeClasses {
  icon: string;
  stroke: string;
  bg: string;
  button: string;
  accent: string;
  toggleActive: string;
  ledActive: string;
  valueText: string;
}

export const SCHEME_CLASSES: Record<ColorScheme, SchemeClasses> = {
  default: {
    icon: 'text-sky-400',
    stroke: 'stroke-sky-500',
    bg: 'bg-sky-500',
    button: 'bg-sky-600 hover:bg-sky-700',
    accent: 'accent-sky-500',
    toggleActive: 'border-sky-500 bg-sky-950/60 text-sky-400',
    ledActive: 'bg-emerald-400 border-emerald-300 shadow-emerald-500/50',
    valueText: 'text-zinc-100',
  },
  blue: {
    icon: 'text-sky-400',
    stroke: 'stroke-sky-500',
    bg: 'bg-sky-500',
    button: 'bg-sky-600 hover:bg-sky-700',
    accent: 'accent-sky-500',
    toggleActive: 'border-sky-500 bg-sky-950/60 text-sky-400',
    ledActive: 'bg-sky-400 border-sky-300 shadow-sky-500/50',
    valueText: 'text-sky-100',
  },
  green: {
    icon: 'text-emerald-400',
    stroke: 'stroke-emerald-500',
    bg: 'bg-emerald-500',
    button: 'bg-emerald-600 hover:bg-emerald-700',
    accent: 'accent-emerald-500',
    toggleActive: 'border-emerald-500 bg-emerald-950/60 text-emerald-400',
    ledActive: 'bg-emerald-400 border-emerald-300 shadow-emerald-500/50',
    valueText: 'text-emerald-100',
  },
  amber: {
    icon: 'text-amber-400',
    stroke: 'stroke-amber-500',
    bg: 'bg-amber-500',
    button: 'bg-amber-600 hover:bg-amber-700',
    accent: 'accent-amber-500',
    toggleActive: 'border-amber-500 bg-amber-950/60 text-amber-400',
    ledActive: 'bg-amber-400 border-amber-300 shadow-amber-500/50',
    valueText: 'text-amber-300',
  },
  red: {
    icon: 'text-red-400',
    stroke: 'stroke-red-500',
    bg: 'bg-red-500',
    button: 'bg-red-600 hover:bg-red-700',
    accent: 'accent-red-500',
    toggleActive: 'border-red-500 bg-red-950/60 text-red-400',
    ledActive: 'bg-red-400 border-red-300 shadow-red-500/50',
    valueText: 'text-red-300',
  },
};

/** What every panel receives from its card. */
export interface PanelProps {
  /** The panel's own settings (for a single-panel card, the whole widget definition). */
  def: CustomWidgetDefinition;
  /** The values the panel displays (panelBindings), in order. */
  bindings: WidgetDataBinding[];
  /** Current readings of `bindings`. */
  readings: BindingReading[];
  /** Reading of the toggle feedback field, if any. */
  feedback?: BindingReading;
  system: UnitSystem;
  alert: AlertState;
  /** Every displayed reading is stale. */
  staleAll: boolean;
  /** Colour scheme after alerts, as Tailwind classes and an accent hex. */
  scheme: SchemeClasses;
  accentHex: string;
}
