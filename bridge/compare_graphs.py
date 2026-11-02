#!/usr/bin/env python3
"""Compare two Understand-Anything knowledge graphs of the same project.

Typical use: the graph ``/understand`` built (LLM agents) against the one the
bridge built from graphify (tree-sitter, no LLM), to see where they agree and
what each one misses.

    python3 bridge/compare_graphs.py A.json B.json [--labels understand graphify]
                                     [--project DIR] [--out report.md] [--json out.json]

Matching rules (both graphs must use project-relative ``filePath`` values):

* files    match on normalized path
* symbols  (function / class) match on (file path, bare name), where the bare name
           drops a leading ".", a trailing "()", and any "Owner." prefix
* imports  are lifted to file -> file pairs on both sides
* calls    are compared symbol -> symbol, and lifted to file -> file pairs

With ``--project`` pointing at the source tree, each graph's symbol line numbers
are checked against the real file: does the symbol's name appear on (or within a
couple of lines of) the line the graph claims?

Standard library only.
"""

from __future__ import annotations

import argparse
import json
import posixpath
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

CODE_SYMBOL_TYPES = {"function", "class"}
FILE_TYPES = {"file"}
EXAMPLES = 8
LINE_TOLERANCE = 2


def norm_path(p: str | None) -> str | None:
    if not p:
        return None
    p = p.replace("\\", "/")
    while p.startswith("./"):
        p = p[2:]
    return posixpath.normpath(p)


def bare_name(name: str) -> str:
    n = name.strip()
    if n.endswith("()"):
        n = n[:-2]
    n = n.lstrip(".")
    if "." in n:
        n = n.rsplit(".", 1)[1]
    return n


@dataclass
class GraphIndex:
    label: str
    raw: dict[str, Any]
    files: dict[str, dict] = field(default_factory=dict)                    # path -> node
    symbols: dict[tuple[str, str], dict] = field(default_factory=dict)      # (path, name) -> node
    key_of: dict[str, tuple] = field(default_factory=dict)                  # node id -> ("file", p) | ("sym", p, n)
    file_of: dict[str, str] = field(default_factory=dict)                   # node id -> path
    other_types: Counter = field(default_factory=Counter)
    any_named: dict[tuple[str, str], str] = field(default_factory=dict)     # (path, name) -> node type

    @classmethod
    def build(cls, label: str, data: dict[str, Any]) -> "GraphIndex":
        idx = cls(label=label, raw=data)
        for node in data.get("nodes", []):
            nid, ntype = node.get("id"), node.get("type")
            path = norm_path(node.get("filePath"))
            if path:
                idx.file_of[nid] = path
                idx.any_named.setdefault((path, bare_name(node.get("name", ""))), ntype)
            if ntype in FILE_TYPES and path:
                idx.files.setdefault(path, node)
                idx.key_of[nid] = ("file", path)
            elif ntype in CODE_SYMBOL_TYPES and path:
                key = (path, bare_name(node.get("name", "")))
                idx.symbols.setdefault(key, node)
                idx.key_of[nid] = ("sym", *key)
            else:
                idx.other_types[ntype] += 1
        return idx

    def edges(self, etype: str) -> list[tuple[str, str]]:
        return [(e["source"], e["target"]) for e in self.raw.get("edges", []) if e.get("type") == etype]

    def file_pairs(self, *etypes: str) -> set[tuple[str, str]]:
        pairs = set()
        for s, t in (st for et in etypes for st in self.edges(et)):
            fs, ft = self.file_of.get(s), self.file_of.get(t)
            if fs and ft and fs != ft:
                pairs.add((fs, ft))
        return pairs

    def owners(self) -> dict[tuple, tuple]:
        """symbol key -> key of the class that contains it (method -> class)."""
        out: dict[tuple, tuple] = {}
        for s, t in self.edges("contains"):
            ks, kt = self.key_of.get(s), self.key_of.get(t)
            if ks and kt and ks[0] == "sym" and kt[0] == "sym":
                out[kt[1:]] = ks[1:]
        return out

    def symbol_pairs(self, etype: str) -> set[tuple[tuple, tuple]]:
        pairs = set()
        for s, t in self.edges(etype):
            ks, kt = self.key_of.get(s), self.key_of.get(t)
            if ks and kt and ks[0] == "sym" and kt[0] == "sym" and ks != kt:
                pairs.add((ks[1:], kt[1:]))
        return pairs


def split(a: set, b: set) -> tuple[set, set, set]:
    return a & b, a - b, b - a


def pct(n: int, d: int) -> str:
    return f"{(100 * n / d):.0f}%" if d else "n/a"


def jaccard(a: set, b: set) -> str:
    u = a | b
    return f"{len(a & b) / len(u):.2f}" if u else "n/a"


def line_check(idx: GraphIndex, project: Path, keys: set) -> dict[str, int]:
    """How often does a graph's claimed start line actually hold the symbol?"""
    exact = near = wrong = missing = 0
    cache: dict[str, list[str]] = {}
    for key in keys:
        node = idx.symbols[key]
        rng = node.get("lineRange")
        if not rng:
            missing += 1
            continue
        path, name = key
        if path not in cache:
            try:
                cache[path] = (project / path).read_text(encoding="utf-8", errors="replace").splitlines()
            except OSError:
                cache[path] = []
        lines = cache[path]
        start = int(rng[0])
        pattern = re.compile(rf"\b{re.escape(name)}\b")

        def holds(n: int) -> bool:
            return 1 <= n <= len(lines) and bool(pattern.search(lines[n - 1]))

        if holds(start):
            exact += 1
        elif any(holds(start + d) for d in range(-LINE_TOLERANCE, LINE_TOLERANCE + 1)):
            near += 1
        else:
            wrong += 1
    return {"exact": exact, "near": near, "wrong": wrong, "missing": missing}


_IMPORT_LINE = re.compile(r"\b(import|from|require|export)\b")


_PKG_CACHE: dict[tuple[str, str], str | None] = {}


def _workspace_package_name(project: Path, rel: str) -> str | None:
    """Name from the nearest package.json above ``rel`` (inside ``project``), if any."""
    d = posixpath.dirname(rel)
    while True:
        key = (str(project), d)
        if key in _PKG_CACHE:
            return _PKG_CACHE[key]
        pj = project / d / "package.json" if d else project / "package.json"
        name = None
        if pj.is_file():
            try:
                name = json.loads(pj.read_text(encoding="utf-8")).get("name")
            except (OSError, ValueError):
                name = None
            _PKG_CACHE[key] = name
            return name
        if not d:
            _PKG_CACHE[key] = None
            return None
        d = posixpath.dirname(d)


def dependency_in_source(project: Path, src: str, tgt: str, cache: dict[str, list[str]]) -> bool:
    """Heuristic: does ``src`` have an import/export-from line that names ``tgt``?

    Matches the target's file stem (or its folder name for index files) inside a
    quoted module specifier, e.g. ``from "./components/CodeViewer"``.
    """
    if src not in cache:
        try:
            cache[src] = (project / src).read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            cache[src] = []
    tgt_path = posixpath.splitext(tgt)[0]
    stem = posixpath.basename(tgt_path)
    tokens = {stem}
    if stem in {"index", "__init__", "mod"}:
        tokens.add(posixpath.basename(posixpath.dirname(tgt_path)))
    patterns = [re.compile(rf"['\"][^'\"]*\b{re.escape(t)}(\.[a-z]+)?['\"/]") for t in tokens]
    # Monorepo imports through a workspace package name ("@scope/core") resolve to
    # files inside that package, so the package name counts as naming the target.
    pkg = _workspace_package_name(project, tgt)
    if pkg and pkg != _workspace_package_name(project, src):
        patterns.append(re.compile(rf"['\"]{re.escape(pkg)}(/[^'\"]*)?['\"]"))
    joined = []
    for line in cache[src]:
        # keep multi-line `export { ... } from "x"` statements together
        joined.append(line)
        text = " ".join(joined[-6:])
        if ("'" in line or '"' in line) and _IMPORT_LINE.search(text) and any(p.search(line) for p in patterns):
            return True
    return False


def _fmt_pair(p: tuple) -> str:
    a, b = p
    if isinstance(a, tuple):
        return f"`{a[1]}` ({a[0]}) → `{b[1]}` ({b[0]})"
    return f"`{a}` → `{b}`"


def _examples(items, fmt=lambda x: f"`{x}`") -> str:
    items = sorted(items)
    if not items:
        return "none"
    shown = ", ".join(fmt(i) for i in items[:EXAMPLES])
    return shown + (f" … (+{len(items) - EXAMPLES} more)" if len(items) > EXAMPLES else "")


def compare(a: GraphIndex, b: GraphIndex, project: Path | None = None) -> dict[str, Any]:
    A, B = a.label, b.label
    files_both, files_a, files_b = split(set(a.files), set(b.files))
    scope = set(a.files) & set(b.files)

    syms_both, syms_a, syms_b = split(set(a.symbols), set(b.symbols))
    # Symbols in files both graphs cover: a fair "did you find it?" comparison.
    syms_b_in_scope = {k for k in b.symbols if k[0] in scope}
    syms_a_in_scope = {k for k in a.symbols if k[0] in scope}
    kind_mismatch = sorted(
        k for k in syms_both if a.symbols[k].get("type") != b.symbols[k].get("type")
    )

    def in_scope(pairs):
        return {p for p in pairs if p[0] in scope and p[1] in scope}

    imports_a, imports_b = a.file_pairs("imports", "exports"), b.file_pairs("imports", "exports")
    imp_both, imp_a, imp_b = split(in_scope(imports_a), in_scope(imports_b))

    calls_a, calls_b = a.symbol_pairs("calls"), b.symbol_pairs("calls")
    calls_a_s = {p for p in calls_a if p[0][0] in scope and p[1][0] in scope}
    calls_b_s = {p for p in calls_b if p[0][0] in scope and p[1][0] in scope}
    call_both, call_a, call_b = split(calls_a_s, calls_b_s)
    # A call one graph attributes to a class, the other to a method of that class.
    owners_a, owners_b = a.owners(), b.owners()
    lifted_b = {(owners_b.get(x, x), y) for x, y in calls_b_s}
    lifted_a = {(owners_a.get(x, x), y) for x, y in calls_a_s}
    call_a_via_method = {p for p in call_a if p in lifted_b}
    call_b_via_method = {p for p in call_b if (owners_b.get(p[0], p[0]), p[1]) in calls_a_s or p in lifted_a}
    fcall_both, fcall_a, fcall_b = split(in_scope(a.file_pairs("calls")), in_scope(b.file_pairs("calls")))

    result: dict[str, Any] = {
        "labels": [A, B],
        "totals": {
            lbl: {
                "nodes": len(g.raw.get("nodes", [])),
                "edges": len(g.raw.get("edges", [])),
                "files": len(g.files),
                "symbols": len(g.symbols),
                "layers": len(g.raw.get("layers", [])),
                "tour": len(g.raw.get("tour", [])),
                "otherNodeTypes": dict(g.other_types),
                "edgeTypes": dict(Counter(e.get("type") for e in g.raw.get("edges", []))),
            }
            for lbl, g in ((A, a), (B, b))
        },
        "files": {"both": sorted(files_both), f"only_{A}": sorted(files_a), f"only_{B}": sorted(files_b)},
        "symbols": {
            "both": len(syms_both),
            f"only_{A}": sorted(map(list, syms_a)),
            f"only_{A}_found_by_{B}_as_other_kind": {
                f"{k[0]}::{k[1]}": b.any_named[k] for k in sorted(syms_a) if k in b.any_named
            },
            f"only_{B}_in_shared_files": sorted(map(list, syms_b_in_scope - syms_both)),
            f"{B}_recall_of_{A}": f"{len(syms_both & syms_a_in_scope)}/{len(syms_a_in_scope)}",
            "kind_mismatch": [list(k) for k in kind_mismatch],
        },
        "imports_file_level": {"both": sorted(imp_both), f"only_{A}": sorted(imp_a), f"only_{B}": sorted(imp_b),
                               "jaccard": jaccard(in_scope(imports_a), in_scope(imports_b))},
        "calls_symbol_level": {"both": sorted(call_both), f"only_{A}": sorted(call_a), f"only_{B}": sorted(call_b),
                               f"only_{A}_but_{B}_has_it_from_a_method": len(call_a_via_method),
                               f"only_{B}_but_{A}_has_it_on_the_class": len(call_b_via_method)},
        "calls_file_level": {"both": len(fcall_both), f"only_{A}": len(fcall_a), f"only_{B}": len(fcall_b)},
        "layers": {lbl: [l.get("name") for l in g.raw.get("layers", [])] for lbl, g in ((A, a), (B, b))},
        "tour": {lbl: [t.get("title") for t in sorted(g.raw.get("tour", []), key=lambda t: t.get("order", 0))]
                 for lbl, g in ((A, a), (B, b))},
        "summaries": {
            lbl: {
                "avgChars": round(sum(len(n.get("summary", "")) for n in g.raw.get("nodes", []))
                                  / max(1, len(g.raw.get("nodes", [])))),
                "languageLessons": sum(1 for t in g.raw.get("tour", []) if t.get("languageLesson")),
            }
            for lbl, g in ((A, a), (B, b))
        },
    }
    if project:
        cache: dict[str, list[str]] = {}
        result["imports_verified_in_source"] = {
            bucket: f"{sum(dependency_in_source(project, s_, t_, cache) for s_, t_ in pairs)}/{len(pairs)}"
            for bucket, pairs in (("both", imp_both), (f"only_{A}", imp_a), (f"only_{B}", imp_b))
        }
        result["line_accuracy"] = {
            A: line_check(a, project, syms_both),
            B: line_check(b, project, syms_both),
        }
    return result


def render_markdown(r: dict[str, Any], a: GraphIndex, b: GraphIndex) -> str:
    A, B = r["labels"]
    ta, tb = r["totals"][A], r["totals"][B]
    f, s = r["files"], r["symbols"]
    imp, calls, fcalls = r["imports_file_level"], r["calls_symbol_level"], r["calls_file_level"]
    shared = len(f["both"])
    out: list[str] = []
    w = out.append

    w(f"# Graph comparison: `{A}` vs `{B}`\n")
    w(f"Project: **{(a.raw.get('project') or {}).get('name', '?')}**  \n"
      f"{A}: analyzed {(a.raw.get('project') or {}).get('analyzedAt', '?')}, "
      f"commit `{((a.raw.get('project') or {}).get('gitCommitHash') or '?')[:10]}`  \n"
      f"{B}: analyzed {(b.raw.get('project') or {}).get('analyzedAt', '?')}, "
      f"commit `{((b.raw.get('project') or {}).get('gitCommitHash') or '?')[:10]}`\n")

    w("## At a glance\n")
    w(f"| | {A} | {B} |\n|---|---:|---:|")
    for label, key in [("Nodes", "nodes"), ("Edges", "edges"), ("Code files", "files"),
                       ("Functions + classes", "symbols"), ("Layers", "layers"), ("Tour steps", "tour")]:
        w(f"| {label} | {ta[key]} | {tb[key]} |")
    w(f"| Avg. summary length (chars) | {r['summaries'][A]['avgChars']} | {r['summaries'][B]['avgChars']} |")
    w(f"| Tour steps with a language lesson | {r['summaries'][A]['languageLessons']} | "
      f"{r['summaries'][B]['languageLessons']} |")
    other_a = ", ".join(f"{k} {v}" for k, v in sorted(ta["otherNodeTypes"].items())) or "none"
    other_b = ", ".join(f"{k} {v}" for k, v in sorted(tb["otherNodeTypes"].items())) or "none"
    w(f"| Other node types | {other_a} | {other_b} |\n")

    w("## Files\n")
    w(f"- In both: **{shared}**")
    w(f"- Only in {A}: **{len(f[f'only_{A}'])}** — {_examples(f[f'only_{A}'])}")
    w(f"- Only in {B}: **{len(f[f'only_{B}'])}** — {_examples(f[f'only_{B}'])}")
    w(f"\nEverything below is compared **inside the {shared} shared files**, so a graph is not "
      f"penalised for covering more of the project.\n")

    w("## Functions and classes\n")
    w(f"- Found by both: **{s['both']}**")
    w(f"- {B} found {s[f'{B}_recall_of_{A}']} of the symbols {A} lists in shared files")
    other_kind = s[f"only_{A}_found_by_{B}_as_other_kind"]
    w(f"- Only in {A}: **{len(s[f'only_{A}'])}** — "
      f"{_examples([tuple(x) for x in s[f'only_{A}']], lambda k: f'`{k[1]}` ({k[0]})')}")
    w(f"- Only in {B} (shared files): **{len(s[f'only_{B}_in_shared_files'])}** — "
      f"{_examples([tuple(x) for x in s[f'only_{B}_in_shared_files']], lambda k: f'`{k[1]}` ({k[0]})')}")
    if other_kind:
        w(f"  - …of which {B} does have, under another kind: "
          + ", ".join(f"`{k.split('::')[1]}` as {v}" for k, v in sorted(other_kind.items())))
    if s["kind_mismatch"]:
        km = [tuple(x) for x in s["kind_mismatch"]]
        def kinds(k: tuple) -> str:
            return f"`{k[1]}` ({a.symbols[k].get('type')} vs {b.symbols[k].get('type')})"
        w(f"- Same symbol, different kind: {_examples(km, kinds)}")
    w("")

    if "line_accuracy" in r:
        la = r["line_accuracy"]
        w("## Line numbers vs the real source\n")
        w(f"For the {s['both']} symbols found by both, does the graph's start line actually contain "
          f"the symbol's name? (\"near\" = within ±{LINE_TOLERANCE} lines)\n")
        w(f"| | exact | near | wrong | no line |\n|---|---:|---:|---:|---:|")
        for lbl in (A, B):
            x = la[lbl]
            w(f"| {lbl} | {x['exact']} | {x['near']} | {x['wrong']} | {x['missing']} |")
        w("")

    w("## File dependencies: imports + re-exports (file → file, shared files)\n")
    w("Both graphs' `imports` and `exports` edges, lifted to file pairs. (graphify records "
      "`export … from` barrels as re-exports; /understand tends to call them imports.)\n")
    w(f"- Both: **{len(imp['both'])}**, only {A}: **{len(imp[f'only_{A}'])}**, "
      f"only {B}: **{len(imp[f'only_{B}'])}** (Jaccard {imp['jaccard']})")
    if "imports_verified_in_source" in r:
        v = r["imports_verified_in_source"]
        w(f"- Confirmed by an import/export line in the source (heuristic): both {v['both']}, "
          f"only {A} {v[f'only_{A}']}, only {B} {v[f'only_{B}']}")
    w(f"- Only {A}: {_examples([tuple(x) for x in imp[f'only_{A}']], _fmt_pair)}")
    w(f"- Only {B}: {_examples([tuple(x) for x in imp[f'only_{B}']], _fmt_pair)}\n")

    w("## Calls (shared files)\n")
    w(f"- Symbol → symbol: both **{len(calls['both'])}**, only {A} **{len(calls[f'only_{A}'])}**, "
      f"only {B} **{len(calls[f'only_{B}'])}**")
    w(f"  - of the only-{A} calls, {calls[f'only_{A}_but_{B}_has_it_from_a_method']} appear in {B} as the same call "
      f"made from a *method* of that class (different granularity, not a miss)")
    w(f"- Lifted to file → file: both **{fcalls['both']}**, only {A} **{fcalls[f'only_{A}']}**, "
      f"only {B} **{fcalls[f'only_{B}']}**")
    w(f"- Only {A}: {_examples([tuple(map(tuple, x)) for x in calls[f'only_{A}']], _fmt_pair)}")
    w(f"- Only {B}: {_examples([tuple(map(tuple, x)) for x in calls[f'only_{B}']], _fmt_pair)}\n")

    w("## Layers\n")
    for lbl in (A, B):
        w(f"- **{lbl}** ({len(r['layers'][lbl])}): " + (", ".join(r["layers"][lbl]) or "none"))
    w("\n## Tour\n")
    for lbl in (A, B):
        w(f"- **{lbl}:** " + (" → ".join(r["tour"][lbl]) or "none"))
    w("\n## Edge types\n")
    types = sorted(set(ta["edgeTypes"]) | set(tb["edgeTypes"]))
    w(f"| type | {A} | {B} |\n|---|---:|---:|")
    for t in types:
        w(f"| {t} | {ta['edgeTypes'].get(t, 0)} | {tb['edgeTypes'].get(t, 0)} |")
    w("")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("a", type=Path, help="first knowledge-graph.json (e.g. from /understand)")
    ap.add_argument("b", type=Path, help="second knowledge-graph.json (e.g. from the graphify bridge)")
    ap.add_argument("--labels", nargs=2, default=["understand", "graphify"], metavar=("A", "B"))
    ap.add_argument("--project", type=Path, help="source tree, to check line numbers against real files")
    ap.add_argument("--out", type=Path, help="write the Markdown report here (default: stdout)")
    ap.add_argument("--json", type=Path, help="also write the raw comparison as JSON")
    args = ap.parse_args(argv)

    if args.labels[0] == args.labels[1]:
        print("error: --labels must differ", file=sys.stderr)
        return 2
    graphs = []
    for label, path in zip(args.labels, (args.a, args.b)):
        try:
            graphs.append(GraphIndex.build(label, json.loads(path.read_text(encoding="utf-8"))))
        except (OSError, ValueError) as exc:
            print(f"error: cannot read {path}: {exc}", file=sys.stderr)
            return 2
    a, b = graphs
    project = args.project.resolve() if args.project else None
    result = compare(a, b, project)
    report = render_markdown(result, a, b)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(report, encoding="utf-8")
        print(f"Wrote {args.out}")
    else:
        print(report)
    if args.json:
        args.json.write_text(json.dumps(result, indent=2, default=list) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
