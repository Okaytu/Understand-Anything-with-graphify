#!/usr/bin/env python3
"""Let a coding agent explain a graphify map: every file, and *why* every connection exists.

graphify finds the structure (which file imports / calls / uses which) without any AI.
This tool hands that structure to your coding agent (Claude Code, Codex, …) in small
batches; the agent reads the real source and writes plain-language explanations; the
tool merges them into the Understand-Anything knowledge graph the dashboard shows.

    python3 bridge/enrich.py status <project>   what is explained, missing or outdated
    python3 bridge/enrich.py export <project>   write task batches to <project>/.ua/enrich/
    python3 bridge/enrich.py apply  <project>   merge the agent's answers, rebuild + validate

Workflow (what the agent does):
    bridge/run.sh <project> --view none        # graphify map → knowledge-graph.json
    enrich.py export <project>                 # → .ua/enrich/batch-001.json …
    (for each batch: read the listed source files, write the answer file it names)
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


def symbol_key(node: dict[str, Any]) -> str:
    return f"{node['filePath']}::{node['name']}"


# ---------------------------------------------------------------------------
# status
# ---------------------------------------------------------------------------

def compute_status(root: Path, graph: dict[str, Any], enr: dict[str, Any]) -> dict[str, Any]:
    idx = GraphIndex(graph)
    files_missing, files_outdated = [], []
    for path in sorted(idx.file_ids):
        rec = enr["files"].get(path)
        if not rec:
            files_missing.append(path)
        elif rec.get("hash") != file_hash(root, path):
            files_outdated.append(path)
    conns_missing, conns_outdated = [], []
    for (a, b) in sorted(idx.pairs()):
        rec = enr["connections"].get(pair_key(a, b))
        if not rec:
            conns_missing.append(pair_key(a, b))
        elif rec.get("hash") != file_hash(root, a):
            conns_outdated.append(pair_key(a, b))
    syms_missing = []
    for n in idx.top_symbols():
        rec = enr["symbols"].get(symbol_key(n))
        if not rec or rec.get("hash") != file_hash(root, n["filePath"]):
            syms_missing.append(symbol_key(n))
    project_missing = not enr.get("project", {}).get("description")
    return {
        "files": {"total": len(idx.file_ids), "missing": files_missing, "outdated": files_outdated},
        "connections": {"total": len(idx.pairs()), "missing": conns_missing, "outdated": conns_outdated},
        "symbols": {"total": len(idx.top_symbols()), "todo": syms_missing},
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
    print(f"files explained:        {done_f}/{f['total']}  (missing {len(f['missing'])}, outdated {len(f['outdated'])})")
    print(f"connections explained:  {done_c}/{c['total']}  (missing {len(c['missing'])}, outdated {len(c['outdated'])})")
    print(f"key symbols explained:  {s['total'] - len(s['todo'])}/{s['total']}")
    print(f"project overview:       {'missing' if st['project']['todo'] else 'done'}")
    print("COMPLETE" if is_complete(st) else "INCOMPLETE: run `enrich.py export` and answer the batches")


# ---------------------------------------------------------------------------
# export
# ---------------------------------------------------------------------------

INSTRUCTIONS = """You are explaining part of a codebase for a beginner who will read it in a dashboard.
Read every source file listed under "files" (paths are relative to the project root), then
write the JSON answer described in "answer_format" to the path in "answer_file".
- files: a 2-4 sentence plain-language summary of what the file is for and how it fits in.
  Avoid jargon or explain it. Mention the most important thing it defines.
- connections: for EVERY entry, one or two sentences on WHY "from" uses "to" — the purpose,
  not just "it imports it". "via" lists what graphify saw (imports/calls/uses).
- symbols (if present): 1-3 sentences on what that function/class does and when it is used.
- Base everything on the actual code. If something is unclear, say so briefly; never invent.
- Write valid JSON only. Keep the exact keys given (file paths, connection keys, symbol keys)."""

ANSWER_FORMAT = {
    "files": {"<path from files[]>": {"summary": "…", "tags": ["optional", "short", "tags"]}},
    "connections": {"<key from files[].connections[]>": "why from uses to"},
    "symbols": {"<key from symbols[]>": "what it does"},
}

PROJECT_INSTRUCTIONS = """Write a beginner-friendly overview of the whole project to "answer_file".
Look at the README (if any), the layers (graphify's clusters of related files) and the
generated tour, and skim key files.
- description: 3-5 sentences: what the project does, for whom, and its main parts.
- layers: for EVERY layer id, a short meaningful "name" (2-4 words, e.g. "Payment processing")
  and a one-sentence "description". Base names on what the member files do.
- tour: 6-12 steps that teach the codebase in a good order (foundations first). Each step:
  "title", "description" (3-6 sentences, plain language), and "files": 1-5 file paths (or
  "path::Symbol" keys from key_symbols) the step is about.
Write valid JSON only."""


def export(root: Path, batch_size: int) -> int:
    data_dir = ua_data_dir(root)
    graph = load_json(data_dir / "knowledge-graph.json", None)
    if not graph:
        print(f"error: {data_dir / 'knowledge-graph.json'} not found; run bridge/run.sh first", file=sys.stderr)
        return 2
    enr = load_json(data_dir / ENRICH_FILE, empty_enrichments())
    st = compute_status(root, graph, enr)
    idx = GraphIndex(graph)
    pairs = idx.pairs()
    work = data_dir / WORK_DIR
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)

    todo_files = set(st["files"]["missing"]) | set(st["files"]["outdated"])
    todo_conns = set(st["connections"]["missing"]) | set(st["connections"]["outdated"])
    todo_syms = set(st["symbols"]["todo"])
    # every file that has work: its own summary and/or outgoing connections and/or key symbols
    sym_nodes = {symbol_key(n): n for n in idx.top_symbols()}
    paths = sorted(
        todo_files
        | {k.split(" -> ")[0] for k in todo_conns}
        | {k.split("::")[0] for k in todo_syms}
    )
    # keep related files together: sort by folder
    paths.sort(key=lambda p: (str(Path(p).parent), p))

    batches = []
    current: list[str] = []
    weight = 0
    for p in paths:
        cost = 1 + sum(1 for k in todo_conns if k.startswith(p + " -> ")) // 8
        if current and weight + cost > batch_size:
            batches.append(current)
            current, weight = [], 0
        current.append(p)
        weight += cost
    if current:
        batches.append(current)

    for i, group in enumerate(batches, 1):
        files = []
        for p in group:
            conns = []
            for (a, b), info in sorted(pairs.items()):
                if a == p and pair_key(a, b) in todo_conns:
                    conns.append({"key": pair_key(a, b), "from": a, "to": b, "via": info["via"]})
            symbols = sorted({s["name"] for s in idx.symbols_in(p)})[:40]
            files.append({
                "path": p,
                "needs_summary": p in todo_files,
                "defines": symbols,
                "connections": conns,
            })
        syms = [
            {"key": k, "name": n["name"], "type": n["type"], "line": (n.get("lineRange") or [None])[0]}
            for k, n in sorted(sym_nodes.items()) if k in todo_syms and n["filePath"] in group
        ]
        write_json(work / f"batch-{i:03d}.json", {
            "instructions": INSTRUCTIONS,
            "answer_file": str(work / f"answer-{i:03d}.json"),
            "answer_format": ANSWER_FORMAT,
            "files": files,
            "symbols": syms,
        })

    if st["project"]["todo"] or not enr.get("project", {}).get("layers"):
        layers = []
        for layer in graph.get("layers", []):
            members = [idx.path_of_file[n] for n in layer["nodeIds"] if n in idx.path_of_file]
            layers.append({"id": layer["id"], "current_name": layer["name"], "files": members[:15],
                           "file_count": len(members)})
        tour = [{"title": t["title"], "description": t["description"]} for t in graph.get("tour", [])]
        write_json(work / "project.json", {
            "instructions": PROJECT_INSTRUCTIONS,
            "answer_file": str(work / "answer-project.json"),
            "answer_format": {
                "description": "…",
                "layers": {"<layer id>": {"name": "…", "description": "…"}},
                "tour": [{"title": "…", "description": "…", "files": ["path/to/file.ext"]}],
            },
            "project_name": graph.get("project", {}).get("name"),
            "layers": layers,
            "key_symbols": sorted(sym_nodes),
            "generated_tour": tour,
        })
        project_task = 1
    else:
        project_task = 0

    print(f"Wrote {len(batches)} batch(es){' + project.json' if project_task else ''} to {work}")
    print(f"  files to summarise: {len(todo_files)}, connections to explain: {len(todo_conns)}, "
          f"key symbols: {len(todo_syms)}")
    if not batches and not project_task:
        print("Nothing to do: everything is explained and up to date.")
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
                "members": task_layers[lid]["files"],
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
                sm = set(s.get("members", []))
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
    p = sub.add_parser("export")
    p.add_argument("project", type=Path)
    p.add_argument("--batch-size", type=int, default=20, help="roughly files per batch (default 20)")
    p = sub.add_parser("apply")
    p.add_argument("project", type=Path)
    args = ap.parse_args(argv)
    root = args.project.resolve()
    if not root.is_dir():
        print(f"error: {root} not found", file=sys.stderr)
        return 2
    if args.cmd == "export":
        return export(root, max(1, args.batch_size))
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
