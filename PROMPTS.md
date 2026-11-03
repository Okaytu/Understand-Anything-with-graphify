# Copy-paste prompts for coding agents

Paste one of these into your AI coding agent, such as **Claude Code**, **Codex**, **Cursor**,
**GitHub Copilot (agent mode)** or **Gemini CLI**, and it does the rest: it gets this
repository, checks your tools, runs the right commands, checks the result, and explains it
in plain language.

**How to use:**
1. Open your coding agent in a terminal, or in your editor's agent chat.
2. Hover over a prompt below and click the **copy** button in its top-right corner. On a
   phone, tap and hold the box.
3. Paste it into the agent's chat. Replace anything in `<<DOUBLE ANGLE BRACKETS>>` with your own
   details, then press Enter.

| # | Prompt | Use it when |
|---|---|---|
| 1 | [Set up and show me the example](#1-set-up-and-show-me-the-example) | the first time |
| 2 | [Help me understand my project](#2-help-me-understand-my-project) | you have code you want to understand |
| 3 | [Start learning a topic from zero](#3-start-learning-a-topic-from-zero) | you want to learn something with no code |
| 4 | [Grow my notes](#4-grow-my-notes) | you already have a notes folder |
| 5 | [Teach me step by step](#5-teach-me-step-by-step) | you want a guided lesson with questions |
| 6 | [Something isn't working](#6-something-isnt-working) | a command failed |
| 7 | [Update from upstream (developers)](#7-update-from-upstream-developers) | you want the latest graphify / Understand Anything |

> These prompts use the commands documented in [README.md](README.md), which were tested on Linux.
> How well each agent follows them depends on the agent. If yours can't keep a program running
> in the background, it gives you the command to run yourself instead.

---

## 1. Set up and show me the example

```text
Help me use the GitHub repository "Understand Anything with graphify"
(https://github.com/Okaytu/Understand-Anything-with-graphify). It turns code projects, or notes
I write, into an interactive Obsidian-style graph dashboard. Set it up and show me the
built-in example. I may not be a programmer: explain each step in one plain sentence.

1. Get the repository. If the current folder already contains both `bridge/run.sh` and
   `learn-from-zero/learn.sh`, use it. Otherwise run
   `git clone https://github.com/Okaytu/Understand-Anything-with-graphify.git ~/Understand-Anything-with-graphify`
   and work inside that folder for everything below.
2. Check my tools without changing anything that already works: `git --version`,
   `node --version` (needs 22 or newer), `pnpm --version` (10 or newer), `uv --version`,
   `python3 --version` (3.10 or newer). If something is missing or too old, tell me which
   one, show me the install command for my operating system from section
   "3. One-time setup" of README.md, and ask me before installing anything.
3. Build the example without starting any servers:
   `learn-from-zero/learn.sh learn-from-zero/examples/how-a-business-works --view none`
   The first run downloads dependencies and can take a few minutes. It has succeeded only
   if the output contains a line starting with `valid:`.
4. Start the viewers as a background process:
   `learn-from-zero/learn.sh learn-from-zero/examples/how-a-business-works`
   Wait for the line that starts with `🔑  Dashboard URL:` and give me that full link,
   including the `?token=...` part. Also give me http://127.0.0.1:5174/graph.html
   (graphify's view, which needs internet in the browser).
5. In 3 short bullet points, tell me what to click first. Then tell me how to stop the
   servers.

Rules: do not commit, push, or edit any file tracked by git (generated folders like `.ua/`
and `graphify-out/` are fine). If a step fails, read the error, check the "Troubleshooting"
table in README.md, fix what you safely can, and tell me plainly what happened. If you
cannot keep a process running in the background, stop after step 3 and give me the exact
command from step 4 to run in my own terminal.
```

---

## 2. Help me understand my project

Replace `<<PATH TO MY PROJECT>>` with the folder of the code you want to understand,
e.g. `~/code/my-app`.

```text
Use the repository "Understand Anything with graphify"
(https://github.com/Okaytu/Understand-Anything-with-graphify) to help me understand the code
project in this folder: <<PATH TO MY PROJECT>>
Explain things for a beginner: plain words, short sentences, no unexplained jargon.

1. Get the repository. If the current folder contains `bridge/run.sh`, use it. Otherwise
   clone it to ~/Understand-Anything-with-graphify (unless it is already there) and work
   from that folder. Check git, Node.js 22+, pnpm 10+, uv and Python 3.10+ as described in
   README.md section 3. Ask me before installing anything.
2. Map my project without starting servers: `bridge/run.sh "<<PATH TO MY PROJECT>>" --view none`
   It succeeded only if the output contains a line starting with `valid:`. If it says the
   project already has a knowledge graph that this bridge did not create, stop and ask me
   before using `--force`.
3. Read `<<PATH TO MY PROJECT>>/graphify-out/GRAPH_REPORT.md`, and the `tour` and `layers`
   in `<<PATH TO MY PROJECT>>/.ua/knowledge-graph.json` (or `.understand-anything/` if that
   folder exists).
4. Check before you claim. For anything important you are unsure about, ask graphify from
   inside the repository's `graphify` folder, for example:
   `cd graphify && uv run graphify explain "SomeName" --graph "<<PATH TO MY PROJECT>>/graphify-out/graph.json"`
   or `uv run graphify path "A" "B" --graph ...`. Read the actual source files too.
   Don't state anything you didn't check.
5. Write me a guide with these sections:
   - What this project does, in 3 sentences.
   - The 5 to 8 main parts: what each does and its key files.
   - The core building blocks: the most-connected classes or functions, with file paths,
     and why everything depends on them.
   - Reading order: 6 to 10 files to read, in order, with one line each on what to look for.
   - 3 surprising or important connections between parts.
   - Words I need to know: short definitions of terms the code uses.
6. Start the viewers in the background with `bridge/run.sh "<<PATH TO MY PROJECT>>"` and give
   me the full `🔑 Dashboard URL` link, including `?token=...`. If you cannot keep a
   process running, give me the command instead.
7. Ask me if I want this guide saved as notes in a learning wiki
   (`learn-from-zero/learn.py init` / `new`), so I can grow it as I learn.

Rules: never edit, move or delete my project's own files. The only things this should add
to my project are the generated `graphify-out/` and `.ua/` folders. If my project is a git
repository and `graphify-out/` isn't in its .gitignore, suggest adding it, but don't do it
without asking. Don't commit or push anything.
```

---

## 3. Start learning a topic from zero

Replace the three `<<...>>` lines with your own answers.

```text
Use the repository "Understand Anything with graphify"
(https://github.com/Okaytu/Understand-Anything-with-graphify) to start a learning wiki for me:
a folder of short, linked notes that becomes an interactive knowledge graph.

Topic: <<WHAT I WANT TO LEARN, e.g. "how restaurants make money">>
My level: <<e.g. "complete beginner">>
My goal: <<e.g. "understand it well enough to plan a small food business">>

1. Get the repository. If the current folder contains `learn-from-zero/learn.py`, use it.
   Otherwise clone it to ~/Understand-Anything-with-graphify (unless it is already there)
   and work from there. Check Node.js 22+, pnpm 10+, uv and Python 3.10+ as described in
   README.md section 3, and ask me before installing anything.
2. Learn the house style first. Read `learn-from-zero/README.md`,
   `learn-from-zero/template/CLAUDE.md` and three notes from
   `learn-from-zero/examples/how-a-business-works/wiki/`.
3. Create the wiki: `python3 learn-from-zero/learn.py init ~/learning/<short-topic-name> "<Topic>"`.
   The wiki's own CLAUDE.md lists the rules for notes. Follow them.
4. Fill in `wiki/Start Here.md` with my question, level and goal.
5. Write the first 8 to 12 notes, foundations first. For each note, run
   `python3 learn-from-zero/learn.py new <wiki> "<Title>" --category "<Category>" --summary "<one line>"`,
   then write its content:
   - one idea per note: a plain-language definition first, then details;
   - one concrete running example (like the café "Corner Coffee" in the example) used
     across all the notes, with numbers that agree from note to note;
   - [[links]] to every related idea, including some I haven't written yet;
   - categories in wiki/index.md ordered from foundations to advanced (the order becomes
     the tour).
   Say clearly when something depends on country, law or date. Don't invent facts or
   sources. If you used real sources, list them in raw/sources.md.
6. Check your work: `python3 learn-from-zero/learn.py next <wiki>` lists the gaps.
   `learn-from-zero/learn.sh <wiki> --view none` must print a line starting with `valid:`.
7. Start the viewers in the background with `learn-from-zero/learn.sh <wiki>` and give me
   the full `🔑 Dashboard URL` link, including `?token=...`. If you cannot keep a
   process running, give me the command instead.
8. Finish with: the notes you wrote, in one line each; the top 5 "next to learn" gaps; and
   one question for me to think about before the next session.

Rules: only create files inside the new wiki folder. Don't commit or push anything.
```

---

## 4. Grow my notes

```text
I have a learning wiki made with "Understand Anything with graphify"
(https://github.com/Okaytu/Understand-Anything-with-graphify) at: <<PATH TO MY NOTES FOLDER>>
Help it grow by <<NUMBER, e.g. 5>> notes.

1. Find the repository (a folder containing `learn-from-zero/learn.py`), or clone it to
   ~/Understand-Anything-with-graphify.
2. Read my wiki's CLAUDE.md, wiki/index.md, wiki/log.md and the existing notes, so you match
   my style, my running example and my numbers.
3. Run `python3 learn-from-zero/learn.py next "<<PATH TO MY NOTES FOLDER>>"` and take the
   most-linked gaps first.
4. For each new note, run `learn.py new` with the best-fitting existing category, then write
   it: plain definition, my running example with numbers that agree with the existing notes,
   and [[links]]. Where it's natural, add a [[link]] to the new note from 1 or 2 existing
   notes. Don't rewrite my existing text otherwise.
5. Re-check: `learn-from-zero/learn.sh "<<PATH TO MY NOTES FOLDER>>" --view none` must print
   a line starting with `valid:`. Run `learn.py next` again.
6. Tell me what you added, which existing notes you changed and why, any numbers you
   double-checked, and the new top gaps. Then offer to start the viewers.

Rules: only change files inside my notes folder. Flag anything that depends on country, law
or date. Don't invent sources. Don't commit or push anything.
```

---

## 5. Teach me step by step

```text
Use the knowledge graph in <<PATH TO MY PROJECT OR NOTES FOLDER>>/.ua/knowledge-graph.json
(made with https://github.com/Okaytu/Understand-Anything-with-graphify) to teach me
interactively. If that file doesn't exist yet, create it first: use
`bridge/run.sh "<path>" --view none` for code, or `learn-from-zero/learn.sh "<path>" --view none`
for a notes folder, from the repository folder.

Walk me through the graph's `tour`, sorted by `order`, one step at a time:
- explain the step in plain language, in at most 8 sentences, using the summaries of the
  step's nodes (and the real source files or notes they point to);
- show me which parts it involves (names and file paths) so I can find them in the
  dashboard;
- ask me one question to check I understood it, then WAIT for my answer;
- if my answer is wrong or incomplete, explain the gap kindly and ask a simpler follow-up;
- only move on to the next step when I say "next".
At the end, summarise what I learned and suggest the 3 things to study next.
Don't change any files.
```

---

## 6. Something isn't working

```text
I'm using the repository "Understand Anything with graphify"
(https://github.com/Okaytu/Understand-Anything-with-graphify) and this didn't work:

Command I ran: <<PASTE THE COMMAND>>
What happened: <<PASTE THE ERROR OR DESCRIBE IT>>

Please:
1. Find the repository folder (it contains bridge/run.sh) and re-run the command, adding
   `--view none` if it's run.sh or learn.sh, so we see the error without starting servers.
2. Check the "Troubleshooting" table in README.md and the tool versions it needs
   (Node.js 22+, pnpm 10+, uv, Python 3.10+).
3. Find the real cause from the actual output. Don't guess.
4. Fix it if the fix is safe and local, such as a missing dependency, file permissions,
   a port already in use, or a missing .gitignore entry. Ask me first before installing
   system-wide software, deleting anything, or using `--force`.
5. Re-run and show me that it now works: a line starting with `valid:`, or the
   `🔑 Dashboard URL`.
6. Explain in 2-3 plain sentences what was wrong and what you changed.
If the problem is a bug in this repository, say so and describe it. Don't commit or push
anything.
```

---

## 7. Update from upstream (developers)

```text
In the repository "Understand Anything with graphify" (my clone of
https://github.com/Okaytu/Understand-Anything-with-graphify), pull the latest upstream
versions of both subprojects. Follow "History and upstream updates" in README.md:

1. Make sure the working tree is clean and create a new branch named
   `update-upstream-<today's date>`.
2. Add the remotes if they're missing (ua-upstream → https://github.com/Okaytu/Understand-Anything,
   graphify-upstream → https://github.com/Okaytu/graphify), then fetch `main` and `v8`.
3. Run `git subtree pull --prefix=understand-anything ua-upstream main` and
   `git subtree pull --prefix=graphify graphify-upstream v8`.
4. Resolve conflicts by keeping upstream's changes AND this repo's additions: the
   Obsidian graph style in understand-anything/understand-anything-plugin/packages/dashboard
   (App.tsx, store.ts, MobileLayout.tsx, MobileDrawer.tsx, locales/*, components/Obsidian*,
   utils/obsidian-graph*). Explain every conflict you resolve.
5. Verify, using the commands under "Running the tests" in README.md: the
   understand-anything tests, the dashboard build
   (`pnpm --filter @understand-anything/dashboard build`), the graphify tests, the bridge +
   learn-from-zero tests, and `bridge/run.sh graphify --view none`.
   graphify's tests that need DNS or a full git history may fail in sandboxes without
   them. Report them separately; don't hide failures.
6. Show me a summary of what changed upstream and the test results. Don't push or merge
   into main until I say so.
```

---

### Tips for specific agents

- **Claude Code:** paste directly. It can keep the dashboard running in the background and
  give you the link. Understand Anything is also a Claude Code plugin: see
  [understand-anything/README.md](understand-anything/README.md) for the AI-powered
  `/understand` commands.
- **Codex and other sandboxed agents:** the first run needs internet to download
  dependencies. If the sandbox blocks network or local servers, allow them for this
  folder, or let the agent stop at the `--view none` step and run the printed command
  yourself.
- **Editor agents (Cursor, Copilot, …):** open the repository folder first, so the agent
  can see `README.md`, and run the prompts in agent mode, not plain chat. Plain chat can't
  run commands.
