#!/usr/bin/env python3
"""Start-from-zero learning: grow a wiki of notes and turn it into a knowledge graph.

    learn.py init  <dir> "Topic"                        create a new learning wiki from the template
    learn.py new   <dir> "Note Title" --category Money  add a note (+ index entry + log line)
                   [--link "Other Note" ...] [--summary "one-line definition"]
    learn.py next  <dir>                                list linked-but-unwritten notes = what to learn next
    learn.py build <dir> [--force]                      build <dir>/.ua/knowledge-graph.json (no LLM)

`build` reuses Understand-Anything's own deterministic wiki scripts
(skills/understand-knowledge/parse-knowledge-base.py + merge-knowledge-graph.py),
the same first two phases `/understand-knowledge` runs, minus the LLM pass.
Running `/understand-knowledge` in Claude Code later adds LLM-inferred entities
and claims on top of the same wiki.

Standard library only.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
TEMPLATE = HERE / "template"
KNOWLEDGE_SCRIPTS = (
    REPO_ROOT / "understand-anything" / "understand-anything-plugin" / "skills" / "understand-knowledge"
)
WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]")
UNSAFE_TITLE_RE = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def wiki_dir(root: Path) -> Path:
    return root / "wiki" if (root / "wiki").is_dir() else root


def ua_data_dir(root: Path) -> Path:
    legacy = root / ".understand-anything"
    return legacy if legacy.is_dir() else root / ".ua"


def today() -> str:
    return date.today().isoformat()


def check_title(title: str) -> str:
    title = title.strip()
    if not title or UNSAFE_TITLE_RE.search(title) or title.startswith("."):
        raise SystemExit(f"error: {title!r} is not usable as a note file name")
    return title


def existing_notes(root: Path) -> dict[str, Path]:
    """lower-cased note title -> path, for every markdown file in the wiki."""
    return {p.stem.lower(): p for p in wiki_dir(root).rglob("*.md")}


def all_links(root: Path) -> Counter[str]:
    """How many notes link to each target (one count per linking note)."""
    counts: Counter[str] = Counter()
    canonical: dict[str, str] = {}
    for path in wiki_dir(root).rglob("*.md"):
        targets = {m.group(1).strip() for m in WIKILINK_RE.finditer(path.read_text(encoding="utf-8", errors="replace"))}
        for t in targets:
            key = t.lower()
            canonical.setdefault(key, t)
            counts[canonical[key]] += 1
    return counts


# ---------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------

def cmd_init(args: argparse.Namespace) -> int:
    root: Path = args.dir
    if root.exists() and any(root.iterdir()):
        print(f"error: {root} already exists and is not empty", file=sys.stderr)
        return 2
    shutil.copytree(TEMPLATE, root, dirs_exist_ok=True)
    for path in root.rglob("*.md"):
        text = path.read_text(encoding="utf-8")
        path.write_text(text.replace("{{TOPIC}}", args.topic).replace("{{DATE}}", today()), encoding="utf-8")
    (root / ".gitignore").write_text(".ua/\ngraphify-out/\n", encoding="utf-8")
    print(f"Created learning wiki for {args.topic!r} in {root}")
    print(f"Next: open {root / 'wiki' / 'Start Here.md'}, then add notes with")
    print(f'  learn.py new {root} "First Concept" --category Foundations')
    return 0


def _add_to_index(index: Path, category: str, title: str, summary: str) -> None:
    lines = index.read_text(encoding="utf-8").splitlines() if index.exists() else ["# Index", ""]
    entry = f"- [[{title}]]" + (f" — {summary}" if summary else "")
    heading = f"## {category}"
    try:
        start = next(i for i, l in enumerate(lines) if l.strip().lower() == heading.lower())
    except StopIteration:
        if lines and lines[-1].strip():
            lines.append("")
        lines += [heading, entry]
    else:
        end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
        insert_at = end
        while insert_at > start + 1 and not lines[insert_at - 1].strip():
            insert_at -= 1
        lines.insert(insert_at, entry)
    index.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _add_to_log(log: Path, message: str) -> None:
    text = log.read_text(encoding="utf-8") if log.exists() else "# Learning log\n"
    heading = f"## {today()}"
    if heading in text:
        text = text.rstrip("\n") + f"\n- {message}\n"
    else:
        text = text.rstrip("\n") + f"\n\n{heading}\n- {message}\n"
    log.write_text(text, encoding="utf-8")


def cmd_new(args: argparse.Namespace) -> int:
    root: Path = args.dir
    wiki = wiki_dir(root)
    if not (wiki / "index.md").exists():
        print(f"error: {wiki / 'index.md'} not found; create the wiki with `learn.py init` first", file=sys.stderr)
        return 2
    title = check_title(args.title)
    if title.lower() in existing_notes(root):
        print(f"error: a note called {title!r} already exists", file=sys.stderr)
        return 2
    links = [check_title(l) for l in (args.link or [])]
    summary = (args.summary or "").strip()
    body = [f"# {title}", "", summary or "One-paragraph, plain-language definition goes here.", ""]
    body += ["## Example", "", "A concrete, real example.", ""]
    body += ["## Related", ""]
    body += [f"- [[{l}]]" for l in links] or ["- (link related notes here: a note title in double square brackets)"]
    (wiki / f"{title}.md").write_text("\n".join(body) + "\n", encoding="utf-8")
    _add_to_index(wiki / "index.md", args.category.strip(), title, summary)
    _add_to_log(wiki / "log.md", f"Added [[{title}]] ({args.category.strip()}).")
    print(f"Created {wiki / (title + '.md')} and listed it under '## {args.category.strip()}' in index.md")
    return 0


def next_to_learn(root: Path) -> list[tuple[str, int]]:
    have = existing_notes(root)
    return sorted(
        ((t, n) for t, n in all_links(root).items() if t.lower() not in have),
        key=lambda x: (-x[1], x[0].lower()),
    )


def cmd_next(args: argparse.Namespace) -> int:
    missing = next_to_learn(args.dir)
    if not missing:
        print("Every linked note exists. Link a new idea with [[...]] to grow the map.")
        return 0
    print("Linked but not written yet (most-linked first) — learn these next:")
    for title, n in missing:
        print(f"  {title}  ({n} note{'s' if n != 1 else ''} link here)")
    return 0


def build_graph(root: Path, force: bool = False) -> dict:
    parse = KNOWLEDGE_SCRIPTS / "parse-knowledge-base.py"
    merge = KNOWLEDGE_SCRIPTS / "merge-knowledge-graph.py"
    for script in (parse, merge):
        if not script.is_file():
            raise SystemExit(f"error: missing {script} (is understand-anything/ present?)")
    data_dir = ua_data_dir(root)
    out = data_dir / "knowledge-graph.json"
    if out.exists() and not force:
        try:
            existing = json.loads(out.read_text(encoding="utf-8"))
        except ValueError:
            existing = {}
        if existing.get("kind") != "knowledge":
            raise SystemExit(f"error: {out} exists and is not a knowledge graph; use --force to replace it")
    for script in (parse, merge):
        result = subprocess.run([sys.executable, str(script), str(root)], capture_output=True, text=True)
        if result.returncode != 0:
            sys.stderr.write(result.stdout + result.stderr)
            raise SystemExit(f"error: {script.name} failed")
        for line in result.stderr.splitlines():
            if line.startswith("[parse] Karpathy") or line.startswith("[merge] Output"):
                print(line)
    assembled = data_dir / "intermediate" / "assembled-graph.json"
    graph = json.loads(assembled.read_text(encoding="utf-8"))
    out.write_text(json.dumps(graph, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    git = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], capture_output=True, text=True)
    meta = {
        "lastAnalyzedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "gitCommitHash": git.stdout.strip() if git.returncode == 0 else "",
        "version": "1.0.0",
        "analyzedFiles": sum(1 for n in graph.get("nodes", []) if n.get("type") == "article"),
    }
    (data_dir / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    shutil.rmtree(data_dir / "intermediate", ignore_errors=True)
    return graph


def cmd_build(args: argparse.Namespace) -> int:
    graph = build_graph(args.dir, args.force)
    types = Counter(n.get("type") for n in graph.get("nodes", []))
    print(f"Wrote {ua_data_dir(args.dir) / 'knowledge-graph.json'}: "
          f"{', '.join(f'{v} {k}' for k, v in types.most_common())}; "
          f"{len(graph.get('edges', []))} links, {len(graph.get('layers', []))} layers, "
          f"{len(graph.get('tour', []))} tour steps")
    missing = next_to_learn(args.dir)
    if missing:
        print("Next to learn: " + ", ".join(t for t, _ in missing[:8]) + (" …" if len(missing) > 8 else ""))
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("init", help="create a new learning wiki")
    p.add_argument("dir", type=Path)
    p.add_argument("topic")
    p.set_defaults(func=cmd_init)
    p = sub.add_parser("new", help="add a note")
    p.add_argument("dir", type=Path)
    p.add_argument("title")
    p.add_argument("--category", required=True, help="index.md section, e.g. Foundations")
    p.add_argument("--link", action="append", help="related note (repeatable)")
    p.add_argument("--summary", help="one-line definition")
    p.set_defaults(func=cmd_new)
    p = sub.add_parser("next", help="what to learn next")
    p.add_argument("dir", type=Path)
    p.set_defaults(func=cmd_next)
    p = sub.add_parser("build", help="build the knowledge graph (no LLM)")
    p.add_argument("dir", type=Path)
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_build)
    args = ap.parse_args(argv)
    args.dir = args.dir.resolve()
    if args.cmd != "init" and not args.dir.is_dir():
        print(f"error: {args.dir} not found", file=sys.stderr)
        return 2
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
