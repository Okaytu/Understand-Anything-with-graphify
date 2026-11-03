# bridge: graphify → Understand-Anything

Map any project with **graphify** (deterministic tree-sitter parsing, no LLM, nothing
leaves your machine), then explore it in **both** projects' own viewers:

| View | What you get | Where |
|---|---|---|
| **graphify** | Force-directed graph coloured by community, node search, community filter, `GRAPH_REPORT.md` (god nodes, surprising connections, suggested questions) | `http://127.0.0.1:5174/graph.html` |
| **Understand-Anything** | Opens as an **Obsidian-style graph**: one dot per file (switch on *Functions & classes* for every symbol), coloured by graphify community; hover for a box of what it imports, calls and is used by; click to open it as a note with Links, Backlinks, what it defines and an *Open code* button. **Classic** in the header switches to the layered dashboard (layers → files → classes → functions). Code viewer, search and the generated tour work in both. | `http://127.0.0.1:5173/?token=…` |

## One command

```bash
bridge/run.sh /path/to/your/project
```

| Option | Effect |
|---|---|
| `--view both` (default) | serve graphify's view on `port+1` **and** the Understand-Anything dashboard on `port` |
| `--view ua` | only the Understand-Anything dashboard |
| `--view graphify` | only graphify's `graph.html` + `GRAPH_REPORT.md` |
| `--view none` | just build + convert + validate, start nothing |
| `--port N` | dashboard port (default 5173; graphify view uses N+1) |
| `--force` | overwrite an existing `knowledge-graph.json` that `/understand` produced |

Steps it runs:

1. `graphify update <project>` → `<project>/graphify-out/` (`graph.json`, `graph.html`, `GRAPH_REPORT.md`)
2. `graphify_to_ua.py` → `<project>/.ua/knowledge-graph.json` (or `.understand-anything/` if that legacy folder exists)
3. `validate_ua_graph.mjs` → checks the result with the dashboard's own `validateGraph()`
4. starts the viewer(s); Ctrl+C stops both

Needs `uv`, Node ≥ 22 and pnpm ≥ 10. The first run installs Understand-Anything's
dependencies and builds its core package.

> **Tip:** add `graphify-out/` to your project's `.gitignore`. Otherwise the dashboard's
> freshness check counts graphify's output files as uncommitted changes and shows a
> banner. `run.sh` prints a hint when it isn't ignored. (`.ua/` is already excluded.)

> **Note:** graphify's `graph.html` loads its graph library (vis-network) from
> unpkg.com, so that view needs an internet connection in the browser.

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

- **Summaries:** built from structure, e.g. "Class GraphBuilder in src/analyzer/graph-builder.ts
  (line 60). Connections: imported by 1; defines 12."
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
```

The converter refuses to overwrite a `knowledge-graph.json` it did not create (for example
one produced by `/understand`) unless you pass `--force` or choose another `--out`.

> Running `uv run --project graphify …` from the **repo root** fails, because the top-level
> `graphify/` folder shadows the installed package on Python's path. Run graphify commands
> from inside `graphify/` (as `run.sh` does) or from your project's folder.

## Explaining every file and connection (`enrich.py`)

graphify finds *that* two files connect. `enrich.py` lets your coding agent write *why*:

```bash
python3 bridge/enrich.py status <project> [--list] [--check]   # explained / missing / outdated
python3 bridge/enrich.py export <project> [--batch-size 20]    # task batches → <project>/.ua/enrich/
python3 bridge/enrich.py apply  <project>                      # merge answers, rebuild, validate
```

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

The unit tests cover type mapping, edge direction, confidence, layers, the tour and the
CLI's overwrite protection. One end-to-end test runs real graphify on a tiny project and
validates the result with `validate_ua_graph.mjs`. It is skipped when node or the built
core package is missing.
