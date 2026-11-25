// The build's identity: the commit it was built from and that commit's date, as "2026.11.25-55b37e4" (with "+" and
// the build time after the hash when the working tree had uncommitted changes). One ID names the deploy everywhere:
// shown in the app (Settings, the console), written to dist/version.json (the app compares it with the deployed one
// to offer a reload), and stamped into the service worker (each deploy's own app-shell cache).
//
// In CI the commit is GITHUB_SHA; locally, git. Without either (a source tarball), the build time stands in.

import { execSync } from 'node:child_process';

/** The build description from its parts (pure, for the tests). */
export function describeBuild({ sha, date, dirty = false, now = new Date() }) {
  const day = (date ?? now.toISOString().slice(0, 10)).replaceAll('-', '.');
  if (!sha) {
    // No commit known: the build time keeps IDs distinct (the service worker cache depends on it).
    const stamp = now.toISOString().slice(11, 19).replaceAll(':', '');
    return { id: `${day}-t${stamp}`, sha: null, date: day, dirty: false };
  }
  const short = sha.slice(0, 7);
  // Uncommitted changes: two such builds of one commit differ, so the build time keeps their IDs (and their service
  // worker caches) apart.
  const suffix = dirty ? `+t${now.toISOString().slice(11, 19).replaceAll(':', '')}` : '';
  return { id: `${day}-${short}${suffix}`, sha, date: day, dirty };
}

function git(args) {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    return null;
  }
}

/** The build description for this checkout (environment and git). */
export function readBuildInfo(env = process.env) {
  const sha = env.GITHUB_SHA || git('rev-parse HEAD');
  // The commit's own date (stable for a given commit), not the build day.
  const date = sha ? git(`show -s --format=%cs ${sha}`) : null;
  const dirty = !env.GITHUB_SHA && sha ? Boolean(git('status --porcelain --untracked-files=no')) : false;
  return describeBuild({ sha, date, dirty });
}
