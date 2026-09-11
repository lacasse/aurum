#!/bin/sh
# Reject real financial figures before they reach the repository.
#
# The app's whole subject is one person's money, and their figures kept arriving
# in places that felt like documentation rather than data: the comment
# explaining why a bug mattered, the test asserting the fix, the commit message
# describing the symptom. GitHub renders commit messages inside the pull
# request, so a balance sheet ends up on a page anyone can read. It happened
# four times, three of them after it had supposedly been learned, which is why
# this is mechanical now rather than a rule to remember.
#
# Written in shell on purpose: node is not on this machine's PATH (it lives in
# the dev container), and a guard that silently does nothing is worse than no
# guard. The first version of this was a .mjs file, and the hook failed open
# with "node: not found" while reporting success.
#
#   scripts/check-no-personal-figures.sh            scan tracked files
#   scripts/check-no-personal-figures.sh --staged   scan staged changes + message
#
# What counts is a comma-grouped currency figure -- one thousand and up. Below a
# thousand there is nothing identifying; above it, a precise amount is almost
# always copied from something real.
#
# Two ways past it, both deliberate:
#   - add a wholly-invented file to ALLOWED below
#   - mark the single line INVENTED, which is a claim you are making
#   - put ALL-FIXTURES-INVENTED in a file whose every row is made up, which
#     waives only the export-row heuristic for it. Needed where fixtures live
#     inside a raw CSV literal and a trailing comment would corrupt the data.
#     Amounts and private terms are still rejected in such a file.
set -eu

MONEY='\$ ?[0-9]{1,3}(,[0-9]{3})+(\.[0-9]+)?'

# Shorthand: [figure redacted], [figure redacted], [figure redacted]. Comma grouping was the only shape the guard
# knew, so an amount written the way a person says it out loud walked straight
# past -- three of them sat in code comments in a public repository, one for
# months. An invented figure in a fixture is round and small; these are not the
# shape anybody invents.
SHORT='\$ ?[0-9]+(\.[0-9]+)? ?[kKmM]([^a-zA-Z0-9]|$)'

# The same, without interval expressions. `--staged` pipes through awk, whose
# POSIX regex has no {n,m}, and the variable it read did not exist at all: with
# `set -u` the awk never ran, the hit file was never written, and the hook
# reported "No real financial figures found" for every staged commit. A guard
# that fails open is worse than no guard, which is the whole reason this file
# is shell and not node -- and it happened here anyway.
MONEY_AWK='\$?[ ]?[0-9][0-9]?[0-9]?(,[0-9][0-9][0-9])+(\.[0-9]+)?'
# The same for awk: no interval expressions, and a bracket for the dollar sign
# because awk swallows the backslash escape and then matches every k in the
# file. Checked by running it, not by reading it.
SHORT_AWK='[$] ?[0-9]+(\.[0-9]+)? ?[kKmM]([^a-zA-Z0-9]|$)' 

# A private list of terms that must never appear: tickers actually held,
# the broker, the pension plan, account identifiers off a statement, the
# machine's hostname. Deliberately NOT in the repository -- a deny-list of
# someone's holdings is itself the disclosure it exists to prevent.
#
# One term per line, blank lines and # comments ignored. Set AURUM_PRIVATE_TERMS
# to point elsewhere. When the file is absent only the generic checks run, which
# is the right behaviour for a fresh clone or CI.
TERMS="${AURUM_PRIVATE_TERMS:-$HOME/.config/aurum/private-terms.txt}"

# A row lifted straight out of a brokerage export: a date, then several
# comma-separated fields, then a price. Whole statement lines were pasted into
# test files as fixtures, which is how account identifiers and real trades got
# in without any single number looking out of place.
EXPORT_ROW='[0-9]{4}-[0-9]{2}-[0-9]{2},([^,]*,){4,}'

# A quantity written as words. "twenty-three US shares" is a real position size
# and passed every check here, because the rules all looked for digits. Spelling
# a number out is exactly what someone does in a comment explaining why a bug
# mattered, which is the sentence that has leaked something every single time.
#
# Deliberately narrow: a number word must sit next to a noun that means a real
# holding. Prose counts things constantly -- "two securities", "three changes" --
# and a guard that fires on those is one that gets switched off.
# Only a compound number -- "twenty-three", "forty-two" -- next to a noun that
# means a real holding. The first version accepted any number word and fired on
# "ten shares cost 200" and "a million dollars of portfolio", which is prose,
# and a guard that cries wolf is one that gets switched off. A round number in
# an example is nobody's position; a compound one almost always is.
TENS='(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)'
UNITS='(one|two|three|four|five|six|seven|eight|nine)'
SPELLED="$TENS[- ]$UNITS([- ][a-zA-Z]+){0,2}[- ](shares?|units?|coins?)"
SPELLED_AWK="$SPELLED"
EXPORT_ROW_AWK='[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9],([^,]*,)([^,]*,)([^,]*,)([^,]*,)'

# Terms from the private list, as one alternation, or empty when there is none.
terms_pattern() {
  [ -f "$TERMS" ] || return 0
  sed -e 's/#.*//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' "$TERMS" \
    | grep -v '^$' | paste -sd'|' - 2>/dev/null || true
}
TERMS_RE=$(terms_pattern)
ALLOWED='^(src/lib/sample\.ts|scripts/check-no-personal-figures\.sh)$'
SCAN_EXT='\.(ts|tsx|js|mjs|md|sql|json|ya?ml)$'

found=0
report() {
  if [ "$found" -eq 0 ]; then
    printf '\nReal financial figures must not enter the repository.\n\n' >&2
    found=1
  fi
  printf '  %s\n' "$1" >&2
}

if [ "${1:-}" = "--staged" ]; then
  # Only added lines. A figure already in the tree is the history rewrite's
  # problem, not this commit's; failing on it would block every unrelated commit.
  git diff --cached --unified=0 | awk -v money="$MONEY_AWK" -v short="$SHORT_AWK" -v row="$EXPORT_ROW_AWK" -v terms="$TERMS_RE" -v allowed="$ALLOWED" -v spelled="$SPELLED_AWK" '
    /^\+\+\+ b\// {
      file = substr($0, 7)
      skip = (file ~ allowed)
      loose = 0
      cmd = "grep -q ALL-FIXTURES-INVENTED \"" file "\" 2>/dev/null && echo y"
      cmd | getline loose_flag
      close(cmd)
      loose = (loose_flag == "y")
      loose_flag = ""
      next
    }
    /^\+\+\+/     { next }
    /^\+/ {
      if (skip) next
      line = substr($0, 2)
      if (line ~ /INVENTED/) next
      if (line ~ money)  { printf "%s [amount]: %s\n",  file, substr(line, 1, 100); next }
      if (line ~ short)  { printf "%s [amount]: %s\n",  file, substr(line, 1, 100); next }
      if (line ~ spelled) { printf "%s [quantity in words]: %s\n", file, substr(line, 1, 100); next }
      if (!loose && line ~ row) { printf "%s [export row]: %s\n", file, substr(line, 1, 100); next }
      if (terms != "" && line ~ terms) { printf "%s [private term]: %s\n", file, substr(line, 1, 100) }
    }
  ' > /tmp/.figcheck.$$ 2>/dev/null || true
  while IFS= read -r hit; do [ -n "$hit" ] && report "$hit"; done < /tmp/.figcheck.$$
  rm -f /tmp/.figcheck.$$

elif [ "${1:-}" = "--build-context" ]; then
  # git is not the only way out of this directory.
  #
  # The Docker builder runs `COPY . .` and never consults git, so `ops/` --
  # gitignored precisely because it holds one installation's real figures --
  # was copied into the image and shipped inside it. `.gitignore` was checked
  # and reported safe; `.dockerignore` was never looked at. A second exit
  # nobody was watching.
  #
  # This asserts the exclusions exist rather than trying to reproduce Docker's
  # matching rules, because the failure was a missing rule, not a subtle one.
  [ -f .dockerignore ] || { report "no .dockerignore: the build context is unguarded"; }
  if [ -f .dockerignore ]; then
    for required in "ops/" ".env"; do
      grep -qxF "$required" .dockerignore \
        || report ".dockerignore does not exclude $required"
    done
  fi
  # Anything git ignores but Docker would still copy, holding something private.
  if [ -n "$TERMS_RE" ] || true; then
    ignored=$(git ls-files --others --ignored --exclude-standard 2>/dev/null \
      | grep -Ev '^(node_modules|\.next|\.test-build)/' || true)
    for f in $ignored; do
      [ -f "$f" ] || continue
      case "$f" in .env*) continue ;; esac
      excluded=0
      while IFS= read -r rule; do
        case "$rule" in ""|\#*) continue ;; esac
        case "$f" in ${rule%/}/*|$rule) excluded=1; break ;; esac
      done < .dockerignore
      [ "$excluded" -eq 1 ] && continue
      if grep -Eq "$MONEY|$SHORT" "$f" 2>/dev/null; then
        report "$f [amount] is gitignored but would be copied into the image"
      elif [ -n "$TERMS_RE" ] && grep -Eq "$TERMS_RE" "$f" 2>/dev/null; then
        report "$f [private term] is gitignored but would be copied into the image"
      fi
    done
  fi

elif [ "${1:-}" = "--message" ]; then
  # The message, with no allowance at all. Prose explaining a change never
  # needs an amount in it -- naming the mechanism says more and cannot leak.
  #
  # Its own mode because the file only exists once git has collected the
  # message: pre-commit runs earlier and would read the *previous* commit's
  # message, failing on text that is no longer being written.
  msg="${2:-}"
  [ -n "$msg" ] && [ -f "$msg" ] || { echo "usage: --message <file>" >&2; exit 2; }
  while IFS= read -r line; do
    case "$line" in \#*) continue ;; esac
    case "$line" in *INVENTED*) continue ;; esac
    if printf '%s' "$line" | grep -Eq "$MONEY|$SHORT"; then
      report "commit message [amount]: $(printf '%s' "$line" | cut -c1-110)"
    elif printf '%s' "$line" | grep -Eq "$SPELLED"; then
      report "commit message [quantity in words]: $(printf '%s' "$line" | cut -c1-110)"
    elif [ -n "$TERMS_RE" ] && printf '%s' "$line" | grep -Eq "$TERMS_RE"; then
      report "commit message [private term]: $(printf '%s' "$line" | cut -c1-110)"
    fi
  done < "$msg"
else
  # One grep over every tracked file of interest. The line-at-a-time version
  # spawned a process per line and took minutes on this repo, which meant in
  # practice it would not be run.
  files=$(git ls-files | grep -E "$SCAN_EXT" | grep -Ev "$ALLOWED" || true)
  if [ -n "$files" ]; then
    strict=""
    loose=""
    for f in $files; do
      if grep -q 'ALL-FIXTURES-INVENTED' "$f" 2>/dev/null; then
        loose="$loose $f"
      else
        strict="$strict $f"
      fi
    done
    pattern="$MONEY|$SHORT|$EXPORT_ROW|$SPELLED"
    [ -n "$TERMS_RE" ] && pattern="$pattern|$TERMS_RE"
    loose_pattern="$MONEY|$SHORT|$SPELLED"
    [ -n "$TERMS_RE" ] && loose_pattern="$loose_pattern|$TERMS_RE"
    hits=""
    [ -n "$strict" ] && hits=$(grep -nEH "$pattern" $strict 2>/dev/null | grep -v INVENTED || true)
    if [ -n "$loose" ]; then
      more=$(grep -nEH "$loose_pattern" $loose 2>/dev/null | grep -v INVENTED || true)
      hits=$(printf '%s\n%s' "$hits" "$more" | grep -v '^$' || true)
    fi
    if [ -n "$hits" ]; then
      printf '%s\n' "$hits" | cut -c1-140 | while IFS= read -r hit; do
        printf '  %s\n' "$hit" >&2
      done
      found=1
      printf '\nReal financial figures must not enter the repository.\n' >&2
    fi
  fi
fi

if [ "$found" -ne 0 ]; then
  cat >&2 <<'MSG'

Describe the mechanism instead of the amount. If the figures really are
invented, mark the line INVENTED or add the file to ALLOWED in
scripts/check-no-personal-figures.sh. Never use --no-verify.
MSG
  exit 1
fi

echo "No real financial figures found."
