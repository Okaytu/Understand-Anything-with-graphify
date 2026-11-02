#!/usr/bin/env bash
# One command: map a project with graphify (no LLM), then explore it in both
# projects' own viewers.
#
#   bridge/run.sh <project-dir> [--view both|ua|graphify|none] [--force] [--port N]
#
#   1. graphify update <project>      -> <project>/graphify-out/ (graph.json, graph.html, GRAPH_REPORT.md)
#   2. bridge/graphify_to_ua.py       -> <project>/.ua/knowledge-graph.json
#   3. bridge/validate_ua_graph.mjs   -> checked with the dashboard's own validator
#   4. viewers (--view, default both):
#        ua        Understand-Anything dashboard  http://127.0.0.1:<port>/?token=...
#        graphify  graphify's graph.html + report  http://127.0.0.1:<port+1>/graph.html
#
# Needs: uv (Python 3.10+), Node >= 22, pnpm >= 10.
set -euo pipefail

usage() {
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

PROJECT=""
VIEW=both
FORCE=()
PORT=5173
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage 0 ;;
    --view) shift; VIEW="${1:?--view needs both|ua|graphify|none}" ;;
    --no-dashboard) VIEW=none ;;
    --force) FORCE=(--force) ;;
    --port) shift; PORT="${1:?--port needs a number}" ;;
    -*) echo "unknown option: $1" >&2; usage 2 ;;
    *) [ -z "$PROJECT" ] || { echo "only one project dir, got: $PROJECT and $1" >&2; exit 2; }
       PROJECT="$1" ;;
  esac
  shift
done
[ -n "$PROJECT" ] || usage 2
case "$VIEW" in both|ua|graphify|none) ;; *) echo "--view must be both, ua, graphify or none" >&2; exit 2 ;; esac
GRAPHIFY_PORT=$((PORT + 1))

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
GRAPHIFY_DIR="$REPO_ROOT/graphify"
UA_DIR="$REPO_ROOT/understand-anything"
PLUGIN_DIR="$UA_DIR/understand-anything-plugin"
PROJECT_DIR="$(cd "$PROJECT" 2>/dev/null && pwd -P)" || { echo "project dir not found: $PROJECT" >&2; exit 2; }

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing required tool: $1 ($2)" >&2; exit 2; }; }
need uv "https://docs.astral.sh/uv/"
need node "Node.js >= 22"
need pnpm "pnpm >= 10 (corepack enable)"

step() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

# Run Python from inside graphify/: at the repo root, the top-level graphify/
# folder would shadow the installed graphify package on sys.path.
graphify_py() { (cd "$GRAPHIFY_DIR" && uv run --quiet --frozen --project "$GRAPHIFY_DIR" "$@"); }

step "1/4 graphify: mapping $PROJECT_DIR (tree-sitter, no LLM)"
graphify_py graphify update "$PROJECT_DIR"
OUT_DIR="$PROJECT_DIR/graphify-out"
[ -f "$OUT_DIR/graph.json" ] || { echo "graphify did not produce $OUT_DIR/graph.json" >&2; exit 1; }

step "2/4 bridge: converting to an Understand-Anything knowledge graph"
graphify_py python "$REPO_ROOT/bridge/graphify_to_ua.py" "$PROJECT_DIR" ${FORCE[@]+"${FORCE[@]}"}
if [ -d "$PROJECT_DIR/.understand-anything" ]; then DATA_DIR="$PROJECT_DIR/.understand-anything"; else DATA_DIR="$PROJECT_DIR/.ua"; fi

step "3/4 validate with the dashboard's own schema"
if [ ! -d "$UA_DIR/node_modules" ]; then
  (cd "$UA_DIR" && pnpm install --frozen-lockfile)
fi
if [ ! -f "$PLUGIN_DIR/packages/core/dist/schema.js" ]; then
  (cd "$UA_DIR" && pnpm --filter @understand-anything/core build)
fi
node "$REPO_ROOT/bridge/validate_ua_graph.mjs" "$DATA_DIR/knowledge-graph.json"

if git -C "$PROJECT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  && ! git -C "$PROJECT_DIR" check-ignore -q graphify-out/graph.json; then
  echo
  echo "hint: graphify-out/ is not git-ignored in this project, so the dashboard's freshness"
  echo "      check will count graphify's output files as uncommitted changes. Add this line"
  echo "      to $PROJECT_DIR/.gitignore:  graphify-out/"
fi

echo
echo "Outputs:"
echo "  graphify view    $OUT_DIR/graph.html   (open directly in a browser)"
echo "  graphify report  $OUT_DIR/GRAPH_REPORT.md"
echo "  UA graph         $DATA_DIR/knowledge-graph.json"

if [ "$VIEW" = none ]; then
  echo
  echo "Re-run with --view both|ua|graphify to start the viewers."
  exit 0
fi

GRAPHIFY_PID=""
cleanup() { [ -n "$GRAPHIFY_PID" ] && kill "$GRAPHIFY_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

if [ "$VIEW" = graphify ] || [ "$VIEW" = both ]; then
  step "4/4 graphify view: http://127.0.0.1:$GRAPHIFY_PORT/graph.html  (report: /GRAPH_REPORT.md)"
  # Bound to localhost only; serves just the graphify-out folder.
  PY="$(cd "$GRAPHIFY_DIR" && uv run --quiet --frozen --project "$GRAPHIFY_DIR" python -c 'import sys; print(sys.executable)')"
  "$PY" -m http.server "$GRAPHIFY_PORT" --bind 127.0.0.1 --directory "$OUT_DIR" >/dev/null 2>&1 &
  GRAPHIFY_PID=$!
fi

if [ "$VIEW" = graphify ]; then
  echo "Serving graphify's view. Ctrl+C to stop."
  wait "$GRAPHIFY_PID"
  exit 0
fi

step "4/4 Understand-Anything dashboard: open the 🔑 Dashboard URL printed below (Ctrl+C to stop both)"
cd "$PLUGIN_DIR/packages/dashboard"
GRAPH_DIR="$PROJECT_DIR" npx vite --host 127.0.0.1 --port "$PORT"
