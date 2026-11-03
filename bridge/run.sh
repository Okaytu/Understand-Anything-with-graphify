#!/usr/bin/env bash
# One command: map a project with graphify (no LLM), then explore it in both
# projects' own viewers.
#
#   bridge/run.sh <project-dir | repo-url> [--view both|ua|graphify|none] [--force] [--port N] [--branch B]
#
#   Someone else's repository works too: owner/repo, https://github.com/owner/repo,
#   a .../tree/<branch>/<subfolder> link, or any git URL. It is cloned (latest version
#   only) to ~/understand-repos/ (or $UA_REPOS_DIR), and its code is only read, never run.
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
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

PROJECT=""
VIEW=both
FORCE=()
PORT=5173
BRANCH=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage 0 ;;
    --view) shift; VIEW="${1:?--view needs both|ua|graphify|none}" ;;
    --no-dashboard) VIEW=none ;;
    --force) FORCE=(--force) ;;
    --port) shift; PORT="${1:?--port needs a number}" ;;
    --branch) shift; BRANCH="${1:?--branch needs a name}" ;;
    -*) echo "unknown option: $1" >&2; usage 2 ;;
    *) [ -z "$PROJECT" ] || { echo "only one project dir, got: $PROJECT and $1" >&2; exit 2; }
       PROJECT="$1" ;;
  esac
  shift
done
[ -n "$PROJECT" ] || usage 2
case "$VIEW" in both|ua|graphify|none) ;; *) echo "--view must be both, ua, graphify or none" >&2; exit 2 ;; esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
GRAPHIFY_DIR="$REPO_ROOT/graphify"
UA_DIR="$REPO_ROOT/understand-anything"
PLUGIN_DIR="$UA_DIR/understand-anything-plugin"

# --- someone else's repository: clone it first -------------------------------
is_remote() {
  case "$1" in http://*|https://*|ssh://*|git@*|file://*) return 0 ;; esac
  # owner/repo shorthand for GitHub, unless a local folder with that name exists
  [[ ! -e "$1" && "$1" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]
}
if is_remote "$PROJECT"; then
  command -v git >/dev/null 2>&1 || { echo "missing required tool: git" >&2; exit 2; }
  URL="$PROJECT"
  SUBDIR=""
  [[ "$URL" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] && URL="https://github.com/$URL"
  # web links like https://github.com/owner/repo/tree/<branch>/<sub/folder>
  if [[ "$URL" =~ ^(https?://[^/]+/[^/]+/[^/]+)/tree/([^/]+)(/(.*))?$ ]]; then
    URL="${BASH_REMATCH[1]}"
    BRANCH="${BRANCH:-${BASH_REMATCH[2]}}"
    SUBDIR="${BASH_REMATCH[4]%/}"
  fi
  URL="${URL%/}"
  case "$URL" in http://*|https://*|git@*|ssh://*) URL="${URL%.git}" ;; esac
  REST="${URL#*://}"; REST="${REST#git@}"; REST="${REST/://}"; REST="${REST#/}"
  case "$REST" in *..*) echo "refusing suspicious repository path: $PROJECT" >&2; exit 2 ;; esac
  REPOS_DIR="${UA_REPOS_DIR:-$HOME/understand-repos}"
  DEST="$REPOS_DIR/$REST"
  if [ -d "$DEST/.git" ]; then
    printf '\n\033[1;33m==> updating your copy of %s\033[0m\n' "$URL"
    git -C "$DEST" pull --ff-only --quiet || echo "warning: could not update $DEST; using the copy you already have"
  else
    printf '\n\033[1;33m==> downloading %s (latest version only)\033[0m\n' "$URL"
    mkdir -p "$(dirname "$DEST")"
    git clone --quiet --depth 1 ${BRANCH:+--branch "$BRANCH"} "$URL" "$DEST" || {
      echo "could not download $URL. Check the link; private repositories need you to be logged in to git." >&2
      exit 2
    }
  fi
  # keep generated files out of that copy's git status (local only, never committed)
  for pattern in graphify-out/ .ua/; do
    grep -qxF "$pattern" "$DEST/.git/info/exclude" 2>/dev/null || echo "$pattern" >> "$DEST/.git/info/exclude"
  done
  PROJECT="$DEST${SUBDIR:+/$SUBDIR}"
  [ -d "$PROJECT" ] || { echo "folder '$SUBDIR' not found in $URL" >&2; exit 2; }
  echo "Your copy is at: $PROJECT"
  echo "(use this path for bridge/enrich.py and bridge/serve.sh)"
fi

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

step "4/4 viewers"
exec "$REPO_ROOT/bridge/serve.sh" "$PROJECT_DIR" --view "$VIEW" --port "$PORT"
