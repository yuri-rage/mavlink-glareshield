#!/usr/bin/env bash
# The notes on a version tag's GitHub Release: the SmartScreen hint (while Windows builds are unsigned) and the pull
# requests merged since the previous release, from GitHub's own note generator, as "- Title (#N)".
#
#   scripts/release-notes.sh v0.2.1            print the notes
#   scripts/release-notes.sh v0.2.1 --apply    write them to the release
#
# Text written by hand outside the generated block (between the markers) is kept. Run by the desktop release workflow
# after both builds have published; by hand to backfill or refresh a release. Needs gh, authenticated.
# SIGNED=true leaves the SmartScreen hint out.
set -euo pipefail

tag=${1:?usage: release-notes.sh <tag> [--apply]}
apply=${2:-}
repo=${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}

start='<!-- release-notes:start -->'
end='<!-- release-notes:end -->'
hint='**Windows:** the installer is not code-signed yet, so SmartScreen may stop it. Choose **More info → Run anyway**.'

generated=$(gh api "repos/$repo/releases/generate-notes" -f tag_name="$tag" -q .body)

# "* Title by @user in https://github.com/o/r/pull/N" → "- Title (#N)"; the compare link kept; the rest dropped.
changes=$(printf '%s\n' "$generated" | sed -nE 's#^\* (.*) by @[^ ]+ in https://github\.com/[^ ]+/pull/([0-9]+)$#- \1 (\#\2)#p')
compare=$(printf '%s\n' "$generated" | grep -m1 '^\*\*Full Changelog\*\*' || true)
count=$(printf '%s' "$changes" | grep -c '^- ' || true)

block=$start
[ "${SIGNED:-false}" = true ] || block+=$'\n'"$hint"$'\n'
if [ "$count" -eq 0 ]; then
  block+=$'\n'"No pull requests since the previous release."
elif [ "$count" -gt 20 ]; then
  block+=$'\n'"<details><summary>$count changes</summary>"$'\n\n'"$changes"$'\n\n'"</details>"
else
  block+=$'\n'"## Changes"$'\n\n'"$changes"
fi
[ -z "$compare" ] || block+=$'\n\n'"$compare"
block+=$'\n'"$end"

if [ "$apply" != --apply ]; then
  printf '%s\n' "$block"
  exit 0
fi

body=$(gh release view "$tag" --repo "$repo" --json body -q .body)
if [[ "$body" == *"$start"*"$end"* ]]; then
  rest_before=${body%%"$start"*}
  rest_after=${body#*"$end"}
else
  # Before this script, the workflow wrote only the hint: drop it, keep anything else after the block.
  rest_before=
  rest_after=$(printf '%s\n' "${body//"$hint"/}" | sed -e '/./,$!d')
  [ -z "$rest_after" ] || rest_after=$'\n\n'"$rest_after"
fi
notes="$rest_before$block$rest_after"
# Trim leading and trailing blank lines left by a dropped hint.
notes=$(printf '%s\n' "$notes" | sed -e '/./,$!d' | sed -e ':a' -e '/^\n*$/{$d;N;ba' -e '}')
gh release edit "$tag" --repo "$repo" --notes "$notes" >/dev/null
echo "Notes written to $tag ($count changes)."
