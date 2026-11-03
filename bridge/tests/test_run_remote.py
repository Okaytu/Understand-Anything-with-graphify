"""bridge/run.sh with a repository URL instead of a folder (someone else's repo).

Uses a local file:// repository so it needs no network.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
RUN = REPO_ROOT / "bridge" / "run.sh"
CORE_SCHEMA = REPO_ROOT / "understand-anything/understand-anything-plugin/packages/core/dist/schema.js"

pytestmark = pytest.mark.skipif(
    not all(shutil.which(t) for t in ("git", "node", "pnpm", "uv")) or not CORE_SCHEMA.exists(),
    reason="needs git, node, pnpm, uv and a built @understand-anything/core",
)


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", *args], cwd=cwd, check=True,
                   capture_output=True)


def _make_upstream(tmp_path: Path) -> Path:
    src = tmp_path / "upstream" / "shapes-lib"
    (src / "pkg").mkdir(parents=True)
    (src / "pkg" / "shapes.py").write_text("class Shape:\n    def area(self):\n        return 0\n")
    (src / "pkg" / "main.py").write_text("from pkg.shapes import Shape\n\ndef total():\n    return Shape().area()\n")
    _git(src, "init", "-q", "-b", "main")
    _git(src, "add", "-A")
    _git(src, "commit", "-qm", "init")
    return src


def _run(arg: str, repos: Path) -> subprocess.CompletedProcess:
    env = {**os.environ, "UA_REPOS_DIR": str(repos)}
    return subprocess.run(["bash", str(RUN), arg, "--view", "none"], capture_output=True, text=True,
                          env=env, cwd=REPO_ROOT, timeout=600)


def test_url_is_cloned_mapped_and_kept_clean(tmp_path):
    src = _make_upstream(tmp_path)
    repos = tmp_path / "repos"
    result = _run(f"file://{src}", repos)
    assert result.returncode == 0, result.stdout + result.stderr
    clone = repos / str(src).lstrip("/")
    assert f"Your copy is at: {clone}" in result.stdout
    graph = json.loads((clone / ".ua" / "knowledge-graph.json").read_text())
    assert any(n.get("filePath") == "pkg/main.py" for n in graph["nodes"])
    exclude = (clone / ".git" / "info" / "exclude").read_text().splitlines()
    assert "graphify-out/" in exclude and ".ua/" in exclude
    status = subprocess.run(["git", "status", "--short"], cwd=clone, capture_output=True, text=True).stdout
    assert status.strip() == ""  # generated files don't show up as changes

    # running again updates the existing copy instead of cloning twice
    (src / "pkg" / "extra.py").write_text("def extra():\n    return 1\n")
    _git(src, "add", "-A")
    _git(src, "commit", "-qm", "more")
    again = _run(f"file://{src}", repos)
    assert again.returncode == 0, again.stdout + again.stderr
    assert "updating your copy" in again.stdout
    assert (clone / "pkg" / "extra.py").exists()


def test_bad_inputs_are_refused(tmp_path):
    repos = tmp_path / "repos"
    traversal = _run("https://example.invalid/../../etc", repos)
    assert traversal.returncode == 2
    assert "suspicious" in traversal.stderr
    src = _make_upstream(tmp_path)
    # a .../tree/<branch>/<folder> link to a folder that doesn't exist
    missing = _run(f"file://{src}/tree/main/nope", repos)
    assert missing.returncode != 0
