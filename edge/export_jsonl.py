#!/usr/bin/env python3
"""Convert RK3576 system-monitor CSV samples to local NEURAL LINK JSONL."""

import argparse
import csv
import json
import math
import os
import socket
import sys
from pathlib import Path
from typing import Dict, Iterable, TextIO

SCHEMA_VERSION = "neural-link.edge.sample.v1"
METRIC_UNITS = {
    "temp_": "Cel",
    "load_": "%",
    "freq_": "MHz",
}


def data_rows(stream: TextIO) -> Iterable[Dict[str, str]]:
    """Read the monitor CSV, tolerating its optional '# METADATA:' line."""
    first_line = stream.readline()
    if not first_line.startswith("#"):
        stream.seek(0)
    return csv.DictReader(line for line in stream if not line.startswith("#"))


def export_csv(input_path: Path, output_path: Path, device_id: str) -> int:
    """Write one JSON object per sample; return the number of exported rows."""
    count = 0
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with input_path.open("r", encoding="utf-8", newline="") as source, output_path.open(
        "w", encoding="utf-8", newline=""
    ) as destination:
        for row_number, row in enumerate(data_rows(source), start=1):
            try:
                elapsed_s = float(row.get("seconds", ""))
            except (TypeError, ValueError) as exc:
                raise ValueError(f"row {row_number}: invalid/missing seconds value") from exc
            if not math.isfinite(elapsed_s) or elapsed_s < 0:
                raise ValueError(f"row {row_number}: seconds must be a finite non-negative number")

            metrics = {}
            for column, unit in METRIC_UNITS.items():
                for name, raw_value in row.items():
                    if not name or not name.startswith(column) or raw_value is None or raw_value.strip() == "":
                        continue
                    try:
                        value = float(raw_value)
                    except ValueError:
                        continue
                    if math.isfinite(value):
                        metrics[name] = {"value": value, "unit": unit}

            if not metrics:
                continue
            record = {
                "schema": SCHEMA_VERSION,
                "device_id": device_id,
                "source": "rk3576-system-monitor",
                "sequence": count,
                "elapsed_s": elapsed_s,
                "metrics": metrics,
            }
            destination.write(json.dumps(record, separators=(",", ":"), allow_nan=False) + "\n")
            count += 1
    return count


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_file", type=Path, help="system_data.csv produced by temperature/system_monitor.sh")
    parser.add_argument("--output", type=Path, help="JSONL output (default: <csv_file>.jsonl)")
    parser.add_argument(
        "--device-id",
        default=os.environ.get("NEURAL_LINK_DEVICE_ID") or socket.gethostname(),
        help="stable device identifier (or set NEURAL_LINK_DEVICE_ID); avoid personal hostnames",
    )
    args = parser.parse_args(argv)
    output_path = args.output or args.csv_file.with_suffix(args.csv_file.suffix + ".jsonl")
    try:
        count = export_csv(args.csv_file, output_path, args.device_id)
    except (OSError, ValueError) as exc:
        print(f"edge export failed: {exc}", file=sys.stderr)
        return 1
    print(f"Exported {count} samples to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
