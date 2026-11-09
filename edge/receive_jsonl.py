#!/usr/bin/env python3
"""Minimal authenticated SQLite receiver for NEURAL LINK EDGE JSONL batches.

For production, place this service behind a TLS reverse proxy and restrict network
access. The built-in HTTP server is intended for local development and testing.
"""

import argparse
import hmac
import json
import math
import os
import sqlite3
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SCHEMA_VERSION = "neural-link.edge.sample.v1"
DEFAULT_PATH = "/v1/edge/samples"
MAX_BODY_BYTES = 1_048_576


def validate_batch(body: bytes):
    """Decode and validate a complete JSONL batch before storing any records."""
    try:
        content = body.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("body must be UTF-8") from exc
    records = []
    for line_number, line in enumerate(content.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"line {line_number}: invalid JSON") from exc
        if not isinstance(record, dict):
            raise ValueError(f"line {line_number}: sample must be an object")
        if record.get("schema") != SCHEMA_VERSION:
            raise ValueError(f"line {line_number}: unsupported schema")
        device_id = record.get("device_id")
        if not isinstance(device_id, str) or not device_id.strip():
            raise ValueError(f"line {line_number}: device_id is required")
        sequence = record.get("sequence")
        if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 0:
            raise ValueError(f"line {line_number}: sequence must be a non-negative integer")
        elapsed = record.get("elapsed_s")
        if isinstance(elapsed, bool) or not isinstance(elapsed, (int, float)) or not math.isfinite(elapsed) or elapsed < 0:
            raise ValueError(f"line {line_number}: elapsed_s must be finite and non-negative")
        metrics = record.get("metrics")
        if not isinstance(metrics, dict) or not metrics:
            raise ValueError(f"line {line_number}: metrics must be a non-empty object")
        for name, metric in metrics.items():
            if not isinstance(name, str) or not isinstance(metric, dict):
                raise ValueError(f"line {line_number}: invalid metric")
            value = metric.get("value")
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError(f"line {line_number}: metric values must be finite numbers")
            if not isinstance(metric.get("unit"), str):
                raise ValueError(f"line {line_number}: metric unit must be a string")
        records.append(record)
    if not records:
        raise ValueError("batch contains no samples")
    return records


def initialize_database(database: str):
    with sqlite3.connect(database) as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS batches (
                idempotency_key TEXT PRIMARY KEY,
                received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                sample_count INTEGER NOT NULL
            )
        """)
        connection.execute("""
            CREATE TABLE IF NOT EXISTS samples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_key TEXT NOT NULL REFERENCES batches(idempotency_key),
                device_id TEXT NOT NULL,
                sequence INTEGER NOT NULL,
                payload_json TEXT NOT NULL
            )
        """)
        connection.execute(
            "CREATE INDEX IF NOT EXISTS samples_device_sequence ON samples(device_id, sequence)"
        )


def store_batch(database: str, idempotency_key: str, records):
    """Persist batch and samples in one transaction; return False for replay."""
    with sqlite3.connect(database, timeout=10) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            connection.execute(
                "INSERT INTO batches(idempotency_key, sample_count) VALUES (?, ?)",
                (idempotency_key, len(records)),
            )
        except sqlite3.IntegrityError:
            return False
        connection.executemany(
            "INSERT INTO samples(batch_key, device_id, sequence, payload_json) VALUES (?, ?, ?, ?)",
            [
                (idempotency_key, record["device_id"], record["sequence"],
                 json.dumps(record, separators=(",", ":"), allow_nan=False))
                for record in records
            ],
        )
        return True


def make_handler(token: str, database: str, endpoint_path: str = DEFAULT_PATH):
    class ReceiverHandler(BaseHTTPRequestHandler):
        server_version = "NeuralLinkReceiver/1.0"

        def _json(self, status, payload):
            encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(encoded)

        def do_POST(self):
            if self.path != endpoint_path:
                self._json(404, {"error": "not_found"})
                return
            authorization = self.headers.get("Authorization", "")
            expected = "Bearer " + token
            if not hmac.compare_digest(authorization, expected):
                self._json(401, {"error": "unauthorized"})
                return
            if self.headers.get_content_type() != "application/x-ndjson":
                self._json(415, {"error": "unsupported_media_type"})
                return
            raw_length = self.headers.get("Content-Length")
            try:
                length = int(raw_length)
            except (TypeError, ValueError):
                self._json(411, {"error": "content_length_required"})
                return
            if length <= 0 or length > MAX_BODY_BYTES:
                self._json(413, {"error": "invalid_or_oversized_body"})
                return
            body = self.rfile.read(length)
            if len(body) != length:
                self._json(400, {"error": "incomplete_body"})
                return
            try:
                records = validate_batch(body)
            except ValueError as exc:
                self._json(400, {"error": "invalid_batch", "detail": str(exc)})
                return
            key = self.headers.get("Idempotency-Key", "")
            if len(key) != 64 or any(ch not in "0123456789abcdef" for ch in key):
                self._json(400, {"error": "valid_sha256_idempotency_key_required"})
                return
            import hashlib
            if not hmac.compare_digest(key, hashlib.sha256(body).hexdigest()):
                self._json(400, {"error": "idempotency_key_mismatch"})
                return
            try:
                inserted = store_batch(database, key, records)
            except sqlite3.Error:
                self._json(500, {"error": "storage_error"})
                return
            self._json(202 if inserted else 200, {
                "accepted": inserted,
                "duplicate": not inserted,
                "samples": len(records),
            })

        def do_GET(self):
            self._json(405, {"error": "method_not_allowed"})

        def log_message(self, fmt, *args):
            # Avoid logging request headers, credentials, or sample payloads.
            sys.stderr.write("receiver: " + (fmt % args) + "\n")

    return ReceiverHandler


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=os.environ.get("NEURAL_LINK_RECEIVER_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("NEURAL_LINK_RECEIVER_PORT", "8080")))
    parser.add_argument("--database", default=os.environ.get("NEURAL_LINK_RECEIVER_DB", "neural_link.sqlite3"))
    parser.add_argument("--token-env", default="NEURAL_LINK_RECEIVER_TOKEN")
    parser.add_argument("--path", default=DEFAULT_PATH)
    args = parser.parse_args(argv)
    token = os.environ.get(args.token_env)
    if not token or len(token) < 24:
        parser.error(f"{args.token_env} must contain a receiver token of at least 24 characters")
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    if not args.path.startswith("/") or args.path == "/":
        parser.error("--path must be a non-root absolute path")
    try:
        initialize_database(args.database)
        server = ThreadingHTTPServer((args.host, args.port), make_handler(token, args.database, args.path))
    except OSError as exc:
        parser.error(str(exc))
    print(f"NEURAL LINK receiver listening on {args.host}:{args.port}{args.path}")
    print("Development HTTP server: expose only behind a TLS reverse proxy.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
