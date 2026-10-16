"""纯内存证据判定；调用者负责取证，本模块不读取文件或执行命令。"""

import json
import re


_SHA256 = re.compile(r"[0-9a-fA-F]{64}\Z")
_VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+\Z")
_MAX_EVIDENCE_CHARS = 100_000
EXPECTED_TOOLS = frozenset([
    "get_account_usage", "list_video_jobs", "cancel_video_job", "close_video_job",
    "list_characters", "get_character", "save_character", "save_character_version",
    "update_character", "list_character_assets", "get_video_delivery", "submit_video_feedback",
    "list_video_templates", "get_video_template", "update_video_template", "health", "capabilities",
    "upload_asset", "upload_local_asset", "create_image_job", "create_video_job", "prepare_video_job",
    "render_video_job", "review_video_segments", "assemble_video_job", "reconcile_video_job",
    "get_job", "download_output",
])


def _result(status, reason, checked):
    """仅返回固定原因码，避免输出路径、stdout 或隐私数据。"""
    return {"status": status, "reason": reason, "checked_steps": checked,
            "installed": False}


def _safe_path(path, prefix):
    """只接受指定包前缀下的普通相对路径。"""
    if not isinstance(path, str) or not path.startswith(prefix):
        return False
    if len(path) > 512 or "\\" in path or ":" in path or "\x00" in path:
        return False
    if any(ord(char) < 32 or ord(char) == 127 for char in path):
        return False
    remainder = path[len(prefix):]
    return bool(remainder) and all(segment not in ("", ".", "..")
                                   for segment in remainder.split("/"))


def _safe_prefix(prefix):
    """前缀本身也必须由安全的相对目录组成。"""
    if not isinstance(prefix, str) or not prefix.endswith("/") or len(prefix) > 256:
        return False
    if "\\" in prefix or ":" in prefix or prefix.startswith("/"):
        return False
    if any(ord(char) < 32 or ord(char) == 127 for char in prefix):
        return False
    return all(segment not in ("", ".", "..")
               for segment in prefix[:-1].split("/"))


def _bounded(value, remaining, depth=0):
    """限制结构化输出的深度与大小，拒绝对象和循环引用。"""
    if depth > 12 or remaining < 1:
        return -1
    kind = type(value)
    if kind is str:
        return remaining - len(value) - 1
    if kind in (int, float, bool) or value is None:
        return remaining - 32
    if kind is dict:
        if len(value) > remaining:
            return -1
        for key, child in value.items():
            if type(key) is not str:
                return -1
            remaining = _bounded(key, remaining - 1, depth + 1)
            remaining = _bounded(child, remaining, depth + 1)
            if remaining < 0:
                return -1
        return remaining
    if kind is list:
        if len(value) > remaining:
            return -1
        for child in value:
            remaining = _bounded(child, remaining - 1, depth + 1)
            if remaining < 0:
                return -1
        return remaining
    return -1


def evaluate_evidence(provide, *, expected_version="0.10.0",
                      package_prefix="lampstage-creative-expert/",
                      expected_entry_count=22,
                      check_version_difference=False):
    """按需索取步骤证据；只有完整、可信且一致时标记 verified。

    provide(step) 应返回 {"exit_code": int, "stdout": dict 或 JSON 对象字符串}。
    此函数只评估调用者提供的证据，不能证明命令曾执行、包安全或安装可行。
    """
    if (not callable(provide) or not isinstance(expected_version, str)
            or not _VERSION.fullmatch(expected_version)
            or not _safe_prefix(package_prefix)
            or type(expected_entry_count) is not int or not 1 <= expected_entry_count <= 1000
            or type(check_version_difference) is not bool):
        return _result("unknown", "invalid_configuration", 0)

    checked = 0

    def read(step, allowed_codes=(0,)):
        nonlocal checked
        try:
            raw = provide(step)
            checked += 1
            if type(raw) is not dict or type(raw.get("exit_code")) is not int:
                return None, "missing_or_invalid_evidence"
            code = raw["exit_code"]
            # 非零普通命令立刻终止，连 stdout 都无需解释。
            if code not in allowed_codes:
                return None, "command_failed"
            stdout = raw.get("stdout")
            if isinstance(stdout, str):
                if not stdout or len(stdout) > _MAX_EVIDENCE_CHARS:
                    return None, "missing_or_invalid_evidence"
                stdout = json.loads(stdout)
            if type(stdout) is not dict or not stdout:
                return None, "missing_or_invalid_evidence"
            if _bounded(stdout, _MAX_EVIDENCE_CHARS) < 0:
                return None, "missing_or_invalid_evidence"
            return (code, stdout), None
        except Exception:
            # 提供器异常、无效 JSON、不可序列化对象均不外泄。
            return None, "missing_or_invalid_evidence"

    def stop(error):
        status = "failed" if error == "command_failed" else "unknown"
        return _result(status, error, checked)

    item, error = read("hashes")
    if error:
        return stop(error)
    hashes = item[1]
    actual, expected = hashes.get("actual_sha256"), hashes.get("expected_sha256")
    if not (isinstance(actual, str) and isinstance(expected, str)
            and _SHA256.fullmatch(actual) and _SHA256.fullmatch(expected)):
        return _result("failed", "invalid_digest", checked)
    if actual.lower() != expected.lower():
        return _result("failed", "digest_mismatch", checked)

    item, error = read("manifest")
    if error:
        return stop(error)
    manifest = item[1]
    source, archive = manifest.get("source_paths"), manifest.get("zip_paths")
    if (type(source) is not list or type(archive) is not list
            or len(source) != expected_entry_count or len(archive) != expected_entry_count
            or not all(_safe_path(path, package_prefix) for path in source + archive)
            or len(set(source)) != expected_entry_count or len(set(archive)) != expected_entry_count
            or set(source) != set(archive)):
        return _result("failed", "manifest_mismatch", checked)

    item, error = read("crc")
    if error:
        return stop(error)
    if item[1].get("passed") is not True:
        return _result("failed", "crc_not_passed", checked)

    for path in source:
        item, error = read("compare:" + path)
        if error:
            return stop(error)
        if item[1].get("result") != "identical":
            return _result("failed", "comparison_not_identical", checked)

    item, error = read("initialize")
    if error:
        return stop(error)
    if item[1].get("version") != expected_version:
        return _result("failed", "version_mismatch", checked)

    item, error = read("tools/list")
    if error:
        return stop(error)
    tool_names = item[1].get("tools")
    if (type(tool_names) is not list or len(tool_names) != 28
            or not all(isinstance(name, str) and bool(name) and len(name) <= 128
                       for name in tool_names)
            or set(tool_names) != EXPECTED_TOOLS):
        return _result("failed", "tool_list_mismatch", checked)

    if check_version_difference:
        # 可选差异步骤放在最后；cmp=1 只代表两版本不同，不放行任何必需步骤。
        item, error = read("version_difference", allowed_codes=(0, 1))
        if error:
            return stop(error)
        code, output = item
        if (code == 0 and output.get("result") != "identical") or (
                code == 1 and output.get("result") != "different"):
            return _result("failed", "invalid_version_difference", checked)

    return _result("verified", "all_evidence_passed", checked)
