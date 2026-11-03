"""Tests for bridge/enrich.py (agent-written explanations for files and connections).

    cd graphify && uv run pytest ../bridge/tests -q
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

BRIDGE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BRIDGE_DIR))

import enrich  # noqa: E402
import graphify_to_ua as bridge  # noqa: E402


@pytest.fixture()
def project(tmp_path: Path) -> Path:
    pytest.importorskip("graphify")
    root = tmp_path / "proj"
    (root / "pkg").mkdir(parents=True)
    (root / "pkg" / "shapes.py").write_text(
        "class Shape:\n"
        "    def area(self):\n"
        "        return 0\n\n"
        "class Square(Shape):\n"
        "    def __init__(self, side):\n"
        "        self.side = side\n\n"
        "    def area(self):\n"
        "        return self.side * self.side\n"
    )
    (root / "pkg" / "main.py").write_text(
        "import json\n"
        "from pkg.shapes import Square\n\n"
        "def total(sides):\n"
        "    return sum(Square(s).area() for s in sides)\n\n"
        "def report(sides):\n"
        "    return json.dumps({'total': total(sides)})\n"
    )
    subprocess.run([sys.executable, "-m", "graphify", "update", str(root)],
                   check=True, capture_output=True, text=True, cwd=root)
    assert bridge.main([str(root)]) == 0
    return root


def _answer_everything(root: Path) -> None:
    work = root / ".ua" / "enrich"
    for batch_path in sorted(work.glob("batch-*.json")):
        batch = json.loads(batch_path.read_text())
        answer = {
            "files": {f["path"]: {"summary": f"About {f['path']}.", "tags": ["demo"]} for f in batch["files"]},
            "connections": {c["key"]: f"Why {c['from']} uses {c['to']}." for f in batch["files"] for c in f["connections"]},
            "symbols": {s["key"]: f"What {s['name']} does." for s in batch["symbols"]},
        }
        Path(batch["answer_file"]).write_text(json.dumps(answer))
    project_task = work / "project.json"
    if project_task.exists():
        task = json.loads(project_task.read_text())
        Path(task["answer_file"]).write_text(json.dumps({
            "description": "A tiny shapes project.",
            "layers": {l["id"]: {"name": f"Group {i}", "description": "d"} for i, l in enumerate(task["layers"])},
            "tour": [{"title": "Start", "description": "Begin with the shapes.", "files": ["pkg/shapes.py"]}],
        }))


def _status(root: Path) -> dict:
    graph = json.loads((root / ".ua" / "knowledge-graph.json").read_text())
    enr = enrich.load_json(root / ".ua" / "enrichments.json", enrich.empty_enrichments())
    return enrich.compute_status(root, graph, enr)


def test_export_lists_files_and_connections(project):
    st = _status(project)
    assert set(st["files"]["missing"]) == {"pkg/main.py", "pkg/shapes.py"}
    assert "pkg/main.py -> pkg/shapes.py" in st["connections"]["missing"]
    assert enrich.main(["status", str(project), "--check"]) == 1
    assert enrich.export(project, 20) == 0
    batch = json.loads((project / ".ua" / "enrich" / "batch-001.json").read_text())
    main_entry = next(f for f in batch["files"] if f["path"] == "pkg/main.py")
    conn = next(c for c in main_entry["connections"] if c["to"] == "pkg/shapes.py")
    assert any("Square" in v for v in conn["via"])
    assert (project / ".ua" / "enrich" / "project.json").exists()


def test_apply_writes_explanations_into_the_graph(project):
    enrich.export(project, 20)
    _answer_everything(project)
    assert enrich.apply(project) == 0
    assert enrich.main(["status", str(project), "--check"]) == 0
    assert not (project / ".ua" / "enrich").exists()  # work folder cleaned up
    graph = json.loads((project / ".ua" / "knowledge-graph.json").read_text())
    by_id = {n["id"]: n for n in graph["nodes"]}
    main_file = next(n for n in graph["nodes"] if n.get("filePath") == "pkg/main.py" and n["type"] == "file")
    assert main_file["summary"] == "About pkg/main.py."
    assert "explained" in main_file["tags"] and "demo" in main_file["tags"]
    # every edge between the two files carries the explanation
    idx = enrich.GraphIndex(graph)
    pair = idx.pairs()[("pkg/main.py", "pkg/shapes.py")]
    assert all(e["description"] == "Why pkg/main.py uses pkg/shapes.py." for e in pair["edges"])
    assert any(l["name"].startswith("Group") for l in graph["layers"])
    assert graph["tour"][0]["title"] == "Start"
    assert graph["project"]["description"].startswith("A tiny shapes project.")
    assert bridge.BRIDGE_MARKER in graph["project"]["description"]  # overwrite protection still works
    assert by_id  # sanity


def test_rebuild_keeps_explanations_and_flags_changed_files(project):
    enrich.export(project, 20)
    _answer_everything(project)
    enrich.apply(project)
    (project / "pkg" / "shapes.py").write_text((project / "pkg" / "shapes.py").read_text() + "\n# changed\n")
    assert bridge.main([str(project)]) == 0  # what bridge/run.sh does on a rebuild
    graph = json.loads((project / ".ua" / "knowledge-graph.json").read_text())
    shapes = next(n for n in graph["nodes"] if n.get("filePath") == "pkg/shapes.py" and n["type"] == "file")
    assert shapes["summary"] == "About pkg/shapes.py."
    assert "explanation-outdated" in shapes["tags"]
    st = _status(project)
    assert st["files"]["outdated"] == ["pkg/shapes.py"]
    assert st["files"]["missing"] == []
    assert graph["tour"][0]["title"] == "Start"
    # export only asks again for what changed
    enrich.export(project, 20)
    batch = json.loads((project / ".ua" / "enrich" / "batch-001.json").read_text())
    needs = [f["path"] for f in batch["files"] if f["needs_summary"]]
    assert needs == ["pkg/shapes.py"]


def test_apply_rejects_unknown_keys_and_empty_text(project):
    enrich.export(project, 20)
    work = project / ".ua" / "enrich"
    batch = json.loads((work / "batch-001.json").read_text())
    Path(batch["answer_file"]).write_text(json.dumps({
        "files": {"../../etc/passwd": {"summary": "nope"}, "pkg/main.py": {"summary": "   "}},
        "connections": {"made -> up": "x"},
    }))
    assert enrich.apply(project) == 0
    enr = json.loads((project / ".ua" / "enrichments.json").read_text())
    assert enr["files"] == {} and enr["connections"] == {}


def test_long_text_is_trimmed():
    assert len(enrich.clean_text("x" * 5000, enrich.MAX_WHY)) == enrich.MAX_WHY
    assert enrich.clean_text("  a   b ", 50) == "a b"
    assert enrich.clean_text(42, 50) is None
