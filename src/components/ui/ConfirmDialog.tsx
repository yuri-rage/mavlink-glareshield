// The in-app confirmation (store/confirmStore.ts): mounted once, shows whatever askConfirm() asks.

import React from 'react';

import { answerConfirm, useConfirmStore } from '../../store/confirmStore';
import { Button } from './button';
import { Modal } from './modal';

export const ConfirmDialog: React.FC = () => {
  const open = useConfirmStore((s) => s.open);
  return (
    <Modal isOpen={open !== null} onClose={() => answerConfirm(false)} title={open?.title ?? ''}>
      {open && (
        <div className="space-y-3">
          {open.message.map((p, i) => (
            <p key={i} className="text-sm leading-relaxed text-zinc-300">
              {p}
            </p>
          ))}
          <div className="flex justify-end gap-2 pt-1">
            {open.cancelLabel !== null && (
              <Button type="button" variant="outline" size="sm" onClick={() => answerConfirm(false)} autoFocus>
                {open.cancelLabel ?? 'Cancel'}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onClick={() => answerConfirm(true)}
              autoFocus={open.cancelLabel === null}
              className={
                open.danger ? 'bg-red-600 text-white hover:bg-red-500' : 'bg-sky-600 text-white hover:bg-sky-500'
              }
            >
              {open.confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
};
