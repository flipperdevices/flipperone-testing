import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from edge.send_jsonl import SCHEMA_VERSION, send_jsonl, validate_jsonl


def sample(sequence=0):
    return {
        "schema": SCHEMA_VERSION,
        "device_id": "edge-test-01",
        "source": "rk3576-system-monitor",
        "sequence": sequence,
        "elapsed_s": float(sequence),
        "metrics": {"temp_soc": {"value": 31.5, "unit": "Cel"}},
    }


class ValidateJsonlTests(unittest.TestCase):
    def test_accepts_valid_records(self):
        content = json.dumps(sample(0)) + "\n" + json.dumps(sample(1)) + "\n"
        self.assertEqual(validate_jsonl(content), 2)

    def test_rejects_malformed_json(self):
        with self.assertRaisesRegex(ValueError, "invalid JSON"):
            validate_jsonl("{broken}\n")

    def test_rejects_unknown_schema(self):
        record = sample()
        record["schema"] = "unknown.v9"
        with self.assertRaisesRegex(ValueError, "unsupported schema"):
            validate_jsonl(json.dumps(record))

    def test_rejects_invalid_sequence(self):
        record = sample()
        record["sequence"] = True
        with self.assertRaisesRegex(ValueError, "sequence"):
            validate_jsonl(json.dumps(record))

    def test_rejects_non_finite_elapsed(self):
        record = sample()
        record["elapsed_s"] = float("nan")
        with self.assertRaisesRegex(ValueError, "elapsed_s"):
            validate_jsonl(json.dumps(record))

    def test_rejects_empty_metrics(self):
        record = sample()
        record["metrics"] = {}
        with self.assertRaisesRegex(ValueError, "metrics"):
            validate_jsonl(json.dumps(record))

    def test_rejects_invalid_metric_unit(self):
        record = sample()
        record["metrics"]["temp_soc"]["unit"] = "%"
        with self.assertRaisesRegex(ValueError, "invalid unit"):
            validate_jsonl(json.dumps(record))

    def test_rejects_non_numeric_metric(self):
        record = sample()
        record["metrics"]["temp_soc"]["value"] = "31.5"
        with self.assertRaisesRegex(ValueError, "finite numbers"):
            validate_jsonl(json.dumps(record))

    def test_rejects_mixed_device_batch(self):
        second = sample(1)
        second["device_id"] = "edge-test-02"
        content = json.dumps(sample()) + "\n" + json.dumps(second)
        with self.assertRaisesRegex(ValueError, "one device_id"):
            validate_jsonl(content)

    def test_rejects_unsupported_source(self):
        record = sample()
        record["source"] = "unknown-source"
        with self.assertRaisesRegex(ValueError, "unsupported source"):
            validate_jsonl(json.dumps(record))


class SendJsonlTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.path = Path(self.temp_dir.name) / "samples.jsonl"
        self.path.write_text(json.dumps(sample()) + "\n", encoding="utf-8")

    def test_posts_jsonl_with_bearer_auth_and_idempotency_key(self):
        response = MagicMock()
        response.status = 202
        response.__enter__.return_value = response
        with patch("edge.send_jsonl.urlopen", return_value=response) as mocked:
            count = send_jsonl(self.path, "https://collector.example/v1/edge/samples", "secret-token")
        self.assertEqual(count, 1)
        request = mocked.call_args.args[0]
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.get_header("Authorization"), "Bearer secret-token")
        self.assertEqual(request.get_header("Content-type"), "application/x-ndjson; charset=utf-8")
        self.assertTrue(request.get_header("Idempotency-key"))

    def test_rejects_plain_http_to_remote_host(self):
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            send_jsonl(self.path, "http://collector.example/ingest", "secret", allow_insecure_loopback=True)

    def test_allows_plain_http_to_loopback_only_when_opted_in(self):
        response = MagicMock()
        response.status = 202
        response.__enter__.return_value = response
        with patch("edge.send_jsonl.urlopen", return_value=response) as mocked:
            self.assertEqual(
                send_jsonl(self.path, "http://127.0.0.1:8080/ingest", "secret",
                           allow_insecure_loopback=True),
                1,
            )
        mocked.assert_called_once()

    def test_rejects_plain_http_without_opt_in(self):
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            send_jsonl(self.path, "http://127.0.0.1:8080/ingest", "secret")

    def test_rejects_url_with_embedded_credentials(self):
        with self.assertRaisesRegex(ValueError, "without credentials"):
            send_jsonl(self.path, "https://user:pass@collector.example/ingest", "secret")

    def test_rejects_batch_over_receiver_limit_before_network_call(self):
        oversized = sample()
        oversized["metrics"] = {"temp_" + ("x" * (1_048_600)): {"value": 1, "unit": "Cel"}}
        self.path.write_text(json.dumps(oversized) + "\n", encoding="utf-8")
        with patch("edge.send_jsonl.urlopen") as mocked:
            with self.assertRaisesRegex(ValueError, "receiver limit"):
                send_jsonl(self.path, "https://collector.example/ingest", "secret")
        mocked.assert_not_called()

    def test_requires_token(self):
        with self.assertRaisesRegex(ValueError, "token is required"):
            send_jsonl(self.path, "https://collector.example/ingest", "")

    def test_empty_file_does_not_make_network_request(self):
        self.path.write_text("", encoding="utf-8")
        with patch("edge.send_jsonl.urlopen") as mocked:
            self.assertEqual(send_jsonl(self.path, "https://collector.example/ingest", "secret"), 0)
        mocked.assert_not_called()


if __name__ == "__main__":
    unittest.main()
