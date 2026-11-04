#!/usr/bin/env bash
# Serve a project's graph (used by bridge/run.sh and learn-from-zero/learn.sh).
#
#   bridge/serve.sh <project-dir> [--view both|ua|graphify] [--port N]
#
#   both, ua  the dashboard on port N (127.0.0.1 only, behind a one-time token): Learn
#             (roadmap), Obsidian (dot map) and Graphify (graphify's graph.html with its
#             explain panel) in one page. Ctrl+C stops it.
#   graphify  opens graphify's graph.html straight from disk in your browser, without the
#             dashboard. No server runs, so no other program or website can read it.
set -euo pipefail

PROJECT=""
VIEW=both
PORT=5173
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --view) shift; VIEW="${1:?--view needs both|ua|graphify}" ;;
    --port) shift; PORT="${1:?--port needs a number}" ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) PROJECT="$1" ;;
  esac
  shift
done
[ -n "$PROJECT" ] || { echo "usage: bridge/serve.sh <project-dir> [--view both|ua|graphify] [--port N]" >&2; exit 2; }
case "$VIEW" in both|ua|graphify) ;; *) echo "--view must be both, ua or graphify" >&2; exit 2 ;; esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
DASHBOARD_DIR="$REPO_ROOT/understand-anything/understand-anything-plugin/packages/dashboard"
PROJECT_DIR="$(cd "$PROJECT" && pwd -P)"
OUT_DIR="$PROJECT_DIR/graphify-out"

if [ "$VIEW" = graphify ]; then
  # graph.html is one self-contained file that embeds source code for its prompts, so it is
  # opened from disk rather than served: nothing listens on a port that others could read.
  [ -f "$OUT_DIR/graph.html" ] || { echo "no $OUT_DIR/graph.html; run graphify first" >&2; exit 1; }
  printf '\n\033[1;33m==> graphify view: file://%s\033[0m\n' "$OUT_DIR/graph.html"
  echo "    report: $OUT_DIR/GRAPH_REPORT.md"
  echo "    (graph.html loads its graph library from unpkg.com, so the browser needs internet)"
  open "$OUT_DIR/graph.html" 2>/dev/null || xdg-open "$OUT_DIR/graph.html" >/dev/null 2>&1 \
    || echo "    Open the file:// link above in your browser."
  exit 0
fi

printf '\n\033[1;33m==> Dashboard (Learn, Obsidian and Graphify tabs): open the 🔑 Dashboard URL below (Ctrl+C stops it)\033[0m\n'
cd "$DASHBOARD_DIR"
GRAPH_DIR="$PROJECT_DIR" npx vite --host 127.0.0.1 --port "$PORT"
