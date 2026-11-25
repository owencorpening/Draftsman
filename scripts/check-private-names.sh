#!/usr/bin/env bash
# Fails if any pattern in PRIVATE_NAMES appears anywhere in the repo.
#
# PRIVATE_NAMES holds one pattern per line (extended regular expressions,
# matched without regard to case). The patterns live only in that variable,
# set from a CI secret or your own shell, never in this repo, which is public.
#
# Checked: the contents and paths of every file git tracks or would track
# (anything not ignored), and every commit message on the current branch.
#
# Output says where a match is, never what matched: CI logs of a public repo
# are public too.
#
#   PRIVATE_NAMES="$(cat ~/private-names.txt)" scripts/check-private-names.sh

set -euo pipefail

if [[ -z "${PRIVATE_NAMES:-}" || -z "${PRIVATE_NAMES//[[:space:]]/}" ]]; then
  echo "check-private-names: PRIVATE_NAMES is empty or not set, so there is nothing to check against." >&2
  echo "Set it to the names to keep out of this repo, one per line (in CI, the PRIVATE_NAMES repository secret)." >&2
  exit 2
fi

cd "$(git rev-parse --show-toplevel)"

patterns="$(mktemp)"
trap 'rm -f "$patterns"' EXIT
# Trim each line, drop blank lines and Windows line endings.
printf '%s\n' "$PRIVATE_NAMES" | sed -e 's/\r$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | grep -v '^$' > "$patterns" || true
count="$(wc -l < "$patterns" | tr -d ' ')"

# A bad pattern makes grep exit 2, which the checks below would read as "no
# match" and pass silently; catch it here. (grep's message is hidden because
# it can quote the pattern.)
status=0
grep -E -i -q -f "$patterns" /dev/null 2>/dev/null || status=$?
if [[ $status -eq 2 ]]; then
  echo "check-private-names: a pattern in PRIVATE_NAMES is not a valid extended regular expression." >&2
  exit 2
fi

found=0
report() {
  echo "  $1"
  found=$((found + 1))
}

echo "check-private-names: checking against $count pattern(s)"

# File paths and contents. -I skips binary files.
while IFS= read -r -d '' file; do
  [[ -f "$file" ]] || continue
  if printf '%s\n' "$file" | grep -E -i -q -f "$patterns"; then
    report "a file path matches (path not shown)"
    continue # printing its line numbers would print the path
  fi
  # Only the line numbers leave grep; the matching text is never printed.
  lines="$(grep -E -i -n -I -f "$patterns" -- "$file" | cut -d: -f1 | paste -sd, - || true)"
  if [[ -n "$lines" ]]; then
    report "$file: line(s) $lines"
  fi
done < <(git ls-files -z --cached --others --exclude-standard)

# Commit messages on this branch.
if git rev-parse -q --verify HEAD > /dev/null; then
  while IFS= read -r sha; do
    if git log -1 --format=%B "$sha" | grep -E -i -q -f "$patterns"; then
      report "commit ${sha:0:12}: message"
    fi
  done < <(git rev-list HEAD)
fi

if [[ $found -gt 0 ]]; then
  echo "check-private-names: $found place(s) contain a private name. Remove them before pushing." >&2
  exit 1
fi
echo "check-private-names: no private names found"
