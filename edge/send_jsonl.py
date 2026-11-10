#!/usr/bin/env python3
"""Send validated NEURAL LINK JSONL batches to a configured receiver."""

import argparse
import hashlib
import ipaddress
import json
import math
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

SCHEMA_VERSION = "neural-link.edge.sample.v1"
MAX_BODY_BYTES = 1_048_576
METRIC_UNITS = {"temp_": "Cel", "load_": "%", "freq_": "MHz"}


def validate_jsonl(content: str) -> int:
    """Validate the full sample contract and return the number of samples."""
    count = 0
    batch_device_id = None
    for line_number, line in enumerate(content.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"line {line_number}: invalid JSON") from exc
        if not isinstance(record, dict):
            raise ValueError(f"line {line_number}: sample must be a JSON object")
        if record.get("schema") != SCHEMA_VERSION:
            raise ValueError(f"line {line_number}: unsupported schema")
        device_id = record.get("device_id")
        if not isinstance(device_id, str) or not device_id.strip():
            raise ValueError(f"line {line_number}: missing device_id")
        if batch_device_id is None:
            batch_device_id = device_id
        elif device_id != batch_device_id:
            raise ValueError(f"line {line_number}: a batch must contain one device_id")
        if record.get("source") != "rk3576-system-monitor":
            raise ValueError(f"line {line_number}: unsupported source")
        sequence = record.get("sequence")
        if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 0:
            raise ValueError(f"line {line_number}: sequence must be a non-negative integer")
        elapsed = record.get("elapsed_s")
        if (isinstance(elapsed, bool) or not isinstance(elapsed, (int, float))
                or not math.isfinite(elapsed) or elapsed < 0):
            raise ValueError(f"line {line_number}: elapsed_s must be finite and non-negative")
        metrics = record.get("metrics")
        if not isinstance(metrics, dict) or not metrics:
            raise ValueError(f"line {line_number}: metrics must be a non-empty object")
        for name, metric in metrics.items():
            if not isinstance(name, str) or not isinstance(metric, dict):
                raise ValueError(f"line {line_number}: invalid metric")
            expected_unit = next(
                (unit for prefix, unit in METRIC_UNITS.items() if name.startswith(prefix)),
                None,
            )
            if expected_unit is None:
                raise ValueError(f"line {line_number}: unsupported metric name")
            value = metric.get("value")
            if (isinstance(value, bool) or not isinstance(value, (int, float))
                    or not math.isfinite(value)):
                raise ValueError(f"line {line_number}: metric values must be finite numbers")
            if metric.get("unit") != expected_unit:
                raise ValueError(f"line {line_number}: invalid unit for metric {name}")
        count += 1
    return count


def _is_loopback(hostname: str) -> bool:
    if hostname.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(hostname).is_loopback
    except ValueError:
        return False


def send_jsonl(
    input_path: Path,
    endpoint: str,
    token: str,
    timeout: float = 10.0,
    allow_insecure_loopback: bool = False,
) -> int:
    """POST one validated JSONL batch; plain HTTP is opt-in for loopback only."""
    parsed = urlparse(endpoint)
    if not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("endpoint must be a valid URL without credentials or a fragment")
    if parsed.scheme != "https" and not (
        parsed.scheme == "http" and allow_insecure_loopback and _is_loopback(parsed.hostname)
    ):
        raise ValueError("endpoint must use HTTPS (HTTP is allowed only for explicit loopback testing)")
    if not token or not token.strip():
        raise ValueError("authentication token is required")
    if not math.isfinite(timeout) or timeout <= 0:
        raise ValueError("timeout must be a finite positive number")
    content = input_path.read_text(encoding="utf-8")
    count = validate_jsonl(content)
    if count == 0:
        return 0

    body = content.encode("utf-8")
    if len(body) > MAX_BODY_BYTES:
        raise ValueError(f"batch exceeds the {MAX_BODY_BYTES}-byte receiver limit")
    request = Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token.strip()}",
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Accept": "application/json",
            "Idempotency-Key": hashlib.sha256(body).hexdigest(),
        },
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            if not 200 <= response.status < 300:
                raise RuntimeError(f"receiver returned HTTP {response.status}")
    except HTTPError as exc:
        raise RuntimeError(f"receiver returned HTTP {exc.code}") from exc
    except URLError as exc:
        raise RuntimeError(f"could not reach receiver: {exc.reason}") from exc
    return count


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("jsonl_file", type=Path)
    parser.add_argument("--endpoint", default=os.environ.get("NEURAL_LINK_ENDPOINT"))
    parser.add_argument("--token-env", default="NEURAL_LINK_TOKEN", help="environment variable containing the bearer token")
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument(
        "--allow-insecure-loopback",
        action="store_true",
        help="allow plain HTTP only to localhost or a loopback IP (development only)",
    )
    args = parser.parse_args(argv)
    if not args.endpoint:
        parser.error("--endpoint or NEURAL_LINK_ENDPOINT is required")
    token = os.environ.get(args.token_env)
    try:
        count = send_jsonl(
            args.jsonl_file, args.endpoint, token, args.timeout, args.allow_insecure_loopback
        )
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"edge send failed: {exc}", file=sys.stderr)
        return 1
    print(f"Sent {count} samples to configured NEURAL LINK receiver")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
