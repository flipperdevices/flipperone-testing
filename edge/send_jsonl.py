#!/usr/bin/env python3
"""Send validated NEURAL LINK JSONL batches to a configured HTTPS endpoint."""

import argparse
import hashlib
import json
import math
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

SCHEMA_VERSION = "neural-link.edge.sample.v1"


def validate_jsonl(content: str) -> int:
    """Validate every non-empty line and return the number of samples."""
    count = 0
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
        if not isinstance(record.get("device_id"), str) or not record["device_id"].strip():
            raise ValueError(f"line {line_number}: missing device_id")
        sequence = record.get("sequence")
        if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 0:
            raise ValueError(f"line {line_number}: sequence must be a non-negative integer")
        elapsed = record.get("elapsed_s")
        if isinstance(elapsed, bool) or not isinstance(elapsed, (int, float)) or not math.isfinite(elapsed) or elapsed < 0:
            raise ValueError(f"line {line_number}: elapsed_s must be finite and non-negative")
        if not isinstance(record.get("metrics"), dict) or not record["metrics"]:
            raise ValueError(f"line {line_number}: metrics must be a non-empty object")
        count += 1
    return count


def send_jsonl(input_path: Path, endpoint: str, token: str, timeout: float = 10.0) -> int:
    """POST one validated JSONL batch; never retries automatically."""
    parsed = urlparse(endpoint)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("endpoint must be an absolute HTTPS URL")
    if not token or not token.strip():
        raise ValueError("authentication token is required")
    content = input_path.read_text(encoding="utf-8")
    count = validate_jsonl(content)
    if count == 0:
        return 0

    body = content.encode("utf-8")
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
            status = response.status
            if not 200 <= status < 300:
                raise RuntimeError(f"receiver returned HTTP {status}")
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
    args = parser.parse_args(argv)
    if not args.endpoint:
        parser.error("--endpoint or NEURAL_LINK_ENDPOINT is required")
    if not math.isfinite(args.timeout) or args.timeout <= 0:
        parser.error("--timeout must be a finite positive number")
    token = os.environ.get(args.token_env)
    try:
        count = send_jsonl(args.jsonl_file, args.endpoint, token, args.timeout)
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"edge send failed: {exc}", file=sys.stderr)
        return 1
    print(f"Sent {count} samples to configured NEURAL LINK receiver")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
