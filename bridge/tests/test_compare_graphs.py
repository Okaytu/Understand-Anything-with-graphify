"""Tests for bridge/compare_graphs.py."""

from __future__ import annotations

import json
import sys
from pathlib import Path

BRIDGE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BRIDGE_DIR))

import compare_graphs as cg  # noqa: E402


def node(nid, ntype, name, path, line=None):
    n = {"id": nid, "type": ntype, "name": name, "filePath": path, "summary": "", "tags": [],
         "complexity": "simple"}
    if line:
        n["lineRange"] = [line, line + 3]
    return n


def edge(s, t, etype):
    return {"source": s, "target": t, "type": etype, "direction": "forward", "weight": 1}


def graph(nodes, edges, layers=(), tour=()):
    return {"version": "1.0.0", "project": {"name": "p"}, "nodes": nodes, "edges": edges,
            "layers": list(layers), "tour": list(tour)}


def test_bare_name_and_paths():
    assert cg.bare_name(".run()") == "run"
    assert cg.bare_name("Engine.search") == "search"
    assert cg.bare_name("helper") == "helper"
    assert cg.norm_path("./src//a.ts") == "src/a.ts"


def make_pair(tmp_path: Path):
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "a.ts").write_text(
        'import { b } from "./b";\n'
        "export class Engine {\n"
        "  run() { return helper(); }\n"
        "}\n"
        "function helper() { return b(); }\n"
    )
    (tmp_path / "src" / "b.ts").write_text("export function b() { return 1; }\n")
    a = graph(
        [node("f:a", "file", "a.ts", "src/a.ts"), node("f:b", "file", "b.ts", "src/b.ts"),
         node("c:Engine", "class", "Engine", "src/a.ts", 2),
         node("fn:helper", "function", "helper", "src/a.ts", 9),  # wrong line on purpose
         node("fn:b", "function", "b", "src/b.ts", 1)],
        [edge("f:a", "f:b", "imports"), edge("c:Engine", "fn:helper", "calls")],
        layers=[{"id": "l1", "name": "Core", "description": "", "nodeIds": ["f:a"]}],
        tour=[{"order": 1, "title": "Intro", "description": "", "nodeIds": ["f:a"], "languageLesson": "x"}],
    )
    b = graph(
        [node("a", "file", "a.ts", "src/a.ts"), node("b", "file", "b.ts", "src/b.ts"),
         node("x", "file", "x.ts", "src/x.ts"),
         node("Engine", "class", "Engine", "src/a.ts", 2),
         node("run", "function", ".run()", "src/a.ts", 3),
         node("helper", "function", "helper()", "src/a.ts", 5),
         node("bfn", "function", "b()", "src/b.ts", 1)],
        [edge("a", "b", "exports"), edge("Engine", "run", "contains"),
         edge("run", "helper", "calls"), edge("helper", "bfn", "calls")],
    )
    return cg.GraphIndex.build("understand", a), cg.GraphIndex.build("graphify", b)


def test_compare_counts(tmp_path):
    a, b = make_pair(tmp_path)
    r = cg.compare(a, b, tmp_path)
    assert r["files"]["only_graphify"] == ["src/x.ts"]
    assert r["files"]["only_understand"] == []
    assert r["symbols"]["both"] == 3
    assert r["symbols"]["graphify_recall_of_understand"] == "3/3"
    # imports vs re-exports are the same file dependency
    assert r["imports_file_level"]["both"] == [("src/a.ts", "src/b.ts")]
    assert r["imports_verified_in_source"]["both"] == "1/1"
    # class-level call in A == method-level call in B
    calls = r["calls_symbol_level"]
    assert calls["only_understand"] == [(("src/a.ts", "Engine"), ("src/a.ts", "helper"))]
    assert calls["only_understand_but_graphify_has_it_from_a_method"] == 1
    assert r["calls_file_level"]["only_graphify"] == 1  # helper -> b crosses files
    # line check: A's helper line is wrong, B's is exact
    assert r["line_accuracy"]["understand"]["wrong"] == 1
    assert r["line_accuracy"]["graphify"]["exact"] == 3
    assert r["summaries"]["understand"]["languageLessons"] == 1


def test_render_and_cli(tmp_path):
    a, b = make_pair(tmp_path)
    md = cg.render_markdown(cg.compare(a, b, tmp_path), a, b)
    assert "# Graph comparison: `understand` vs `graphify`" in md
    assert "Line numbers vs the real source" in md
    pa, pb = tmp_path / "a.json", tmp_path / "b.json"
    pa.write_text(json.dumps(a.raw))
    pb.write_text(json.dumps(b.raw))
    out = tmp_path / "report.md"
    assert cg.main([str(pa), str(pb), "--project", str(tmp_path), "--out", str(out),
                    "--json", str(tmp_path / "r.json")]) == 0
    assert out.read_text().startswith("# Graph comparison")
    assert json.loads((tmp_path / "r.json").read_text())["labels"] == ["understand", "graphify"]


def test_workspace_package_imports_count_as_dependencies(tmp_path):
    (tmp_path / "packages" / "core" / "src").mkdir(parents=True)
    (tmp_path / "packages" / "app" / "src").mkdir(parents=True)
    (tmp_path / "packages" / "core" / "package.json").write_text('{"name": "@demo/core"}')
    (tmp_path / "packages" / "app" / "package.json").write_text('{"name": "@demo/app"}')
    (tmp_path / "packages" / "core" / "src" / "types.ts").write_text("export type T = 1;\n")
    (tmp_path / "packages" / "app" / "src" / "main.ts").write_text('import type { T } from "@demo/core";\n')
    cache: dict = {}
    assert cg.dependency_in_source(tmp_path, "packages/app/src/main.ts", "packages/core/src/types.ts", cache)
    assert not cg.dependency_in_source(tmp_path, "packages/core/src/types.ts", "packages/app/src/main.ts", cache)
