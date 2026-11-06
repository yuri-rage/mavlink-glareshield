import { useEffect, useRef, useState, type RefObject } from 'react';

export type ColorScheme = 'default' | 'green' | 'amber' | 'blue' | 'red';

/** Accent colours (SVG / canvas) matching the Tailwind classes used elsewhere for each scheme. */
export const ACCENT_HEX: Record<ColorScheme, string> = {
  default: '#0ea5e9', // sky-500
  blue: '#38bdf8', // sky-400
  green: '#10b981', // emerald-500
  amber: '#f59e0b', // amber-500
  red: '#ef4444', // red-500
};

export const ZONE_HEX = { normal: '#10b981', warn: '#f59e0b', crit: '#ef4444' } as const;

/** Series colours, chosen to stay distinguishable from each other and on both themes. */
export const SERIES_HEX = ['#0ea5e9', '#f59e0b', '#10b981', '#d946ef', '#f43f5e', '#84cc16', '#a78bfa', '#14b8a6'];

export interface ChromeColors {
  track: string;
  tick: string;
  tickMinor: string;
  label: string;
  grid: string;
  text: string;
  textMuted: string;
  needle: string;
  pivot: string;
  panel: string;
  /** Card background, used to outline text drawn over needles. */
  backdrop: string;
}

const DARK: ChromeColors = {
  track: '#27272a', // zinc-800
  tick: '#a1a1aa', // zinc-400
  tickMinor: '#52525b', // zinc-600
  label: '#a1a1aa',
  grid: 'rgba(161,161,170,0.12)',
  text: '#f4f4f5',
  textMuted: '#71717a',
  needle: '#f4f4f5',
  pivot: '#d4d4d8',
  panel: 'rgba(24,24,27,0.92)',
  backdrop: '#0b0b0d',
};

const LIGHT: ChromeColors = {
  track: '#d4d4d8', // zinc-300
  tick: '#52525b',
  tickMinor: '#a1a1aa',
  label: '#3f3f46',
  grid: 'rgba(63,63,70,0.14)',
  text: '#18181b',
  textMuted: '#71717a',
  needle: '#18181b',
  pivot: '#3f3f46',
  panel: 'rgba(244,244,245,0.95)',
  backdrop: '#ffffff',
};

function readDaylight(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('daylight-theme');
}

/** Theme-aware chrome colours; follows the navbar's daylight toggle. */
export function useChromeColors(): ChromeColors {
  const [daylight, setDaylight] = useState(readDaylight);
  useEffect(() => {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    const observer = new MutationObserver(() => setDaylight(readDaylight()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return daylight ? LIGHT : DARK;
}

/**
 * Eases toward `target` (exponential, ~150 ms time constant) so needles and arcs glide instead of jumping or
 * sweeping through a CSS transition. Null passes straight through.
 */
export function useSmoothedValue(target: number | null, timeConstantMs = 150): number | null {
  const [shown, setShown] = useState<number | null>(target);
  const shownRef = useRef<number | null>(target);
  const targetRef = useRef<number | null>(target);
  const frameRef = useRef<number | null>(null);
  targetRef.current = target;

  useEffect(() => {
    if (target === null || shownRef.current === null || !Number.isFinite(shownRef.current)) {
      shownRef.current = target;
      setShown(target);
      return;
    }
    if (typeof requestAnimationFrame === 'undefined') {
      shownRef.current = target;
      setShown(target);
      return;
    }
    let last = performance.now();
    const step = (now: number) => {
      const goal = targetRef.current;
      const current = shownRef.current;
      if (goal === null || current === null) return;
      const dt = Math.min(100, now - last);
      last = now;
      const next = current + (goal - current) * (1 - Math.exp(-dt / timeConstantMs));
      const done = Math.abs(goal - next) <= Math.abs(goal) * 1e-4 + 1e-6;
      shownRef.current = done ? goal : next;
      setShown(shownRef.current);
      frameRef.current = done ? null : requestAnimationFrame(step);
    };
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [target, timeConstantMs]);

  return shown;
}

/** Size of an element, tracked with ResizeObserver. */
export function useElementSize<T extends HTMLElement>(): [RefObject<T>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}
