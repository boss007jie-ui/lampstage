#!/usr/bin/env python3
"""只用显式输入对 Expert 发布包做离线取证；所有输出均为安全摘要。"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import zipfile
from pathlib import Path, PurePosixPath

from validation.fail_closed_evidence import EXPECTED_TOOLS


NAME = "lampstage-creative-expert"
HEX = re.compile(r"[0-9a-fA-F]{64}\Z")
MAX_ARCHIVE = 50 * 1024 * 1024
MAX_MEMBER = 5 * 1024 * 1024
MAX_TOTAL = 50 * 1024 * 1024
MAX_MANIFEST = 1024 * 1024
MAX_ENTRIES = 1000
# 0.10.1 沿用已冻结的原生 HTTPS 连接器；本地桥握手不等于宿主安装验证。
EXPECTED_CONNECTOR_SHA256 = "cc473cd538a3736104af3fef42ffa7c7ffb0cc38f4cceba915c8db202ba1c60f"


class Rejected(Exception):
    pass


def require(condition: bool, code: str) -> None:
    if not condition:
        raise Rejected(code)


def safe_path(value: object) -> bool:
    if (not isinstance(value, str) or len(value) > 512 or "\\" in value or ":" in value
            or any(ord(char) < 32 or ord(char) == 127 for char in value)):
        return False
    parts = PurePosixPath(value).parts
    return bool(parts) and parts[0] == NAME and len(parts) > 1 and all(p not in ("", ".", "..") for p in parts) and value == "/".join(parts)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "invalid_json")
        result[key] = value
    return result


def read_json(path: Path, limit: int) -> object:
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= limit, "invalid_input")
    with path.open("rb") as stream:
        data = stream.read(limit + 1)
    require(len(data) <= limit, "size_limit")
    return json.loads(data.decode("utf-8"), object_pairs_hook=unique_object)


def digest_file(path: Path, limit: int) -> tuple[str, int]:
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= limit, "invalid_input")
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        while data := stream.read(1024 * 1024):
            size += len(data)
            require(size <= limit, "size_limit")
            digest.update(data)
    return digest.hexdigest(), size


def source_files(source: Path) -> dict[str, Path]:
    require(source.is_dir() and not source.is_symlink() and source.name == NAME
            and not (hasattr(source, "is_junction") and source.is_junction()), "invalid_source")
    root = source.resolve(strict=True)
    files = {}
    visited = 0

    def visit(directory, depth=0):
        nonlocal visited
        require(depth <= 32, "size_limit")
        # rglob 会抑制某些扫描错误；显式 scandir 让第一次拒绝直接终止。
        with os.scandir(directory) as entries:
            for entry in entries:
                visited += 1
                require(visited <= MAX_ENTRIES * 4, "size_limit")
                item = Path(entry.path)
                require(not entry.is_symlink() and not (hasattr(item, "is_junction") and item.is_junction()), "unsafe_source")
                require(item.resolve(strict=True).is_relative_to(root), "unsafe_source")
                name = f"{NAME}/{item.relative_to(source).as_posix()}"
                require(safe_path(name), "unsafe_source")
                if entry.is_dir(follow_symlinks=False):
                    visit(item, depth + 1)
                else:
                    require(entry.is_file(follow_symlinks=False), "unsafe_source")
                    require(entry.stat(follow_symlinks=False).st_size <= MAX_MEMBER, "size_limit")
                    files[name] = item
                    require(len(files) <= MAX_ENTRIES, "size_limit")

    visit(source)
    return files


def check_registration(source: Path, paths: set[str], version: str) -> None:
    require(f"{NAME}/.mcp.json" in paths and f"{NAME}/.codebuddy-plugin/plugin.json" in paths, "missing_native_files")
    connector_sha, _ = digest_file(source / ".mcp.json", MAX_MANIFEST)
    require(connector_sha == EXPECTED_CONNECTOR_SHA256, "native_connector_changed")
    plugin = read_json(source / ".codebuddy-plugin/plugin.json", MAX_MANIFEST)
    mcp = read_json(source / ".mcp.json", MAX_MANIFEST)
    require(isinstance(plugin, dict) and plugin.get("name") == NAME and plugin.get("version") == version, "invalid_registration")
    require(plugin.get("dependencies", {}).get("mcpServers") == "./.mcp.json", "invalid_registration")
    require(isinstance(mcp, dict) and isinstance(mcp.get("mcpServers"), dict) and "lampstage" in mcp["mcpServers"], "invalid_registration")
    for field, suffix in (("agents", ""), ("skills", "/SKILL.md")):
        values = plugin.get(field)
        require(isinstance(values, list) and bool(values), "invalid_registration")
        for value in values:
            require(isinstance(value, str) and value.startswith("./"), "invalid_registration")
            name = f"{NAME}/{value[2:]}{suffix}"
            require(safe_path(name) and name in paths, "invalid_registration")


def check_node(node: Path, source: Path, version: str) -> None:
    require(node.is_absolute() and node.is_file(), "node_unavailable")
    script = source / "scripts/lampstage-http.mjs"
    require(script.is_file() and not script.is_symlink(), "missing_script")
    requests = (
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "offline-validator", "version": "1"}}},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
    )
    # 管道按字节捕获；UTF-8 解码在主线程内失败，避免系统 GBK 或后台线程输出原始异常。
    completed = subprocess.run([str(node), str(script)], input=("\n".join(json.dumps(x) for x in requests) + "\n").encode("utf-8"),
                               capture_output=True, timeout=10, shell=False,
                               env={"SystemRoot": os.environ.get("SystemRoot", "")})
    require(type(completed.returncode) is int and completed.returncode == 0 and completed.stderr == b"", "node_failed")
    require(isinstance(completed.stdout, bytes) and len(completed.stdout) <= 1024 * 1024, "node_failed")
    lines = completed.stdout.decode("utf-8").splitlines()
    require(len(lines) == 2, "node_failed")
    responses = [json.loads(line, object_pairs_hook=unique_object) for line in lines]
    for index, response in enumerate(responses, 1):
        require(isinstance(response, dict) and response.get("jsonrpc") == "2.0" and type(response.get("id")) is int and response["id"] == index and "error" not in response and isinstance(response.get("result"), dict), "node_failed")
    require(responses[0]["result"].get("serverInfo", {}).get("version") == version, "node_failed")
    tools = responses[1]["result"].get("tools")
    require(isinstance(tools, list) and len(tools) == len(EXPECTED_TOOLS), "node_failed")
    names = [tool.get("name") if isinstance(tool, dict) else None for tool in tools]
    require(len(set(names)) == len(names) and set(names) == set(EXPECTED_TOOLS), "node_failed")


def validate(archive: Path, source: Path, manifest: Path, expected_sha256: str,
             expected_version: str, node: Path | None = None) -> dict:
    """读取指定本地输入；任何取证或工具异常立即返回失败。"""
    try:
        archive, source, manifest = Path(archive), Path(source), Path(manifest)
        require(isinstance(expected_sha256, str) and bool(HEX.fullmatch(expected_sha256)), "invalid_expected_sha256")
        require(expected_version == "0.10.1", "invalid_expected_version")
        spec = read_json(manifest, MAX_MANIFEST)
        require(isinstance(spec, dict) and spec.get("version") == expected_version and spec.get("archive") == archive.name, "invalid_manifest")
        require(isinstance(spec.get("sha256"), str) and bool(HEX.fullmatch(spec["sha256"])) and spec["sha256"].lower() == expected_sha256.lower(), "hash_mismatch")
        entries = spec.get("entries")
        count = spec.get("entry_count")
        require(isinstance(entries, list) and type(count) is int and 0 < count <= MAX_ENTRIES and len(entries) == count, "invalid_entries")
        expected = {}
        for item in entries:
            require(isinstance(item, dict) and safe_path(item.get("path")) and item["path"] not in expected, "invalid_entries")
            require(isinstance(item.get("sha256"), str) and bool(HEX.fullmatch(item["sha256"])) and type(item.get("bytes")) is int and 0 <= item["bytes"] <= MAX_MEMBER, "invalid_entries")
            expected[item["path"]] = item
        require(sum(item["bytes"] for item in entries) <= MAX_TOTAL, "size_limit")
        actual_sha, _ = digest_file(archive, MAX_ARCHIVE)
        require(actual_sha == expected_sha256.lower(), "hash_mismatch")
        sources = source_files(source)
        require(set(sources) == set(expected), "source_mismatch")
        check_registration(source, set(expected), expected_version)
        with zipfile.ZipFile(archive) as bundle:
            members = bundle.infolist()
            require(len(members) == count, "archive_mismatch")
            seen = set()
            for member in members:
                name = member.filename
                require(safe_path(name) and name not in seen and name in expected and not member.is_dir(), "unsafe_member")
                require(not (member.flag_bits & 1) and not stat.S_ISLNK((member.external_attr >> 16) & 0xffff), "unsafe_member")
                require(member.file_size == expected[name]["bytes"] and member.file_size <= MAX_MEMBER, "archive_mismatch")
                seen.add(name)
                with bundle.open(member) as stream:
                    data = stream.read(MAX_MEMBER + 1)
                    require(len(data) == member.file_size, "archive_mismatch")
                require(hashlib.sha256(data).hexdigest() == expected[name]["sha256"].lower(), "archive_mismatch")
                with sources[name].open("rb") as source_stream:
                    source_data = source_stream.read(MAX_MEMBER + 1)
                require(len(source_data) <= MAX_MEMBER and data == source_data, "source_mismatch")
            require(seen == set(expected), "archive_mismatch")
        selected = Path(node) if node is not None else Path(shutil.which("node") or "")
        check_node(selected, source, expected_version)
        return {"status": "verified", "installed": False, "version": expected_version,
                "entry_count": count, "sha256": actual_sha, "tool_count": len(EXPECTED_TOOLS),
                "handshake": "local_bundled_bridge_only", "online_verified": False,
                "workbuddy_import_verified": False}
    except Rejected as failure:
        return {"status": "failed", "installed": False, "reason": str(failure)}
    except Exception:
        return {"status": "failed", "installed": False, "reason": "evidence_error"}


def main() -> int:
    parser = argparse.ArgumentParser(description="Expert 发布包离线校验；不安装，不处理权限放行")
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--expected-version", required=True)
    parser.add_argument("--node", type=Path)
    args = parser.parse_args()
    result = validate(args.archive, args.source, args.manifest, args.expected_sha256, args.expected_version, args.node)
    print(json.dumps(result, separators=(",", ":")))
    return 0 if result["status"] == "verified" else 1


if __name__ == "__main__":
    sys.exit(main())
