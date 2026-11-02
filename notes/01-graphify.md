# 01: How graphify works

graphify turns a folder (code, docs, PDFs, images, video) into a **knowledge graph you query
instead of grepping**. Its key design choice is that **code is parsed, not read by an LLM**:
tree-sitter builds a syntax tree, and graphify walks it. That makes the code graph free,
local and the same on every run. Only docs and media get an optional LLM "semantic pass".

Source: [`graphify/`](../graphify/). Start with [`ARCHITECTURE.md`](../graphify/ARCHITECTURE.md).
A test, `tests/test_architecture_doc.py`, imports every function it names, so the document
cannot drift from the code.

## The pipeline

```
detect()  →  extract()  →  build()  →  cluster()  →  analyze  →  report.generate()  →  export.to_*()
 what's       tree-sitter   NetworkX     Leiden        god nodes,    GRAPH_REPORT.md       graph.json,
 there?       → nodes+edges  graph       communities   surprises     (the highlights)      graph.html, …
```

Each stage is a plain function in its own module, passing plain dicts and NetworkX graphs.

| Stage | File | What to look at |
|---|---|---|
| detect | `graphify/detect.py` | Groups files by category (code / document / paper / image / video) and counts words. It sizes media files without decoding them. |
| extract | `graphify/extract.py` (~11k lines) + `graphify/extractors/*.py` | One extractor per language (the newer ones live in `extractors/`: `go.py`, `rust.py`, `sql.py`, `markdown.py`, …). Each parses with tree-sitter, walks the tree, emits `nodes` and `edges`, then runs a **second pass over calls** that adds `INFERRED` call edges. |
| build | `graphify/build.py` | Assembles extractions into one graph and de-duplicates nodes in three layers. Read the comment at the top of the file. |
| cluster | `graphify/cluster.py` | **Leiden** community detection (via graspologic), falling back to Louvain. It splits oversized communities and returns cohesion scores. |
| analyze | `graphify/analyze.py` | `god_nodes()` (most connected), `surprising_connections()` (links across files, languages or top-level folders), `suggest_questions()`, `find_import_cycles()`, `graph_diff()`. |
| report | `graphify/report.py` | Writes `GRAPH_REPORT.md`, the human summary. |
| export | `graphify/export.py`, `wiki.py`, `callflow_html.py` | `graph.json`, `graph.html` (vis-network), Obsidian vault, SVG, GraphML, Neo4j Cypher, a per-community wiki. |
| serve | `graphify/serve.py` | Serves `graph.json` to AI assistants over MCP (stdio or HTTP). |
| cache / watch | `graphify/cache.py`, `graphify/watch.py` | Only re-extracts changed files. `graphify watch` rebuilds on save; `graphify hook install` rebuilds on commit. |

## Three ideas worth understanding deeply

### 1. Confidence labels
Every edge says how it was found:

| Label | Meaning | Example |
|---|---|---|
| `EXTRACTED` | written explicitly in the source | an `import` line, a direct call |
| `INFERRED` | deduced by graphify | the call-graph second pass resolved which `foo()` a call means |
| `AMBIGUOUS` | uncertain, flagged for a human in the report | several candidates matched |

On Understand-Anything's own source, 99% of edges were `EXTRACTED`. The graph is mostly
facts read from the code, not guesses. The bridge keeps this as edge weight, edge
description and `confidence:*` tags in the dashboard.

### 2. Communities instead of hand-drawn layers
graphify does not know your architecture. It finds groups of nodes that are densely linked
to each other (Leiden) and names each group after its most connected member. These groups
are often real subsystems, but not always: in our sample one community was named after the
test library `vitest`, because the tests all link to it. When a community name looks odd,
that is a hint about the code's structure (here: tests cluster together).

### 3. Direction in an "undirected" file
`graph.json` is written with `"directed": false`, but every link *is* directed: the order
of `source` and `target` is the direction. Older files carry `_src` / `_tgt` markers
instead. Loading the file with plain NetworkX loses the direction, so use
`paths.load_node_link_graph()`. The bridge honours both forms.

## Things to try

```bash
cd graphify
uv run graphify update ../understand-anything/understand-anything-plugin/packages/core/src
uv run graphify explain "GraphBuilder" --graph ../understand-anything/understand-anything-plugin/packages/core/src/graphify-out/graph.json
uv run graphify path "GraphBuilder" "GraphNode" --graph ../understand-anything/understand-anything-plugin/packages/core/src/graphify-out/graph.json
```

(Run graphify commands from inside `graphify/` or from the target project, not from the
repo root, where the `graphify/` folder hides the installed package.)

- Read `GRAPH_REPORT.md`: god nodes, surprising connections, suggested questions.
- Open `graph.html`, untick every community except one, and see which files it holds.
- Read one extractor end to end, e.g. `graphify/extractors/go.py`, and find where it emits
  `contains`, `calls` and `imports` edges.

## Where graphify stops
- It doesn't explain *why* code exists. It has no LLM summaries for code, only structure.
  `# NOTE:` / `# WHY:` comments become `rationale` nodes, which helps.
- Communities are statistical, not architectural, so they don't always match how the
  authors think about the system.
- Docs, PDFs and media need an LLM backend for real content extraction. Without one,
  markdown still maps to files, headings and links.
