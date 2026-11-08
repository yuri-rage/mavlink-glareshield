// Feedback on a button for the command it sent (pending spinner, accepted tick, refused cross, and a matching
// ring), shared by the flight control widgets.

import React from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import type { CommandFeedbackInfo } from '../../store/telemetryStore';

/** How long a settled result stays on the button. */
const SHOW_RESULT_MS = 6000;

/** The feedback that belongs to the button `key` right now, or null. */
function current(feedback: CommandFeedbackInfo | null | undefined, key: string, nowMs: number): CommandFeedbackInfo | null {
  if (!feedback || feedback.targetKey !== key) return null;
  if (feedback.status !== 'pending' && nowMs - feedback.time > SHOW_RESULT_MS) return null;
  return feedback;
}

/** Spinner, tick or cross for the button `key`; `size` is the icon's Tailwind size classes. */
export function feedbackBadge(
  feedback: CommandFeedbackInfo | null | undefined,
  key: string,
  nowMs: number,
  size = 'h-3.5 w-3.5'
): React.ReactNode {
  const fb = current(feedback, key, nowMs);
  if (!fb) return null;
  if (fb.status === 'pending') return <Loader2 className={`${size} animate-spin text-sky-400 shrink-0`} />;
  if (fb.status === 'accepted') return <CheckCircle2 className={`${size} text-emerald-400 shrink-0`} />;
  return <XCircle className={`${size} text-rose-400 shrink-0`} />;
}

/** Ring classes for the button `key`. */
export function feedbackRing(feedback: CommandFeedbackInfo | null | undefined, key: string, nowMs: number): string {
  const fb = current(feedback, key, nowMs);
  if (!fb) return '';
  if (fb.status === 'pending') return 'ring-2 ring-sky-400/70';
  if (fb.status === 'accepted') return 'ring-2 ring-emerald-500/80';
  return 'ring-2 ring-rose-500/90 bg-rose-950/30';
}
