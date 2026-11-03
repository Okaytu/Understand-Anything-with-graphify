#!/usr/bin/env python3
"""Convert a graphify ``graph.json`` into an Understand-Anything ``knowledge-graph.json``.

graphify builds its code graph deterministically (tree-sitter AST, no LLM).
Understand-Anything has the richer dashboard (layers, tours, code viewer, search).
This bridge lets you map a project for free with graphify and explore the result
in the Understand-Anything dashboard.

Standard library only, so it runs with any Python >= 3.10.

    python3 bridge/graphify_to_ua.py <project-dir>
    python3 bridge/graphify_to_ua.py <project-dir> --graph path/to/graph.json --out out.json

What maps to what
-----------------
* graphify communities (Leiden clusters)  -> dashboard layers
* graphify confidence (EXTRACTED/INFERRED/AMBIGUOUS) -> edge ``weight`` + ``description``
  and a ``confidence:*`` node tag, so you can still tell read-from-source from inferred
* graphify file / class / callable / rationale / external nodes -> UA node types
* a generated tour: core abstractions first, then subsystems ordered foundations-first
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

BRIDGE_MARKER = "graphify-bridge"
UA_GRAPH_VERSION = "1.0.0"

# graphify relation -> Understand-Anything EdgeType.
EDGE_TYPE_MAP: dict[str, str] = {
    "calls": "calls",
    "contains": "contains",
    "method": "contains",
    "imports": "imports",
    "imports_from": "imports",
    "dynamic_import": "imports",
    "re_exports": "exports",
    "exports": "exports",
    "inherits": "inherits",
    "mixes_in": "inherits",
    "extends": "inherits",
    "implements": "implements",
    "references": "depends_on",
    "uses": "depends_on",
    "depends_on": "depends_on",
    "rationale_for": "documents",
    "documents": "documents",
    "cites": "cites",
    "tests": "tested_by",
    "tested_by": "tested_by",
    "reads": "reads_from",
    "reads_from": "reads_from",
    "writes": "writes_to",
    "writes_to": "writes_to",
    "configures": "configures",
    "similar_to": "similar_to",
    "semantically_similar_to": "similar_to",
}
DEFAULT_EDGE_TYPE = "related"

# Default weight per confidence tag when graphify gives no numeric score.
CONFIDENCE_WEIGHT = {"EXTRACTED": 1.0, "INFERRED": 0.6, "AMBIGUOUS": 0.3}

CONFIG_EXTENSIONS = {".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".env", ".xml"}
DOC_EXTENSIONS = {".md", ".mdx", ".rst", ".txt", ".adoc", ".pdf", ".docx", ".html"}
MEDIA_FILE_TYPES = {"image", "video", "audio"}
DOC_FILE_TYPES = {"document", "paper"}

LANGUAGE_BY_EXTENSION = {
    ".py": "python", ".ts": "typescript", ".tsx": "typescript", ".js": "javascript",
    ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".go": "go",
    ".rs": "rust", ".java": "java", ".kt": "kotlin", ".kts": "kotlin", ".scala": "scala",
    ".rb": "ruby", ".php": "php", ".cs": "csharp", ".c": "c", ".h": "c", ".cpp": "cpp",
    ".cc": "cpp", ".hpp": "cpp", ".swift": "swift", ".m": "objective-c", ".lua": "lua",
    ".dart": "dart", ".ex": "elixir", ".exs": "elixir", ".erl": "erlang", ".hs": "haskell",
    ".clj": "clojure", ".r": "r", ".jl": "julia", ".sh": "shell", ".bash": "shell",
    ".sql": "sql", ".vue": "vue", ".svelte": "svelte", ".zig": "zig", ".nim": "nim",
    ".pas": "pascal", ".ml": "ocaml", ".fs": "fsharp", ".groovy": "groovy", ".tf": "terraform",
}

_LOCATION_RE = re.compile(r"L(\d+)(?:\s*[-:]\s*L?(\d+))?")
_SCREAMING_CASE_RE = re.compile(r"^[A-Z0-9_]+$")

TOUR_SUBSYSTEM_STEPS = 8
TOUR_NODES_PER_STEP = 5


# ---------------------------------------------------------------------------
# Loading graphify output
# ---------------------------------------------------------------------------

def load_graphify_graph(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict) or "nodes" not in data:
        raise ValueError(f"{path} does not look like a graphify graph.json (no 'nodes')")
    return data


def _links(data: dict[str, Any]) -> list[dict[str, Any]]:
    links = data.get("links")
    if links is None:
        links = data.get("edges", [])
    return list(links)


def _arc(link: dict[str, Any]) -> tuple[str, str]:
    """Return (source, target) honouring graphify's direction markers.

    graph.json is written undirected, but arc order is the direction; older
    canonicalized files carry it in ``_src``/``_tgt`` instead (see graphify
    ARCHITECTURE.md, "Edge direction in graph.json").
    """
    src = link.get("_src", link.get("source"))
    tgt = link.get("_tgt", link.get("target"))
    return str(src), str(tgt)


# ---------------------------------------------------------------------------
# Node classification
# ---------------------------------------------------------------------------

def _is_external(node: dict[str, Any]) -> bool:
    return bool(node.get("external")) or node.get("type") in {"external", "module"}


def _is_file_node(node: dict[str, Any]) -> bool:
    source_file = node.get("source_file") or ""
    if not source_file or _is_external(node) or node.get("_callable"):
        return False
    label = str(node.get("label", ""))
    if label == PurePosixPath(source_file).name:
        return True
    # graphify disambiguates same-named files with a path label ("src/types.ts",
    # "parsers/index.ts"): that is still the file node, not a symbol in it.
    return "/" in label and (source_file == label or source_file.endswith("/" + label))


def classify_node(node: dict[str, Any]) -> str:
    """Map a graphify node onto an Understand-Anything NodeType."""
    file_type = node.get("file_type")
    if _is_external(node):
        return "module"
    if file_type == "rationale":
        return "concept"
    if file_type in MEDIA_FILE_TYPES:
        return "resource"
    if file_type in DOC_FILE_TYPES:
        return "document"
    if _is_file_node(node):
        suffix = PurePosixPath(node["source_file"]).suffix.lower()
        if suffix in CONFIG_EXTENSIONS:
            return "config"
        if suffix in DOC_EXTENSIONS:
            return "document"
        return "file"
    if node.get("_callable_class"):
        return "class"
    if node.get("_callable"):
        return "function"
    if file_type == "concept":
        return "concept"
    # Non-callable code symbols: interfaces / type aliases / enums read as types
    # (PascalCase), constants and variables as concepts.
    label = str(node.get("label", ""))
    if label[:1].isupper() and not _SCREAMING_CASE_RE.match(label):
        return "class"
    return "concept"


def display_name(node: dict[str, Any]) -> str:
    label = str(node.get("label") or node.get("id"))
    if node.get("external") and label.startswith("ref_"):
        return label[len("ref_"):]
    return label


def parse_line_range(location: Any) -> list[int] | None:
    if not isinstance(location, str):
        return None
    match = _LOCATION_RE.search(location)
    if not match:
        return None
    start = int(match.group(1))
    end = int(match.group(2)) if match.group(2) else start
    if end < start:
        start, end = end, start
    return [start, end]


def complexity_for(degree: int) -> str:
    if degree <= 4:
        return "simple"
    if degree <= 15:
        return "moderate"
    return "complex"


# ---------------------------------------------------------------------------
# Conversion
# ---------------------------------------------------------------------------

def _git_commit(root: Path) -> str:
    try:
        out = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=10, check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return out.stdout.strip() if out.returncode == 0 else ""


def _plural(n: int, word: str) -> str:
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


def convert(
    data: dict[str, Any],
    *,
    project_name: str,
    git_commit: str = "",
    analyzed_at: str | None = None,
) -> dict[str, Any]:
    """Convert a parsed graphify graph.json dict into an Understand-Anything KnowledgeGraph dict."""
    raw_nodes: list[dict[str, Any]] = [n for n in data.get("nodes", []) if n.get("id") is not None]
    by_id: dict[str, dict[str, Any]] = {str(n["id"]): n for n in raw_nodes}
    node_type: dict[str, str] = {nid: classify_node(n) for nid, n in by_id.items()}

    # --- edges -------------------------------------------------------------
    edges: list[dict[str, Any]] = []
    seen_edges: set[tuple[str, str, str]] = set()
    degree: Counter[str] = Counter()
    out_rel: dict[str, Counter[str]] = defaultdict(Counter)
    in_rel: dict[str, Counter[str]] = defaultdict(Counter)
    node_confidence: dict[str, set[str]] = defaultdict(set)
    unmapped_relations: Counter[str] = Counter()

    def add_edge(src: str, tgt: str, etype: str, weight: float, description: str) -> None:
        key = (src, tgt, etype)
        if src == tgt or key in seen_edges:
            return
        seen_edges.add(key)
        edges.append({
            "source": src,
            "target": tgt,
            "type": etype,
            "direction": "forward",
            "description": description,
            "weight": round(max(0.0, min(1.0, weight)), 3),
        })

    for link in _links(data):
        src, tgt = _arc(link)
        if src not in by_id or tgt not in by_id:
            continue
        relation = str(link.get("relation") or "related")
        etype = EDGE_TYPE_MAP.get(relation)
        if etype is None:
            unmapped_relations[relation] += 1
            etype = DEFAULT_EDGE_TYPE
        confidence = str(link.get("confidence") or "EXTRACTED").upper()
        score = link.get("confidence_score")
        if not isinstance(score, (int, float)):
            score = CONFIDENCE_WEIGHT.get(confidence, 0.5)
        description = f"graphify: {relation} · {confidence}"
        if confidence != "EXTRACTED":
            description += f" (score {float(score):.2f})"
        if link.get("source_location"):
            description += f" · {link['source_location']}"
        add_edge(src, tgt, etype, float(score), description)
        degree[src] += 1
        degree[tgt] += 1
        out_rel[src][relation] += 1
        in_rel[tgt][relation] += 1
        node_confidence[src].add(confidence)
        node_confidence[tgt].add(confidence)

    # Dashboard drill-down expands a layer's *file* nodes into classes/functions
    # through file -> symbol "contains" edges, so make sure every symbol that
    # lives in a known file is reachable that way.
    file_node_by_path: dict[str, str] = {}
    for nid, n in by_id.items():
        if node_type[nid] in {"file", "config", "document"} and _is_file_node(n):
            file_node_by_path.setdefault(n["source_file"], nid)
    file_node_ids = set(file_node_by_path.values())
    parent_file: dict[str, str] = {}
    for nid, n in by_id.items():
        if nid in file_node_ids:
            continue
        fid = file_node_by_path.get(n.get("source_file") or "")
        if fid and not _is_external(n):
            parent_file[nid] = fid
            add_edge(fid, nid, "contains", 1.0, "graphify: defined in file · EXTRACTED")

    # --- god nodes (most connected real symbols) ----------------------------
    symbol_ids = {
        nid for nid in by_id
        if node_type[nid] not in {"file", "config", "document", "module"}
        and by_id[nid].get("file_type") != "rationale"
    }
    god_nodes = sorted(symbol_ids, key=lambda nid: (-degree[nid], nid))[:10]
    god_set = set(god_nodes)

    # --- communities ---------------------------------------------------------
    community_of: dict[str, int] = {}
    community_name: dict[int, str] = {}
    for nid, n in by_id.items():
        cid = n.get("community")
        if isinstance(cid, int):
            community_of[nid] = cid
            if n.get("community_name"):
                cname = str(n["community_name"])
                # graphify can name a community after an external ref node ("ref_vitest").
                if cname.startswith("ref_"):
                    cname = cname[len("ref_"):]
                community_name.setdefault(cid, cname)

    # --- nodes ---------------------------------------------------------------
    nodes: list[dict[str, Any]] = []
    for nid, n in by_id.items():
        ntype = node_type[nid]
        name = display_name(n)
        out_c, in_c = out_rel[nid], in_rel[nid]
        tags = ["graphify"]
        if n.get("file_type"):
            tags.append(str(n["file_type"]))
        if nid in community_of:
            tags.append(f"community:{community_name.get(community_of[nid], community_of[nid])}")
        if n.get("external"):
            tags.append("external")
        if nid in god_set:
            tags.append("god-node")
        for conf in sorted(node_confidence[nid]):
            if conf != "EXTRACTED":
                tags.append(f"confidence:{conf.lower()}")

        node: dict[str, Any] = {
            "id": nid,
            "type": ntype,
            "name": name,
            "summary": _summary(n, ntype, name, out_c, in_c, community_name.get(community_of.get(nid, -1))),
            "tags": tags,
            "complexity": complexity_for(degree[nid]),
        }
        source_file = n.get("source_file")
        if source_file and not _is_external(n):
            node["filePath"] = str(source_file)
            line_range = parse_line_range(n.get("source_location"))
            if line_range and ntype not in {"file", "config", "document"}:
                node["lineRange"] = line_range
        nodes.append(node)

    # --- layers (one per community, holding top-level nodes) ------------------
    top_level = [nid for nid in by_id if nid not in parent_file]
    members: dict[int | None, list[str]] = defaultdict(list)
    for nid in top_level:
        members[community_of.get(nid)].append(nid)

    layers: list[dict[str, Any]] = []
    other: list[str] = list(members.pop(None, []))
    used_names: Counter[str] = Counter()
    for cid, ids in sorted(members.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        if len(ids) < 2:
            other.extend(ids)
            continue
        base = community_name.get(cid, f"Community {cid}")
        used_names[base] += 1
        name = base if used_names[base] == 1 else f"{base} ({used_names[base]})"
        hubs = sorted(
            (nid for nid, c in community_of.items() if c == cid and nid in symbol_ids),
            key=lambda nid: (-degree[nid], nid),
        )[:3]
        files = sum(1 for nid in ids if node_type[nid] in {"file", "config", "document"})
        hub_text = ", ".join(display_name(by_id[h]) for h in hubs) or "n/a"
        layers.append({
            "id": f"layer:graphify-community-{cid}",
            "name": name,
            "description": (
                f"graphify community {cid} ({_plural(files, 'file')}, {_plural(len(ids), 'top-level node')}). "
                f"Most connected: {hub_text}."
            ),
            "nodeIds": sorted(ids),
        })
    if other:
        layers.append({
            "id": "layer:graphify-other",
            "name": "Other",
            "description": "Small or unclustered graphify communities and external dependencies.",
            "nodeIds": sorted(other),
        })

    tour = _build_tour(by_id, node_type, edges, community_of, community_name, god_nodes, degree, layers)

    languages = sorted({
        LANGUAGE_BY_EXTENSION[PurePosixPath(p).suffix.lower()]
        for p in file_node_by_path
        if PurePosixPath(p).suffix.lower() in LANGUAGE_BY_EXTENSION
    })
    gmeta = data.get("graph") or {}
    graphify_version = gmeta.get("graphify_version", "unknown") if isinstance(gmeta, dict) else "unknown"
    confidence_totals = Counter(
        str(link.get("confidence") or "EXTRACTED").upper() for link in _links(data)
    )
    total_links = sum(confidence_totals.values()) or 1
    extracted_pct = round(100 * confidence_totals.get("EXTRACTED", 0) / total_links)

    graph = {
        "version": UA_GRAPH_VERSION,
        "kind": "codebase",
        "project": {
            "name": project_name,
            "languages": languages,
            "frameworks": [],
            "description": (
                f"Generated by graphify {graphify_version} (deterministic tree-sitter AST, no LLM) "
                f"and converted by the learn-code {BRIDGE_MARKER}. "
                f"{len(nodes)} nodes, {len(edges)} edges, {len(layers)} communities; "
                f"{extracted_pct}% of graphify edges are EXTRACTED directly from source."
            ),
            "analyzedAt": analyzed_at or datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "gitCommitHash": git_commit,
        },
        "nodes": nodes,
        "edges": edges,
        "layers": layers,
        "tour": tour,
    }
    if unmapped_relations:
        graph["_bridge"] = {"unmappedRelations": dict(unmapped_relations)}
    return graph


def _summary(
    node: dict[str, Any],
    ntype: str,
    name: str,
    out_c: Counter[str],
    in_c: Counter[str],
    community: str | None,
) -> str:
    """Deterministic one-paragraph summary (graphify has no LLM summaries for code)."""
    kind = {
        "file": "File", "config": "Config file", "document": "Document",
        "class": "Class" if node.get("_callable_class") else "Type",
        "function": "Function", "module": "External module", "concept": "Symbol",
        "resource": "Resource",
    }.get(ntype, ntype.capitalize())
    if node.get("file_type") == "rationale":
        return f"Developer note in {node.get('source_file', 'the source')}: {name}"
    where = ""
    if node.get("source_file") and not _is_external(node) and name != node["source_file"]:
        where = f" in {node['source_file']}"
        loc = parse_line_range(node.get("source_location"))
        if loc and ntype not in {"file", "config", "document"}:
            where += f" (line {loc[0]})"
    parts = [f"{kind} {name}{where}."]
    facts = []
    if out_c.get("calls"):
        facts.append(f"calls {_plural(out_c['calls'], 'symbol')}")
    if in_c.get("calls"):
        facts.append(f"called from {_plural(in_c['calls'], 'place')}")
    imports_out = out_c.get("imports", 0) + out_c.get("imports_from", 0)
    if imports_out:
        facts.append(f"imports {imports_out}")
    imports_in = in_c.get("imports", 0) + in_c.get("imports_from", 0)
    if imports_in:
        facts.append(f"imported by {imports_in}")
    defines = out_c.get("contains", 0) + out_c.get("method", 0)
    if defines:
        facts.append(f"defines {defines}")
    if in_c.get("references"):
        facts.append(f"referenced by {in_c['references']}")
    if facts:
        parts.append("Connections: " + "; ".join(facts) + ".")
    if community:
        parts.append(f"graphify community: {community}.")
    return " ".join(parts)


def _build_tour(
    by_id: dict[str, dict[str, Any]],
    node_type: dict[str, str],
    edges: list[dict[str, Any]],
    community_of: dict[str, int],
    community_name: dict[int, str],
    god_nodes: list[str],
    degree: Counter[str],
    layers: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    tour: list[dict[str, Any]] = []
    if god_nodes:
        names = ", ".join(display_name(by_id[n]) for n in god_nodes[:TOUR_NODES_PER_STEP])
        tour.append({
            "order": 1,
            "title": "Start here: the core abstractions",
            "description": (
                "These are the most connected symbols in the project (graphify's \"god nodes\"). "
                f"Most other code flows through them: {names}."
            ),
            "nodeIds": god_nodes[:TOUR_NODES_PER_STEP],
        })

    # Order communities foundations-first: those other communities depend on most
    # (incoming cross-community dependency edges) come before their dependents.
    dependency_types = {"imports", "calls", "depends_on", "inherits", "implements"}
    incoming: Counter[int] = Counter()
    outgoing: Counter[int] = Counter()
    for e in edges:
        if e["type"] not in dependency_types:
            continue
        cs, ct = community_of.get(e["source"]), community_of.get(e["target"])
        if cs is None or ct is None or cs == ct:
            continue
        if node_type.get(e["target"]) == "module":
            continue
        incoming[ct] += 1
        outgoing[cs] += 1
    layer_cids = []
    for layer in layers:
        lid = layer["id"]
        if lid.startswith("layer:graphify-community-"):
            layer_cids.append(int(lid.rsplit("-", 1)[1]))
    ordered = sorted(layer_cids, key=lambda c: (-(incoming[c] - outgoing[c]), -incoming[c], c))

    for cid in ordered[:TOUR_SUBSYSTEM_STEPS]:
        ids = [
            nid for nid, c in community_of.items()
            if c == cid and node_type[nid] != "module" and by_id[nid].get("file_type") != "rationale"
        ]
        if not ids:
            continue
        top = sorted(ids, key=lambda nid: (-degree[nid], nid))[:TOUR_NODES_PER_STEP]
        files = sorted({by_id[n].get("source_file") for n in ids if by_id[n].get("source_file")})
        file_text = ", ".join(files[:4]) + (f" and {len(files) - 4} more" if len(files) > 4 else "")
        name = community_name.get(cid, f"Community {cid}")
        tour.append({
            "order": len(tour) + 1,
            "title": f"Subsystem: {name}",
            "description": (
                f"A cluster graphify detected around {name}. "
                f"Used by {_plural(incoming[cid], 'dependency edge')} from other subsystems. "
                + (f"Lives in {file_text}." if file_text else "")
            ).strip(),
            "nodeIds": top,
        })

    notes = [nid for nid, n in by_id.items() if n.get("file_type") == "rationale"]
    if notes:
        tour.append({
            "order": len(tour) + 1,
            "title": "Notes the developers left behind",
            "description": (
                "graphify turns NOTE / WHY / TODO comments into nodes. "
                "They explain intent that the code alone does not."
            ),
            "nodeIds": sorted(notes)[:TOUR_NODES_PER_STEP * 2],
        })
    return tour


# ---------------------------------------------------------------------------
# Output location + CLI
# ---------------------------------------------------------------------------

def ua_data_dir(project_root: Path) -> Path:
    """Understand-Anything's data-dir rule: legacy ``.understand-anything/`` if present, else ``.ua/``."""
    legacy = project_root / ".understand-anything"
    return legacy if legacy.is_dir() else project_root / ".ua"


def is_bridge_output(path: Path) -> bool:
    try:
        existing = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    desc = (existing.get("project") or {}).get("description", "") if isinstance(existing, dict) else ""
    return BRIDGE_MARKER in str(desc)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("project", type=Path, help="project directory graphify was run on")
    parser.add_argument("--graph", type=Path, help="graphify graph.json (default <project>/graphify-out/graph.json)")
    parser.add_argument("--out", type=Path, help="output path (default <project>/.ua/knowledge-graph.json)")
    parser.add_argument("--name", help="project name shown in the dashboard (default: folder name)")
    parser.add_argument(
        "--force", action="store_true",
        help="overwrite an existing knowledge-graph.json that was NOT produced by this bridge "
             "(e.g. one built by /understand)",
    )
    args = parser.parse_args(argv)

    project = args.project.resolve()
    if not project.is_dir():
        print(f"error: project directory not found: {project}", file=sys.stderr)
        return 2
    graph_path = (args.graph or project / "graphify-out" / "graph.json").resolve()
    if not graph_path.is_file():
        print(f"error: graphify graph not found: {graph_path}\n"
              f"       run `graphify update {project}` first", file=sys.stderr)
        return 2
    out_path = (args.out or ua_data_dir(project) / "knowledge-graph.json").resolve()
    if out_path.exists() and not args.force and not is_bridge_output(out_path):
        print(f"error: {out_path} already exists and was not created by this bridge\n"
              f"       (probably an /understand graph). Use --out to write elsewhere, "
              f"or --force to overwrite it.", file=sys.stderr)
        return 3

    data = load_graphify_graph(graph_path)
    graph = convert(data, project_name=args.name or project.name, git_commit=_git_commit(project))
    # Re-apply explanations a coding agent wrote earlier with bridge/enrich.py, so a
    # rebuild after code changes keeps them (changed files get flagged as outdated).
    enrich_file = out_path.parent / "enrichments.json"
    if enrich_file.is_file():
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import enrich  # noqa: PLC0415  (same folder; optional feature)

        enrichments = enrich.load_json(enrich_file, None)
        if isinstance(enrichments, dict):
            enrich.apply_enrichments(graph, enrichments, project)
            print(f"  re-applied explanations from {enrich_file}")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_suffix(out_path.suffix + ".tmp")
    tmp.write_text(json.dumps(graph, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(out_path)

    types = Counter(n["type"] for n in graph["nodes"])
    print(f"Wrote {out_path}")
    print(f"  {len(graph['nodes'])} nodes ({', '.join(f'{k} {v}' for k, v in types.most_common())})")
    print(f"  {len(graph['edges'])} edges, {len(graph['layers'])} layers, {len(graph['tour'])} tour steps")
    unmapped = graph.get("_bridge", {}).get("unmappedRelations")
    if unmapped:
        print(f"  note: relations mapped to '{DEFAULT_EDGE_TYPE}': {unmapped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
