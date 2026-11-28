// What's new after a desktop update (src/lib/releaseNews.ts): shown once per newer version, never on a first run or
// a downgrade, and not when turned off (the version is still recorded, so turning it on later shows nothing stale).
export {};
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const news = await import('../src/lib/releaseNews.ts');
const { compareVersions, isNews, parseReleaseChanges, startReleaseNews, useReleaseNewsStore } = news;

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

check('0.10.0 is after 0.9.2', compareVersions('0.10.0', '0.9.2') === 1);
check('v0.2.1 equals 0.2.1', compareVersions('v0.2.1', '0.2.1') === 0);
check('0.2 equals 0.2.0', compareVersions('0.2', '0.2.0') === 0);
check('first run is not news', !isNews('0.3.0', null));
check('a downgrade is not news', !isNews('0.2.0', '0.3.0'));
check('a newer version is news', isNews('0.3.0', '0.2.1'));

// The notes script's output, short and folded.
const body = [
  '<!-- release-notes:start -->',
  '**Windows:** the installer is not code-signed yet, so SmartScreen may stop it.',
  '',
  '## Changes',
  '',
  '- Widgets: change a `tile` value (#140)',
  '- Top bars and Now items (#139)',
  '',
  '**Full Changelog**: https://github.com/x/y/compare/v0.1.0...v0.2.0',
  '<!-- release-notes:end -->',
].join('\n');
const changes = parseReleaseChanges(body);
check(
  'changes parsed, ticks dropped',
  changes.join('|') === 'Widgets: change a tile value (#140)|Top bars and Now items (#139)',
  changes.join('|')
);
check(
  'folded list parsed',
  parseReleaseChanges('<details><summary>2</summary>\r\n\r\n- A (#1)\r\n- B (#2)\r\n\r\n</details>').length === 2
);
check(
  'other bullets ignored',
  parseReleaseChanges('- no PR number here\n* Something (#3)').join() === 'Something (#3)'
);

// Startup, with a fake GitHub.
let fetched = 0;
const fakeFetch = (async (url: string) => {
  fetched++;
  return { ok: url.endsWith('/v0.3.0'), json: async () => ({ body }) };
}) as any;
const reset = (saved: object | null) => {
  if (saved) mem.set('mavlink_glareshield_release_news', JSON.stringify(saved));
  else mem.clear();
  useReleaseNewsStore.setState({
    enabled: (saved as any)?.enabled !== false,
    lastSeen: (saved as any)?.lastSeen ?? null,
    news: null,
  });
  fetched = 0;
};
const stored = () => JSON.parse(mem.get('mavlink_glareshield_release_news') ?? 'null');

reset(null);
await startReleaseNews('0.2.1', fakeFetch);
let st = useReleaseNewsStore.getState();
check('first run: nothing shown, nothing fetched', st.news === null && fetched === 0);
check('…the version recorded', stored()?.lastSeen === '0.2.1', JSON.stringify(stored()));

await startReleaseNews('0.3.0', fakeFetch);
st = useReleaseNewsStore.getState();
check(
  'updated: the news is shown',
  st.news?.version === '0.3.0' && st.news.changes.length === 2,
  JSON.stringify(st.news)
);
check('…linking to the release', st.news?.url.endsWith('/releases/tag/v0.3.0') === true);
check('…not seen until closed', stored()?.lastSeen === '0.2.1');
st.dismiss();
check('closed: gone, and seen', useReleaseNewsStore.getState().news === null && stored()?.lastSeen === '0.3.0');
await startReleaseNews('0.3.0', fakeFetch);
check('the next start: nothing again', useReleaseNewsStore.getState().news === null && fetched === 1);

reset({ enabled: true, lastSeen: '0.3.0' });
await startReleaseNews('0.2.1', fakeFetch);
check(
  'a downgrade: nothing, and the record stays at the newer version',
  useReleaseNewsStore.getState().news === null && stored().lastSeen === '0.3.0'
);

reset({ enabled: true, lastSeen: '0.2.1' });
await startReleaseNews('0.3.1', fakeFetch); // no such release: offline or not published
st = useReleaseNewsStore.getState();
check(
  'notes unavailable: still says which version, with the link',
  st.news?.version === '0.3.1' && st.news.changes.length === 0
);

reset({ enabled: false, lastSeen: '0.2.1' });
await startReleaseNews('0.3.0', fakeFetch);
check('turned off: nothing shown, nothing fetched', useReleaseNewsStore.getState().news === null && fetched === 0);
check('…but recorded', stored().lastSeen === '0.3.0');
useReleaseNewsStore.getState().setEnabled(true);
await startReleaseNews('0.3.0', fakeFetch);
check('turned back on: no stale news', useReleaseNewsStore.getState().news === null);

reset({ enabled: true, lastSeen: '0.2.1' });
await startReleaseNews('0.3.0', fakeFetch);
useReleaseNewsStore.getState().setEnabled(false);
check(
  '"Don\'t show these": closes it and stays off',
  useReleaseNewsStore.getState().news === null && stored().enabled === false
);

await startReleaseNews(null, fakeFetch);
check('in a browser (no desktop version): nothing', fetched === 1);

console.log(failures.length ? `\n${failures.length} release news check(s) FAILED` : '\nAll release news checks PASSED');
process.exit(failures.length ? 1 : 0);
