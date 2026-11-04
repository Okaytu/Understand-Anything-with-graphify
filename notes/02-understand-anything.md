# 02: How Understand-Anything works

Understand-Anything is a Claude Code plugin (it also runs in Codex, Cursor, Copilot, Gemini
CLI and others). It builds a knowledge graph with a **team of AI agents** and presents it in
a **dashboard designed for teaching**. Where graphify asks "what does the code say?",
Understand-Anything asks "what would a new team member need to be told?"

Source: [`understand-anything/understand-anything-plugin/`](../understand-anything/understand-anything-plugin/).
Project conventions are in [`understand-anything/CLAUDE.md`](../understand-anything/CLAUDE.md).

## The three parts

| Part | Folder | Role |
|---|---|---|
| **Skills** | `skills/` | The commands (`/understand`, `/understand-knowledge`, `/understand-domain`, `/understand-diff`, `/understand-dashboard`, …). Each `SKILL.md` is a step-by-step script the AI follows, helped by small deterministic scripts next to it. |
| **Agents** | `agents/` | Specialists the skills dispatch: `project-scanner`, `file-analyzer`, `assemble-reviewer`, `architecture-analyzer`, `tour-builder`, `graph-reviewer`, `article-analyzer`, `domain-analyzer`, `design-analyzer`. |
| **Packages** | `packages/core`, `packages/dashboard`, `packages/viewer` | `core`: graph types, the Zod schema and `validateGraph()`, search, staleness, tree-sitter plugins. `dashboard`: the React app. `viewer`: the dashboard as a standalone npx package. |

## `/understand`: the codebase pipeline

From `skills/understand/SKILL.md`:

| Phase | What happens | Who |
|---|---|---|
| 0 Pre-flight | Decide full vs incremental vs skip, based on what changed since the last commit analysed | script + skill |
| 0.5 Ignore | Generate and confirm ignore rules (full runs only) | `generate-ignore.mjs` |
| 1 Scan | Inventory files, languages, frameworks, import map | `project-scanner` + `scan-project.mjs` |
| 1.5 Batch | Group related files into batches | `compute-batches.mjs` |
| 2 Analyze | Up to 5 batches in parallel: summaries, symbols, relationships | `file-analyzer` |
| 3 Assemble review | Merge batches, recover dropped nodes, fill cross-batch gaps | `merge-batch-graphs.py` + `assemble-reviewer` |
| 4 Architecture | Assign every file to exactly one **layer** (API, Service, Data, UI, …) | `architecture-analyzer` |
| 5 Tour | 5–15 teaching steps in dependency order, with language lessons | `tour-builder` |
| 6 Review | Quality gate: correctness and completeness | `graph-reviewer` |
| 7 Save | Write `.ua/knowledge-graph.json` + `meta.json`, open the dashboard | skill |

Agents write intermediate results to `.ua/intermediate/` on disk instead of returning them
into the conversation, which keeps large projects within context limits. Incremental runs
skip most phases when only a few files changed.

## `/understand-knowledge`: the start-from-zero pipeline

The same idea applied to a **wiki of notes** (the "Karpathy LLM wiki" pattern: `index.md`,
`log.md`, one markdown file per concept, `[[wikilinks]]`, an optional `raw/` folder of sources):

1. `parse-knowledge-base.py`: deterministic. Notes become `article` nodes, `index.md`
   sections become `topic` nodes, wikilinks become `related` edges, and category membership
   becomes `categorized_under` edges.
2. `article-analyzer` agents (LLM, optional): add `entity` and `claim` nodes and implicit
   links (`builds_on`, `contradicts`, `exemplifies`, …).
3. `merge-knowledge-graph.py`: deterministic. Merges, de-duplicates, makes **layers from
   index categories** and a **tour from index order**, and sets `kind: "knowledge"` so the
   dashboard uses a force-directed layout.

`learn-from-zero/learn.py build` runs steps 1 and 3 only. That gives a complete graph with
no LLM, and running `/understand-knowledge` later adds step 2 on top of the same notes.

## The graph format (`packages/core/src/types.ts`)

- **27 node types** in 5 families: code (`file`, `function`, `class`, `module`, `concept`),
  non-code (`config`, `document`, `service`, `table`, `endpoint`, …), domain (`domain`,
  `flow`, `step`), knowledge (`article`, `entity`, `topic`, `claim`, `source`) and design
  (Figma: `page`, `screen`, `component`, …).
- **38 edge types** in 9 categories, e.g. `imports`, `calls`, `contains`, `inherits`,
  `reads_from`, `depends_on`, `cites`, `contradicts`.
- Every node has a `summary`, `tags` and a `complexity`; edges have a `weight` from 0 to 1.
- `validateGraph()` in `packages/core/src/schema.ts` fixes what it safely can (type
  aliases, missing fields), drops what it can't, and reports both. The dashboard runs it on
  load. So does `bridge/validate_ua_graph.mjs`, which is why our converted graphs are
  checked against the real schema rather than a copy.

## The dashboard (`packages/dashboard`)

> **Added in this repo: three pages in one dashboard.** **Learn** (opens first) is a roadmap you
> read step by step; **Obsidian** is the dot map described here; **Graphify** shows graphify's
> own map with a plain-language explain panel. Upstream's classic card view is no longer shown.
> Lives in `components/ObsidianGraphView.tsx` (canvas + d3-force), `components/ObsidianNotePanel.tsx`
> (sidebar note), `components/ObsidianSidebar.tsx` (overview, tour panel) and
> `utils/obsidian-graph.ts` (tested data helpers). It is used in the phone layout too. It draws dots sized by
> connection count, lights up a hovered dot's neighbours, and shows a box of its outgoing links
> and backlinks; clicking pins the box and opens the node as a note. In code graphs, functions,
> classes and constants fold into their file until you switch them on. The choice is saved per
> browser (`localStorage` key `ua.graphStyle`). Upstream Understand-Anything does not have this view.

- **Graph-first:** about 75% of the screen is the graph (React Flow + ELK layout), with a
  360px sidebar.
- **Layers → files → classes → functions:** the overview shows layers as clusters; clicking
  one drills in. File → symbol `contains` edges drive this (the bridge adds them for graphify graphs).
- **Personas (Obsidian page):** Overview / Guided / Deep Dive. Deep Dive adds functions and
  classes; Guided starts the tour.
- **Tour:** the Info tab lists the steps; Start Tour walks them and highlights the nodes.
- **Code viewer:** slides up when you click a file node. It is served by the dev server only
  for files listed in the graph, behind a one-time access token.
- **Freshness banner:** compares the graph's commit with the working tree. That is why
  `graphify-out/` should be git-ignored when you use the bridge.
- **Knowledge view:** graphs with `kind: "knowledge"` get a force-directed layout, and the
  sidebar shows each note's category, wikilinks and backlinks.

## Things to try
- Read `agents/tour-builder.md`: how do you *teach* a codebase, step by step?
- Read `skills/understand-knowledge/parse-knowledge-base.py` and find where `index.md`
  categories become topics.
- Open `packages/dashboard/src/components/GraphView.tsx` and find
  `STRUCTURAL_VISIBLE_TYPES` and the layer drill-down.
