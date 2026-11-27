// The desktop app's serial port picker. A browser shows its own when the page asks for a serial device
// (navigator.serial.requestPort); Electron has none, so the main process (desktop/main.ts) hands the list here and
// the choice goes back. Rendered only in the desktop app.

import React, { useEffect, useState } from 'react';

import { Usb } from 'lucide-react';

import { desktopApi, type SerialPortChoice } from '../../desktop/api';
import { Button } from '../ui/button';
import { Modal } from '../ui/modal';

export const SerialPortPicker: React.FC = () => {
  const [ports, setPorts] = useState<SerialPortChoice[] | null>(null);

  useEffect(() => {
    const desktop = desktopApi();
    if (!desktop) return;
    return desktop.serial.onChoosePort((list) => setPorts(list));
  }, []);

  const answer = (portId: string | null) => {
    desktopApi()?.serial.choosePort(portId);
    setPorts(null);
  };

  return (
    <Modal
      isOpen={ports !== null}
      onClose={() => answer(null)}
      title="Choose a serial port"
      description="The telemetry radio or flight controller to connect to."
    >
      <div className="space-y-3">
        {ports && ports.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-400">
            No serial ports found. Plug the radio or flight controller in, then Connect again. On Linux, your user may
            need to be in the <code className="text-sky-400">dialout</code> (or <code>uucp</code>) group.
          </p>
        ) : (
          <div className="space-y-1.5">
            {ports?.map((p) => (
              <button
                key={p.portId}
                type="button"
                onClick={() => answer(p.portId)}
                className="flex w-full items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-left text-xs text-zinc-200 hover:border-sky-600 hover:bg-zinc-800"
              >
                <Usb className="h-4 w-4 shrink-0 text-sky-400" />
                <span className="min-w-0 flex-1 truncate font-mono">{p.label}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex justify-end border-t border-zinc-800 pt-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => answer(null)}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
};
