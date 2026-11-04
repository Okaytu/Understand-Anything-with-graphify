#!/usr/bin/env bash
# One command after code changes: re-map the project and list what still needs explaining.
#
#   bridge/refresh.sh <project-dir | repo-url> [run.sh options such as --branch B or --force]
#
# Re-runs graphify (free, no AI), keeps every explanation already written, rebuilds the
# graph.html explain panel, then lists the files that are new or changed. Explaining those
# needs your coding agent (steps 5 to 8 in the README): it only has to cover that list.
set -euo pipefail
case "${1:-}" in ""|-h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;; esac
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# the project is the argument that is not an option (nor the value of --view/--port/--branch)
PROJECT=""
skip=""
for a in "$@"; do
  if [ -n "$skip" ]; then skip=""; continue; fi
  case "$a" in
    --view|--port|--branch) skip=1 ;;
    -*) ;;
    *) PROJECT="$a" ;;
  esac
done

LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT
"$HERE/run.sh" "$@" --view none 2>&1 | tee "$LOG"
# a repository link is mapped in a downloaded copy: run.sh prints where it is
COPY="$(sed -n 's/^Your copy is at: *//p' "$LOG" | tail -1)"
[ -d "$PROJECT" ] || PROJECT="$COPY"
[ -n "$PROJECT" ] && [ -d "$PROJECT" ] || { echo "Could not find the project folder to report on." >&2; exit 1; }

echo
if python3 "$HERE/enrich.py" status "$PROJECT" --check >/dev/null 2>&1; then
  python3 "$HERE/enrich.py" status "$PROJECT"
  echo "Everything is explained. Nothing more to do."
else
  python3 "$HERE/enrich.py" status "$PROJECT" --list || true
  echo "These files are new or changed. Ask your coding agent to run steps 5 to 8 (estimate,"
  echo "export, explain, apply) on $PROJECT: it will only explain those."
fi
