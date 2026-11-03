# Understand Anything with graphify

A personal learning repository that combines two open-source "turn a codebase into a
knowledge graph" projects side by side, with their **full commit history preserved**:

| Folder | Project | Language / toolchain | License | Imported from |
|---|---|---|---|---|
| [`understand-anything/`](understand-anything/) | **Understand Anything**: multi-agent LLM analysis + interactive React dashboard (tours, domain view, diff impact, personas) | TypeScript · pnpm monorepo · Node ≥ 22 | MIT ([LICENSE](understand-anything/LICENSE)) | `Okaytu/Understand-Anything` @ `main` |
| [`graphify/`](graphify/) | **graphify**: deterministic tree-sitter extraction (~40 languages, no LLM) + CLI queries (`query` / `path` / `explain`), `GRAPH_REPORT.md`, many exporters | Python ≥ 3.10 · uv | Apache-2.0 ([LICENSE](graphify/LICENSE), [NOTICE](graphify/NOTICE)) | `Okaytu/graphify` @ `v8` |

Each folder is the complete, unmodified project and builds and runs exactly as it does
upstream. Each keeps its own license; nothing here relicenses either project.

## Two ways to learn

| | **1. Learn from what you have** | **2. Start from zero** |
|---|---|---|
| You begin with | an existing codebase | only a question, e.g. "how does a business work?" |
| The graph comes from | the code, parsed by graphify (no LLM) | the linked notes you write as you learn |
| It grows when | the code changes | you add a note |
| What to learn next | the generated tour: core abstractions, then subsystems | `learn.py next`: ideas you linked but haven't written yet |
| One command | `bridge/run.sh <project>` | `learn-from-zero/learn.sh <wiki>` |
| Try it on | any project (e.g. `graphify/`) | [`learn-from-zero/examples/how-a-business-works`](learn-from-zero/examples/how-a-business-works) |

Both open the **same two viewers** side by side:
- **Understand-Anything dashboard:** `http://127.0.0.1:5173/?token=…`. It opens in an
  **Obsidian-style graph**: dots sized by connections, hover a dot to light up its neighbours
  and get a box of where it connects, click it to read it as a note with Links and
  Backlinks. **Classic** (in the header) switches back to the original layers, drill-down
  and cards. The tour and search work in both.
- **graphify view:** `http://127.0.0.1:5174/graph.html` (force-directed graph coloured by
  community, plus `GRAPH_REPORT.md`)

Use `--view ua`, `--view graphify` or `--view none` to pick one or neither.

**Start with [`notes/README.md`](notes/README.md):** the study guide for both paths, a
reading order, exercises, and a head-to-head comparison of the two tools on the same commit.

### 1. Learn from what you have: [`bridge/`](bridge/)

```bash
bridge/run.sh /path/to/any/project
```

graphify maps the project with tree-sitter (free, local), the bridge converts the result
into an Understand-Anything knowledge graph and checks it with the dashboard's own
validator, and both viewers open. `bridge/compare_graphs.py` compares that graph with one
from `/understand`. See [`bridge/README.md`](bridge/README.md).

### 2. Start from zero: [`learn-from-zero/`](learn-from-zero/)

```bash
python3 learn-from-zero/learn.py init ~/learning/my-topic "My topic"
python3 learn-from-zero/learn.py new ~/learning/my-topic "First Idea" --category Foundations --link "Next Idea"
learn-from-zero/learn.sh ~/learning/my-topic
```

Notes become a knowledge graph through Understand-Anything's own wiki parser (no LLM), and
graphify maps them for the second view. See [`learn-from-zero/README.md`](learn-from-zero/README.md).

## Layout

```
learn-code/
├── understand-anything/   ← full Understand-Anything project (git subtree)
├── graphify/              ← full graphify project (git subtree)
├── bridge/                ← path 1: graphify → Understand-Anything converter, runner, viewer server, comparison
├── learn-from-zero/       ← path 2: notes-wiki template, worked business example, learn.py / learn.sh
├── notes/                 ← study guide, architecture notes, generated comparison report
├── .github/workflows/     ← one CI workflow: both projects + bridge + learn-from-zero tests
├── .gitignore             ← shared ignores (node_modules, .venv, .ua/, graphify-out/, …)
└── README.md
```

## Running each project

### Understand Anything

```bash
cd understand-anything
pnpm install
pnpm --filter @understand-anything/core build
pnpm --filter @understand-anything/skill build
pnpm test
pnpm dev:dashboard      # start the dashboard dev server
```

See [`understand-anything/README.md`](understand-anything/README.md) and
[`understand-anything/CLAUDE.md`](understand-anything/CLAUDE.md) for details.

### graphify

```bash
cd graphify
uv sync --all-extras
uv run pytest tests/ -q
uv run graphify --help
uv run graphify update .   # map a folder (code is parsed locally, no LLM)
```

See [`graphify/README.md`](graphify/README.md) and
[`graphify/ARCHITECTURE.md`](graphify/ARCHITECTURE.md) for details.

## Exploring the history

Both projects were imported with `git subtree add`, so every original commit is here.

- `git blame <file>` follows lines back into the original project history, e.g.
  `git blame graphify/graphify/build.py`.
- A path-limited `git log -- graphify/<path>` stops at the import commit, because the
  files lived at the repository root before. To see a file's full history, log the
  upstream branch with the path relative to that project:

  ```bash
  git log graphify-upstream/v8 -- graphify/build.py
  git log ua-upstream/main -- README.md
  ```

  (After a fresh clone, first run the `git remote add` + `git fetch` commands below.)

## Pulling upstream updates

```bash
git remote add ua-upstream https://github.com/Okaytu/Understand-Anything
git remote add graphify-upstream https://github.com/Okaytu/graphify
git fetch ua-upstream main
git fetch graphify-upstream v8

git subtree pull --prefix=understand-anything ua-upstream main
git subtree pull --prefix=graphify graphify-upstream v8
```

## Notes on CI

Each project's own `.github/workflows/` folder is kept for reference, but GitHub only
runs workflows from the repository root, so they are inactive here. The root
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs both test suites, plus the
`bridge/` and `learn-from-zero/` tests, instead.
