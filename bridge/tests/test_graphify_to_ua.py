"""Tests for bridge/graphify_to_ua.py.

Run from the repo root with graphify's environment (it already has pytest):

    uv run --project graphify pytest bridge/tests -q

The end-to-end test runs real graphify on a tiny project and checks the result
with Understand-Anything's own validateGraph(); it is skipped when graphify,
node, or the built core package is not available.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

BRIDGE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BRIDGE_DIR.parent
sys.path.insert(0, str(BRIDGE_DIR))

import graphify_to_ua as bridge  # noqa: E402


def _node(nid, label, source_file="", loc=None, **extra):
    node = {"id": nid, "label": label, "source_file": source_file, "file_type": "code"}
    if loc:
        node["source_location"] = loc
    node.update(extra)
    return node


def _link(src, tgt, relation, confidence="EXTRACTED", **extra):
    return {"source": src, "target": tgt, "relation": relation, "confidence": confidence, **extra}


@pytest.fixture()
def sample_graph() -> dict:
    nodes = [
        _node("app", "app.py", "src/app.py", "L1", community=0, community_name="App"),
        _node("svc", "service.py", "src/service.py", "L1", community=0, community_name="App"),
        _node("types_file", "src/types.ts", "src/types.ts", "L1", community=1, community_name="Types"),
        _node("cfg", "settings.yaml", "settings.yaml", "L1", community=1, community_name="Types"),
        _node("App", "App", "src/app.py", "L5", _callable=True, _callable_class=True,
              community=0, community_name="App"),
        _node("run", ".run()", "src/app.py", "L9", _callable=True, community=0, community_name="App"),
        _node("helper", "helper()", "src/service.py", "L3", _callable=True, community=0, community_name="App"),
        _node("Shape", "Shape", "src/types.ts", "L2", community=1, community_name="Types"),
        _node("MAX", "MAX_SIZE", "src/types.ts", "L7", community=1, community_name="Types"),
        _node("note", "WHY: keep this sync", "src/service.py", "L2", file_type="rationale",
              community=0, community_name="App"),
        {"id": "ref_requests", "label": "ref_requests", "source_file": "", "file_type": "concept",
         "external": True, "type": "external", "community": 0, "community_name": "App"},
        {"id": "img", "label": "diagram.png", "source_file": "docs/diagram.png", "file_type": "image",
         "community": 1, "community_name": "Types"},
    ]
    links = [
        _link("App", "run", "method"),
        _link("run", "helper", "calls"),
        # stored in "wrong" arc order but carries the direction marker
        _link("svc", "app", "imports", _src="app", _tgt="svc"),
        _link("app", "types_file", "imports_from"),
        _link("helper", "Shape", "references", confidence="INFERRED", confidence_score=0.8),
        _link("svc", "ref_requests", "imports_from"),
        _link("note", "helper", "rationale_for"),
        _link("App", "Shape", "some_new_relation", confidence="AMBIGUOUS"),
    ]
    return {"directed": False, "graph": {"graphify_version": "9.9.9"}, "nodes": nodes, "links": links}


def _by_id(graph):
    return {n["id"]: n for n in graph["nodes"]}


def _edge_set(graph):
    return {(e["source"], e["target"], e["type"]) for e in graph["edges"]}


# --- classification ----------------------------------------------------------

def test_node_types(sample_graph):
    nodes = _by_id(bridge.convert(sample_graph, project_name="demo"))
    assert nodes["app"]["type"] == "file"
    assert nodes["types_file"]["type"] == "file"  # path-style label is still the file
    assert nodes["cfg"]["type"] == "config"
    assert nodes["App"]["type"] == "class"
    assert nodes["run"]["type"] == "function"
    assert nodes["Shape"]["type"] == "class"  # PascalCase non-callable = type
    assert nodes["MAX"]["type"] == "concept"  # SCREAMING_CASE constant
    assert nodes["note"]["type"] == "concept"
    assert nodes["ref_requests"]["type"] == "module"
    assert nodes["img"]["type"] == "resource"


def test_node_fields(sample_graph):
    nodes = _by_id(bridge.convert(sample_graph, project_name="demo"))
    run = nodes["run"]
    assert run["filePath"] == "src/app.py"
    assert run["lineRange"] == [9, 9]
    assert "lineRange" not in nodes["app"]  # files have no single line
    assert nodes["ref_requests"]["name"] == "requests"
    assert "filePath" not in nodes["ref_requests"]
    assert "community:App" in run["tags"]
    assert "confidence:inferred" in nodes["Shape"]["tags"]
    assert nodes["App"]["summary"].startswith("Class App in src/app.py (line 5).")
    assert nodes["note"]["summary"].startswith("Developer note")
    for n in nodes.values():
        assert n["complexity"] in {"simple", "moderate", "complex"}
        assert isinstance(n["summary"], str) and n["summary"]


def test_parse_line_range():
    assert bridge.parse_line_range("L12") == [12, 12]
    assert bridge.parse_line_range("L12-L20") == [12, 20]
    assert bridge.parse_line_range("L20-12") == [12, 20]
    assert bridge.parse_line_range(None) is None
    assert bridge.parse_line_range("nowhere") is None


# --- edges -------------------------------------------------------------------

def test_edge_mapping_and_direction(sample_graph):
    graph = bridge.convert(sample_graph, project_name="demo")
    edges = _edge_set(graph)
    assert ("App", "run", "contains") in edges  # method -> contains
    assert ("run", "helper", "calls") in edges
    assert ("app", "svc", "imports") in edges  # _src/_tgt wins over arc order
    assert ("svc", "app", "imports") not in edges
    assert ("app", "types_file", "imports") in edges
    assert ("helper", "Shape", "depends_on") in edges
    assert ("note", "helper", "documents") in edges
    assert ("App", "Shape", "related") in edges  # unknown relation falls back
    assert graph["_bridge"]["unmappedRelations"] == {"some_new_relation": 1}


def test_confidence_becomes_weight_and_description(sample_graph):
    graph = bridge.convert(sample_graph, project_name="demo")
    by_key = {(e["source"], e["target"], e["type"]): e for e in graph["edges"]}
    inferred = by_key[("helper", "Shape", "depends_on")]
    assert inferred["weight"] == 0.8
    assert "INFERRED" in inferred["description"]
    ambiguous = by_key[("App", "Shape", "related")]
    assert ambiguous["weight"] == bridge.CONFIDENCE_WEIGHT["AMBIGUOUS"]
    assert by_key[("run", "helper", "calls")]["weight"] == 1.0
    for e in graph["edges"]:
        assert 0.0 <= e["weight"] <= 1.0
        assert e["direction"] == "forward"


def test_symbols_are_contained_by_their_file(sample_graph):
    edges = _edge_set(bridge.convert(sample_graph, project_name="demo"))
    for sym, fid in [("App", "app"), ("run", "app"), ("helper", "svc"), ("Shape", "types_file")]:
        assert (fid, sym, "contains") in edges
    assert not any(t == "ref_requests" and k == "contains" for _, t, k in edges)


def test_edges_reference_existing_nodes(sample_graph):
    sample_graph["links"].append(_link("run", "does_not_exist", "calls"))
    graph = bridge.convert(sample_graph, project_name="demo")
    ids = {n["id"] for n in graph["nodes"]}
    assert all(e["source"] in ids and e["target"] in ids for e in graph["edges"])


# --- layers, tour, project ------------------------------------------------------

def test_layers_hold_top_level_nodes(sample_graph):
    graph = bridge.convert(sample_graph, project_name="demo")
    names = {layer["name"] for layer in graph["layers"]}
    assert {"App", "Types"} <= names
    in_layers = {nid for layer in graph["layers"] for nid in layer["nodeIds"]}
    assert {"app", "svc", "types_file", "cfg"} <= in_layers
    assert "run" not in in_layers  # reached by drilling into its file
    assert "helper" not in in_layers


def test_tour(sample_graph):
    graph = bridge.convert(sample_graph, project_name="demo")
    tour = graph["tour"]
    assert [s["order"] for s in tour] == list(range(1, len(tour) + 1))
    assert tour[0]["title"] == "Start here: the core abstractions"
    assert tour[-1]["title"] == "Notes the developers left behind"
    assert "note" in tour[-1]["nodeIds"]
    ids = {n["id"] for n in graph["nodes"]}
    assert all(nid in ids for step in tour for nid in step["nodeIds"])


def test_project_meta(sample_graph):
    graph = bridge.convert(sample_graph, project_name="demo", git_commit="abc123",
                           analyzed_at="2026-01-01T00:00:00+00:00")
    project = graph["project"]
    assert project["name"] == "demo"
    assert project["gitCommitHash"] == "abc123"
    assert project["languages"] == ["python", "typescript"]
    assert "graphify 9.9.9" in project["description"]
    assert bridge.BRIDGE_MARKER in project["description"]
    assert graph["kind"] == "codebase"


# --- CLI / output location --------------------------------------------------------

def _write_graphify_output(project: Path, data: dict) -> None:
    out = project / "graphify-out"
    out.mkdir(parents=True)
    (out / "graph.json").write_text(json.dumps(data))


def test_cli_writes_to_ua_dir(tmp_path, sample_graph):
    _write_graphify_output(tmp_path, sample_graph)
    assert bridge.main([str(tmp_path)]) == 0
    written = json.loads((tmp_path / ".ua" / "knowledge-graph.json").read_text())
    assert written["project"]["name"] == tmp_path.name
    assert bridge.main([str(tmp_path)]) == 0  # re-running over its own output is fine


def test_cli_prefers_legacy_data_dir(tmp_path, sample_graph):
    _write_graphify_output(tmp_path, sample_graph)
    (tmp_path / ".understand-anything").mkdir()
    assert bridge.main([str(tmp_path)]) == 0
    assert (tmp_path / ".understand-anything" / "knowledge-graph.json").is_file()
    assert not (tmp_path / ".ua").exists()


def test_cli_protects_existing_understand_graph(tmp_path, sample_graph):
    _write_graphify_output(tmp_path, sample_graph)
    existing = tmp_path / ".ua" / "knowledge-graph.json"
    existing.parent.mkdir()
    existing.write_text(json.dumps({"project": {"description": "built by /understand"}}))
    assert bridge.main([str(tmp_path)]) == 3
    assert "built by /understand" in existing.read_text()
    assert bridge.main([str(tmp_path), "--force"]) == 0
    assert bridge.BRIDGE_MARKER in existing.read_text()


def test_cli_missing_graph(tmp_path):
    assert bridge.main([str(tmp_path)]) == 2


# --- end to end: real graphify -> bridge -> Understand-Anything validator ------------

CORE_SCHEMA = REPO_ROOT / "understand-anything/understand-anything-plugin/packages/core/dist/schema.js"


@pytest.mark.skipif(shutil.which("node") is None or not CORE_SCHEMA.exists(),
                    reason="needs node and a built @understand-anything/core")
def test_end_to_end_with_real_graphify(tmp_path):
    pytest.importorskip("graphify")
    project = tmp_path / "tinyproj"
    (project / "pkg").mkdir(parents=True)
    (project / "pkg" / "shapes.py").write_text(
        "class Shape:\n"
        "    def area(self):\n"
        "        return 0\n\n"
        "class Square(Shape):\n"
        "    def __init__(self, side):\n"
        "        self.side = side\n\n"
        "    def area(self):\n"
        "        return self.side * self.side\n"
    )
    (project / "pkg" / "main.py").write_text(
        "from pkg.shapes import Square\n\n"
        "def total(sides):\n"
        "    # WHY: squares only for now, circles come later\n"
        "    return sum(Square(s).area() for s in sides)\n"
    )
    subprocess.run([sys.executable, "-m", "graphify", "update", str(project)],
                   check=True, capture_output=True, text=True, cwd=project)
    assert bridge.main([str(project)]) == 0
    out = project / ".ua" / "knowledge-graph.json"
    result = subprocess.run(["node", str(BRIDGE_DIR / "validate_ua_graph.mjs"), str(out)],
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
    graph = json.loads(out.read_text())
    names = {n["name"]: n["type"] for n in graph["nodes"]}
    assert names.get("Square") == "class"
    assert names.get("main.py") == "file"
