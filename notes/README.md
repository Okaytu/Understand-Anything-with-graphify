# Study notes: start here

This repository supports **two ways of learning**, and every tool in it serves one or both:

| | **Path 1: learn from what you have** | **Path 2: start from zero** |
|---|---|---|
| You begin with | an existing project: code someone wrote | nothing but a question ("how does a business work?") |
| The graph comes from | parsing the code (graphify, no LLM) or AI analysis (`/understand`) | the notes you write while learning, one concept per note, linked with `[[...]]` |
| It grows when | the code changes; re-run | you add a note; re-run |
| "What next?" comes from | the guided tour: core abstractions first, then subsystems, foundations first | `learn.py next`: concepts you linked but have not written yet |
| One command | `bridge/run.sh <project>` | `learn-from-zero/learn.sh <wiki>` |
| Example in this repo | Understand-Anything's own source | [`learn-from-zero/examples/how-a-business-works`](../learn-from-zero/examples/how-a-business-works) |

Both paths end in the **same two viewers**: the Understand-Anything dashboard (layers,
tour, details panel) and graphify's `graph.html` (force-directed graph, communities).
The paths also feed each other. When you learn a codebase (path 1), you will meet ideas
you don't know yet; write them down as notes (path 2). When your notes (path 2) reach a
real system, open its code with path 1.

## Path 1: learn an existing codebase

```bash
bridge/run.sh /path/to/project          # graphify -> convert -> validate -> both viewers
```

1. **Map:** open graphify's `GRAPH_REPORT.md` first. The god nodes are the 5–10 things
   everything flows through, and the communities are the subsystems.
2. **Walk the tour** in the dashboard (Info tab → Start Tour). It starts with the core
   abstractions, then visits subsystems in foundations-first order.
3. **Drill in:** click a layer, then a file, then a class. Read the code in the code viewer.
4. **Ask questions** with graphify from inside the project:
   `graphify explain "X"`, `graphify path "A" "B"`, `graphify query "how does auth work"`.
5. **Write down what you learned** as notes (path 2). That turns reading into memory.
6. With Claude Code, run `/understand` on the same project for AI-written summaries and a
   teaching tour. Then compare the two graphs, which is what
   [comparison-report.md](comparison-report.md) does.

## Path 2: start from zero

```bash
python3 learn-from-zero/learn.py init ~/learning/restaurants "How restaurants work"
python3 learn-from-zero/learn.py new ~/learning/restaurants "Food Cost" --category Money \
        --summary "what the ingredients of a dish cost" --link "Menu Pricing" --link "Suppliers"
python3 learn-from-zero/learn.py next ~/learning/restaurants     # what to learn next
learn-from-zero/learn.sh ~/learning/restaurants                  # build + both viewers
```

1. **Ask one question** in `wiki/Start Here.md`.
2. **Pick one concrete example** and keep using it. The business example uses one café,
   "Corner Coffee", so every idea has a number attached.
3. **One concept per note.** Define it in plain words, give the example, and link every
   related idea with `[[...]]`, even ideas you haven't written yet.
4. **Rebuild the graph** every few notes. Clusters show you which areas you understand;
   `next` shows the gaps, most-linked first.
5. **Categories become layers** and the order of `## Category` sections in `index.md`
   becomes the tour, so put the foundations first.
6. With Claude Code, `/understand-knowledge` on the same folder adds AI-inferred entities,
   claims and hidden links on top. With an API key, `/graphify` does a semantic pass.

The rules for adding notes are in each wiki's `CLAUDE.md`, so an AI assistant can help you
grow the wiki while following the same conventions.

## Reading order for these notes

1. [01-graphify.md](01-graphify.md): how graphify turns code into a graph without an LLM.
2. [02-understand-anything.md](02-understand-anything.md): how Understand-Anything's agents
   build a graph and how the dashboard presents it.
3. [03-side-by-side.md](03-side-by-side.md): what each approach is good at, with real numbers.
4. [comparison-report.md](comparison-report.md): the full generated comparison
   (`bridge/compare_demo.sh` regenerates it).

## Exercises

Path 1:
1. Run `bridge/run.sh graphify` on graphify itself. Which god nodes does `GRAPH_REPORT.md`
   list? Find each one in the dashboard and read its code.
2. Use `graphify path` to find how `extract` reaches `cluster`. Then trace the same path in
   [01-graphify.md](01-graphify.md).
3. Open `understand-anything/understand-anything-plugin/skills/understand/SKILL.md` and
   map each phase to the agent in `agents/` that does it.

Path 2:
4. Grow the business example by one idea the café will face next, such as Location or
   Seasonality. Link it from at least two existing notes, run `learn.py next` to confirm
   it is the only gap, write it, rebuild, and see which layer it joins. (Competitors,
   Hiring and Taxes were added this way; their notes show the pattern.)
5. Start a new wiki on a topic you know nothing about. Stop after 10 notes and look at the
   graph: which note has the most backlinks? That is your topic's "god node".
6. Combine both paths: write a notes wiki explaining the *concepts* graphify uses
   (tree-sitter, AST, Leiden communities, confidence labels), then link each note to the
   file in `graphify/` where it lives.
