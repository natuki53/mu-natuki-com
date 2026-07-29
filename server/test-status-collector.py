import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("status-collector.py")
SPEC = importlib.util.spec_from_file_location("status_collector", MODULE_PATH)
status_collector = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(status_collector)


class StatusCollectorParserTests(unittest.TestCase):
    def test_cpu_uses_idle_dimension(self):
        labels = ["time", "user", "system", "idle"]
        row = [1_700_000_000, 10.0, 5.0, 85.0]
        self.assertEqual(status_collector._parse_cpu(labels, row), 15.0)

    def test_memory_reports_used_share(self):
        labels = ["time", "free", "used", "cached", "buffers"]
        row = [1_700_000_000, 20.0, 50.0, 20.0, 10.0]
        self.assertEqual(status_collector._parse_memory(labels, row), 50.0)

    def test_disk_reports_used_share(self):
        labels = ["time", "avail", "used", "reserved"]
        row = [1_700_000_000, 60.0, 35.0, 5.0]
        self.assertEqual(status_collector._parse_disk(labels, row), 35.0)

    def test_uptime_is_non_negative_integer(self):
        labels = ["time", "uptime"]
        row = [1_700_000_000, 1234.9]
        self.assertEqual(status_collector._parse_uptime(labels, row), 1234)


if __name__ == "__main__":
    unittest.main()
