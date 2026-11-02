#!/usr/bin/env bash
# Serve a project's graph in both viewers (used by bridge/run.sh and learn-from-zero/learn.sh).
#
#   bridge/serve.sh <project-dir> [--view both|ua|graphify] [--port N]
#
#   ua        Understand-Anything dashboard for <project>/.ua/knowledge-graph.json  -> port N
#   graphify  graphify's graph.html + GRAPH_REPORT.md from <project>/graphify-out/   -> port N+1
#
# Both bind to 127.0.0.1 only. Ctrl+C stops both.
set -euo pipefail

PROJECT=""
VIEW=both
PORT=5173
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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
GRAPHIFY_DIR="$REPO_ROOT/graphify"
DASHBOARD_DIR="$REPO_ROOT/understand-anything/understand-anything-plugin/packages/dashboard"
PROJECT_DIR="$(cd "$PROJECT" && pwd -P)"
OUT_DIR="$PROJECT_DIR/graphify-out"
GRAPHIFY_PORT=$((PORT + 1))

GRAPHIFY_PID=""
cleanup() { [ -n "$GRAPHIFY_PID" ] && kill "$GRAPHIFY_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

if [ "$VIEW" != ua ]; then
  [ -f "$OUT_DIR/graph.html" ] || { echo "no $OUT_DIR/graph.html; run graphify first" >&2; exit 1; }
  # graphify's own interpreter (run from inside graphify/ so the folder does not shadow the package)
  PY="$(cd "$GRAPHIFY_DIR" && uv run --quiet --frozen --project "$GRAPHIFY_DIR" python -c 'import sys; print(sys.executable)')"
  "$PY" -m http.server "$GRAPHIFY_PORT" --bind 127.0.0.1 --directory "$OUT_DIR" >/dev/null 2>&1 &
  GRAPHIFY_PID=$!
  printf '\n\033[1;33m==> graphify view: http://127.0.0.1:%s/graph.html  (report: /GRAPH_REPORT.md)\033[0m\n' "$GRAPHIFY_PORT"
  echo "    (graph.html loads its graph library from unpkg.com, so the browser needs internet)"
fi

if [ "$VIEW" = graphify ]; then
  echo "Serving graphify's view. Ctrl+C to stop."
  wait "$GRAPHIFY_PID"
  exit 0
fi

printf '\n\033[1;33m==> Understand-Anything dashboard: open the 🔑 Dashboard URL below (Ctrl+C stops both)\033[0m\n'
cd "$DASHBOARD_DIR"
GRAPH_DIR="$PROJECT_DIR" npx vite --host 127.0.0.1 --port "$PORT"
