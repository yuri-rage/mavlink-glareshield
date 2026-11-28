// After the desktop app updates itself: what's new in this version (lib/releaseNews.ts), once. It closes on its own
// after a while (not while the pointer or focus is on it), with ×, or for good with "Don't show these".

import React, { useEffect, useState } from 'react';

import { ExternalLink, Sparkles, X } from 'lucide-react';

import { useReleaseNewsStore } from '../../lib/releaseNews';

/** How long it stays, unless the pointer or focus is on it. */
const SHOW_MS = 30_000;
/** Changes listed before "and N more". */
const MAX_LISTED = 4;

export const ReleaseNewsBanner: React.FC = () => {
  const news = useReleaseNewsStore((s) => s.news);
  const dismiss = useReleaseNewsStore((s) => s.dismiss);
  const setEnabled = useReleaseNewsStore((s) => s.setEnabled);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!news || held) return;
    const t = setTimeout(dismiss, SHOW_MS);
    return () => clearTimeout(t);
  }, [news, held, dismiss]);

  if (!news) return null;
  const listed = news.changes.slice(0, MAX_LISTED);
  const more = news.changes.length - listed.length;
  const link = 'inline-flex items-center gap-1 text-sky-300 hover:text-sky-200 hover:underline';
  return (
    <div
      role="status"
      aria-label={`What's new in Glareshield ${news.version}`}
      className="flex items-start justify-between gap-2 border-t border-sky-500/50 bg-sky-950/90 px-3 py-1.5 text-xs text-sky-100 sm:px-6"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <div className="flex min-w-0 items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
        <div className="min-w-0 space-y-0.5">
          <div>
            <strong>Updated to Glareshield {news.version}.</strong>{' '}
            <a href={news.url} target="_blank" rel="noreferrer" className={link}>
              Release notes
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          {listed.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-sky-200/90">
              {listed.map((c) => (
                <li key={c} className="break-words">
                  {c}
                </li>
              ))}
              {more > 0 && <li className="list-none text-sky-300/80">…and {more} more</li>}
            </ul>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[11px] text-sky-300 hover:bg-sky-900/60 hover:text-sky-100"
          onClick={() => setEnabled(false)}
          title="Turn these off (Settings → About turns them back on)"
        >
          Don't show these
        </button>
        <button
          type="button"
          aria-label="Close"
          className="rounded p-1 text-sky-300 hover:bg-sky-900/60 hover:text-sky-100"
          onClick={dismiss}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};
