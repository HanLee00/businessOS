from __future__ import annotations

import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from easyparcel_cli.cli import load_env, main, update_env


class CliTests(unittest.TestCase):
    def test_missing_oauth_token_fails_without_a_traceback(self):
        stdout = StringIO()
        stderr = StringIO()
        with patch.dict(os.environ, {}, clear=True), redirect_stdout(stdout), redirect_stderr(stderr):
            code = main(["--env-file", "/does/not/exist", "shipments"])
        self.assertEqual(code, 1)
        self.assertEqual(stdout.getvalue(), "")
        self.assertEqual(json.loads(stderr.getvalue())["error"], "EASYPARCEL_ACCESS_TOKEN is required")

    def test_load_env_does_not_override_existing_values(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text("ONE=file\nTWO=second\n", encoding="utf-8")
            with patch.dict(os.environ, {"ONE": "environment"}, clear=True):
                load_env(path)
                self.assertEqual(os.environ["ONE"], "environment")
                self.assertEqual(os.environ["TWO"], "second")

    def test_invalid_date_is_reported_as_json(self):
        stdout = StringIO()
        stderr = StringIO()
        with patch.dict(
            os.environ, {"EASYPARCEL_ACCESS_TOKEN": "not-printed"}, clear=True
        ), redirect_stdout(stdout), redirect_stderr(stderr):
            code = main(
                [
                    "--env-file",
                    "/does/not/exist",
                    "costs",
                    "--from",
                    "bad-date",
                    "--to",
                    "2026-09-01",
                ]
            )
        self.assertEqual(code, 1)
        self.assertNotIn("not-printed", stderr.getvalue())
        self.assertIn("YYYY-MM-DD", json.loads(stderr.getvalue())["error"])

    def test_update_env_replaces_and_appends_without_leaking_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text("KEEP=value\nTOKEN=old\n", encoding="utf-8")
            update_env(path, {"TOKEN": "new", "REFRESH": "secret"})
            self.assertEqual(
                path.read_text(encoding="utf-8"),
                "KEEP=value\nTOKEN=new\n\nREFRESH=secret\n",
            )
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
