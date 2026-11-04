# bridge: graphify → Understand-Anything

Map any project with **graphify** (deterministic tree-sitter parsing, no LLM, nothing
leaves your machine), then explore it in one dashboard at `http://127.0.0.1:5173/?token=…`
with three tabs:

| Tab | What you get |
|---|---|
| **Learn** (opens first) | The project as a roadmap: the generated tour (or one chapter per group when there is none), read step by step with Back / Next or the arrow keys. Each step explains its files: summary, how hard it is to read, what's inside, how it connects, language notes, *Open code*, *Show on map* and a *Copy AI prompt for this step* button. It remembers where you stopped. |
| **Obsidian** | One dot per file (*Deep Dive* or *Functions & classes* adds every symbol), coloured by group; hover for what it imports, calls and is used by; click to open it as a note with Links, Backlinks, what it defines and *Open code*. |
| **Graphify** | graphify's own `graph.html`, with the explain panel `explain_html.py` adds: click a dot for a plain-language explanation, what's inside the file, what uses it and what it relies on (with the reason for each link), **Show impact** (everything that depends on it, with a count) and a ready-to-copy AI prompt (optionally with the code). Plus **Whole project**, **Health check** (risky hubs, circular dependencies, files nothing uses) and an **Ask** box. Served by the dashboard behind its token, because the page embeds source code for its prompts. |

**Path** in the header answers "how are two parts connected?": type two names and it shows
the chain of links between them, with the reason for each link.

## One command

```bash
bridge/run.sh /path/to/your/project
```

Someone else's repository works the same way. Pass a link instead of a folder:
`owner/repo` (GitHub), `https://github.com/owner/repo`, a `…/tree/<branch>/<folder>` link
for one part of a monorepo, or any git URL (`--branch` picks a branch). It is shallow-cloned
to `~/understand-repos/<host>/<owner>/<repo>` (set `UA_REPOS_DIR` to change that), or
updated if it's already there. `graphify-out/` and `.ua/` are added to that clone's
`.git/info/exclude`. The code is only parsed, never executed.

| Option | Effect |
|---|---|
| `--view both` (default) | the dashboard on `port`, with its Learn, Obsidian and Graphify tabs |
| `--view ua` | the same as `both` |
| `--view graphify` | opens only graphify's `graph.html` straight from disk in your browser, without the dashboard; no server runs |
| `--view none` | just build + convert + validate, start nothing |
| `--port N` | dashboard port (default 5173) |
| `--force` | overwrite an existing `knowledge-graph.json` that `/understand` produced |
| `--branch B` | branch to download, when you pass a repository link |

Steps it runs:

1. `graphify update <project>` → `<project>/graphify-out/` (`graph.json`, `graph.html`, `GRAPH_REPORT.md`)
2. `graphify_to_ua.py` → `<project>/.ua/knowledge-graph.json` (or `.understand-anything/` if that legacy folder exists)
3. `validate_ua_graph.mjs` → checks the result with the dashboard's own `validateGraph()`,
   then `explain_html.py` adds the explain panel to `graph.html`
4. starts the dashboard; Ctrl+C stops it

After code changes, `bridge/refresh.sh <project>` re-maps it (keeping every explanation
already written), rebuilds the explain panel and lists the files that are new or changed,
so your agent only has to explain those (`enrich.py`, below).

Needs `uv`, Node ≥ 22 and pnpm ≥ 10. The first run installs Understand-Anything's
dependencies and builds its core package.

> **Tip:** add `graphify-out/` to your project's `.gitignore`. Otherwise the dashboard's
> freshness check counts graphify's output files as uncommitted changes and shows a
> banner. `run.sh` prints a hint when it isn't ignored. (`.ua/` is already excluded.)

> **Note:** graphify's `graph.html` loads its graph library (vis-network) from
> unpkg.com, so the Graphify tab needs an internet connection in the browser.

## How graphify's graph is mapped

| graphify | Understand-Anything |
|---|---|
| file node (`label` = file name or path) | `file` (`config` for .json/.yaml/…, `document` for .md/…) |
| `_callable_class` | `class` |
| `_callable` | `function` |
| PascalCase non-callable symbol (interface, type, enum) | `class` |
| other symbols (constants) / `concept` | `concept` |
| `rationale` (NOTE / WHY / TODO comments) | `concept`, plus a "Notes the developers left behind" tour step |
| external package (`ref_*`, `type: module`) | `module` |
| image / video / audio | `resource`; document / paper → `document` |
| community (Leiden cluster) | **layer** (communities with < 2 top-level nodes go to "Other") |
| `calls` · `contains` / `method` · `imports` / `imports_from` / `dynamic_import` · `re_exports` · `inherits` / `mixes_in` · `implements` · `references` / `uses` · `rationale_for` | `calls` · `contains` · `imports` · `exports` · `inherits` · `implements` · `depends_on` · `documents` |
| any other relation | `related` (reported by the converter) |
| `confidence` EXTRACTED / INFERRED / AMBIGUOUS | edge `weight` (`confidence_score`, else 1.0 / 0.6 / 0.3), edge `description`, and `confidence:*` node tags |
| `_src` / `_tgt` direction markers | honoured (they win over arc order) |

Also generated, since graphify has no LLM summaries for code:

- **Summaries:** built from structure in plain words until an agent explains it, e.g.
  "GraphBuilder is a class (a blueprint for making objects) in src/analyzer/graph-builder.ts,
  line 60. It contains 12 smaller pieces and is used by 1 other file."
- **Complexity:** from node degree.
- **`contains` edges:** file → symbol, so the dashboard can drill from a file into its
  classes and functions.
- **Tour:** core abstractions first (the most-connected symbols), then up to 8 subsystems
  in foundations-first order (most depended-on first), then developer notes.

## Using the pieces directly

```bash
# convert an existing graphify run (run from inside graphify/, or use any Python 3.10+)
python3 bridge/graphify_to_ua.py <project> [--graph graph.json] [--out out.json] [--name "My project"] [--force]

# validate any knowledge-graph.json with the dashboard's own validator
node bridge/validate_ua_graph.mjs <project>/.ua/knowledge-graph.json

# (re)build the explain panel inside <project>/graphify-out/graph.html; safe to run again
python3 bridge/explain_html.py <project>
```

The converter refuses to overwrite a `knowledge-graph.json` it did not create (for example
one produced by `/understand`) unless you pass `--force` or choose another `--out`.

> Running `uv run --project graphify …` from the **repo root** fails, because the top-level
> `graphify/` folder shadows the installed package on Python's path. Run graphify commands
> from inside `graphify/` (as `run.sh` does) or from your project's folder.

## Explaining every file and connection (`enrich.py`)

graphify finds *that* two files connect. `enrich.py` lets your coding agent write *why*:

```bash
python3 bridge/enrich.py estimate <project> [scope flags]      # files to explain, tokens, cost per model
python3 bridge/enrich.py status   <project> [--list] [--check] # explained / missing / outdated / skipped
python3 bridge/enrich.py export   <project> [scope flags]      # task batches → <project>/.ua/enrich/
python3 bridge/enrich.py apply    <project>                    # merge answers, rebuild, validate
```

**Built to use few tokens:**

- **Digests, not whole files.** Each batch carries a short digest of every file: its opening
  comment, imports, and each definition's doc comment and signature, public definitions first
  (about 2,400 characters at most). Small files are included whole. The agent opens the real
  file only when the digest isn't enough.
- **Scope.** Tests, docs (except the README) and generated or vendored files (`dist/`,
  `build/`, `node_modules/`, `*.min.js`, lock files…) are skipped by default and counted as
  *skipped* in `status`. Scope flags: `--only src lib`, `--include-tests`, `--include-docs`,
  `--include-generated`, `--explain-modules` (also explain links to external packages),
  `--everything`, `--batch-size N`. The scope is remembered in `enrichments.json`.
- **Short answers.** Files get 2–3 sentences, connections and symbols one sentence each.
- **Batches sized by tokens** (about 9,000 each), so each one fits a small subagent. The
  setup prompts ask Claude Code to hand every batch to its own subagent on a cheaper model
  (Sonnet or Haiku) instead of reading them all in the main conversation.
- **`estimate`** shows the reading tokens (digests vs whole files), writing tokens and a cost
  for each Claude model before anything is spent. Measured: Understand-Anything's
  `packages/core/src` needs about 77k reading tokens instead of 144k; graphify's own repo
  about 143k instead of 1.56M.

- **export** writes `batch-NNN.json`. Each lists files, with every outgoing connection
  (lifted to file → file, or file → external module, with "via" details such as
  `loadGraph() calls validateGraph()`) and the most-used symbols. Each batch names the
  `answer_file` the agent must write. `project.json` asks for an overview, a meaningful name
  for every group (layer) and a written tour.
- **apply** accepts only keys that were in the batches, trims overlong text, stores everything
  in `<project>/.ua/enrichments.json` (keyed by file path, with a hash of each file's
  contents), writes it into the knowledge graph, and validates the result:
  - file summaries become node summaries (tagged `explained`);
  - each connection's "why" becomes the description of every edge between the two files;
  - group names and the tour replace the generated ones.
- **Rebuilds keep it:** `bridge/run.sh` re-applies `enrichments.json` after every graphify run.
  Files whose contents changed are tagged `explanation-outdated`, and `status`/`export` ask
  only for new or changed files and connections.
- **In the dashboard,** a file's connections are grouped by the other file, each with its
  explanation and what it goes through ("via validateGraph()").

The one setup prompt in the main README runs this loop for you.

## Comparing with an `/understand` graph

```bash
python3 bridge/compare_graphs.py <understand-graph.json> <bridge-graph.json> \
        --project <source-dir> [--labels understand graphify] [--out report.md] [--json report.json]
bridge/compare_demo.sh        # regenerates notes/comparison-report.md (same commit, both tools)
```

Inside the files both graphs cover, it compares:
- files and symbols, reporting symbols found under another kind;
- file dependencies (imports and re-exports together), each checked against the real
  import/export lines, including workspace-package imports such as `@scope/core`;
- calls, at symbol level (crediting class-level vs method-level differences) and file level;
- whether each graph's line numbers point at the right line in the source;
- layers, tour, summary length and language lessons.

Findings and how to read them: [`notes/03-side-by-side.md`](../notes/03-side-by-side.md).

## Viewers only

`bridge/serve.sh <dir> [--view both|ua|graphify] [--port N]` serves an already-built
`.ua/knowledge-graph.json` and `graphify-out/` without rebuilding. `run.sh` and
`learn-from-zero/learn.sh` both end by calling it.

## Tests

```bash
cd graphify && uv run pytest ../bridge/tests ../learn-from-zero/tests -q
```

The unit tests cover type mapping, edge direction, confidence, layers, the tour, the
CLI's overwrite protection and the explain panel: it is added once; it only embeds code
from files inside the project; it skips files with secret-looking names (.env, key files,
names containing "secret" or "credential") and any file whose text holds a
credential-shaped string (graphify's own patterns); and source code can't break out of its
script tag. Other files' code is embedded, so keep `graph.html` on your own machine.
One end-to-end test runs real graphify on a tiny project and
validates the result with `validate_ua_graph.mjs`. It is skipped when node or the built
core package is missing.
