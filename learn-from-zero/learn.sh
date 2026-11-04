#!/usr/bin/env bash
# Start-from-zero learning: turn a wiki of notes into a knowledge graph and open it
# in the dashboard. Re-run after every few notes and watch the graph grow.
#
#   learn-from-zero/learn.sh <wiki-dir> [--view both|ua|graphify|none] [--port N] [--force]
#
#   1. learn.py build      -> <wiki>/.ua/knowledge-graph.json  (Understand-Anything's own
#                             deterministic wiki parser + merger, no LLM)
#   2. validate            -> the dashboard's own validateGraph()
#   3. graphify update     -> <wiki>/graphify-out/  (notes, headings and links, no LLM),
#                             plus the explain panel in its graph.html
#   4. viewers             -> dashboard on <port> (Learn, Obsidian and Graphify tabs)
#
# Create a new wiki first with:  learn-from-zero/learn.py init <dir> "Topic"
set -euo pipefail

usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

WIKI=""
VIEW=both
PORT=5173
FORCE=()
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage 0 ;;
    --view) shift; VIEW="${1:?--view needs both|ua|graphify|none}" ;;
    --port) shift; PORT="${1:?--port needs a number}" ;;
    --force) FORCE=(--force) ;;
    -*) echo "unknown option: $1" >&2; usage 2 ;;
    *) WIKI="$1" ;;
  esac
  shift
done
[ -n "$WIKI" ] || usage 2
case "$VIEW" in both|ua|graphify|none) ;; *) echo "--view must be both, ua, graphify or none" >&2; exit 2 ;; esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
GRAPHIFY_DIR="$REPO_ROOT/graphify"
UA_DIR="$REPO_ROOT/understand-anything"
PLUGIN_DIR="$UA_DIR/understand-anything-plugin"
WIKI_DIR="$(cd "$WIKI" 2>/dev/null && pwd -P)" || { echo "wiki dir not found: $WIKI" >&2; exit 2; }

for tool in python3 uv node pnpm; do
  command -v "$tool" >/dev/null 2>&1 || { echo "missing required tool: $tool" >&2; exit 2; }
done
step() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

step "1/4 building the knowledge graph from your notes (no LLM)"
python3 "$REPO_ROOT/learn-from-zero/learn.py" build "$WIKI_DIR" ${FORCE[@]+"${FORCE[@]}"}
if [ -d "$WIKI_DIR/.understand-anything" ]; then DATA_DIR="$WIKI_DIR/.understand-anything"; else DATA_DIR="$WIKI_DIR/.ua"; fi

step "2/4 validate with the dashboard's own schema"
[ -d "$UA_DIR/node_modules" ] || (cd "$UA_DIR" && pnpm install --frozen-lockfile)
[ -f "$PLUGIN_DIR/packages/core/dist/schema.js" ] || (cd "$UA_DIR" && pnpm --filter @understand-anything/core build)
node "$REPO_ROOT/bridge/validate_ua_graph.mjs" "$DATA_DIR/knowledge-graph.json"

step "3/4 graphify: mapping the notes"
(cd "$GRAPHIFY_DIR" && uv run --quiet --frozen --project "$GRAPHIFY_DIR" graphify update "$WIKI_DIR")
python3 -I "$REPO_ROOT/bridge/explain_html.py" "$WIKI_DIR" \
  || echo "note: could not add the explain panel to graph.html (the rest still works)"

echo
echo "Outputs:"
echo "  knowledge graph  $DATA_DIR/knowledge-graph.json"
echo "  graphify view    $WIKI_DIR/graphify-out/graph.html"
echo "  what to learn next:  python3 learn-from-zero/learn.py next \"$WIKI\""

[ "$VIEW" = none ] && exit 0
step "4/4 viewers"
exec "$REPO_ROOT/bridge/serve.sh" "$WIKI_DIR" --view "$VIEW" --port "$PORT"
