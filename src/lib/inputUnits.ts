// Units for values the user types: lengths and altitudes in feet or metres, speeds in the speed unit chosen (m/s,
// km/h, mph or kts), converted to and from the SI values the vehicle uses. One place for it, so every field agrees
// with the display units (unitsStore) instead of each component converting its own way.
//
// Mission command params are labelled with their MAVLink unit ("Accept radius (m)", "Speed (m/s)"): paramUnitKind
// reads that, so the item editor can show them in the user's units, or raw (as sent) when asked.

import { useUnitsStore, type UnitSystem } from '../store/unitsStore';

export const FT_PER_M = 3.28084;

export interface InputUnit {
  /** Shown next to the field: "ft", "m", "kts", … */
  unit: string;
  /** From SI (m, m/s) to the shown unit. */
  fromSi: (v: number) => number;
  /** From the shown unit to SI. */
  toSi: (v: number) => number;
  /** Decimals worth showing in a field. */
  digits: number;
}

const IDENTITY = (v: number) => v;

export const isImperialSystem = (s: UnitSystem) => s === 'mph' || s === 'kts';

/** Lengths and altitudes: feet with mph or kts, else metres. */
export function lengthUnit(system: UnitSystem): InputUnit {
  return isImperialSystem(system)
    ? { unit: 'ft', fromSi: (m) => m * FT_PER_M, toSi: (ft) => ft / FT_PER_M, digits: 0 }
    : { unit: 'm', fromSi: IDENTITY, toSi: IDENTITY, digits: 1 };
}

/** Speeds in the chosen speed unit. */
export function speedUnit(system: UnitSystem): InputUnit {
  const k = { ms: 1, kmh: 3.6, mph: 2.23694, kts: 1.94384 }[system];
  const unit = { ms: 'm/s', kmh: 'km/h', mph: 'mph', kts: 'kts' }[system];
  return { unit, fromSi: (v) => v * k, toSi: (v) => v / k, digits: 1 };
}

/** The raw MAVLink units, for "show as sent". */
export const RAW_LENGTH: InputUnit = { unit: 'm', fromSi: IDENTITY, toSi: IDENTITY, digits: 2 };
export const RAW_SPEED: InputUnit = { unit: 'm/s', fromSi: IDENTITY, toSi: IDENTITY, digits: 2 };

export const useLengthUnit = () => lengthUnit(useUnitsStore((s) => s.system));
export const useSpeedUnit = () => speedUnit(useUnitsStore((s) => s.system));

/** What a mission command param's label says it holds: a length "(m)", a speed "(m/s)", or something else. */
export function paramUnitKind(label: string): 'length' | 'speed' | null {
  if (/\(m\/s\)/.test(label)) return 'speed';
  if (/\(m\)/.test(label)) return 'length';
  return null;
}

/** The label with its unit replaced by the one shown: "Accept radius (m)" -> "Accept radius (ft)". */
export function relabel(label: string, unit: string): string {
  return label.replace(/\((m\/s|m)\)/, `(${unit})`);
}
