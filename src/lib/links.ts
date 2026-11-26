// Where Glareshield's documentation and source live (Settings → About).

export const REPO_URL = 'https://github.com/yuri-rage/mavlink-glareshield';

/** A file in the repository's default branch, as GitHub shows it. */
export const repoFile = (path: string) => `${REPO_URL}/blob/master/${path}`;

export const DOC_LINKS: { label: string; href: string; hint: string }[] = [
  { label: 'User guide', href: repoFile('docs/user-guide.md'), hint: 'Using Glareshield once it is connected' },
  {
    label: 'Connecting',
    href: repoFile('docs/connection-guide.md'),
    hint: 'The bridge, Docker, serial and UDP links, several vehicles',
  },
  { label: 'Custom widgets', href: repoFile('docs/custom-widgets.md'), hint: 'Making and sharing your own widgets' },
  { label: 'Examples', href: `${REPO_URL}/tree/master/examples`, hint: 'Widgets to import' },
];
