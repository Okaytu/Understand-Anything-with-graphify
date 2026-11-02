"""Tests for learn-from-zero/learn.py.

    cd graphify && uv run pytest ../learn-from-zero/tests -q
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parents[1]
REPO_ROOT = HERE.parent
sys.path.insert(0, str(HERE))

import learn  # noqa: E402

EXAMPLE = HERE / "examples" / "how-a-business-works"
VALIDATOR = REPO_ROOT / "bridge" / "validate_ua_graph.mjs"
CORE_SCHEMA = REPO_ROOT / "understand-anything/understand-anything-plugin/packages/core/dist/schema.js"


def test_init_creates_a_filled_in_wiki(tmp_path):
    root = tmp_path / "w"
    assert learn.main(["init", str(root), "How ships float"]) == 0
    for rel in ["CLAUDE.md", "wiki/index.md", "wiki/log.md", "wiki/Start Here.md", "raw/README.md"]:
        text = (root / rel).read_text()
        assert "{{" not in text, rel
    assert "How ships float" in (root / "wiki" / "index.md").read_text()
    assert ".ua/" in (root / ".gitignore").read_text()
    assert learn.main(["init", str(root), "again"]) == 2  # refuses a non-empty dir


def test_new_note_updates_index_and_log(tmp_path):
    root = tmp_path / "w"
    learn.main(["init", str(root), "Topic"])
    assert learn.main(["new", str(root), "Buoyancy", "--category", "Foundations",
                       "--summary", "the upward push of a fluid", "--link", "Density"]) == 0
    assert learn.main(["new", str(root), "Hull Design", "--category", "Engineering"]) == 0
    note = (root / "wiki" / "Buoyancy.md").read_text()
    assert note.startswith("# Buoyancy\n") and "[[Density]]" in note
    index = (root / "wiki" / "index.md").read_text()
    # added under the existing section, before the new one
    assert index.index("[[Buoyancy]]") < index.index("## Engineering") < index.index("[[Hull Design]]")
    assert "- [[Buoyancy]] — the upward push of a fluid" in index
    log = (root / "wiki" / "log.md").read_text()
    assert "Added [[Buoyancy]] (Foundations)." in log and "Added [[Hull Design]]" in log
    assert learn.main(["new", str(root), "buoyancy", "--category", "X"]) == 2  # duplicate (case-insensitive)
    with pytest.raises(SystemExit):
        learn.main(["new", str(root), "../escape", "--category", "X"])


def test_next_lists_unwritten_links_most_linked_first(tmp_path):
    root = tmp_path / "w"
    learn.main(["init", str(root), "Topic"])
    learn.main(["new", str(root), "A", "--category", "C", "--link", "Shared", "--link", "Only A"])
    learn.main(["new", str(root), "B", "--category", "C", "--link", "Shared"])
    missing = learn.next_to_learn(root)
    assert missing[0] == ("Shared", 2)
    titles = [t for t, _ in missing]
    assert "Only A" in titles and "A" not in titles and "First Concept" in titles


def test_example_next_to_learn():
    assert [t for t, _ in learn.next_to_learn(EXAMPLE)] == ["Competitors", "Hiring", "Taxes"]


def test_build_uses_understand_anythings_wiki_pipeline(tmp_path):
    root = tmp_path / "biz"
    shutil.copytree(EXAMPLE, root)
    assert learn.main(["build", str(root)]) == 0
    graph = json.loads((root / ".ua" / "knowledge-graph.json").read_text())
    assert graph["kind"] == "knowledge"
    types = {n["type"] for n in graph["nodes"]}
    assert {"article", "topic"} <= types
    assert sum(1 for n in graph["nodes"] if n["type"] == "article") == 13
    assert [l["name"] for l in graph["layers"]][:4] == ["Foundations", "Money", "Operations", "Growth"]
    assert not (root / ".ua" / "intermediate").exists()
    assert json.loads((root / ".ua" / "meta.json").read_text())["analyzedFiles"] == 13
    # rebuilding over its own knowledge graph is fine; a code graph is protected
    assert learn.main(["build", str(root)]) == 0
    (root / ".ua" / "knowledge-graph.json").write_text(json.dumps({"kind": "codebase"}))
    with pytest.raises(SystemExit):
        learn.main(["build", str(root)])
    assert learn.main(["build", str(root), "--force"]) == 0

    if shutil.which("node") and CORE_SCHEMA.exists():
        result = subprocess.run(["node", str(VALIDATOR), str(root / ".ua" / "knowledge-graph.json")],
                                capture_output=True, text=True)
        assert result.returncode == 0, result.stdout + result.stderr
