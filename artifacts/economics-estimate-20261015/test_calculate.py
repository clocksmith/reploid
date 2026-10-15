"""Accounting and dimensional checks for the offline estimator, not product acceptance."""
import copy
import json
from pathlib import Path
import unittest
from calculate import estimate, results, token_cost

DATA=json.loads(Path(__file__).with_name('inputs.json').read_text())

class Accounting(unittest.TestCase):
    def test_original_illustration_and_units(self):
        r=results(DATA)
        self.assertAlmostEqual(r['illustrative_original_usd_per_million']['300_watts'],20)
        self.assertAlmostEqual(r['illustrative_original_usd_per_million']['450_watts'],30)
        row=next(x for x in r['energy_only_break_even'] if x['watts']==450 and x['alternative_usd_per_million_output']==10)
        self.assertAlmostEqual(row['minimum_decode_tokens_s_energy_only'],2.5)
        self.assertAlmostEqual(token_cost(DATA['sources']['together']['models'][0],56,100),0.00003452)

    def test_internal_rewards_cancel(self):
        for s in DATA['scenarios']:
            r=estimate(DATA,s)
            # Consolidation removes internal reward transfer, adds underlying costs once.
            self.assertAlmostEqual(r['operator_cost_before_payment_fees_usd_night']
                 +r['contributor_full_usd_night']-r['reward_service_value_usd_equivalent_night'],
                 r['consolidated_cost_before_payment_fees_usd_night'])
            self.assertAlmostEqual(r['operator_paid_break_even_revenue_usd_night']
                 -r['payment_fees_usd_night']-r['loss_reserve_usd_night'],
                 r['operator_cost_before_payment_fees_usd_night'])
            self.assertAlmostEqual(r['busy_hours']+r['idle_hours']+r['preparation_hours'],8)

    def test_rental_break_even_uses_same_service_boundary(self):
        r=results(DATA)
        target=r['scenarios'][1]['consolidated_usd_per_accepted_before_payment_fees']
        for a in r['rental_comparison']:
            hourly=(a['usd_hour']+a['common_fixed_service_usd_hour']
                    +DATA['rental_comparison']['additional_disk_network_usd_hour_assumption'])
            self.assertAlmostEqual(hourly/a['accepted_per_billed_hour_to_beat_reploid_base']
                                   +a['review_usd_per_accepted_assumption'],target)
            self.assertAlmostEqual(a['instance_usd_730_hours'],730*a['usd_hour'])
            costs=[v['usd_per_accepted'] for v in a['complete_service_usd_per_accepted_sensitivity']]
            self.assertGreater(costs[0],costs[1]);self.assertGreater(costs[1],costs[2])

    def test_zero_success_never_has_favorable_unit_cost(self):
        for field in ['quality_pass_fraction','on_time_fraction','utilization']:
            s=dict(DATA['scenarios'][1],**{field:0})
            r=estimate(DATA,s)
            self.assertIsNone(r['consolidated_usd_per_accepted_before_payment_fees'])
            self.assertEqual(r['reward_redeemable_answers_at_break_even_price'],0)
        d=copy.deepcopy(DATA);d['common']['deadline_s']=100
        self.assertEqual(estimate(d,d['scenarios'][1])['satisfactory_on_time_night'],0)

    def test_failures_and_lower_paid_share_do_not_improve_economics(self):
        base=DATA['scenarios'][1]
        a=estimate(DATA,base)
        b=estimate(DATA,dict(base,failed_attempt_duration_ratio=2))
        self.assertGreater(b['consolidated_usd_per_accepted_before_payment_fees'],a['consolidated_usd_per_accepted_before_payment_fees'])
        c=estimate(DATA,dict(base,paid_answer_fraction=base['paid_answer_fraction']/2))
        self.assertAlmostEqual(c['operator_break_even_usd_per_paid_answer_at_assumed_mix'],2*a['operator_break_even_usd_per_paid_answer_at_assumed_mix'])
        self.assertAlmostEqual(c['consolidated_cost_before_payment_fees_usd_night'],a['consolidated_cost_before_payment_fees_usd_night'])

if __name__=='__main__': unittest.main()
