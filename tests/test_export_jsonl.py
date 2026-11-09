import json
import math
import tempfile
import unittest
from pathlib import Path

from edge.export_jsonl import export_csv


class ExportJsonlTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.source = self.root / "system_data.csv"
        self.output = self.root / "samples.jsonl"

    def write_csv(self, content):
        self.source.write_text(content, encoding="utf-8")

    def read_records(self):
        return [
            json.loads(line)
            for line in self.output.read_text(encoding="utf-8").splitlines()
        ]

    def test_metadata_and_metrics_export_to_jsonl(self):
        self.write_csv(
            '# METADATA: {"temperature_sensors":["temp_soc"]}\n'
            "seconds,temp_soc,load_cpu0,freq_cpu0\n"
            "0,31.5,0,1200\n"
            "0.5,32.0,,1300\n"
        )
        exported = export_csv(self.source, self.output, "edge-test-01")
        records = self.read_records()
        self.assertEqual(exported, 2)
        self.assertEqual(records[0]["schema"], "neural-link.edge.sample.v1")
        self.assertEqual(records[0]["device_id"], "edge-test-01")
        self.assertEqual(records[0]["metrics"]["temp_soc"], {"value": 31.5, "unit": "Cel"})
        self.assertEqual(records[0]["metrics"]["load_cpu0"]["unit"], "%")
        self.assertNotIn("load_cpu0", records[1]["metrics"])
        self.assertEqual(records[1]["elapsed_s"], 0.5)

    def test_rejects_invalid_elapsed_time(self):
        self.write_csv("seconds,temp_soc\n-1,31.5\n")
        with self.assertRaisesRegex(ValueError, "finite non-negative"):
            export_csv(self.source, self.output, "edge-test-01")

    def test_empty_file_exports_zero_records(self):
        self.write_csv("")
        self.assertEqual(export_csv(self.source, self.output, "edge-01"), 0)
        self.assertEqual(self.output.read_text(encoding="utf-8"), "")

    def test_missing_seconds_column_is_rejected(self):
        self.write_csv("temp_soc\n31.5\n")
        with self.assertRaisesRegex(ValueError, "seconds"):
            export_csv(self.source, self.output, "edge-01")

    def test_blank_metric_is_omitted(self):
        self.write_csv("seconds,temp_soc\n0,   \n")
        self.assertEqual(export_csv(self.source, self.output, "edge-01"), 0)
        self.assertEqual(self.output.read_text(encoding="utf-8"), "")

    def test_nonnumeric_metric_is_omitted(self):
        self.write_csv("seconds,temp_soc\n0,not-a-number\n")
        self.assertEqual(export_csv(self.source, self.output, "edge-01"), 0)

    def test_nan_and_infinity_metrics_are_omitted(self):
        self.write_csv("seconds,temp_soc,load_cpu0,freq_cpu0\n0,NaN,inf,-inf\n")
        self.assertEqual(export_csv(self.source, self.output, "edge-01"), 0)

    def test_incomplete_row_omits_missing_metric(self):
        self.write_csv("seconds,temp_soc,load_cpu0\n0,31.5\n")
        self.assertEqual(export_csv(self.source, self.output, "edge-01"), 1)
        record = self.read_records()[0]
        self.assertEqual(record["metrics"], {"temp_soc": {"value": 31.5, "unit": "Cel"}})

    def test_empty_sample_is_skipped(self):
        self.write_csv("seconds,temp_soc,load_cpu0\n0,,\n1,32.0,\n")
        self.assertEqual(export_csv(self.source, self.output, "edge-01"), 1)
        self.assertEqual(len(self.read_records()), 1)
        self.assertEqual(self.read_records()[0]["elapsed_s"], 1.0)

    def test_previous_file_preserved_on_error(self):
        self.output.write_text("previous-valid-output\n", encoding="utf-8")
        self.write_csv("seconds,temp_soc\n0,31.5\ninvalid,32.0\n")
        with self.assertRaisesRegex(ValueError, "invalid/missing seconds"):
            export_csv(self.source, self.output, "edge-01")
        self.assertEqual(
            self.output.read_text(encoding="utf-8"), "previous-valid-output\n"
        )
        self.assertEqual(list(self.root.glob(".samples.jsonl.*.tmp")), [])

    def test_multiple_records_have_sequential_ids(self):
        self.write_csv("seconds,temp_soc\n0,30\n0.5,31\n1,32\n")
        self.assertEqual(export_csv(self.source, self.output, "edge-01"), 3)
        records = self.read_records()
        self.assertEqual([r["sequence"] for r in records], [0, 1, 2])
        self.assertEqual([r["elapsed_s"] for r in records], [0.0, 0.5, 1.0])

    def test_missing_device_id_is_rejected(self):
        self.write_csv("seconds,temp_soc\n0,30\n")
        for device_id in (None, "", "   "):
            with self.subTest(device_id=device_id):
                with self.assertRaisesRegex(ValueError, "device_id is required"):
                    export_csv(self.source, self.output, device_id)


if __name__ == "__main__":
    unittest.main()
