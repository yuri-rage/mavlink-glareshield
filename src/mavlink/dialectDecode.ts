// Decodes any message of the dialect from its generated field table (dialectFields.generated.ts), for the MAVLink
// Inspector. The app's own logic keeps its hand-written decoders (parser.ts), which scale and name fields its way;
// this shows each field as it is on the wire, with its units.
//
// MAVLink 2 drops trailing zero bytes from a payload, so it is read as if zero-padded to the full length. 64-bit
// integers come back as numbers when they fit exactly, else as decimal strings; char arrays as text; other arrays as
// lists.

import { DIALECT_MESSAGES } from './dialect.generated';
import { DIALECT_FIELDS } from './dialectFields.generated';

export interface DecodedField {
  name: string;
  type: string;
  units: string;
  /** Extension field (MAVLink 2, after the base fields). */
  ext: boolean;
  value: number | string | (number | string)[];
}

const SIZE: Record<string, number> = { char: 1, int8_t: 1, uint8_t: 1, int16_t: 2, uint16_t: 2, int32_t: 4, uint32_t: 4, float: 4, int64_t: 8, uint64_t: 8, double: 8 };

export function messageName(id: number): string | null {
  return DIALECT_MESSAGES[id]?.[0] ?? null;
}

/** The full payload length of a message (base and extension fields). */
export function payloadLength(id: number): number {
  const fields = DIALECT_FIELDS[id];
  return fields ? fields.reduce((n, [, t, len]) => n + SIZE[t] * Math.max(1, len), 0) : 0;
}

function readOne(view: DataView, type: string, at: number): number | string {
  switch (type) {
    case 'int8_t':
      return view.getInt8(at);
    case 'uint8_t':
    case 'char':
      return view.getUint8(at);
    case 'int16_t':
      return view.getInt16(at, true);
    case 'uint16_t':
      return view.getUint16(at, true);
    case 'int32_t':
      return view.getInt32(at, true);
    case 'uint32_t':
      return view.getUint32(at, true);
    case 'float':
      return view.getFloat32(at, true);
    case 'double':
      return view.getFloat64(at, true);
    case 'int64_t': {
      const v = view.getBigInt64(at, true);
      return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
    }
    case 'uint64_t': {
      const v = view.getBigUint64(at, true);
      return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
    }
    default:
      return 0;
  }
}

/** The message's fields, or null when the dialect doesn't have it. */
export function decodeAny(id: number, payload: Uint8Array): DecodedField[] | null {
  const fieldList = DIALECT_FIELDS[id];
  if (!fieldList) return null;
  const full = new Uint8Array(Math.max(payloadLength(id), payload.length));
  full.set(payload);
  const view = new DataView(full.buffer);
  const out: DecodedField[] = [];
  let at = 0;
  for (const [name, type, len, units, ext] of fieldList) {
    const size = SIZE[type];
    let value: DecodedField['value'];
    if (len > 0 && type === 'char') {
      let s = '';
      for (let i = 0; i < len; i++) {
        const c = full[at + i];
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      value = s;
    } else if (len > 0) {
      value = Array.from({ length: len }, (_, i) => readOne(view, type, at + i * size));
    } else {
      value = readOne(view, type, at);
    }
    out.push({ name, type, units, ext: ext === 1, value });
    at += size * Math.max(1, len);
  }
  return out;
}
