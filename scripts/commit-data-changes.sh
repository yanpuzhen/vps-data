#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <commit-message> <file> [file ...]" >&2
  exit 64
fi

commit_message="$1"
shift

branch="${GITHUB_REF_NAME:-}"
if [ -z "$branch" ]; then
  branch="$(git branch --show-current)"
fi
if [ -z "$branch" ]; then
  branch="main"
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

git add -- "$@"
if git diff --cached --quiet; then
  echo "No data changes."
  exit 0
fi

git commit -m "$commit_message"

max_attempts="${GIT_PUSH_MAX_ATTEMPTS:-3}"
for attempt in $(seq 1 "$max_attempts"); do
  if git push origin "HEAD:$branch"; then
    exit 0
  fi

  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "Push failed after $attempt attempts." >&2
    exit 1
  fi

  echo "Push failed; rebasing onto origin/$branch before retry $((attempt + 1))/$max_attempts."
  git fetch origin "$branch"
  git rebase FETCH_HEAD
done
