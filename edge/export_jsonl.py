#!/usr/bin/env python3
"""Convert RK3576 system-monitor CSV samples to local NEURAL LINK JSONL."""

import argparse
import csv
import json
import math
import os
import sys
import tempfile
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
    """Atomically write valid samples as JSONL and return the exported row count.

    Invalid elapsed times abort the export. Metric values that are blank,
    non-numeric, non-finite, or absent are omitted. The previous output remains
    untouched unless the complete export succeeds.
    """
    if not isinstance(device_id, str) or not device_id.strip():
        raise ValueError("device_id is required and must not be empty")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = None
    count = 0
    try:
        with input_path.open("r", encoding="utf-8", newline="") as source:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                newline="",
                dir=output_path.parent,
                prefix=f".{output_path.name}.",
                suffix=".tmp",
                delete=False,
            ) as destination:
                temp_path = Path(destination.name)
                for row_number, row in enumerate(data_rows(source), start=1):
                    raw_elapsed = row.get("seconds")
                    try:
                        elapsed_s = float(raw_elapsed) if raw_elapsed is not None else math.nan
                    except (TypeError, ValueError) as exc:
                        raise ValueError(
                            f"row {row_number}: invalid/missing seconds value"
                        ) from exc
                    if not math.isfinite(elapsed_s) or elapsed_s < 0:
                        raise ValueError(
                            f"row {row_number}: seconds must be a finite non-negative number"
                        )

                    metrics = {}
                    for prefix, unit in METRIC_UNITS.items():
                        for name, raw_value in row.items():
                            if (
                                not isinstance(name, str)
                                or not name.startswith(prefix)
                                or not isinstance(raw_value, str)
                                or not raw_value.strip()
                            ):
                                continue
                            try:
                                value = float(raw_value)
                            except ValueError:
                                continue
                            if math.isfinite(value):
                                metrics[name] = {"value": value, "unit": unit}

                    # A row without any usable metrics is not a sample.
                    if not metrics:
                        continue

                    record = {
                        "schema": SCHEMA_VERSION,
                        "device_id": device_id.strip(),
                        "source": "rk3576-system-monitor",
                        "sequence": count,
                        "elapsed_s": elapsed_s,
                        "metrics": metrics,
                    }
                    destination.write(
                        json.dumps(record, separators=(",", ":"), allow_nan=False) + "\n"
                    )
                    count += 1

        # Atomic replacement prevents a failed export from truncating old data.
        os.replace(temp_path, output_path)
        temp_path = None
        return count
    finally:
        if temp_path is not None:
            try:
                temp_path.unlink()
            except FileNotFoundError:
                pass


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "csv_file",
        type=Path,
        help="system_data.csv produced by temperature/system_monitor.sh",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="JSONL output (default: <csv_file>.jsonl)",
    )
    parser.add_argument(
        "--device-id",
        default=os.environ.get("NEURAL_LINK_DEVICE_ID"),
        help="stable device identifier (or set NEURAL_LINK_DEVICE_ID)",
    )
    args = parser.parse_args(argv)
    if not args.device_id or not args.device_id.strip():
        parser.error("--device-id or NEURAL_LINK_DEVICE_ID is required")

    output_path = args.output or args.csv_file.with_suffix(
        args.csv_file.suffix + ".jsonl"
    )
    try:
        count = export_csv(args.csv_file, output_path, args.device_id)
    except (OSError, ValueError) as exc:
        print(f"edge export failed: {exc}", file=sys.stderr)
        return 1
    print(f"Exported {count} samples to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
