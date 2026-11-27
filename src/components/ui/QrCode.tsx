// A QR code drawn as SVG (uqr encodes it): dark modules as one path on a white square, whatever the theme, since
// an inverted (light-on-dark) code is one many phones won't read.

import React, { useMemo } from 'react';

import { encode } from 'uqr';

/** The SVG path of a QR code's dark modules (one unit square each), and its width in modules (with a 2-module border). */
export function qrPath(text: string): { size: number; d: string } {
  const { size, data } = encode(text, { ecc: 'M', border: 2 });
  let d = '';
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`;
    })
  );
  return { size, d };
}

export const QrCode: React.FC<{ text: string; className?: string; title?: string }> = ({ text, className, title }) => {
  const { size, d } = useMemo(() => qrPath(text), [text]);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      role="img"
      aria-label={title ?? 'QR code'}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
};
