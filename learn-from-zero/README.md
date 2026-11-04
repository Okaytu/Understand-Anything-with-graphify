# learn-from-zero: grow a knowledge graph from your own notes

For learning something with **no code to start from**, such as how a business works, how a
law is made, or how the body digests food. You write short linked notes as you learn, and
every rebuild turns them into a knowledge graph in the dashboard. The graph grows with you,
and the links you haven't written yet tell you what to learn next.

```bash
# 1. start from zero
python3 learn-from-zero/learn.py init ~/learning/restaurants "How restaurants work"

# 2. add what you learn, one concept per note, linking related ideas
python3 learn-from-zero/learn.py new ~/learning/restaurants "Food Cost" --category Money \
        --summary "what the ingredients of a dish cost" --link "Menu Pricing" --link "Suppliers"

# 3. see the gaps: linked but not written yet, most-linked first
python3 learn-from-zero/learn.py next ~/learning/restaurants

# 4. build the graph and open the dashboard
learn-from-zero/learn.sh ~/learning/restaurants
```

Try it on the worked example first:

```bash
learn-from-zero/learn.sh learn-from-zero/examples/how-a-business-works
```

It is 16 notes about one café ("Corner Coffee"), from Business Model through Revenue,
Gross Margin and Break-even Point to Unit Economics, Competitors, Hiring and Taxes, with
numbers that agree from note to note. It started with 13 notes and three linked-but-missing
ones (Competitors, Hiring, Taxes), which were then written the same way: `learn.py new`,
then content. `learn.py next` now reports no gaps, so link a new idea to start the next round.
Generated files (`.ua/`, `graphify-out/`) are git-ignored.

## What you get

One dashboard at `:5173` with three tabs:

| Tab | Shows |
|---|---|
| **Learn** | Your notes as a reading roadmap that follows the order of categories in `index.md`: read a step, press **Next**. Each step has a *Copy AI prompt for this step* button. |
| **Obsidian** | An **Obsidian-style graph** of your notes, coloured by `index.md` category. Hover a note to light up its neighbours and see a box of what it links to and what links to it; click it to read the whole note in the sidebar, with clickable `[[links]]`, Links and **Backlinks**. |
| **Graphify** | graphify's map of every note, its headings and its links, coloured by detected community. Click a note for a plain explanation and a ready-to-copy AI prompt. |

## Folder layout (the Karpathy LLM-wiki pattern)

```
my-topic/
├── CLAUDE.md          rules for adding notes (people and AI assistants follow the same ones)
├── raw/               sources you learn from: articles, PDFs, links
└── wiki/
    ├── index.md       ## Category sections listing [[Note]] links → layers + tour order
    ├── log.md         dated learning log
    ├── Start Here.md  your question
    └── <Concept>.md   one note per concept: "# Title", a plain definition, an example, [[links]]
```

## How the graph is built (no LLM)

`learn.py build` runs Understand-Anything's own deterministic scripts from
`understand-anything/…/skills/understand-knowledge/`: `parse-knowledge-base.py` (notes,
categories, wikilinks) and `merge-knowledge-graph.py` (layers, tour, `kind: "knowledge"`).
These are the same first and last steps `/understand-knowledge` runs. The graph is then
checked with the dashboard's own validator, and graphify maps the folder for the second view.

To go further with AI, in Claude Code:
- `/understand-knowledge <wiki>` adds entities, claims and implicit links between notes.
- `/graphify <wiki>` (with an LLM backend) does a semantic pass over notes and `raw/` sources.

## `learn.py` commands

| Command | Does |
|---|---|
| `init <dir> "Topic"` | copy `template/` and fill in the topic and date |
| `new <dir> "Title" --category C [--link X]… [--summary S]` | create `wiki/Title.md`, list it under `## C` in `index.md` (creating the section if needed), log it |
| `next <dir>` | linked-but-missing notes, most-linked first |
| `build <dir> [--force]` | write `.ua/knowledge-graph.json` + `meta.json`; refuses to replace a code graph unless `--force` |

Tests: `cd graphify && uv run pytest ../learn-from-zero/tests -q`
