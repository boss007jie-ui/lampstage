import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import validate_expert_release as validator


class OfflineValidatorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.assertTrue(Path(self.temp.name).resolve().is_relative_to(Path(tempfile.gettempdir()).resolve()))
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.source = root / "lampstage-creative-expert"
        files = {
            ".mcp.json": b'{"mcpServers":{"lampstage":{}}}',
            ".codebuddy-plugin/plugin.json": json.dumps({"name": self.source.name, "version": "0.10.1", "agents": ["./agents/expert.md"], "skills": ["./skills/demo"], "dependencies": {"mcpServers": "./.mcp.json"}}).encode(),
            "agents/expert.md": b"agent",
            "skills/demo/SKILL.md": b"skill",
            "scripts/lampstage-http.mjs": b"// fixture",
        }
        for name, data in files.items():
            target = self.source / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        # 合成样例固定自己的连接器摘要；真实入口使用发布基线常量。
        connector_pin = patch.object(validator, "EXPECTED_CONNECTOR_SHA256",
                                     hashlib.sha256(files[".mcp.json"]).hexdigest(), create=True)
        connector_pin.start()
        self.addCleanup(connector_pin.stop)
        self.archive = root / "release.zip"
        with zipfile.ZipFile(self.archive, "w") as bundle:
            for name, data in files.items():
                bundle.writestr(f"{self.source.name}/{name}", data)
        self.digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.manifest = root / "manifest.json"
        self.data = {"version": "0.10.1", "archive": self.archive.name, "sha256": self.digest,
                     "entry_count": len(files), "entries": [{"path": f"{self.source.name}/{name}", "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)} for name, data in files.items()]}
        self.save()
        self.node = root / "node.exe"
        self.node.write_bytes(b"mock")

    def save(self):
        self.manifest.write_text(json.dumps(self.data), encoding="utf-8")

    def run_check(self, **overrides):
        args = dict(archive=self.archive, source=self.source, manifest=self.manifest,
                    expected_sha256=self.digest, expected_version="0.10.1", node=self.node)
        args.update(overrides)
        with patch.object(validator.subprocess, "run", return_value=subprocess.CompletedProcess([], 0,
                json.dumps({"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"version":"0.10.1"}}}) + "\n" +
                json.dumps({"jsonrpc":"2.0","id":2,"result":{"tools":[{"name": n} for n in validator.EXPECTED_TOOLS]}}) + "\n", "")) as run:
            run.return_value.stdout = run.return_value.stdout.encode("utf-8")
            run.return_value.stderr = b""
            result = validator.validate(**args)
        return result, run

    def test_valid_fixture(self):
        result, run = self.run_check()
        self.assertEqual(result["status"], "verified")
        self.assertFalse(result["installed"])
        self.assertEqual(run.call_count, 1)

    def test_hash_and_empty_entries_fail_before_node(self):
        for digest in ("", "0" * 64):
            result, run = self.run_check(expected_sha256=digest)
            self.assertEqual(result["status"], "failed")
            run.assert_not_called()
        self.data["entries"] = []
        self.data["entry_count"] = 0
        self.save()
        result, run = self.run_check()
        self.assertEqual(result["status"], "failed")
        run.assert_not_called()

    def test_duplicate_extra_and_changed_source_fail(self):
        original = list(self.data["entries"])
        for entries in (original + [original[0]], original[:-1]):
            self.data["entries"] = entries
            self.data["entry_count"] = len(entries)
            self.save()
            result, run = self.run_check()
            self.assertEqual(result["status"], "failed")
            run.assert_not_called()
        self.data["entries"] = original
        self.data["entry_count"] = len(original)
        self.save()
        (self.source / "agents/expert.md").write_bytes(b"other")
        result, run = self.run_check()
        self.assertEqual(result["status"], "failed")
        run.assert_not_called()

    def test_duplicate_zip_member_and_crc_fail(self):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(self.archive, "a") as bundle:
                bundle.writestr(f"{self.source.name}/agents/expert.md", b"agent")
        self.digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.data["sha256"] = self.digest
        self.save()
        result, run = self.run_check()
        self.assertEqual(result["status"], "failed")
        run.assert_not_called()

        with zipfile.ZipFile(self.archive, "w", compression=zipfile.ZIP_STORED) as bundle:
            for entry in self.data["entries"]:
                bundle.writestr(entry["path"], (self.source / entry["path"].split("/", 1)[1]).read_bytes())
        with zipfile.ZipFile(self.archive) as bundle:
            header = bundle.getinfo(f"{self.source.name}/agents/expert.md").header_offset
        payload = bytearray(self.archive.read_bytes())
        # 修改成员内容而非文件名，保留中央目录 CRC 来真正触发校验失败。
        position = header + 30 + int.from_bytes(payload[header + 26:header + 28], "little") + int.from_bytes(payload[header + 28:header + 30], "little")
        payload[position] = ord("x")
        self.archive.write_bytes(payload)
        self.digest = hashlib.sha256(payload).hexdigest()
        self.data["sha256"] = self.digest
        self.save()
        result, run = self.run_check()
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["reason"], "evidence_error")
        run.assert_not_called()

    def test_node_fail_closed(self):
        for completed in (subprocess.CompletedProcess([], 0, "", ""),
                          subprocess.CompletedProcess([], None, "", ""),
                          subprocess.CompletedProcess([], False, "", ""),
                          subprocess.CompletedProcess([], True, "", "")):
            with patch.object(validator.subprocess, "run", return_value=completed):
                self.assertEqual(validator.validate(self.archive,self.source,self.manifest,self.digest,"0.10.1",self.node)["status"], "failed")
        for failure in (PermissionError("secret-path"), RuntimeError("secret-url")):
            with patch.object(validator.subprocess, "run", side_effect=failure):
                result = validator.validate(self.archive,self.source,self.manifest,self.digest,"0.10.1",self.node)
            self.assertEqual(result["status"], "failed")
            self.assertNotIn("secret", json.dumps(result))

    def test_same_count_wrong_tool_fails(self):
        names = list(validator.EXPECTED_TOOLS)
        names[-1] = "wrong_tool"
        output = "\n".join((json.dumps({"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"version":"0.10.1"}}}),
                            json.dumps({"jsonrpc":"2.0","id":2,"result":{"tools":[{"name": n} for n in names]}})))
        with patch.object(validator.subprocess,"run",return_value=subprocess.CompletedProcess([],0,output.encode("utf-8"),b"")):
            result = validator.validate(self.archive,self.source,self.manifest,self.digest,"0.10.1",self.node)
        self.assertEqual(result["status"], "failed")

    def test_extra_source_cache_file_cannot_be_silently_skipped(self):
        extra = self.source / "__pycache__/extra.pyc"
        extra.parent.mkdir()
        extra.write_bytes(b"extra")
        result, run = self.run_check()
        self.assertEqual(result["status"], "failed")
        run.assert_not_called()

    def test_changed_native_registration_fails_even_with_updated_archive_hash(self):
        (self.source / ".mcp.json").write_text('{"mcpServers":{"lampstage":{"command":"other"}}}', encoding="utf-8")
        with zipfile.ZipFile(self.archive, "w") as bundle:
            for item in self.data["entries"]:
                data = (self.source / item["path"].split("/", 1)[1]).read_bytes()
                bundle.writestr(item["path"], data)
                item.update(sha256=hashlib.sha256(data).hexdigest(), bytes=len(data))
        self.digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.data["sha256"] = self.digest
        self.save()
        result, run = self.run_check()
        self.assertEqual(result["status"], "failed")
        run.assert_not_called()

    def test_file_read_refusal_stops_without_retry_or_raw_diagnostic(self):
        real_open = Path.open
        denied = []
        target = self.source / "agents/expert.md"

        def guarded_open(path, *args, **kwargs):
            if path == target:
                denied.append(path)
                raise PermissionError("private blocked resource")
            return real_open(path, *args, **kwargs)

        with patch.object(Path, "open", guarded_open):
            result, run = self.run_check()
        self.assertEqual(result["status"], "failed")
        self.assertEqual(denied, [target])
        self.assertNotIn("private", json.dumps(result))
        run.assert_not_called()

    def test_directory_scan_refusal_is_not_suppressed(self):
        with patch.object(validator.os, "scandir", side_effect=PermissionError("private directory")) as scan:
            result, run = self.run_check()
        self.assertEqual(result["status"], "failed")
        self.assertEqual(scan.call_count, 1)
        self.assertNotIn("private", json.dumps(result))
        run.assert_not_called()

    def test_control_character_member_name_is_unsafe(self):
        self.assertFalse(validator.safe_path("lampstage-creative-expert/bad\nname"))

    def test_utf8_handshake_does_not_depend_on_windows_locale(self):
        output = "\n".join((json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"serverInfo": {"version": "0.10.1"}}}),
                            json.dumps({"jsonrpc": "2.0", "id": 2, "result": {"tools": [{"name": n, "description": "明确保留停顿 – 不重复提交"} for n in validator.EXPECTED_TOOLS]}}, ensure_ascii=False)))
        with patch.object(validator.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, output.encode("utf-8"), b"")) as run:
            result = validator.validate(self.archive, self.source, self.manifest, self.digest, "0.10.1", self.node)
        self.assertEqual(result["status"], "verified")
        self.assertIsInstance(run.call_args.kwargs["input"], bytes)
        self.assertNotIn("text", run.call_args.kwargs)
        self.assertEqual(set(run.call_args.kwargs["env"]), {"SystemRoot"})

    def test_invalid_utf8_output_fails_without_exposing_bytes(self):
        with patch.object(validator.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, b"\xff private-output", b"")):
            result = validator.validate(self.archive, self.source, self.manifest, self.digest, "0.10.1", self.node)
        self.assertEqual(result["status"], "failed")
        self.assertNotIn("private", json.dumps(result))


if __name__ == "__main__":
    unittest.main()
