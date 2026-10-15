"""Offline accounting/attribution checks; no GPU or network calls."""
import copy
import json
import unittest
from pathlib import Path
from analyze import grouped, run

HERE = Path(__file__).resolve().parent


class EvidenceChecks(unittest.TestCase):
    def setUp(self):
        self.data = json.loads((HERE / 'trace-extract.json').read_text())

    def test_missing_time_is_rejected(self):
        row = copy.deepcopy(self.data['rows'][0])
        row['decode_mean_ms'] += 100
        with self.assertRaisesRegex(AssertionError, 'reconcile'):
            grouped(row)

    def test_grouping_and_amdahl_bound(self):
        row = {'decode_mean_ms': 100, 'decode_mean_segments_ms': {
            'transfer.stage': 50, 'mac.encode': 20, 'amd.doppler': 20,
            'amd.authorization': 5, 'serialization.request': 1, 'residual': 4}}
        g = grouped(row)
        self.assertEqual(g['execution_boundary'], 40)
        self.assertEqual(g['transfer_delivery'], 50)
        self.assertEqual(g['other'], 4)
        self.assertEqual(100 / (100 - g['transfer_delivery']), 2)
        self.assertLess(100 / (100 - g['serialization']), 1.011)

    def test_evidence_gaps_survive_calculation(self):
        result = run(self.data)
        for before, after in zip(self.data['rows'], result['rows']):
            self.assertEqual(before['step_error_count'], after['step_error_count'])
            self.assertEqual(before['prompt_captured'], after['prompt_captured'])
        self.assertTrue(any(row['step_error_count'] for row in result['rows']))

    def test_conditional_power_units(self):
        result = run(self.data)
        limits = result['conditional_power_limits_at_20c_kwh']
        watts = limits['route_watts_at_equal_acceptance_rates']
        # W -> kW; seconds -> hours; tariff USD/kWh -> USD/attempt.
        price = watts / 1000 * result['retained_installed_answer_s'] / 3600 * 0.20
        self.assertAlmostEqual(price, limits['alternative_raw_price_56_in_100_out_usd'])
        self.assertAlmostEqual(limits['local_watts_at_equal_acceptance_rates'] / watts,
                               result['derived_time_ratio'])


if __name__ == '__main__':
    unittest.main()
