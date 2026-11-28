// The desktop app's own settings, kept by the main process (it needs them before the page exists: whether the window
// has a frame, whether the bridge listens). A small JSON file in the app's user data folder; a missing or unreadable
// file means the defaults.

import fs from 'node:fs';
import path from 'node:path';

export interface DesktopSettings {
  /** The window without its system title bar; an auto-hiding one slides over the top of the app instead. */
  frameless: boolean;
}

export const DEFAULT_SETTINGS: DesktopSettings = { frameless: false };

/** The settings in `raw`, with anything missing or of the wrong type at its default. */
export function readSettings(raw: unknown): DesktopSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return { frameless: typeof r.frameless === 'boolean' ? r.frameless : DEFAULT_SETTINGS.frameless };
}

export class SettingsFile {
  private value: DesktopSettings;

  constructor(private file: string) {
    let raw: unknown = null;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // Missing or unreadable: the defaults.
    }
    this.value = readSettings(raw);
  }

  get(): DesktopSettings {
    return { ...this.value };
  }

  /** Changes some settings and writes the file (atomically: a crash mid-write leaves the old one). */
  set(patch: Partial<DesktopSettings>): DesktopSettings {
    this.value = readSettings({ ...this.value, ...patch });
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.value, null, 2) + '\n', { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch {
      // Not writable: it holds for this run.
    }
    return this.get();
  }
}
