import hashlib
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from edge.receive_jsonl import (
    DEFAULT_PATH,
    SCHEMA_VERSION,
    initialize_database,
    make_handler,
    validate_batch,
)


def record(sequence=0):
    return {
        "schema": SCHEMA_VERSION,
        "device_id": "edge-test-01",
        "source": "rk3576-system-monitor",
        "sequence": sequence,
        "elapsed_s": float(sequence),
        "metrics": {"temp_soc": {"value": 31.5, "unit": "Cel"}},
    }


class ReceiverValidationTests(unittest.TestCase):
    def test_accepts_valid_batch(self):
        body = (json.dumps(record()) + "\n").encode()
        self.assertEqual(len(validate_batch(body)), 1)

    def test_rejects_invalid_json(self):
        with self.assertRaisesRegex(ValueError, "invalid JSON"):
            validate_batch(b"{broken}\n")

    def test_rejects_unknown_schema(self):
        item = record()
        item["schema"] = "unknown"
        with self.assertRaisesRegex(ValueError, "unsupported schema"):
            validate_batch((json.dumps(item) + "\n").encode())

    def test_rejects_nan_metric(self):
        item = record()
        item["metrics"]["temp_soc"]["value"] = float("nan")
        with self.assertRaisesRegex(ValueError, "finite numbers"):
            validate_batch((json.dumps(item) + "\n").encode())

    def test_rejects_invalid_metric_unit(self):
        item = record()
        item["metrics"]["temp_soc"]["unit"] = "%"
        with self.assertRaisesRegex(ValueError, "invalid unit"):
            validate_batch((json.dumps(item) + "\n").encode())

    def test_rejects_unsupported_metric_name(self):
        item = record()
        item["metrics"] = {"voltage": {"value": 5, "unit": "V"}}
        with self.assertRaisesRegex(ValueError, "unsupported metric"):
            validate_batch((json.dumps(item) + "\n").encode())

    def test_rejects_unsupported_source(self):
        item = record()
        item["source"] = "unknown-source"
        with self.assertRaisesRegex(ValueError, "unsupported source"):
            validate_batch((json.dumps(item) + "\n").encode())

    def test_rejects_mixed_device_batch(self):
        second = record(1)
        second["device_id"] = "edge-test-02"
        body = (json.dumps(record()) + "\n" + json.dumps(second) + "\n").encode()
        with self.assertRaisesRegex(ValueError, "one device_id"):
            validate_batch(body)

    def test_rejects_empty_batch(self):
        with self.assertRaisesRegex(ValueError, "no samples"):
            validate_batch(b"\n")


class ReceiverHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.database = str(Path(self.temp_dir.name) / "receiver.sqlite3")
        initialize_database(self.database)
        self.token = "test-receiver-token-long-enough-123"
        self.server = ThreadingHTTPServer(
            ("127.0.0.1", 0), make_handler(self.token, self.database)
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.thread.join, 2)
        self.addCleanup(self.server.shutdown)
        self.url = f"http://127.0.0.1:{self.server.server_port}{DEFAULT_PATH}"

    def post(self, body, token=None, key=None, content_type="application/x-ndjson"):
        headers = {"Content-Type": content_type}
        if token is not None:
            headers["Authorization"] = f"Bearer {token}"
        if key is not None:
            headers["Idempotency-Key"] = key
        request = Request(self.url, data=body, headers=headers, method="POST")
        try:
            response = urlopen(request, timeout=3)
            return response.status, json.loads(response.read())
        except HTTPError as exc:
            return exc.code, json.loads(exc.read())

    def test_accepts_authenticated_batch(self):
        body = (json.dumps(record()) + "\n").encode()
        status, result = self.post(body, self.token, hashlib.sha256(body).hexdigest())
        self.assertEqual(status, 202)
        self.assertEqual(result["samples"], 1)
        self.assertTrue(result["accepted"])

    def test_rejects_bad_token(self):
        body = (json.dumps(record()) + "\n").encode()
        status, result = self.post(body, "wrong-token", hashlib.sha256(body).hexdigest())
        self.assertEqual(status, 401)
        self.assertEqual(result["error"], "unauthorized")

    def test_rejects_wrong_content_type(self):
        body = (json.dumps(record()) + "\n").encode()
        status, _ = self.post(body, self.token, hashlib.sha256(body).hexdigest(), "application/json")
        self.assertEqual(status, 415)

    def test_rejects_idempotency_mismatch(self):
        body = (json.dumps(record()) + "\n").encode()
        status, result = self.post(body, self.token, "0" * 64)
        self.assertEqual(status, 400)
        self.assertEqual(result["error"], "idempotency_key_mismatch")

    def test_duplicate_batch_is_not_inserted_twice(self):
        body = (json.dumps(record()) + "\n").encode()
        key = hashlib.sha256(body).hexdigest()
        first = self.post(body, self.token, key)
        second = self.post(body, self.token, key)
        self.assertEqual(first[0], 202)
        self.assertEqual(second[0], 200)
        self.assertTrue(second[1]["duplicate"])

    def test_unknown_path_returns_404(self):
        request = Request(self.url + "/wrong", data=b"x", method="POST")
        request.add_header("Authorization", f"Bearer {self.token}")
        with self.assertRaises(HTTPError) as raised:
            urlopen(request, timeout=3)
        self.assertEqual(raised.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
