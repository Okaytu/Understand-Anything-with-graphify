#!/usr/bin/env python3
"""Let a coding agent explain a graphify map: every file, and *why* every connection exists.

graphify finds the structure (which file imports / calls / uses which) without any AI.
This tool hands that structure to your coding agent (Claude Code, Codex, …) in small
batches; the agent reads the real source and writes plain-language explanations; the
tool merges them into the Understand-Anything knowledge graph the dashboard shows.

    python3 bridge/enrich.py estimate <project>  tokens and dollars it will take, before spending any
    python3 bridge/enrich.py status   <project>  what is explained, missing or outdated
    python3 bridge/enrich.py export   <project>  write task batches to <project>/.ua/enrich/
    python3 bridge/enrich.py apply    <project>  merge the agent's answers, rebuild + validate

To keep token use low, the agent reads compact *digests* (imports, each definition's
first lines and nearby comments; small files whole) instead of whole files, and by
default tests, docs pages, generated code and "uses library X" connections are left
unexplained (they stay on the map). Flags on export/estimate change that:
--only src/ · --include-tests · --include-docs · --include-generated · --explain-modules · --everything

Workflow (what the agent does):
    bridge/run.sh <project> --view none        # graphify map → knowledge-graph.json
    enrich.py export <project>                 # → .ua/enrich/batch-001.json …
    (for each batch - ideally one subagent per batch: read it, write its answer file)
    enrich.py apply <project>                  # → explanations in the dashboard
    enrich.py status <project> --check         # exit 0 only when everything is explained

Explanations are stored in <project>/.ua/enrichments.json, keyed by file path, with a
hash of each file's contents. Re-running bridge/run.sh keeps them (graphify_to_ua.py
re-applies them); `status`/`export` only ask again for files that are new or changed.

Standard library only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
ENRICH_FILE = "enrichments.json"
WORK_DIR = "enrich"
FILE_TYPES = {"file", "config", "document"}
SYMBOL_TYPES = {"class", "function"}
MAX_SUMMARY = 1200
MAX_WHY = 400
MAX_NAME = 80
TOP_SYMBOLS = 40
GENERIC_PREFIX = "graphify:"


# ---------------------------------------------------------------------------
# paths / io
# ---------------------------------------------------------------------------

def ua_data_dir(root: Path) -> Path:
    legacy = root / ".understand-anything"
    return legacy if legacy.is_dir() else root / ".ua"


def load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def file_hash(root: Path, rel: str) -> str:
    try:
        return hashlib.sha1((root / rel).read_bytes()).hexdigest()[:16]
    except OSError:
        return ""


def empty_enrichments() -> dict[str, Any]:
    return {"version": 1, "files": {}, "connections": {}, "symbols": {}, "project": {}}


def clean_text(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    text = re.sub(r"[ \t]+", " ", value).strip()
    if not text:
        return None
    return text[:limit].rstrip()


# ---------------------------------------------------------------------------
# graph index
# ---------------------------------------------------------------------------

class GraphIndex:
    """Lift every node to its file so connections can be explained file → file."""

    def __init__(self, graph: dict[str, Any]):
        self.graph = graph
        self.by_id = {n["id"]: n for n in graph.get("nodes", [])}
        self.file_ids: dict[str, str] = {}  # path -> file node id
        for n in graph.get("nodes", []):
            if n.get("type") in FILE_TYPES and n.get("filePath") and not n.get("lineRange"):
                self.file_ids.setdefault(n["filePath"], n["id"])
        self.path_of_file = {v: k for k, v in self.file_ids.items()}

    def endpoint_key(self, node_id: str) -> str | None:
        """File path for project nodes, 'module:<name>' for external modules."""
        n = self.by_id.get(node_id)
        if not n:
            return None
        path = n.get("filePath")
        if path and path in self.file_ids:
            return path
        if n.get("type") == "module":
            return f"module:{n.get('name')}"
        return None

    def pairs(self) -> dict[tuple[str, str], dict[str, Any]]:
        """(from-file, to-file-or-module) -> {"via": [...], "types": [...], "edges": [edge, ...]}"""
        out: dict[tuple[str, str], dict[str, Any]] = {}
        for e in self.graph.get("edges", []):
            if e.get("type") == "contains":
                continue
            a, b = self.endpoint_key(e["source"]), self.endpoint_key(e["target"])
            if not a or not b or a == b or a.startswith("module:"):
                continue
            entry = out.setdefault((a, b), {"via": [], "types": [], "edges": []})
            entry["edges"].append(e)
            if e["type"] not in entry["types"]:
                entry["types"].append(e["type"])
            tgt = self.by_id.get(e["target"], {})
            src = self.by_id.get(e["source"], {})
            label = f"{e['type']} {tgt.get('name', '?')}"
            if src.get("type") not in FILE_TYPES:
                label = f"{src.get('name', '?')} {e['type']} {tgt.get('name', '?')}"
            if label not in entry["via"] and len(entry["via"]) < 12:
                entry["via"].append(label)
        return out

    def symbols_in(self, path: str) -> list[dict[str, Any]]:
        return [
            n for n in self.graph.get("nodes", [])
            if n.get("filePath") == path and n.get("type") not in FILE_TYPES and n.get("type") != "module"
        ]

    def top_symbols(self, limit: int | None = None) -> list[dict[str, Any]]:
        # scale with the project: about one key symbol per three files, 10..40
        if limit is None:
            limit = min(TOP_SYMBOLS, max(10, len(self.file_ids) // 3))
        # "key" = used the most by other code (incoming calls/imports/references)
        used_by: dict[str, int] = defaultdict(int)
        for e in self.graph.get("edges", []):
            if e.get("type") == "contains":
                continue
            used_by[e["target"]] += 1
        syms = [n for n in self.graph.get("nodes", []) if n.get("type") in SYMBOL_TYPES and n.get("filePath")]
        syms.sort(key=lambda n: (-used_by[n["id"]], n["id"]))
        return [n for n in syms[:limit] if used_by[n["id"]] >= 2]


def pair_key(a: str, b: str) -> str:
    return f"{a} -> {b}"


# ---------------------------------------------------------------------------
# scope: what is worth explaining (everything stays on the map regardless)
# ---------------------------------------------------------------------------

DEFAULT_SCOPE: dict[str, Any] = {
    "include_tests": False,     # test files: the code they test is what matters
    "include_docs": False,      # docs pages (README files are always explained)
    "include_generated": False,  # dist/, build/, vendor/, *.min.js, lockfiles …
    "explain_modules": False,   # "uses library X" connections
    "only": [],                 # limit to these path prefixes, e.g. ["src/"]
}
TEST_DIRS = {"test", "tests", "__tests__", "spec", "specs", "testing", "__mocks__", "fixtures", "e2e"}
GENERATED_DIRS = {"dist", "build", "out", "vendor", "node_modules", "coverage", ".next", "target",
                  "__snapshots__", "third_party", "site-packages", "generated", "gen"}
GENERATED_SUFFIXES = (".min.js", ".min.css", ".map", ".lock", "-lock.json", ".snap", ".pb.go", "_pb2.py",
                      ".generated.ts", ".g.dart")
DOC_SUFFIXES = (".md", ".mdx", ".rst", ".txt", ".adoc", ".pdf", ".html")


def is_test_path(path: str) -> bool:
    parts = path.lower().split("/")
    name = parts[-1]
    return (
        any(p in TEST_DIRS for p in parts[:-1])
        or name.startswith("test_") or name == "conftest.py"
        or bool(re.search(r"(_test|\.test|\.spec|_spec|Test|Tests)\.[A-Za-z0-9]+$", path.split("/")[-1]))
    )


def is_generated_path(path: str) -> bool:
    parts = path.lower().split("/")
    return any(p in GENERATED_DIRS for p in parts[:-1]) or parts[-1].endswith(GENERATED_SUFFIXES)


def is_doc_path(path: str) -> bool:
    name = path.lower().split("/")[-1]
    return name.endswith(DOC_SUFFIXES) and not name.startswith("readme")


def path_in_scope(path: str, scope: dict[str, Any]) -> bool:
    only = scope.get("only") or []
    if only and not any(path == o.rstrip("/") or path.startswith(o.rstrip("/") + "/") for o in only):
        return False
    if not scope.get("include_tests") and is_test_path(path):
        return False
    if not scope.get("include_generated") and is_generated_path(path):
        return False
    if not scope.get("include_docs") and is_doc_path(path):
        return False
    return True


def load_scope(enr: dict[str, Any]) -> dict[str, Any]:
    return {**DEFAULT_SCOPE, **(enr.get("scope") or {})}


# ---------------------------------------------------------------------------
# digests: what the agent reads instead of whole files
# ---------------------------------------------------------------------------

DIGEST_MAX = 2400            # characters per file digest
WHOLE_FILE_MAX = 2400        # files up to this size are sent whole
_IMPORT_RE = re.compile(
    r"^\s*(import\b|from\s+\S+\s+import\b|#include\b|using\s+[\w.]+;|use\s+[\w:]+|require\b|package\b"
    r"|.*\brequire\(|export\s+(\*|\{)[^;]*\bfrom\b)"
)
_COMMENT_RE = re.compile(r"^\s*(#|//|/\*|\*|--|;|\"\"\"|''')")


def read_text(root: Path, rel: str) -> str:
    try:
        return (root / rel).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


_PUBLIC_RE = re.compile(
    r"^\s*(export\b|pub\b|pub\(|public\b|module\.exports|exports\.|def [A-Za-z]|async def [A-Za-z]"
    r"|class [A-Za-z]|func [A-Z]|func \([^)]*\) [A-Z]|fn [a-z]|interface [A-Z]|type [A-Z]|struct [A-Z])"
)


def make_digest(root: Path, rel: str, definition_lines: list[int]) -> tuple[str, bool]:
    """A compact view of a file: its opening comment, imports, and for every definition its
    doc comment + signature line. Public definitions come first when space runs out; small
    files are returned whole. Returns (text, is_whole_file)."""
    text = read_text(root, rel)
    if len(text) <= WHOLE_FILE_MAX:
        return text, True
    lines = text.splitlines()

    def chunk_for(i: int) -> list[int]:
        rows = [i]
        j = i - 1
        while j >= 0 and i - j <= 8 and _COMMENT_RE.match(lines[j]):   # doc comment above
            rows.insert(0, j)
            j -= 1
        k = i + 1
        while k < len(lines) and k - i <= 3 and _COMMENT_RE.match(lines[k]):  # docstring below
            rows.append(k)
            k += 1
        return rows

    def size(rows: list[int]) -> int:
        return sum(min(len(lines[r]), 160) + 8 for r in rows)

    header = []
    for i, line in enumerate(lines[:8]):
        if _COMMENT_RE.match(line) or not line.strip():
            header.append(i)
        else:
            break
    imports = [i for i, line in enumerate(lines) if _IMPORT_RE.match(line)][:12]
    keep: set[int] = set(header) | set(imports)
    budget = DIGEST_MAX - size(sorted(keep))
    defs = [d - 1 for d in sorted(set(definition_lines)) if 0 < d <= len(lines)]
    # public definitions first, then the rest, each in file order
    ordered = [d for d in defs if _PUBLIC_RE.match(lines[d]) and not lines[d].lstrip().startswith("_")]
    ordered += [d for d in defs if d not in ordered]
    omitted = 0
    for d in ordered:
        rows = [r for r in chunk_for(d) if r not in keep]
        cost = size(rows)
        if cost <= budget:
            keep.update(rows)
            budget -= cost
        else:
            omitted += 1
    out: list[str] = []
    prev = -2
    for i in sorted(keep):
        if i != prev + 1:
            out.append("  …")
        out.append(f"{i + 1}: {lines[i][:160]}")
        prev = i
    if omitted:
        out.append(f"  … ({omitted} more definitions not shown; open the file if needed)")
    return "\n".join(out), False


def tokens(chars: int) -> int:
    """Rough token count for code/JSON (~3.5 characters per token)."""
    return int(chars / 3.5) + 1


def symbol_key(node: dict[str, Any]) -> str:
    return f"{node['filePath']}::{node['name']}"


# ---------------------------------------------------------------------------
# status
# ---------------------------------------------------------------------------

def compute_status(root: Path, graph: dict[str, Any], enr: dict[str, Any],
                   scope: dict[str, Any] | None = None) -> dict[str, Any]:
    """What is explained, missing or outdated - counting only what is in scope."""
    scope = scope or load_scope(enr)
    idx = GraphIndex(graph)
    in_scope_files = [p for p in sorted(idx.file_ids) if path_in_scope(p, scope)]
    in_scope = set(in_scope_files)
    files_missing, files_outdated = [], []
    for path in in_scope_files:
        rec = enr["files"].get(path)
        if not rec:
            files_missing.append(path)
        elif rec.get("hash") != file_hash(root, path):
            files_outdated.append(path)
    pairs = [
        (a, b) for (a, b) in sorted(idx.pairs())
        if a in in_scope and (b in in_scope or (b.startswith("module:") and scope.get("explain_modules")))
    ]
    conns_missing, conns_outdated = [], []
    for (a, b) in pairs:
        rec = enr["connections"].get(pair_key(a, b))
        if not rec:
            conns_missing.append(pair_key(a, b))
        elif rec.get("hash") != file_hash(root, a):
            conns_outdated.append(pair_key(a, b))
    syms = [n for n in idx.top_symbols() if n["filePath"] in in_scope]
    syms_missing = []
    for n in syms:
        rec = enr["symbols"].get(symbol_key(n))
        if not rec or rec.get("hash") != file_hash(root, n["filePath"]):
            syms_missing.append(symbol_key(n))
    project_missing = not enr.get("project", {}).get("description")
    return {
        "files": {"total": len(in_scope_files), "missing": files_missing, "outdated": files_outdated,
                  "skipped": len(idx.file_ids) - len(in_scope_files)},
        "connections": {"total": len(pairs), "missing": conns_missing, "outdated": conns_outdated},
        "symbols": {"total": len(syms), "todo": syms_missing},
        "project": {"todo": project_missing},
    }


def is_complete(st: dict[str, Any]) -> bool:
    return not (
        st["files"]["missing"] or st["files"]["outdated"]
        or st["connections"]["missing"] or st["connections"]["outdated"]
        or st["symbols"]["todo"] or st["project"]["todo"]
    )


def print_status(st: dict[str, Any]) -> None:
    f, c, s = st["files"], st["connections"], st["symbols"]
    done_f = f["total"] - len(f["missing"]) - len(f["outdated"])
    done_c = c["total"] - len(c["missing"]) - len(c["outdated"])
    print(f"files explained:        {done_f}/{f['total']}  (missing {len(f['missing'])}, outdated {len(f['outdated'])})"
          + (f"  [{f['skipped']} tests/docs/generated files not explained]" if f.get("skipped") else ""))
    print(f"connections explained:  {done_c}/{c['total']}  (missing {len(c['missing'])}, outdated {len(c['outdated'])})")
    print(f"key symbols explained:  {s['total'] - len(s['todo'])}/{s['total']}")
    print(f"project overview:       {'missing' if st['project']['todo'] else 'done'}")
    print("COMPLETE" if is_complete(st) else "INCOMPLETE: run `enrich.py export` and answer the batches")


# ---------------------------------------------------------------------------
# export
# ---------------------------------------------------------------------------

INSTRUCTIONS = """You are explaining part of a codebase for a beginner who will read it in a dashboard.
Each entry in "files" has a "digest": the file's imports, the first lines of every
definition with the comments next to them, and its opening comment (small files are
included whole; "whole_file": true). Explain from the digests. Open the real file
(the path is relative to "project_root") ONLY if a digest is not enough to tell what it does.
Write the JSON described in "answer_format" to "answer_file". Be brief and plain:
- files: 2-3 sentences: what the file is for and how it fits in. Explain any jargon.
- connections: for EVERY entry, ONE sentence on WHY "from" uses "to" (the purpose, not
  "it imports it"). "via" lists what graphify saw (imports/calls/uses).
- symbols (if present): one sentence on what it does and when it is used.
Never invent: if something is unclear, say so in a few words. Keep the exact keys given.
Write valid JSON only, then stop: do not summarise your answer back."""

ANSWER_FORMAT = {
    "files": {"<path from files[]>": {"summary": "…", "tags": ["optional", "short", "tags"]}},
    "connections": {"<key from files[].connections[]>": "why from uses to"},
    "symbols": {"<key from symbols[]>": "what it does"},
}

PROJECT_INSTRUCTIONS = """Write a beginner-friendly overview of the whole project to "answer_file".
Use "readme" (the start of the project's README, if any), the layers (graphify's clusters of
related files, with their files' summaries when already written) and the generated tour.
Open other files only if needed.
- description: 3-5 sentences: what the project does, for whom, and its main parts.
- layers: for EVERY layer id, a short meaningful "name" (2-4 words, e.g. "Payment processing")
  and a one-sentence "description". Base names on what the member files do.
- tour: about {tour_steps} steps (roughly one per 10 files, so it grows with the project) that
  teach the codebase in a good order (foundations first), together covering every layer. Each step:
  "title", "description" (2-4 sentences), and "files": 1-5 file paths (or "path::Symbol" keys
  from key_symbols) the step is about.
Write valid JSON only."""

BATCH_TOKEN_BUDGET = 9000     # target size of one batch file, in tokens
BATCH_MAX_FILES = 40


def plan(root: Path, graph: dict[str, Any], enr: dict[str, Any], scope: dict[str, Any]) -> dict[str, Any]:
    """Work out what needs explaining and build the batches (shared by export and estimate)."""
    st = compute_status(root, graph, enr, scope)
    idx = GraphIndex(graph)
    pairs = idx.pairs()
    todo_files = set(st["files"]["missing"]) | set(st["files"]["outdated"])
    todo_conns = set(st["connections"]["missing"]) | set(st["connections"]["outdated"])
    todo_syms = set(st["symbols"]["todo"])
    sym_nodes = {symbol_key(n): n for n in idx.top_symbols()}
    conns_by_file: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for (a, b), info in sorted(pairs.items()):
        if pair_key(a, b) in todo_conns:
            conns_by_file[a].append({"key": pair_key(a, b), "from": a, "to": b, "via": info["via"][:6]})
    paths = sorted(todo_files | set(conns_by_file) | {k.split("::")[0] for k in todo_syms})
    paths.sort(key=lambda p: (str(Path(p).parent), p))  # keep folders together

    entries: dict[str, dict[str, Any]] = {}
    full_chars = 0
    for p in paths:
        defs = sorted({(s.get("lineRange") or [0])[0] for s in idx.symbols_in(p) if s.get("lineRange")})
        digest, whole = make_digest(root, p, defs)
        full_chars += len(read_text(root, p))
        entries[p] = {
            "path": p,
            "needs_summary": p in todo_files,
            "whole_file": whole,
            "digest": digest,
            "defines": sorted({s["name"] for s in idx.symbols_in(p)})[:30],
            "connections": conns_by_file.get(p, []),
        }

    batches: list[list[str]] = []
    current: list[str] = []
    weight = 0
    for p in paths:
        cost = tokens(len(json.dumps(entries[p], ensure_ascii=False)))
        if current and (weight + cost > BATCH_TOKEN_BUDGET or len(current) >= BATCH_MAX_FILES):
            batches.append(current)
            current, weight = [], 0
        current.append(p)
        weight += cost
    if current:
        batches.append(current)
    project_todo = bool(st["project"]["todo"] or not enr.get("project", {}).get("layers"))
    return {"status": st, "entries": entries, "batches": batches, "sym_nodes": sym_nodes,
            "todo_files": todo_files, "todo_conns": todo_conns, "todo_syms": todo_syms,
            "project_todo": project_todo, "full_chars": full_chars, "idx": idx}


def scope_from_args(enr: dict[str, Any], args: argparse.Namespace | None) -> dict[str, Any]:
    scope = load_scope(enr)
    if args is None:
        return scope
    for flag in ("include_tests", "include_docs", "include_generated", "explain_modules"):
        if getattr(args, flag, False):
            scope[flag] = True
    if getattr(args, "everything", False):
        scope.update(include_tests=True, include_docs=True, include_generated=True, explain_modules=True)
    if getattr(args, "only", None):
        scope["only"] = [o.strip("/") for o in args.only]
    return scope


def export(root: Path, args: argparse.Namespace | None = None) -> int:
    data_dir = ua_data_dir(root)
    graph = load_json(data_dir / "knowledge-graph.json", None)
    if not graph:
        print(f"error: {data_dir / 'knowledge-graph.json'} not found; run bridge/run.sh first", file=sys.stderr)
        return 2
    enr = load_json(data_dir / ENRICH_FILE, empty_enrichments())
    for key in ("files", "connections", "symbols", "project"):
        enr.setdefault(key, {})
    scope = scope_from_args(enr, args)
    if scope != load_scope(enr):
        enr["scope"] = scope  # remember, so status/apply use the same scope
        write_json(data_dir / ENRICH_FILE, enr)
    pl = plan(root, graph, enr, scope)
    work = data_dir / WORK_DIR
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)

    for i, group in enumerate(pl["batches"], 1):
        syms = [
            {"key": k, "name": n["name"], "type": n["type"], "line": (n.get("lineRange") or [None])[0]}
            for k, n in sorted(pl["sym_nodes"].items()) if k in pl["todo_syms"] and n["filePath"] in group
        ]
        write_json(work / f"batch-{i:03d}.json", {
            "instructions": INSTRUCTIONS,
            "project_root": str(root),
            "answer_file": str(work / f"answer-{i:03d}.json"),
            "answer_format": ANSWER_FORMAT,
            "files": [pl["entries"][p] for p in group],
            "symbols": syms,
        })

    if pl["project_todo"]:
        idx = pl["idx"]
        layers = []
        layer_members: dict[str, list[str]] = {}
        for layer in graph.get("layers", []):
            members = [idx.path_of_file[n] for n in layer["nodeIds"] if n in idx.path_of_file]
            layers.append({
                "id": layer["id"], "current_name": layer["name"], "file_count": len(members),
                "files": [{"path": m, "summary": enr["files"].get(m, {}).get("summary", "")} for m in members[:12]],
            })
            layer_members[layer["id"]] = members
        readme = next((p for p in sorted(idx.file_ids, key=len) if p.lower().split("/")[-1].startswith("readme")), None)
        write_json(work / "layer-members.json", layer_members)
        write_json(work / "project.json", {
            "instructions": PROJECT_INSTRUCTIONS.replace(
                "{tour_steps}", str(max(6, min(40, round(len(idx.file_ids) / 10))))),
            "project_root": str(root),
            "answer_file": str(work / "answer-project.json"),
            "answer_format": {
                "description": "…",
                "layers": {"<layer id>": {"name": "…", "description": "…"}},
                "tour": [{"title": "…", "description": "…", "files": ["path/to/file.ext"]}],
            },
            "project_name": graph.get("project", {}).get("name"),
            "readme": read_text(root, readme)[:3000] if readme else "",
            "layers": layers,
            "key_symbols": sorted(pl["sym_nodes"]),
            "generated_tour": [t["title"] for t in graph.get("tour", [])],
        })

    st = pl["status"]
    print(f"Wrote {len(pl['batches'])} batch(es){' + project.json' if pl['project_todo'] else ''} to {work}")
    print(f"  files to summarise: {len(pl['todo_files'])}, connections to explain: {len(pl['todo_conns'])}, "
          f"key symbols: {len(pl['todo_syms'])}")
    if st["files"].get("skipped"):
        print(f"  not explained (still on the map): {st['files']['skipped']} test/doc/generated files"
              " - add --include-tests / --include-docs / --everything to change that")
    if not pl["batches"] and not pl["project_todo"]:
        print("Nothing to do: everything is explained and up to date.")
    return 0


# ---------------------------------------------------------------------------
# estimate
# ---------------------------------------------------------------------------

# $ per million tokens: (fresh input, cached input, output). Update when prices change.
PRICES = {
    "Opus 5.5": (4.00, 0.20, 20.00),
    "Sonnet 5.5": (2.00, 0.20, 10.00),
    "Haiku 5.5": (0.10, 0.01, 0.50),
}
SUBAGENT_OVERHEAD = 12_000    # agent instructions/tools each subagent starts with (mostly cached)
OUTPUT_OVERHEAD = 2.0         # thinking, tool calls and narration on top of the answer text


def estimate(root: Path, args: argparse.Namespace | None = None) -> int:
    data_dir = ua_data_dir(root)
    graph = load_json(data_dir / "knowledge-graph.json", None)
    if not graph:
        print(f"error: {data_dir / 'knowledge-graph.json'} not found; run bridge/run.sh first", file=sys.stderr)
        return 2
    enr = load_json(data_dir / ENRICH_FILE, empty_enrichments())
    for key in ("files", "connections", "symbols", "project"):
        enr.setdefault(key, {})
    pl = plan(root, graph, enr, scope_from_args(enr, args))
    st = pl["status"]
    batch_tokens = [
        tokens(len(INSTRUCTIONS) + sum(len(json.dumps(pl["entries"][p], ensure_ascii=False)) for p in b))
        for b in pl["batches"]
    ]
    reading = sum(batch_tokens) + (3_000 if pl["project_todo"] else 0)
    reread = int(reading * 0.15)   # files whose digest wasn't enough
    whole_files = tokens(pl["full_chars"])
    writing = (60 * len(pl["todo_files"]) + 35 * len(pl["todo_conns"]) + 35 * len(pl["todo_syms"])
               + (900 if pl["project_todo"] else 0))
    out_total = int(writing * (1 + OUTPUT_OVERHEAD))
    n_batches = len(pl["batches"]) + (1 if pl["project_todo"] else 0)
    # each batch in a fresh subagent: its instructions/tools are mostly cached, the batch is read once
    fresh = reading + reread
    cached = n_batches * SUBAGENT_OVERHEAD + int(fresh * 0.5)

    print(f"In scope: {st['files']['total']} files, {st['connections']['total']} connections, "
          f"{st['symbols']['total']} key symbols"
          + (f" ({st['files']['skipped']} test/doc/generated files skipped)" if st['files'].get('skipped') else ""))
    print(f"To do now: {len(pl['todo_files'])} files, {len(pl['todo_conns'])} connections, "
          f"{len(pl['todo_syms'])} symbols{', project overview' if pl['project_todo'] else ''} "
          f"in {n_batches} batch(es)")
    if not n_batches:
        print("Nothing to explain: everything is up to date (cost 0).")
        return 0
    saved = 100 - int(100 * reading / max(1, whole_files))
    print(f"Reading:  ~{reading:,} tokens of digests (the whole files would be ~{whole_files:,}: "
          f"{max(0, saved)}% less)")
    print(f"Writing:  ~{writing:,} tokens of explanations (~{out_total:,} with the agent's own thinking)")
    print("\nEstimated cost if the explaining runs on (API prices; a Pro/Max subscription uses plan")
    print("limits instead):")
    for name, (p_in, p_cache, p_out) in PRICES.items():
        cost = (fresh * p_in + cached * p_cache + out_total * p_out) / 1e6
        print(f"  {name:<11} ~${cost:.2f}")
    print("\nEstimate (±2x): real use depends on the agent, its effort setting and how often it opens")
    print("full files. Cheapest: one subagent per batch on Sonnet or Haiku, which also keeps the main")
    print("conversation small. Mapping with graphify is free.")
    return 0


# ---------------------------------------------------------------------------
# apply
# ---------------------------------------------------------------------------

def merge_answers(root: Path, data_dir: Path, enr: dict[str, Any]) -> dict[str, int]:
    work = data_dir / WORK_DIR
    counts = {"files": 0, "connections": 0, "symbols": 0, "project": 0, "rejected": 0}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for answer_path in sorted(work.glob("answer-[0-9]*.json")):
        batch = load_json(work / answer_path.name.replace("answer-", "batch-"), None)
        answer = load_json(answer_path, None)
        if not isinstance(batch, dict) or not isinstance(answer, dict):
            print(f"warning: skipping {answer_path.name} (missing batch or not valid JSON)", file=sys.stderr)
            counts["rejected"] += 1
            continue
        allowed_files = {f["path"] for f in batch.get("files", [])}
        allowed_conns = {c["key"]: c for f in batch.get("files", []) for c in f.get("connections", [])}
        allowed_syms = {s["key"] for s in batch.get("symbols", [])}
        for path, rec in (answer.get("files") or {}).items():
            summary = clean_text(rec.get("summary") if isinstance(rec, dict) else rec, MAX_SUMMARY)
            if path not in allowed_files or not summary:
                counts["rejected"] += 1
                continue
            tags = rec.get("tags", []) if isinstance(rec, dict) else []
            tags = [t for t in (clean_text(x, 30) for x in tags if isinstance(x, str)) if t][:6]
            enr["files"][path] = {"summary": summary, "tags": tags, "hash": file_hash(root, path), "at": now}
            counts["files"] += 1
        for key, why in (answer.get("connections") or {}).items():
            text = clean_text(why.get("why") if isinstance(why, dict) else why, MAX_WHY)
            if key not in allowed_conns or not text:
                counts["rejected"] += 1
                continue
            enr["connections"][key] = {"why": text, "hash": file_hash(root, allowed_conns[key]["from"]), "at": now}
            counts["connections"] += 1
        for key, text in (answer.get("symbols") or {}).items():
            text = clean_text(text.get("summary") if isinstance(text, dict) else text, MAX_SUMMARY)
            if key not in allowed_syms or not text:
                counts["rejected"] += 1
                continue
            enr["symbols"][key] = {"summary": text, "hash": file_hash(root, key.split("::")[0]), "at": now}
            counts["symbols"] += 1

    project_answer = load_json(work / "answer-project.json", None)
    project_task = load_json(work / "project.json", None)
    if isinstance(project_answer, dict) and isinstance(project_task, dict):
        proj = enr.setdefault("project", {})
        desc = clean_text(project_answer.get("description"), MAX_SUMMARY * 2)
        if desc:
            proj["description"] = desc
            counts["project"] += 1
        task_layers = {l["id"]: l for l in project_task.get("layers", [])}
        layer_members = load_json(work / "layer-members.json", {})  # full lists, kept out of the agent's task
        stored_layers = []
        for lid, rec in (project_answer.get("layers") or {}).items():
            if lid not in task_layers or not isinstance(rec, dict):
                counts["rejected"] += 1
                continue
            name = clean_text(rec.get("name"), MAX_NAME)
            if not name:
                continue
            stored_layers.append({
                "name": name,
                "description": clean_text(rec.get("description"), MAX_WHY) or "",
                "members": layer_members.get(lid)
                           or [f["path"] if isinstance(f, dict) else f for f in task_layers[lid].get("files", [])],
            })
        if stored_layers:
            proj["layers"] = stored_layers
        tour = []
        for step in project_answer.get("tour") or []:
            if not isinstance(step, dict):
                continue
            title = clean_text(step.get("title"), MAX_NAME * 2)
            desc = clean_text(step.get("description"), MAX_SUMMARY * 2)
            files = [f for f in step.get("files", []) if isinstance(f, str)][:8]
            if title and desc:
                tour.append({"title": title, "description": desc, "files": files})
        if tour:
            proj["tour"] = tour
        proj["at"] = now
    enr["updatedAt"] = now
    return counts


def apply_enrichments(graph: dict[str, Any], enr: dict[str, Any], root: Path) -> dict[str, Any]:
    """Write stored explanations into a knowledge graph (in place). Used by graphify_to_ua.py too."""
    if not enr:
        return graph
    idx = GraphIndex(graph)
    hashes: dict[str, str] = {}

    def current_hash(path: str) -> str:
        if path not in hashes:
            hashes[path] = file_hash(root, path)
        return hashes[path]

    for n in graph.get("nodes", []):
        path = n.get("filePath")
        if not path:
            continue
        rec = None
        if n["id"] in idx.path_of_file:
            rec = enr.get("files", {}).get(path)
        elif n.get("type") in SYMBOL_TYPES or n.get("type") == "concept":
            rec = enr.get("symbols", {}).get(f"{path}::{n['name']}")
        if not rec:
            continue
        n["summary"] = rec["summary"]
        tags = [t for t in n.get("tags", []) if t not in {"explained", "explanation-outdated"}]
        tags += [t for t in rec.get("tags", []) if t not in tags]
        tags.append("explained" if rec.get("hash") == current_hash(path) else "explanation-outdated")
        n["tags"] = tags

    conns = enr.get("connections", {})
    if conns:
        for (a, b), info in idx.pairs().items():
            rec = conns.get(pair_key(a, b))
            if not rec:
                continue
            for e in info["edges"]:
                e["description"] = rec["why"]

    proj = enr.get("project", {})
    if proj.get("description"):
        base = graph.setdefault("project", {}).get("description", "")
        marker = base.split("\n\n")[-1] if "graphify-bridge" in base else base
        graph["project"]["description"] = proj["description"] + ("\n\n" + marker if marker else "")
    stored_layers = proj.get("layers") or []
    if stored_layers:
        used: set[int] = set()
        for layer in graph.get("layers", []):
            members = {idx.path_of_file[n] for n in layer["nodeIds"] if n in idx.path_of_file}
            best, best_score = None, 0.0
            for i, s in enumerate(stored_layers):
                if i in used:
                    continue
                sm = {m["path"] if isinstance(m, dict) else m for m in s.get("members", [])}
                inter = len(members & sm)
                score = inter / max(1, min(len(members), len(sm)))
                if score > best_score:
                    best, best_score = i, score
            if best is not None and best_score >= 0.5:
                used.add(best)
                layer["name"] = stored_layers[best]["name"]
                if stored_layers[best].get("description"):
                    layer["description"] = stored_layers[best]["description"]
    tour = proj.get("tour") or []
    if tour:
        sym_ids = {f"{n['filePath']}::{n['name']}": n["id"] for n in graph.get("nodes", [])
                   if n.get("filePath") and n.get("type") not in FILE_TYPES}
        steps = []
        for step in tour:
            ids = []
            for ref in step.get("files", []):
                nid = idx.file_ids.get(ref) or sym_ids.get(ref)
                if nid and nid not in ids:
                    ids.append(nid)
            if ids:
                steps.append({"order": len(steps) + 1, "title": step["title"],
                              "description": step["description"], "nodeIds": ids})
        if steps:
            graph["tour"] = steps
    return graph


def validate(graph_path: Path) -> bool | None:
    validator = HERE / "validate_ua_graph.mjs"
    if not shutil.which("node"):
        return None
    result = subprocess.run(["node", str(validator), str(graph_path)], capture_output=True, text=True)
    out = (result.stdout + result.stderr).strip()
    if out:
        print(out)
    if result.returncode == 2:
        return None  # core not built yet
    return result.returncode == 0


def apply(root: Path) -> int:
    data_dir = ua_data_dir(root)
    graph_path = data_dir / "knowledge-graph.json"
    graph = load_json(graph_path, None)
    if not graph:
        print(f"error: {graph_path} not found; run bridge/run.sh first", file=sys.stderr)
        return 2
    enr = load_json(data_dir / ENRICH_FILE, empty_enrichments())
    for key in ("files", "connections", "symbols", "project"):
        enr.setdefault(key, {})
    counts = merge_answers(root, data_dir, enr)
    write_json(data_dir / ENRICH_FILE, enr)
    apply_enrichments(graph, enr, root)
    write_json(graph_path, graph)
    print(f"Applied: {counts['files']} file summaries, {counts['connections']} connection explanations, "
          f"{counts['symbols']} symbol summaries, project overview {'yes' if counts['project'] else 'no'}"
          + (f"; rejected {counts['rejected']} entries (unknown keys or empty text)" if counts["rejected"] else ""))
    ok = validate(graph_path)
    if ok is False:
        print("error: the updated graph did not validate", file=sys.stderr)
        return 1
    work = data_dir / WORK_DIR
    if work.exists():
        shutil.rmtree(work)
    if (root / "graphify-out" / "graph.html").is_file():  # refresh the explain panel's texts
        subprocess.run([sys.executable, "-I", str(Path(__file__).with_name("explain_html.py")), str(root)], check=False)
    print_status(compute_status(root, graph, enr))
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("status")
    p.add_argument("project", type=Path)
    p.add_argument("--check", action="store_true", help="exit 1 unless everything is explained")
    p.add_argument("--list", action="store_true", help="list what is missing")
    for name, help_text in (("export", "write task batches to <project>/.ua/enrich/"),
                            ("estimate", "how many tokens / dollars explaining will take")):
        p = sub.add_parser(name, help=help_text)
        p.add_argument("project", type=Path)
        p.add_argument("--only", nargs="+", metavar="PATH", help="explain only these folders/files, e.g. src/")
        p.add_argument("--include-tests", action="store_true", help="also explain test files")
        p.add_argument("--include-docs", action="store_true", help="also explain documentation pages")
        p.add_argument("--include-generated", action="store_true", help="also explain dist/, vendor/, lockfiles …")
        p.add_argument("--explain-modules", action="store_true", help="also explain 'uses library X' connections")
        p.add_argument("--everything", action="store_true", help="all of the above")
        p.add_argument("--batch-size", type=int, default=None, help="max files per batch (default 40)")
    p = sub.add_parser("apply")
    p.add_argument("project", type=Path)
    args = ap.parse_args(argv)
    root = args.project.resolve()
    if not root.is_dir():
        print(f"error: {root} not found", file=sys.stderr)
        return 2
    if args.cmd in ("export", "estimate"):
        global BATCH_MAX_FILES
        if args.batch_size:
            BATCH_MAX_FILES = max(1, args.batch_size)
        return export(root, args) if args.cmd == "export" else estimate(root, args)
    if args.cmd == "apply":
        return apply(root)
    data_dir = ua_data_dir(root)
    graph = load_json(data_dir / "knowledge-graph.json", None)
    if not graph:
        print(f"error: no knowledge graph in {data_dir}; run bridge/run.sh first", file=sys.stderr)
        return 2
    st = compute_status(root, graph, load_json(data_dir / ENRICH_FILE, empty_enrichments()))
    print_status(st)
    if args.list:
        for label, items in (("missing file", st["files"]["missing"]), ("outdated file", st["files"]["outdated"]),
                             ("missing connection", st["connections"]["missing"]),
                             ("outdated connection", st["connections"]["outdated"]),
                             ("key symbol", st["symbols"]["todo"])):
            for item in items:
                print(f"  {label}: {item}")
    return 1 if args.check and not is_complete(st) else 0


if __name__ == "__main__":
    sys.exit(main())
