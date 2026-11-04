"""Tests for bridge/explain_html.py (the explain panel added to graphify's graph.html).

    cd graphify && uv run pytest ../bridge/tests/test_explain_html.py -q
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

BRIDGE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BRIDGE_DIR))

import explain_html  # noqa: E402

NODES = [
    {"id": "a", "label": "a.py", "source_file": "pkg/a.py", "file_type": "code", "community_name": "pkg", "degree": 1},
    {"id": "b", "label": "b.py", "source_file": "pkg/b.py", "file_type": "code", "community_name": "pkg", "degree": 1},
]
EDGES = [{"from": "a", "to": "b", "label": "imports"}]
PAGE = (
    "<html><body><script>\n"
    f"const RAW_NODES = {json.dumps(NODES)};\n"
    f"const RAW_EDGES = {json.dumps(EDGES)};\n"
    "</script></body></html>\n"
)


@pytest.fixture()
def project(tmp_path: Path) -> Path:
    root = tmp_path / "proj"
    (root / "pkg").mkdir(parents=True)
    (root / "graphify-out").mkdir()
    (root / "graphify-out" / "graph.html").write_text(PAGE, encoding="utf-8")
    (root / "pkg" / "a.py").write_text("import b\nprint('</script><b>x</b>')\n", encoding="utf-8")
    (root / "pkg" / "b.py").write_text("X = 1\n", encoding="utf-8")
    (root / ".env").write_text("TOKEN=hunter2\n", encoding="utf-8")
    return root


def page(root: Path) -> str:
    return (root / "graphify-out" / "graph.html").read_text(encoding="utf-8")


def test_inject_is_idempotent_and_keeps_the_page(project: Path) -> None:
    assert explain_html.inject(project) == 0
    assert explain_html.inject(project) == 0
    html = page(project)
    assert html.count(explain_html.START) == 1 and html.count(explain_html.END) == 1
    assert "const RAW_NODES" in html and html.rstrip().endswith("</html>")


def test_works_without_enrichments_and_uses_the_folder_name(project: Path) -> None:
    payload = explain_html.build_payload(project, page(project))
    assert payload["name"] == "proj" and payload["files"] == {} and payload["tour"] == []


def test_enrichments_are_embedded(project: Path) -> None:
    (project / ".ua").mkdir()
    (project / ".ua" / "enrichments.json").write_text(json.dumps({
        "files": {"pkg/a.py": {"summary": "Does A.", "tags": ["core"]}},
        "connections": {"pkg/a.py -> pkg/b.py": {"why": "A needs B."}},
        "symbols": {},
        "project": {"description": "A tiny project.", "layers": [{"name": "pkg", "description": "All of it"}],
                    "tour": [{"title": "Start", "description": "Here", "files": ["pkg/a.py"]}]},
    }), encoding="utf-8")
    payload = explain_html.build_payload(project, page(project))
    assert payload["files"]["pkg/a.py"]["s"] == "Does A."
    assert payload["why"]["pkg/a.py -> pkg/b.py"] == "A needs B."
    assert payload["overview"] == "A tiny project." and payload["tour"][0]["files"] == ["pkg/a.py"]


def test_secrets_are_never_embedded(project: Path) -> None:
    nodes = NODES + [{"id": "e", "label": ".env", "source_file": ".env", "file_type": "code"}]
    html = page(project).replace(json.dumps(NODES), json.dumps(nodes))
    payload = explain_html.build_payload(project, html)
    assert ".env" not in payload["code"] and "pkg/a.py" in payload["code"]


def test_source_code_cannot_break_out_of_the_script_tag(project: Path) -> None:
    (project / "pkg" / "b.py").write_text("X = '<!-- <script>'\n", encoding="utf-8")
    assert explain_html.inject(project) == 0
    block = page(project).split(explain_html.START)[1].split(explain_html.END)[0]
    data = block.split("window.__UA_EXPLAIN__=")[1].split(";</script>")[0]
    # no raw "<" survives in the data, so "</script>", "<!--" and "<script" from source are inert
    assert "<" not in data and "\\u003c/script>" in data and "\\u003c!--" in data
    assert json.loads(data)["code"]["pkg/a.py"].count("</script>") == 1


def test_refuses_a_page_it_does_not_understand(project: Path) -> None:
    (project / "graphify-out" / "graph.html").write_text("<html>no body end", encoding="utf-8")
    assert explain_html.inject(project) == 1
    assert page(project) == "<html>no body end"
    shutil.rmtree(project / "graphify-out")
    assert explain_html.inject(project) == 2


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_generated_javascript_is_valid(project: Path, tmp_path: Path) -> None:
    assert explain_html.inject(project) == 0
    scripts = re.findall(r"<script>(.*?)</script>", page(project).split(explain_html.START)[1], re.S)
    js = tmp_path / "panel.js"
    js.write_text(scripts[-1], encoding="utf-8")
    result = subprocess.run(["node", "--check", str(js)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_only_files_inside_the_project_are_embedded(project: Path, tmp_path: Path) -> None:
    outside = tmp_path / "outside.txt"
    outside.write_text("private notes\n", encoding="utf-8")
    nodes = NODES + [
        {"id": "o1", "label": "outside.txt", "source_file": "../outside.txt", "file_type": "code"},
        {"id": "o2", "label": "outside.txt", "source_file": str(outside), "file_type": "code"},
    ]
    (project / "pkg" / "link.py").symlink_to(outside)
    nodes.append({"id": "o3", "label": "link.py", "source_file": "pkg/link.py", "file_type": "code"})
    html = page(project).replace(json.dumps(NODES), json.dumps(nodes))
    code = explain_html.build_payload(project, html)["code"]
    assert "pkg/a.py" in code
    assert not any("private notes" in text for text in code.values())


def test_files_holding_credentials_are_never_embedded(project: Path) -> None:
    (project / "pkg" / "a.py").write_text("-----BEGIN PRIVATE KEY-----\nMIIE...\n", encoding="utf-8")
    (project / "pkg" / "b.py").write_text('stripe = "sk_live_' + "a" * 24 + '"\n', encoding="utf-8")
    code = explain_html.build_payload(project, page(project))["code"]
    assert "pkg/a.py" not in code and "pkg/b.py" not in code


def test_files_with_repeated_names_are_still_files(project: Path) -> None:
    nodes = [
        {"id": "i1", "label": "x/index.ts", "source_file": "src/x/index.ts", "file_type": "code"},
        {"id": "i2", "label": "y/index.ts", "source_file": "src/y/index.ts", "file_type": "code"},
        {"id": "f1", "label": "run()", "source_file": "src/x/index.ts", "file_type": "code"},
    ]
    html = page(project).replace(json.dumps(NODES), json.dumps(nodes))
    ids = explain_html.build_payload(project, html)["fileIds"]
    assert ids == {"src/x/index.ts": "i1", "src/y/index.ts": "i2"}


def test_falls_back_to_the_dashboard_graph_without_explanations(project: Path) -> None:
    (project / ".ua").mkdir()
    (project / ".ua" / "knowledge-graph.json").write_text(json.dumps({
        "project": {"description": "Notes about cafés.\n\nGenerated by graphify 1.0 (no LLM)."},
        "nodes": [
            {"id": "a", "type": "article", "filePath": "pkg/a.py", "summary": "What food costs.", "tags": ["money"]},
            {"id": "f", "type": "function", "filePath": "pkg/a.py", "lineRange": [1, 2], "summary": "not a file"},
        ],
        "layers": [{"name": "Money", "description": "Costs", "nodeIds": ["a"]}],
        "tour": [{"order": 1, "title": "Start", "description": "Begin", "nodeIds": ["a"]}],
    }), encoding="utf-8")
    payload = explain_html.build_payload(project, page(project))
    assert payload["files"] == {"pkg/a.py": {"s": "What food costs.", "t": ["money"]}}
    assert payload["overview"] == "Notes about cafés."
    assert payload["groups"] == [{"name": "Money", "description": "Costs"}]
    assert payload["tour"] == [{"title": "Start", "description": "Begin", "files": ["pkg/a.py"]}]


def test_ordinary_files_about_passwords_are_still_embedded(project: Path) -> None:
    (project / "pkg" / "set-password.py").write_text("def change(): ...\n", encoding="utf-8")
    nodes = NODES + [{"id": "p", "label": "set-password.py", "source_file": "pkg/set-password.py", "file_type": "code"}]
    html = page(project).replace(json.dumps(NODES), json.dumps(nodes))
    assert "pkg/set-password.py" in explain_html.build_payload(project, html)["code"]


def test_wiki_notes_match_graphify_paths_and_outside_libraries_are_not_files(project: Path) -> None:
    (project / "wiki").mkdir()
    (project / "wiki" / "Revenue.md").write_text("# Revenue\n", encoding="utf-8")
    nodes = NODES + [
        {"id": "r", "label": "Revenue.md", "source_file": "wiki/Revenue.md", "file_type": "document"},
        {"id": "jspdf", "label": "jspdf", "source_file": "jspdf", "file_type": "code"},
    ]
    html = page(project).replace(json.dumps(NODES), json.dumps(nodes))
    (project / "graphify-out" / "graph.json").write_text(json.dumps({"nodes": [
        {"id": "jspdf", "label": "jspdf", "source_file": "jspdf", "type": "module"},
    ]}), encoding="utf-8")
    (project / ".ua").mkdir()
    (project / ".ua" / "knowledge-graph.json").write_text(json.dumps({
        "project": {"description": "A wiki."},
        "nodes": [{"id": "n", "type": "article", "filePath": "Revenue.md", "summary": "Money customers pay."}],
        "layers": [], "tour": [{"title": "Money", "description": "", "nodeIds": ["n"]}],
    }), encoding="utf-8")
    payload = explain_html.build_payload(project, html)
    assert payload["files"] == {"wiki/Revenue.md": {"s": "Money customers pay.", "t": []}}
    assert payload["tour"][0]["files"] == ["wiki/Revenue.md"]
    assert "jspdf" not in payload["fileIds"] and payload["fileIds"]["wiki/Revenue.md"] == "r"


def test_big_projects_get_a_note_instead_of_wrong_answers(project: Path) -> None:
    grouped = [{"id": "c0", "label": "auth", "member_count": 120}, {"id": "c1", "label": "ui", "member_count": 80}]
    html = page(project).replace(json.dumps(NODES), json.dumps(grouped))
    (project / "graphify-out" / "graph.html").write_text(html, encoding="utf-8")
    assert explain_html.inject(project) == 0
    block = page(project).split(explain_html.START)[1].split(explain_html.END)[0]
    assert "one dot per group" in block and "__UA_EXPLAIN__" not in block
    assert not (project / "graphify-out" / "graph.html.tmp").exists()


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_panel_logic_runs_on_a_project(project: Path) -> None:
    nodes = NODES + [{"id": "c", "label": "cache.py", "source_file": "pkg/cache.py", "file_type": "code", "community_name": "pkg"}]
    edges = EDGES + [{"from": "c", "to": "b", "label": "calls"}]
    (project / "pkg" / "cache.py").write_text("import b\n", encoding="utf-8")
    html = page(project).replace(json.dumps(NODES), json.dumps(nodes)).replace(json.dumps(EDGES), json.dumps(edges))
    (project / "graphify-out" / "graph.html").write_text(html, encoding="utf-8")
    assert explain_html.inject(project) == 0
    check = Path(__file__).with_name("panel_check.mjs")
    result = subprocess.run(["node", str(check), str(project / "graphify-out" / "graph.html"), "where is the cache kept?"],
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    out = json.loads(result.stdout)
    assert out["clicked"] == "b.py"                                   # the most depended-on file
    assert out["impact"].startswith("2 pieces in 2 other files depend on this")
    assert out["ask"][:1] == ["cache.py"]
    assert "Uses (0)" in out["panelHeadings"] and "Used by (2)" in out["panelHeadings"]
