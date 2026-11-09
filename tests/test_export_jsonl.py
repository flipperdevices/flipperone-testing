import json
import tempfile
import unittest
from pathlib import Path

from edge.export_jsonl import export_csv


class ExportJsonlTests(unittest.TestCase):
    def test_metadata_and_metrics_export_to_jsonl(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "system_data.csv"
            output = Path(temp_dir) / "samples.jsonl"
            source.write_text(
                '# METADATA: {"temperature_sensors":["temp_soc"]}\n'
                'seconds,temp_soc,load_cpu0,freq_cpu0\n'
                '0,31.5,0,1200\n'
                '0.5,32.0,,1300\n',
                encoding="utf-8",
            )

            exported = export_csv(source, output, "edge-test-01")
            records = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]

            self.assertEqual(exported, 2)
            self.assertEqual(records[0]["schema"], "neural-link.edge.sample.v1")
            self.assertEqual(records[0]["device_id"], "edge-test-01")
            self.assertEqual(records[0]["metrics"]["temp_soc"], {"value": 31.5, "unit": "Cel"})
            self.assertEqual(records[0]["metrics"]["load_cpu0"]["unit"], "%")
            self.assertNotIn("load_cpu0", records[1]["metrics"])
            self.assertEqual(records[1]["elapsed_s"], 0.5)

    def test_rejects_invalid_elapsed_time(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "bad.csv"
            output = Path(temp_dir) / "samples.jsonl"
            source.write_text("seconds,temp_soc\n-1,31.5\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "finite non-negative"):
                export_csv(source, output, "edge-test-01")


if __name__ == "__main__":
    unittest.main()
