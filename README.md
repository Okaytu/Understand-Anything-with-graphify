# Understand Anything with graphify

A personal learning repository that combines two open-source "turn a codebase into a
knowledge graph" projects side by side, with their **full commit history preserved**:

| Folder | Project | Language / toolchain | License | Imported from |
|---|---|---|---|---|
| [`understand-anything/`](understand-anything/) | **Understand Anything**: multi-agent LLM analysis + interactive React dashboard (tours, domain view, diff impact, personas) | TypeScript · pnpm monorepo · Node ≥ 22 | MIT ([LICENSE](understand-anything/LICENSE)) | `Okaytu/Understand-Anything` @ `main` |
| [`graphify/`](graphify/) | **graphify**: deterministic tree-sitter extraction (~40 languages, no LLM) + CLI queries (`query` / `path` / `explain`), `GRAPH_REPORT.md`, many exporters | Python ≥ 3.10 · uv | Apache-2.0 ([LICENSE](graphify/LICENSE), [NOTICE](graphify/NOTICE)) | `Okaytu/graphify` @ `v8` |

Each folder is the complete, unmodified project and builds and runs exactly as it does
upstream. Each keeps its own license; nothing here relicenses either project. The new
[`bridge/`](bridge/) folder connects them.

## The bridge: map with graphify, explore in both viewers

```bash
bridge/run.sh /path/to/any/project
```

1. **graphify** maps the project with tree-sitter (no LLM, free, local).
2. The bridge converts graphify's graph into an Understand-Anything knowledge graph and
   checks it with the dashboard's own validator.
3. Both views open side by side:
   - **graphify view:** `http://127.0.0.1:5174/graph.html`, a force-directed graph coloured
     by community, plus `GRAPH_REPORT.md`.
   - **Understand-Anything dashboard:** `http://127.0.0.1:5173/?token=…`, graphify's
     communities as layers, file → class → function drill-down, code viewer, search and a
     generated guided tour.

Use `--view ua`, `--view graphify` or `--view none` to pick one or neither. See
[`bridge/README.md`](bridge/README.md) for the full mapping, options and tests.

## Layout

```
learn-code/
├── understand-anything/   ← full Understand-Anything project (git subtree)
├── graphify/              ← full graphify project (git subtree)
├── bridge/                ← graphify → Understand-Anything converter + one-command runner
├── .github/workflows/     ← one CI workflow that tests both projects
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
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs both test suites and the
bridge tests instead.
