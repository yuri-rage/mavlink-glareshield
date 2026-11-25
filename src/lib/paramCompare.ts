// Comparing a .param file with the vehicle's parameters, and judging each write: the rules behind the Parameters
// widget's compare dialog.
//
// A file parameter is one of:
// - same: the vehicle has the file's value (not listed);
// - differs: the vehicle has another value (selected by default, unless read-only);
// - missing: the vehicle's full list is read and it isn't in it (another firmware or vehicle type): can't be written;
// - unread: the vehicle's list isn't complete, so it may or may not exist (can be written: ArduPilot looks it up by
//   name and answers with the value it kept).
// A write is confirmed by the vehicle echoing the parameter (PARAM_VALUE): with the value asked for (ok), or another
// (kept: the vehicle refused or clamped it), or no echo at all (no answer).

import { areParamsDifferent, type ParamMeta } from '../mavlink/paramMetadata';

export type CompareStatus = 'differs' | 'missing' | 'unread';

export interface CompareEntry {
  name: string;
  file: number;
  /** The vehicle's value, when it has one. */
  vehicle?: number;
  /** The firmware default, when known. */
  defaultValue?: number;
  status: CompareStatus;
  readOnly: boolean;
  rebootRequired: boolean;
  units?: string;
  /** Offered for writing: differs or unread, and not read-only. */
  writable: boolean;
}

export interface CompareResult {
  entries: CompareEntry[];
  /** File parameters the vehicle already has at the file's value. */
  same: number;
  /** The vehicle's parameters the file doesn't mention (it's a partial file, or another vehicle's). */
  notInFile: number;
}

export function compareParams(
  file: Record<string, number>,
  vehicle: Record<string, { value: number; defaultValue?: number }>,
  listComplete: boolean,
  meta: (name: string) => ParamMeta | null | undefined
): CompareResult {
  const entries: CompareEntry[] = [];
  let same = 0;
  for (const [name, value] of Object.entries(file)) {
    const v = vehicle[name];
    if (v && !areParamsDifferent(v.value, value)) {
      same++;
      continue;
    }
    const m = meta(name);
    const status: CompareStatus = v ? 'differs' : listComplete ? 'missing' : 'unread';
    const readOnly = Boolean(m?.readOnly);
    entries.push({
      name,
      file: value,
      vehicle: v?.value,
      defaultValue: v?.defaultValue,
      status,
      readOnly,
      rebootRequired: Boolean(m?.rebootRequired),
      units: m?.units,
      writable: status !== 'missing' && !readOnly,
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const fileNames = new Set(Object.keys(file));
  const notInFile = Object.keys(vehicle).filter((n) => !fileNames.has(n)).length;
  return { entries, same, notInFile };
}

export type WriteOutcome = 'ok' | 'kept' | 'no-answer';

/** What a write came to, from the value the vehicle echoed (undefined: no echo). */
export function writeOutcome(requested: number, echoed: number | undefined): WriteOutcome {
  if (echoed === undefined) return 'no-answer';
  // Parameters travel as 32-bit floats: 0.1 comes back as 0.100000001.
  return areParamsDifferent(Math.fround(requested), Math.fround(echoed)) ? 'kept' : 'ok';
}

/** Filter entries by a name or description fragment (case-insensitive). */
export function filterEntries(entries: CompareEntry[], query: string, meta: (name: string) => ParamMeta | null | undefined): CompareEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) => e.name.toLowerCase().includes(q) || (meta(e.name)?.description ?? '').toLowerCase().includes(q) || (meta(e.name)?.displayName ?? '').toLowerCase().includes(q));
}
