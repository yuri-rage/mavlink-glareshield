// Fuzzy search for short lists (the Add Widget catalog): every word of the query must appear in the text, its letters
// in order but not necessarily together ("bat volt" finds "Battery voltage", "pfd" finds "Primary Flight Display").
// Matches score higher when letters run together, start words, or start the text.

/** How well `word` matches `text` (both lowercase), or null when its letters don't all appear in order. */
function wordScore(word: string, text: string): number | null {
  // A plain substring is the best kind of match: scored by where it starts (a word start, the very start).
  const at = text.indexOf(word);
  if (at >= 0) {
    const wordStart = at === 0 || !/[a-z0-9]/.test(text[at - 1]);
    return 100 + word.length * 4 + (wordStart ? 30 : 0) + (at === 0 ? 20 : 0);
  }
  let score = 0;
  let ti = 0;
  let prev = -2;
  let first = -1;
  for (const ch of word) {
    const found = text.indexOf(ch, ti);
    if (found < 0) return null;
    const wordStart = found === 0 || !/[a-z0-9]/.test(text[found - 1]);
    score += found === prev + 1 ? 5 : 1;
    if (wordStart) score += 8;
    if (first < 0) first = found;
    prev = found;
    ti = found + 1;
  }
  // Letters strewn across a long text (a widget's bound fields) aren't a match: they must fall within a short span.
  if (prev - first + 1 > word.length * 2 + 2) return null;
  return score;
}

/**
 * How well `query` matches: each of its words against the fields (the best field for each word, the first field, a
 * name, counting double). Null when some word matches no field; 0 for an empty query.
 */
export function fuzzyScore(query: string, fields: readonly (string | undefined)[]): number | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const texts = fields.map((f) => (f ?? '').toLowerCase());
  let total = 0;
  for (const w of words) {
    let best: number | null = null;
    texts.forEach((t, i) => {
      const s = wordScore(w, t);
      if (s !== null) {
        const weighted = i === 0 ? s * 2 : s;
        if (best === null || weighted > best) best = weighted;
      }
    });
    if (best === null) return null;
    total += best;
  }
  return total;
}

/** The items matching `query` with their scores, best first (ties keep their order). */
export function fuzzyRank<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => (string | undefined)[]
): { item: T; score: number }[] {
  return items
    .map((item, i) => ({ item, i, score: fuzzyScore(query, fields(item)) }))
    .filter((x): x is { item: T; i: number; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ item, score }) => ({ item, score }));
}

/** The items matching `query`, best first (ties keep their order); all of them, in order, for an empty query. */
export function fuzzyFilter<T>(items: readonly T[], query: string, fields: (item: T) => (string | undefined)[]): T[] {
  if (!query.trim()) return [...items];
  return items
    .map((item, i) => ({ item, i, s: fuzzyScore(query, fields(item)) }))
    .filter((x): x is { item: T; i: number; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item);
}
