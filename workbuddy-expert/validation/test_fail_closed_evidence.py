"""仅用合成证据检查判定器的拒绝与短路行为。"""

import importlib.util
from pathlib import Path
import unittest


SPEC = importlib.util.spec_from_file_location(
    "fail_closed_evidence", Path(__file__).with_name("fail_closed_evidence.py")
)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)
evaluate_evidence = module.evaluate_evidence


def fixture():
    """构造与外部文件、命令和网络无关的完整证据。"""
    paths = [f"package/item-{number:02d}.txt" for number in range(22)]
    tools = [
        "get_account_usage", "list_video_jobs", "cancel_video_job", "close_video_job",
        "list_characters", "get_character", "save_character", "save_character_version",
        "update_character", "list_character_assets", "get_video_delivery", "submit_video_feedback",
        "list_video_templates", "get_video_template", "update_video_template", "health", "capabilities",
        "upload_asset", "upload_local_asset", "create_image_job", "create_video_job", "prepare_video_job",
        "render_video_job", "review_video_segments", "assemble_video_job", "reconcile_video_job",
        "get_job", "download_output",
    ]
    evidence = {
        "hashes": {"exit_code": 0, "stdout": {
            "actual_sha256": "a" * 64, "expected_sha256": "a" * 64,
        }},
        "manifest": {"exit_code": 0, "stdout": {
            "source_paths": paths, "zip_paths": paths[:],
        }},
        "crc": {"exit_code": 0, "stdout": {"passed": True}},
        "initialize": {"exit_code": 0, "stdout": {"version": "0.10.0"}},
        "tools/list": {"exit_code": 0, "stdout": {"tools": tools}},
    }
    for path in paths:
        evidence[f"compare:{path}"] = {
            "exit_code": 0, "stdout": {"result": "identical"}
        }
    return evidence


class FailClosedEvidenceTests(unittest.TestCase):
    def check(self, evidence, **kwargs):
        calls = []

        def provide(step):
            calls.append(step)
            return evidence.get(step)

        kwargs.setdefault("package_prefix", "package/")
        return evaluate_evidence(provide, **kwargs), calls

    def test_complete_fixture_verifies_without_installing(self):
        result, calls = self.check(fixture())
        self.assertEqual(result["status"], "verified")
        self.assertIs(result["installed"], False)
        self.assertEqual(len(calls), 27)

    def test_both_empty_hashes_are_rejected_even_when_equal(self):
        evidence = fixture()
        evidence["hashes"]["stdout"] = {"actual_sha256": "", "expected_sha256": ""}
        result, calls = self.check(evidence)
        self.assertNotEqual(result["status"], "verified")
        self.assertEqual(calls, ["hashes"])

    def test_two_empty_path_sets_are_rejected(self):
        evidence = fixture()
        evidence["manifest"]["stdout"] = {"source_paths": [], "zip_paths": []}
        result, calls = self.check(evidence)
        self.assertNotEqual(result["status"], "verified")
        self.assertEqual(calls, ["hashes", "manifest"])

    def test_cmp_one_cannot_be_misread_as_identical(self):
        evidence = fixture()
        evidence["compare:package/item-00.txt"]["exit_code"] = 1
        result, calls = self.check(evidence)
        self.assertEqual(result["status"], "failed")
        self.assertNotIn("initialize", calls)

    def test_permission_denied_stops_on_each_phase(self):
        for step in ("hashes", "manifest", "crc", "compare:package/item-00.txt", "initialize", "tools/list"):
            with self.subTest(step=step):
                evidence = fixture()
                evidence[step] = {"exit_code": 13, "stdout": "Permission denied"}
                result, calls = self.check(evidence)
                self.assertEqual(result["status"], "failed")
                self.assertEqual(calls[-1], step)
                self.assertNotIn("Permission denied", repr(result))

    def test_missing_invalid_and_empty_evidence_are_unknown(self):
        for value in (None, "{invalid json", {"exit_code": 0, "stdout": ""},
                      {"exit_code": False, "stdout": {"passed": True}}):
            with self.subTest(value=value):
                evidence = fixture()
                evidence["crc"] = value
                result, calls = self.check(evidence)
                self.assertEqual(result["status"], "unknown")
                self.assertEqual(calls[-1], "crc")

    def test_wrong_version_and_tool_count_fail(self):
        evidence = fixture()
        evidence["initialize"]["stdout"]["version"] = "0.9.0"
        self.assertEqual(self.check(evidence)[0]["status"], "failed")
        evidence = fixture()
        evidence["tools/list"]["stdout"]["tools"].pop()
        self.assertEqual(self.check(evidence)[0]["status"], "failed")

    def test_optional_difference_cannot_authorize_other_comparisons(self):
        evidence = fixture()
        evidence["version_difference"] = {"exit_code": 1, "stdout": {"result": "different"}}
        result, _ = self.check(evidence, check_version_difference=True)
        self.assertEqual(result["status"], "verified")
        evidence["compare:package/item-00.txt"]["exit_code"] = 1
        self.assertEqual(self.check(evidence, check_version_difference=True)[0]["status"], "failed")

    def test_oversize_and_unsafe_manifest_are_rejected(self):
        evidence = fixture()
        evidence["hashes"]["stdout"] = "X" * 100_001
        self.assertEqual(self.check(evidence)[0]["status"], "unknown")
        evidence = fixture()
        evidence["manifest"]["stdout"]["source_paths"][0] = "package/../secret"
        self.assertEqual(self.check(evidence)[0]["status"], "failed")

    def test_duplicate_paths_bad_prefix_and_crc_zero_are_rejected(self):
        evidence = fixture()
        evidence["manifest"]["stdout"]["source_paths"][1] = "package/item-00.txt"
        self.assertEqual(self.check(evidence)[0]["status"], "failed")
        self.assertEqual(self.check(fixture(), package_prefix="../package/")[0]["status"], "unknown")
        evidence = fixture()
        evidence["crc"]["stdout"]["passed"] = 0
        self.assertEqual(self.check(evidence)[0]["status"], "failed")

    def test_comparison_error_and_provider_exception_stop(self):
        evidence = fixture()
        evidence["compare:package/item-00.txt"]["exit_code"] = 2
        result, calls = self.check(evidence)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(calls[-1], "compare:package/item-00.txt")

        def provide(step):
            if step == "crc":
                raise PermissionError("secret output")
            return fixture()[step]

        result = evaluate_evidence(provide, package_prefix="package/")
        self.assertEqual(result["status"], "unknown")
        self.assertNotIn("secret output", repr(result))

    def test_tool_rejection_without_standard_fields_stops_immediately(self):
        for refusal in ({"error": "tool blocked: private detail"},
                        {"exit_code": 0}, {"stdout": {"passed": True}}):
            with self.subTest(refusal=refusal):
                evidence = fixture()
                evidence["crc"] = refusal
                result, calls = self.check(evidence)
                self.assertEqual(result["status"], "unknown")
                self.assertIs(result["installed"], False)
                self.assertEqual(calls, ["hashes", "manifest", "crc"])
                self.assertNotIn("private detail", repr(result))

    def test_none_and_false_exit_codes_never_mean_success(self):
        for invalid_code in (None, False):
            with self.subTest(invalid_code=invalid_code):
                evidence = fixture()
                evidence["hashes"]["exit_code"] = invalid_code
                result, calls = self.check(evidence)
                self.assertEqual(result["status"], "unknown")
                self.assertIs(result["installed"], False)
                self.assertEqual(calls, ["hashes"])

    def test_provider_exception_stops_before_next_step_and_hides_detail(self):
        calls = []
        evidence = fixture()

        def provide(step):
            calls.append(step)
            if step == "crc":
                raise RuntimeError("private tool diagnostic")
            return evidence[step]

        result = evaluate_evidence(provide, package_prefix="package/")
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(calls, ["hashes", "manifest", "crc"])
        self.assertNotIn("private tool diagnostic", repr(result))

    def test_expected_version_can_be_changed(self):
        evidence = fixture()
        evidence["initialize"]["stdout"]["version"] = "0.10.1"
        result, _ = self.check(evidence, expected_version="0.10.1")
        self.assertEqual(result["status"], "verified")

    def test_same_tool_count_with_substituted_name_is_rejected(self):
        evidence = fixture()
        evidence["tools/list"]["stdout"]["tools"][-1] = "invented_tool"
        result, _ = self.check(evidence)
        self.assertEqual(result["status"], "failed")

    def test_explicit_manifest_count_can_change_but_never_be_empty(self):
        evidence = fixture()
        paths = evidence["manifest"]["stdout"]
        paths["source_paths"].append("package/item-22.txt")
        paths["zip_paths"].append("package/item-22.txt")
        evidence["compare:package/item-22.txt"] = {
            "exit_code": 0, "stdout": {"result": "identical"}}
        result, _ = self.check(evidence, expected_entry_count=23)
        self.assertEqual(result["status"], "verified")
        for count in (0, -1, False, None):
            result, calls = self.check(evidence, expected_entry_count=count)
            self.assertEqual(result["status"], "unknown")
            self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
