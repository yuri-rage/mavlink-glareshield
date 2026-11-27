// The waypoint pin, for the vehicle's mission (MapWidget) and the draft (useDraftLayer): a slim needle with a white
// badge carrying the number. Kept small so it hides less of the map; the number stays the same size (10.5 px, 8.5 for
// three digits) to stay readable.

/** The pin's size in CSS pixels at scale 1 (a selected draft pin is drawn larger). */
export const WP_PIN_W = 22;
export const WP_PIN_H = 30;

export function wpPinHtml(opts: {
  label: string;
  fill: string;
  text: string;
  scale?: number;
  stroke?: number;
  shadow?: string;
}): { html: string; w: number; h: number } {
  const scale = opts.scale ?? 1;
  const w = Math.round(WP_PIN_W * scale);
  const h = Math.round(WP_PIN_H * scale);
  const fontSize = opts.label.length > 2 ? '8.5' : '10.5';
  // Head: a circle of radius 8.5 centered at (11, 10); the needle runs from where its sides leave it to the tip.
  const html = `
    <div style="filter: drop-shadow(${opts.shadow ?? '0 2px 4px rgba(0,0,0,0.8)'}); width: ${w}px; height: ${h}px;">
      <svg width="${w}" height="${h}" viewBox="0 0 22 30" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M 11 29.2 L 3.25 13.5 A 8.5 8.5 0 1 1 18.75 13.5 Z" fill="${opts.fill}" stroke="#ffffff" stroke-width="${opts.stroke ?? 1.2}" stroke-linejoin="round"/>
        <circle cx="11" cy="10" r="6.9" fill="#ffffff" />
        <text x="11" y="13.6" font-size="${fontSize}" font-weight="900" font-family="ui-monospace, monospace, sans-serif" text-anchor="middle" fill="${opts.text}">${opts.label}</text>
      </svg>
    </div>`;
  return { html, w, h };
}
