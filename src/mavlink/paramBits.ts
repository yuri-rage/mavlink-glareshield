// Bitmask and named-value helpers for the parameter editor. Parameter values arrive as floats; bitmasks use
// arithmetic rather than JavaScript's 32-bit signed bitwise operators, so bit 31 works.

/** Whether `bit` is set in `value`. */
export function hasBit(value: number, bit: number): boolean {
  const v = Math.max(0, Math.round(value));
  return Math.floor(v / 2 ** bit) % 2 === 1;
}

/** `value` with `bit` set or cleared. */
export function withBit(value: number, bit: number, on: boolean): number {
  const v = Math.max(0, Math.round(value));
  const set = hasBit(v, bit);
  if (on === set) return v;
  return on ? v + 2 ** bit : v - 2 ** bit;
}

/** The set bits of `value`, lowest first (up to bit 31). */
export function setBits(value: number): number[] {
  const out: number[] = [];
  for (let bit = 0; bit < 32; bit++) if (hasBit(value, bit)) out.push(bit);
  return out;
}

/** Bit numbers of a bitmask definition, lowest first. */
export function bitmaskBits(bitmask: Record<number, string>): number[] {
  return Object.keys(bitmask)
    .map(Number)
    .filter((b) => Number.isInteger(b) && b >= 0 && b < 32)
    .sort((a, b) => a - b);
}

/**
 * A short reading of a bitmask value: "None", "Barometer, Compass", or "Barometer, Compass +3". Set bits the
 * definition doesn't name are shown as "bit n".
 */
export function bitmaskSummary(value: number, bitmask: Record<number, string>, maxNames = 2): string {
  const bits = setBits(value);
  if (bits.length === 0) return 'None';
  const names = bits.map((b) => bitmask[b] ?? `bit ${b}`);
  return names.length <= maxNames ? names.join(', ') : `${names.slice(0, maxNames).join(', ')} +${names.length - maxNames}`;
}

/** Named values as [value, label] pairs, in numeric order. */
export function sortedValueOptions(values: Record<number, string>): [number, string][] {
  return Object.entries(values)
    .map(([k, label]) => [Number(k), label] as [number, string])
    .filter(([k]) => Number.isFinite(k))
    .sort((a, b) => a[0] - b[0]);
}

/** The label for a value, matching floats from the vehicle (e.g. 2.0000001) to their integer key. */
export function valueLabel(values: Record<number, string> | undefined, value: number): string | undefined {
  if (!values) return undefined;
  if (values[value] !== undefined) return values[value];
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 1e-4 ? values[rounded] : undefined;
}
