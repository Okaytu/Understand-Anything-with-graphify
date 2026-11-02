# 03: graphify and Understand-Anything, side by side

## In one sentence each
- **graphify** reads the code with a parser. It is complete, exact and free, but it explains
  nothing.
- **Understand-Anything** has AI agents read the code. It is selective and explains a lot,
  costs model calls, and can only be as complete as the agents' attention.

## Head to head on the same commit

`bridge/compare_demo.sh` takes the graph `/understand` built for Understand-Anything itself
(commit `58cfb20`, committed as the dashboard's sample graph), runs graphify and the bridge
on **exactly the same source**, and compares the two. Full output:
[comparison-report.md](comparison-report.md).

| | `/understand` (AI agents) | graphify (parser) |
|---|---:|---:|
| Code files in the graph | 34 (it chose the important ones) | 54 (all, including tests) |
| Functions + classes | 63 | 153 |
| Of `/understand`'s 63 symbols, also found by the other | — | 62, and the 63rd is there too, as a different kind |
| Symbol line numbers correct (of 62 shared) | 62 | 62 |
| File dependencies in shared files | 45 | 68 (all 45 of `/understand`'s, plus 23 more) |
| Extra dependencies confirmed in the source | — | 23 of 23 |
| Calls in shared files, file to file | 6 | 24 (all 6 of `/understand`'s, plus 18 more) |
| Layers | 7, named by meaning ("Analysis Engine Layer") | 9, named after a central node ("types.ts", "App.tsx") |
| Tour | 12 steps written as lessons, 8 with a language lesson | 9 generated steps: core abstractions, then subsystems |
| Summaries | written prose ("Implements fuzzy search over graph nodes using Fuse.js…") | built from structure ("imported by 59; defines 25") |
| Cost | model calls for every batch, plus review passes | none, runs locally in seconds |

What the comparison shows:

1. **On structure, graphify is the superset.** Everything structural that `/understand`
   found, graphify found too. graphify also found 23 file dependencies `/understand` left
   out, and a source check confirmed all 23 are real imports. Examples: `App.tsx` imports 8
   dashboard components, and the `skill` package imports `@understand-anything/core`.
2. **Apparent misses were mostly differences in labels.**
   - `export … from` barrels are *re-exports* to graphify and *imports* to `/understand`.
     Counting both as dependencies takes agreement from 0.38 to 0.66, and leaves zero
     dependencies that only `/understand` has.
   - 6 calls `/understand` lists from a class (`TreeSitterPlugin → extractParams`) appear in
     graphify as the same call from that class's method.
   - The other 5 involve `useDashboardStore`. It is a `const` holding a React hook, not a
     `function`, so the bridge files it as a `concept`.
3. **Both got line numbers right.** All 62 shared symbols have correct start lines in both
   graphs, checked against the real source files.
4. **On meaning, `/understand` wins clearly.** Its layers describe the architecture as a
   person would, its tour teaches ("Start with App.tsx, the root React component that…"),
   and 8 of its 12 tour steps include a language lesson. graphify's layers are statistical
   clusters, and its tour comes from graph shape alone.
5. **They choose differently.** `/understand` picked 34 of 54 files and left out tests.
   That is a teaching choice, not an error. graphify keeps everything, so you see that tests
   form their own community.

## When to use which

| Situation | Use |
|---|---|
| First look at a large unknown codebase, no budget, or code you can't send to an LLM | graphify + bridge (`bridge/run.sh`) |
| "What depends on X?", "how do A and B connect?", impact of a change | graphify (`graphify path`, `explain`, `query`); its graph is the complete one |
| Onboarding a person: why it is built this way, what to read first | `/understand` (tour, layers by meaning, prose summaries) |
| Checking an AI-built graph for gaps | both + `bridge/compare_graphs.py` |
| Learning a topic from zero (no code) | `learn-from-zero/` (Understand-Anything's wiki parser, plus graphify for the second view); add `/understand-knowledge` for AI-inferred links |

## The combined workflow

1. `bridge/run.sh <project>`: the complete, exact map in minutes, at no cost.
2. Read `GRAPH_REPORT.md` and walk the generated tour to get the shape.
3. Run `/understand` for the explanations, then `bridge/compare_graphs.py` to see what the
   AI skipped and decide whether those parts matter to you.
4. Write what you learned into a `learn-from-zero` wiki. The code graph shows what exists;
   your notes graph shows what you understand.

## Caveats about this comparison
- It covers one project (TypeScript, about 54 files) at one commit. Treat the numbers as an
  illustration, not a benchmark.
- The `/understand` graph is the project's committed sample and may have been tidied by
  hand. A fresh `/understand` run could differ.
- Matching is by file path and bare name, so symbols that are renamed or nested inside
  other symbols may not match.
- The import check is a heuristic: it looks for an import or export line naming the target
  file or its workspace package.
