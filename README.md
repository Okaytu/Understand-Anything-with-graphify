# Understand Anything with graphify

**Turn any code project, or anything you're learning from scratch, into a map you can
click through, like Obsidian's graph view.**

![The dashboard: every dot is a file or note, coloured by group, with an overview and guided tour on the right](docs/images/dashboard-overview.jpg)

This repository combines two open-source tools and adds the pieces that connect them:

- **[graphify](graphify/)** reads a project and works out what connects to what. It needs
  no AI and no internet, and it's free.
- **[Understand Anything](understand-anything/)** shows that map as an interactive
  dashboard, with an Obsidian-style graph, notes, links and a guided tour.

It runs on your own computer; your files are not uploaded anywhere.

> 🤖 **Have an AI coding agent (Claude Code, Codex, Cursor, …)?** Copy a ready-made prompt
> from **[PROMPTS.md](PROMPTS.md)**, paste it into the agent, and it sets everything up and
> walks you through it.

---

## Contents

1. [What can I do with it?](#1-what-can-i-do-with-it)
2. [What you will see](#2-what-you-will-see)
3. [One-time setup](#3-one-time-setup)
4. [Try it in two minutes](#4-try-it-in-two-minutes)
5. [Way 1: understand an existing project](#5-way-1-understand-an-existing-project)
6. [Way 2: learn something from zero](#6-way-2-learn-something-from-zero)
7. [How to use the dashboard](#7-how-to-use-the-dashboard)
8. [Optional: with an AI assistant](#8-optional-with-an-ai-assistant)
9. [Troubleshooting](#9-troubleshooting)
10. [For developers](#10-for-developers)
    · Copy-paste prompts for AI coding agents: [PROMPTS.md](PROMPTS.md)
11. [Credits and licenses](#11-credits-and-licenses)

---

## 1. What can I do with it?

There are two ways to learn with it:

| | **Way 1: learn from what you have** | **Way 2: start from zero** |
|---|---|---|
| **Use it when…** | you have a project (an app, a website, any code) and want to understand how it works | you want to learn a topic that has no code, such as how a business works, a subject for an exam, or a new field at work |
| **The map comes from…** | the project's files, read automatically | short notes you write as you learn, linked to each other |
| **It grows when…** | the project changes | you add a note |
| **"What should I learn next?"** | a guided tour: the most important parts first | a list of ideas you mentioned but haven't written about yet |
| **One command** | `bridge/run.sh <project folder>` | `learn-from-zero/learn.sh <notes folder>` |

Both ways open the same viewer, so once you know one, you know both.

You don't need to be a programmer. You will type a few commands into a terminal, and each
one is written out below, ready to copy and paste.

---

## 2. What you will see

**Hover over a dot:** it and everything it's connected to light up, and a box tells you
what it links to and what links to it.

![Hovering a file: its connections light up and a box lists them](docs/images/hover-connections.jpg)

**Click a dot:** the box stays open, and the sidebar shows it as a note, with its text,
clickable links, and **Backlinks** (everything that points to it).

![A note from the "how a business works" example, open in the sidebar](docs/images/note-sidebar.jpg)

<table>
<tr>
<td width="34%"><img src="docs/images/phone.jpg" alt="The graph on a phone, with a tapped dot's connection box and an Open note button"></td>
<td>

**It works on phones too.** Tap a dot to see its connections, then **Open note**.

**And a second view.** graphify's own interactive map opens next to the dashboard,
together with a written report of the most important parts of the project.

![graphify's view: the whole project as coloured clusters](docs/images/graphify-view.jpg)

</td>
</tr>
</table>

---

## 3. One-time setup

You need five free tools. You install them once.

| Tool | What it's for | Check it's installed (paste into a terminal) | You need |
|---|---|---|---|
| **Git** | downloads this repository | `git --version` | any version |
| **Node.js** | runs the dashboard | `node --version` | 22 or newer |
| **pnpm** | installs the dashboard's parts | `pnpm --version` | 10 or newer |
| **uv** | runs graphify and installs Python for it | `uv --version` | any version |
| **Python** | runs the notes tools | `python3 --version` | 3.10 or newer |

> **What's a terminal?** It's the app where you type commands.
> **Mac:** open *Terminal* (press ⌘ Space and type "Terminal").
> **Linux:** open *Terminal*.
> **Windows:** see the Windows section below.

### Mac

1. Install [Homebrew](https://brew.sh) if you don't have it: copy the one-line command from
   its homepage into Terminal.
2. Install the tools:
   ```bash
   brew install git node uv python
   ```
   ```bash
   npm install -g pnpm
   ```

### Linux (Ubuntu / Debian)

```bash
sudo apt update && sudo apt install -y git curl python3
```
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

For Node.js 22 or newer, use the installer at [nodejs.org](https://nodejs.org) (choose "LTS"),
or [nvm](https://github.com/nvm-sh/nvm). Then:
```bash
npm install -g pnpm
```

Close the terminal and open a new one, so it notices the new tools.

### Windows

The scripts in this repository are written for Mac and Linux. On Windows, use **WSL**, a
Linux system built into Windows:

1. Open **PowerShell as Administrator** and run `wsl --install`, then restart your computer.
2. Open **Ubuntu** from the Start menu and follow the **Linux** steps above.

> This repository has been tested on Linux. Mac should work the same way. Windows has only
> been considered through WSL, not tested natively.

---

## 4. Try it in two minutes

**Step 1. Download the repository:**
```bash
git clone https://github.com/Okaytu/Understand-Anything-with-graphify.git
```
```bash
cd Understand-Anything-with-graphify
```

> No Git? On the GitHub page, click **Code → Download ZIP**, unzip it, and open a terminal in
> that folder. Everything below still works, except the parts about history and updates.

**Step 2. Open the example.** It is 16 linked notes about how a small café makes money:
```bash
learn-from-zero/learn.sh learn-from-zero/examples/how-a-business-works
```

The **first run takes a few minutes**, because it downloads what the dashboard and graphify
need. Later runs take seconds.

**Step 3. Open the link.** When it's ready, the terminal shows a line like this:
```
🔑  Dashboard URL: http://127.0.0.1:5173/?token=3f9a…
```
Copy that **whole** link, including the `?token=…` part, into your web browser.
graphify's view is at `http://127.0.0.1:5174/graph.html`.

**Step 4. Stop it when you're done** by pressing **Ctrl + C** in the terminal.

---

## 5. Way 1: understand an existing project

Point it at any folder of code on your computer:

```bash
bridge/run.sh /path/to/the/project
```

For example, to explore graphify itself:
```bash
bridge/run.sh graphify
```

What happens:
1. **graphify reads the project.** It finds every file, function and class, and what
   uses what. This happens on your computer, with no AI and no internet needed.
2. **The result is converted and checked** so the dashboard can show it.
3. **Both viewers open.** Open the 🔑 link from the terminal, as in step 3 above.

**A good way to learn a project:**
1. Read **`graphify-out/GRAPH_REPORT.md`** inside the project. It lists the handful of
   parts everything else depends on.
2. In the dashboard sidebar, click **Start Tour →**. It walks through the most important
   parts first.
3. Hover over the big dots: bigger means more connected, and usually more important.
4. Click a file and press **Open code** to read the real code.
5. Write down what you learned as notes (Way 2). That's how it sticks.

> **Tip:** if the project uses Git, add the line `graphify-out/` to its `.gitignore` file.
> Otherwise the dashboard shows a "working-tree changes" warning about graphify's own output
> files. The script prints a reminder if this is needed.

More detail: [`bridge/README.md`](bridge/README.md).

---

## 6. Way 2: learn something from zero

Here you build the map yourself, one idea at a time. Each idea is a short note, and notes
link to each other.

**Step 1. Create a new notes folder** for your topic:
```bash
python3 learn-from-zero/learn.py init ~/learning/restaurants "How restaurants work"
```

**Step 2. Add what you learn.** Each note is one idea, with links to related ideas:
```bash
python3 learn-from-zero/learn.py new ~/learning/restaurants "Food Cost" --category Money --summary "what the ingredients of a dish cost" --link "Menu Pricing" --link "Suppliers"
```
This creates the file `wiki/Food Cost.md`. Open it in any text editor and write your
explanation. Mentioning another idea in double square brackets, like `[[Suppliers]]`, makes
a link.

**Step 3. Ask what to learn next.** This lists the ideas you linked but haven't written yet:
```bash
python3 learn-from-zero/learn.py next ~/learning/restaurants
```

**Step 4. See your map:**
```bash
learn-from-zero/learn.sh ~/learning/restaurants
```

Run it again after every few notes and watch the map grow.

> **Using Obsidian?** A notes folder made this way is plain Markdown with `[[links]]`, so
> you can also open it as an Obsidian vault and write your notes there. The two work
> side by side.

**What a good note looks like** (from the example):
```markdown
# Gross Margin

Gross margin is what is left from each sale after its variable [[Costs]]:
gross margin = price − variable cost per unit.

**Corner Coffee:** $4.50 − $1.20 = $3.30 per drink, a 73% gross margin.
```
Write one idea per note, in plain words, with a concrete example and links to related ideas.

More detail: [`learn-from-zero/README.md`](learn-from-zero/README.md).

---

## 7. How to use the dashboard

| I want to… | Do this |
|---|---|
| See what something connects to | **Hover** over its dot |
| Read about it | **Click** the dot. Its note opens in the sidebar |
| Jump to a related item | Click a name in the box or under **Links / Backlinks** |
| Go back | **← Back** at the top of the note |
| Move around | **Drag** the background; **scroll** to zoom; or use the **+ / − / ⤢** buttons |
| Move a dot | **Drag** the dot |
| Find something | Type in the **search bar** at the top; matches light up |
| Take the guided tour | **Start Tour →** in the sidebar |
| See functions and classes, not only files | Settings (⚙, top left) → **Functions & classes** |
| Give the graph more room | **⇥** (top right) hides the sidebar |
| Read the actual code | **Open code** in a file's note |
| Use the original layout | **Classic** in the header (on phones, in the ☰ menu) |
| Change colours | **Theme** in the header |

On a phone: tap a dot to see its connections, then tap **Open note**. Use **Graph / Info /
Files** at the bottom to switch screens.

---

## 8. Optional: with an AI assistant

Everything above works **without AI**. To let an AI coding agent do the steps for you,
use the ready-made prompts in **[PROMPTS.md](PROMPTS.md)**. If you use an AI coding assistant such as
[Claude Code](https://claude.com/claude-code), Understand Anything can also be installed as a
plugin that adds AI-written explanations:

- `/understand` on a project writes plain-English summaries, architecture layers and a teaching tour.
- `/understand-knowledge` on a notes folder finds hidden connections between your notes.

Installation for each assistant: [`understand-anything/README.md`](understand-anything/README.md).
To see how the AI version compares with graphify's free version on the same project, read
[`notes/03-side-by-side.md`](notes/03-side-by-side.md).

---

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| `command not found: pnpm` (or `uv`, `node`) | That tool isn't installed, or the terminal was opened before installing it. Redo [setup](#3-one-time-setup), then open a new terminal. |
| `permission denied` when running a script | Run `chmod +x bridge/*.sh learn-from-zero/*.sh` once, then try again. |
| The page says **"Access Token Required"** | Use the full 🔑 link from the terminal, including `?token=…`. A new token is made each time you start it. |
| **Port already in use** | Something else is using port 5173. Stop it, or add `--port 6000` to the command and use ports 6000 / 6001. |
| graphify's view (`graph.html`) is **blank** | It loads its drawing library from the internet, so it needs a connection. The dashboard works offline. |
| Orange **"working-tree changes"** banner | Add `graphify-out/` to the project's `.gitignore` (see the tip in [Way 1](#5-way-1-understand-an-existing-project)). |
| "**…already exists and was not created by this bridge**" | The project already has a map made by the AI version. Add `--force` to replace it. |
| The first run is slow | It's downloading dependencies once. Later runs are fast. |
| Something else | Run the same command with `--view none`: it only builds and checks, and prints what went wrong. |

Only open the dashboard links yourself. The servers listen on your own computer only
(`127.0.0.1`) and are not reachable from other devices.

---

## 10. For developers

<details>
<summary><b>Repository layout</b></summary>

```
├── understand-anything/   full Understand Anything project (git subtree, MIT)
├── graphify/              full graphify project (git subtree, Apache-2.0)
├── bridge/                Way 1: graphify → Understand-Anything converter, runner,
│                          viewer server, graph comparison
├── learn-from-zero/       Way 2: notes template, worked example, learn.py / learn.sh
├── notes/                 study guide, architecture notes, comparison report
├── docs/images/           screenshots used in this README
└── .github/workflows/     CI for everything above
```

Additions inside `understand-anything/`: the Obsidian graph style
(`packages/dashboard/src/components/Obsidian*.tsx`, `src/utils/obsidian-graph.ts`). Upstream
Understand Anything does not have it.
</details>

<details>
<summary><b>Commands</b></summary>

```bash
bridge/run.sh <project> [--view both|ua|graphify|none] [--port N] [--force]
learn-from-zero/learn.sh <notes> [--view both|ua|graphify|none] [--port N] [--force]
bridge/serve.sh <dir> [--view both|ua|graphify] [--port N]      # viewers only, no rebuild
python3 bridge/compare_graphs.py <understand.json> <bridge.json> --project <src>
bridge/compare_demo.sh                                            # regenerate notes/comparison-report.md
python3 learn-from-zero/learn.py {init|new|next|build} …
```
</details>

<details>
<summary><b>Running the tests</b></summary>

```bash
cd understand-anything && pnpm install && pnpm --filter @understand-anything/core build && pnpm --filter @understand-anything/skill build && pnpm test
```
```bash
cd graphify && uv sync --all-extras && uv run pytest tests/ -q
```
```bash
cd graphify && uv run pytest ../bridge/tests ../learn-from-zero/tests -q
```

Run graphify commands from inside `graphify/` or from the target project, not from the
repository root: there, the `graphify/` folder hides the installed package. The scripts
handle this for you.

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs all three suites. The graphify
job needs the full git history (`fetch-depth: 0`), because some tests read files from
older commits.
</details>

<details>
<summary><b>History and upstream updates</b></summary>

Both projects were imported with `git subtree add`, so their full commit history is
here. `git blame` follows lines into the original history. A path-limited `git log` stops
at the import commit, so to see a file's history, log the upstream branch:

```bash
git remote add ua-upstream https://github.com/Okaytu/Understand-Anything
git remote add graphify-upstream https://github.com/Okaytu/graphify
git fetch ua-upstream main && git fetch graphify-upstream v8
git log graphify-upstream/v8 -- graphify/build.py
```

To pull updates:
```bash
git subtree pull --prefix=understand-anything ua-upstream main
git subtree pull --prefix=graphify graphify-upstream v8
```
Expect conflicts in the dashboard files this repo changed (`App.tsx`, `store.ts`,
`MobileLayout.tsx`, `MobileDrawer.tsx`, `locales/*`).
</details>

<details>
<summary><b>Study notes</b></summary>

[`notes/README.md`](notes/README.md) is a study guide for both ways of learning, with a reading
order and exercises. It also links architecture notes on [graphify](notes/01-graphify.md)
and [Understand Anything](notes/02-understand-anything.md), and a
[comparison of the two on the same code](notes/03-side-by-side.md).
</details>

---

## 11. Credits and licenses

- **Understand Anything** by Yuxiang Lin and contributors: MIT,
  see [`understand-anything/LICENSE`](understand-anything/LICENSE).
- **graphify** by Graphify Labs and contributors: Apache-2.0,
  see [`graphify/LICENSE`](graphify/LICENSE) and [`graphify/NOTICE`](graphify/NOTICE).

Each project keeps its own license; this repository does not relicense either one. The
café numbers in the business example are made up for learning.
