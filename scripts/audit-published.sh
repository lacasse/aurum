#!/bin/sh
# What is actually published, audited from the outside.
#
# `check-no-personal-figures.sh` reads the working tree. That is the wrong
# surface for this question and always was: a working tree that is clean today
# says nothing about the commit that cleaned it, the pull request refs that
# pinned the version before it, or the release note somebody wrote by hand.
# Four leaks survived a working-tree grep, and the September 2026 audit found
# two more that had never been anywhere near one -- a release body and a pull
# request body, both with public URLs.
#
# So this clones the remote as a stranger would, fetches the pull request refs
# that a force-push cannot touch, and scans:
#
#   1. every blob on branches and tags -- what a clone gets
#   2. every blob reachable only from refs/pull/* -- what survives a rewrite
#   3. every commit message, separately, because a blob scan misses them
#   4. every tag message
#   5. the GitHub side: repository description, pull request titles and
#      bodies, issues, review comments, release notes
#   6. the author and committer identity on every commit
#
# It needs `gh` authenticated for step 5. Without it the git side still runs
# and the GitHub side reports that it was skipped, which is not the same as
# passing.
#
# Run it before publishing anything, and after any remediation: the rewrite
# that removed amounts in September 2026 left the private terms in place, and
# nobody looked again.
set -u

REMOTE="${AURUM_AUDIT_REMOTE:-$(git remote get-url origin 2>/dev/null)}"
[ -n "$REMOTE" ] || { echo "no remote to audit" >&2; exit 2; }
SLUG=$(printf '%s' "$REMOTE" | sed -e 's#^git@github.com:##' -e 's#^https://github.com/##' -e 's#\.git$##')

TERMS="${AURUM_PRIVATE_TERMS:-$HOME/.config/aurum/private-terms.txt}"
MONEY='\$ ?[0-9]{1,3}(,[0-9]{3})+(\.[0-9]+)?'
SHORT='\$ ?[0-9]+(\.[0-9]+)? ?[kKmM]([^a-zA-Z0-9]|$)'
BARE='\$[0-9]{3,}(\.[0-9]+)?'
AMOUNT="$MONEY|$SHORT|$BARE"
# Files whose every figure is invented by construction, and the guard itself.
SKIP='^(src/lib/sample\.ts|scripts/check-no-personal-figures\.sh|scripts/audit-published\.sh)$'

TERMS_RE=""
if [ -f "$TERMS" ]; then
  TERMS_RE=$(sed -e 's/#.*//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' "$TERMS" \
    | grep -v '^$' | paste -sd'|' -)
else
  echo "note: no private terms at $TERMS -- only the generic checks will run" >&2
fi

found=0
noted=0
report() {
  [ "$found" -eq 0 ] && printf '\nPublished material carries personal data.\n\n' >&2
  found=1
  printf '  %s\n' "$1" >&2
}
# Pull request refs are read-only and permanent: no force-push reaches them,
# and clearing them means GitHub Support or deleting the repository. Reporting
# them is right; failing on them every run for months is not -- a check that is
# always red is a check that gets ignored, and being ignored is how all of this
# happened. They are listed under their own heading and do not set the exit
# status. Everything else does, because everything else can be fixed today.
note() {
  [ "$noted" -eq 0 ] && printf '\nStanding, not fixable by a push:\n\n' >&2
  noted=1
  printf '  %s\n' "$1" >&2
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM
echo "cloning $SLUG as a stranger would..."
git clone --quiet --mirror "$REMOTE" "$work/repo" || { echo "clone failed" >&2; exit 2; }
cd "$work/repo" || exit 2
# Permanent, and unreachable by any force-push: a pull request pins the commits
# it was opened from for the life of the repository.
git fetch --quiet origin '+refs/pull/*/head:refs/pull/*/head' 2>/dev/null || true

published=$(git for-each-ref --format='%(refname)' refs/heads refs/tags)

# Paths the owner has marked as holding invented figures, decided once from
# the current tree.
#
# A fixtures file is a fixtures file in every revision of itself. The markers
# were added the day the rule was written and the invented rows predate them
# by months, so judging each historical blob on whether it happened to carry
# one yet reports a hundred lines of made-up rent as leaks -- and an audit
# that cries wolf is an audit nobody runs, which is how the last four got
# through.
#
# This waives the amount check only, and only for these paths. Private terms
# are still checked everywhere: an invented amount beside a real payee is
# still a real payee, and that is precisely what this audit found in them.
# Any path without a marker -- a page, a library, a script -- is judged in
# full, which is where every leak so far has actually been.
FIXTURE_PATHS=$(git grep -l 'INVENTED' refs/heads/main 2>/dev/null \
  | sed 's#^refs/heads/main:##' | paste -sd'|' -)
pullrefs=$(git for-each-ref --format='%(refname)' refs/pull)

scan_blobs() {
  label="$1"; shift
  [ -n "$*" ] || return 0
  git rev-list --objects "$@" 2>/dev/null | while read -r oid path; do
    [ -z "$path" ] && continue
    printf '%s' "$path" | grep -Eq "$SKIP" && continue
    [ "$(git cat-file -t "$oid" 2>/dev/null)" = blob ] || continue
    body=$(git cat-file blob "$oid" 2>/dev/null | head -c 400000)
    # The same allowances the commit guard makes, so this reports what is
    # wrong rather than what is merely numeric. A guard that cries wolf on
    # every fixture is a guard nobody reads.
    if printf '%s' "$body" | grep -q 'ALL-FIXTURES-INVENTED'; then
      hit=""
    elif [ -n "$FIXTURE_PATHS" ] && printf '%s' "$path" | grep -Eqx "$FIXTURE_PATHS"; then
      hit=""
    else
      hit=$(printf '%s' "$body" | grep -nE "$AMOUNT" | grep -v INVENTED | head -1)
    fi
    [ -n "$hit" ] && echo "$label [amount] $path: $(printf '%s' "$hit" | cut -c1-90)"
    if [ -n "$TERMS_RE" ]; then
      hit=$(printf '%s' "$body" | grep -nE "$TERMS_RE" | head -1)
      [ -n "$hit" ] && echo "$label [private term] $path: $(printf '%s' "$hit" | cut -c1-90)"
    fi
  done
}

echo "scanning blobs on branches and tags..."
scan_blobs "clone" $published > "$work/a" 2>/dev/null
echo "scanning blobs reachable only from pull request refs..."
if [ -n "$pullrefs" ]; then
  # shellcheck disable=SC2086
  scan_blobs "refs/pull" $pullrefs $(for r in $published; do echo "^$r"; done) > "$work/b" 2>/dev/null
else
  : > "$work/b"
fi

echo "scanning commit and tag messages..."
: > "$work/c"
for scope in "published:$published" "refs/pull:$pullrefs"; do
  label=${scope%%:*}; refs=${scope#*:}
  [ -n "$refs" ] || continue
  # shellcheck disable=SC2086
  git rev-list $refs 2>/dev/null | while read -r c; do
    msg=$(git log -1 --format='%B' "$c")
    hit=$(printf '%s' "$msg" | grep -nE "$AMOUNT" | grep -v INVENTED | head -1)
    [ -n "$hit" ] && echo "$label [amount] commit $c: $(printf '%s' "$hit" | cut -c1-90)"
    if [ -n "$TERMS_RE" ]; then
      hit=$(printf '%s' "$msg" | grep -nE "$TERMS_RE" | head -1)
      [ -n "$hit" ] && echo "$label [private term] commit $c: $(printf '%s' "$hit" | cut -c1-90)"
    fi
  done >> "$work/c"
done
for t in $(git for-each-ref --format='%(refname)' refs/tags); do
  hit=$(git cat-file -p "$t" 2>/dev/null | grep -nE "$AMOUNT${TERMS_RE:+|$TERMS_RE}" | head -1)
  [ -n "$hit" ] && echo "tag [text] $t: $(printf '%s' "$hit" | cut -c1-90)" >> "$work/c"
done

echo "checking commit identities..."
git log --all --format='%ae%n%ce' | sort -u | grep -v '^[^@]*@users\.noreply\.github\.com$' \
  | grep -v '^noreply@github\.com$' | grep -v '^noreply@anthropic\.com$' > "$work/d" || true

echo "scanning the GitHub side..."
: > "$work/e"
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  {
    gh api "repos/$SLUG" --jq '.description // "", .homepage // ""'
    gh api "repos/$SLUG/pulls?state=all&per_page=100" --jq '.[] | "PR#\(.number) \(.title)\n\(.body // "")"'
    gh api "repos/$SLUG/issues?state=all&per_page=100" --jq '.[] | "issue \(.title)\n\(.body // "")"'
    gh api "repos/$SLUG/releases?per_page=100" --jq '.[] | "release \(.tag_name) \(.name // "")\n\(.body // "")"'
    gh api "repos/$SLUG/pulls/comments?per_page=100" --jq '.[].body'
    gh api "repos/$SLUG/issues/comments?per_page=100" --jq '.[].body'
  } > "$work/gh.txt" 2>/dev/null
  grep -nE "$AMOUNT" "$work/gh.txt" | grep -v INVENTED | head -20 \
    | sed 's/^/github [amount] /' >> "$work/e" || true
  if [ -n "$TERMS_RE" ]; then
    grep -nE "$TERMS_RE" "$work/gh.txt" | head -20 | sed 's/^/github [private term] /' >> "$work/e" || true
  fi
else
  echo "github: SKIPPED -- gh is not installed or not authenticated." >&2
  echo "        Pull request bodies and release notes were NOT checked," >&2
  echo "        and that is where the last two leaks were." >&2
fi

for f in a c d e; do
  [ -s "$work/$f" ] || continue
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    case "$line" in "refs/pull "*) note "$line" ;; *) report "$line" ;; esac
  done < "$work/$f"
done
[ -s "$work/b" ] && while IFS= read -r line; do
  [ -n "$line" ] && note "$line"
done < "$work/b"

if [ "$noted" -ne 0 ]; then
  cat >&2 <<'MSG'

Those live in refs/pull/*, which a pull request pins for the life of the
repository. A force-push cannot reach them. Clearing them means asking GitHub
Support to purge the refs, or deleting and recreating the repository.
MSG
fi

if [ "$found" -ne 0 ]; then
  cat >&2 <<'MSG'

A hit under "clone" or "published" is in what anyone downloads and needs a
history rewrite. A hit under "github" is a page with a public URL and can be
edited now -- that is `gh api -X PATCH`, not a rewrite.
MSG
  exit 1
fi
echo "Nothing personal in anything published."
[ "$noted" -ne 0 ] && echo "(standing items above remain, in refs nobody can push to.)"
exit 0
