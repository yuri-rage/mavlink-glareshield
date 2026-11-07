// Parameter search and selection patterns, shared by the Parameters widget's search box and the Parameter set
// widget.
//
// - A term with * or ? is a wildcard over the whole parameter name: BATT_* , FS_?_ACTION , *_ENABLE.
//   Wildcards add up: "BATT_* FS_*" is every battery and every failsafe parameter.
// - Any other term is a word to find in the name, short name or description, and every word must be found:
//   "BATT_* voltage" is the battery parameters that mention voltage.
// - A term starting with - leaves matches out: "BATT_* -BATT2_*".
// - "Quoted words" are one term.
// Matching ignores case.

import type { ParamMeta } from './paramMetadata';

type Term = { kind: 'glob'; re: RegExp; source: string } | { kind: 'word'; text: string };

export interface ParamQuery {
  globs: Term[];
  words: Term[];
  exclude: Term[];
  /** True when the query has no terms (everything matches). */
  empty: boolean;
}

/** Whether a term is a wildcard pattern rather than a plain name or word. */
export const isParamPattern = (s: string) => /[*?]/.test(s);

function globToRegExp(glob: string): RegExp {
  const body = glob
    .split('')
    .map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${body}$`, 'i');
}

function toTerm(raw: string): Term {
  return isParamPattern(raw) ? { kind: 'glob', re: globToRegExp(raw), source: raw } : { kind: 'word', text: raw.toLowerCase() };
}

/** Splits on spaces and commas, keeping "quoted words" together. */
function tokens(query: string): string[] {
  const out: string[] = [];
  const re = /(-?)"([^"]*)"|([^\s,]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query))) {
    if (m[2] !== undefined) {
      if (m[2].trim()) out.push(`${m[1]}${m[2].trim()}`);
    } else if (m[3]) {
      out.push(m[3]);
    }
  }
  return out;
}

export function parseParamQuery(query: string): ParamQuery {
  const q: ParamQuery = { globs: [], words: [], exclude: [], empty: true };
  for (const tok of tokens(query)) {
    if (tok.length > 1 && tok.startsWith('-')) {
      q.exclude.push(toTerm(tok.slice(1)));
    } else if (tok !== '-') {
      const t = toTerm(tok);
      (t.kind === 'glob' ? q.globs : q.words).push(t);
    }
  }
  q.empty = q.globs.length === 0 && q.words.length === 0 && q.exclude.length === 0;
  return q;
}

function termMatches(term: Term, name: string, meta: ParamMeta | null | undefined): boolean {
  if (term.kind === 'glob') return term.re.test(name);
  if (name.toLowerCase().includes(term.text)) return true;
  if (!meta) return false;
  return Boolean(meta.displayName?.toLowerCase().includes(term.text) || meta.description?.toLowerCase().includes(term.text));
}

/** Whether parameter `name` (with its metadata, if any) matches the query. */
export function matchesParamQuery(name: string, meta: ParamMeta | null | undefined, q: ParamQuery): boolean {
  if (q.empty) return true;
  if (q.globs.length > 0 && !q.globs.some((t) => termMatches(t, name, meta))) return false;
  if (!q.words.every((t) => termMatches(t, name, meta))) return false;
  return !q.exclude.some((t) => termMatches(t, name, meta));
}

/**
 * The parameters a Parameter set lists, in order: each entry is an exact name or a wildcard pattern, optionally
 * prefixed with - to leave names out. Exact names keep their place (and are listed even when the vehicle doesn't
 * have them, so a typo or a missing parameter shows); a pattern adds the matching names alphabetically. Each name
 * appears once.
 */
export function expandParamPatterns(entries: string[], available: string[]): { name: string; present: boolean }[] {
  const have = new Set(available.map((n) => n.toUpperCase()));
  const sorted = [...have].sort((a, b) => a.localeCompare(b));
  const excluded = entries
    .map((e) => e.trim())
    .filter((e) => e.length > 1 && e.startsWith('-'))
    .map((e) => toTerm(e.slice(1).toUpperCase()));
  const isExcluded = (n: string) =>
    excluded.some((t) => (t.kind === 'glob' ? t.re.test(n) : n === t.text.toUpperCase()));

  const out: { name: string; present: boolean }[] = [];
  const seen = new Set<string>();
  const add = (name: string) => {
    if (seen.has(name) || isExcluded(name)) return;
    seen.add(name);
    out.push({ name, present: have.has(name) });
  };
  for (const raw of entries) {
    const e = raw.trim().toUpperCase();
    if (!e || e.startsWith('-')) continue;
    if (isParamPattern(e)) {
      const re = globToRegExp(e);
      for (const n of sorted) if (re.test(n)) add(n);
    } else {
      add(e);
    }
  }
  return out;
}
