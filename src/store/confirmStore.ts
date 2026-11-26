// An in-app confirmation (ConfirmDialog), for questions asked while the vehicle link must keep running.
// window.confirm() blocks the page's JavaScript while it's open, Glareshield's 1 Hz heartbeat to the vehicle included:
// reading a warning about the ground-station failsafe could trigger that failsafe. This asks without blocking.

import { create } from 'zustand';

export interface ConfirmRequest {
  title: string;
  /** Paragraphs of the question. */
  message: string[];
  confirmLabel: string;
  /** Styles the confirm button as a warning (an armed vehicle, something that can't be undone). */
  danger?: boolean;
}

interface ConfirmState {
  open: (ConfirmRequest & { resolve: (ok: boolean) => void }) | null;
}

export const useConfirmStore = create<ConfirmState>(() => ({ open: null }));

/**
 * Ask, without blocking the page: resolves true on confirm, false on cancel (or Escape, or a newer question). Where
 * no dialog can show (tests, no DOM), resolves true.
 */
export function askConfirm(req: ConfirmRequest): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(true);
  return new Promise((resolve) => {
    useConfirmStore.getState().open?.resolve(false);
    useConfirmStore.setState({ open: { ...req, resolve } });
  });
}

/** Answer the open question (the dialog's buttons). */
export function answerConfirm(ok: boolean): void {
  const open = useConfirmStore.getState().open;
  if (!open) return;
  useConfirmStore.setState({ open: null });
  open.resolve(ok);
}
