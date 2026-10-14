#!/usr/bin/env python3
"""Build a WorkBuddy Expert archive without dropping hidden connector files.

The WorkBuddy helper currently treats root dotfiles as disposable. This
packager uses an explicit file list, validates the connector before creating
the archive, and keeps a top-level directory matching plugin.json.name.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


HERE = Path(__file__).resolve().parent
SOURCE = HERE / "lampstage-creative-expert"
RELEASES = HERE / "releases"


def read_manifest() -> tuple[str, str]:
    manifest_path = SOURCE / ".codebuddy-plugin" / "plugin.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    name = manifest.get("name")
    version = manifest.get("version")
    if not isinstance(name, str) or not name:
        raise SystemExit("plugin.json.name is required")
    if not isinstance(version, str) or not version:
        raise SystemExit("plugin.json.version is required")
    if SOURCE.name != name:
        raise SystemExit(f"source directory {SOURCE.name!r} must match plugin name {name!r}")
    return name, version


def source_files() -> list[Path]:
    files = sorted(
        path
        for path in SOURCE.rglob("*")
        if path.is_file() and ".git" not in path.parts and "__pycache__" not in path.parts
    )
    relative = {path.relative_to(SOURCE).as_posix() for path in files}
    required = {".mcp.json", ".codebuddy-plugin/plugin.json"}
    missing = sorted(required - relative)
    if missing:
        raise SystemExit(f"required package files are missing: {', '.join(missing)}")
    return files


def build() -> tuple[Path, str, int]:
    name, version = read_manifest()
    files = source_files()
    RELEASES.mkdir(parents=True, exist_ok=True)
    archive = RELEASES / f"{name}-{version}.zip"
    with ZipFile(archive, "w", compression=ZIP_DEFLATED) as bundle:
        for path in files:
            relative = path.relative_to(SOURCE).as_posix()
            bundle.write(path, f"{name}/{relative}")

    digest = hashlib.sha256(archive.read_bytes()).hexdigest().upper()
    (RELEASES / f"{name}-{version}.sha256").write_text(
        f"{digest}  {archive.name}\n", encoding="utf-8"
    )
    return archive, digest, len(files)


if __name__ == "__main__":
    archive, digest, count = build()
    print(f"created {archive} ({count} files)")
    print(f"sha256 {digest}")
