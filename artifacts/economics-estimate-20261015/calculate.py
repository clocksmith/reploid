"""Offline planning model. No network, credentials, live prices or runtime changes."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def token_cost(model, input_tokens, output_tokens):
    return (input_tokens * model['input_usd_per_million']
            + output_tokens * model['output_usd_per_million']) / 1e6


def estimate(data, s):
    m, c = data['measurements'], data['common']
    hours = c['night_hours']
    assert hours > 0 and 0 <= s['utilization'] <= 1
    assert 0 <= s['quality_pass_fraction'] <= 1 and 0 <= s['on_time_fraction'] <= 1
    p = s['quality_pass_fraction'] * s['on_time_fraction']
    if m['answer_s'] > c['deadline_s']:
        p = 0
    # Failed-work runtime is included once, not charged again as a flat penalty.
    duration = m['answer_s'] * (p + (1-p) * s['failed_attempt_duration_ratio'])
    prep = (m['parallel_amd_cold_preparation_s'] + s['startup_extra_s']
            + s['acquisition_s'] / s['cache_reuse_nights']) / 3600
    assert prep < hours and duration > 0
    busy = (hours-prep) * s['utilization']
    idle = hours-prep-busy
    attempts = busy*3600/duration
    accepted = attempts*p
    kwh = (((busy+prep)*s['active_incremental_w'] + idle*s['idle_incremental_w']
            + hours*s['network_incremental_w']) / 1000 * s['cooling_multiplier'])
    gross = kwh + hours*s['baseline_w']/1000*s['cooling_multiplier']
    energy = kwh*s['tariff_usd_kwh']
    bandwidth = (attempts*s['transfer_mb_per_attempt']/1000
                 + s['acquisition_gb']/s['cache_reuse_nights']) * s['egress_usd_gb']
    capital = (s['hardware_basis_usd']*s['hardware_allocation_fraction']*hours
               / (s['hardware_years']*365*24))
    labor = s['operator_minutes_night']/60*s['operator_usd_hour']
    platform = s['platform_usd_month']/c['nights_per_month']
    review = attempts*token_cost(data['sources']['together']['models'][s['review_model_index']],
                                s['review_input_tokens'], s['review_output_tokens'])
    contributor_incremental = energy+bandwidth
    contributor_full = contributor_incremental+capital
    # Reward is an internal transfer. Operator pays reward instead of paying
    # contributor energy/bandwidth a second time. Capacity is assumed already owned.
    reward = contributor_incremental*(1+c['reward_markup_fraction']) if attempts else 0
    operator_other = labor+platform+review
    real_total = contributor_full+operator_other
    operator_total = reward+operator_other
    stripe = data['sources']['stripe']
    fee = stripe['fraction']+stripe['fixed_usd']/c['topup_usd']
    denominator = 1-fee-s['loss_reserve_fraction']
    assert denominator > 0
    revenue = operator_total/denominator
    return {
        'name': s['name'], 'attempts_night': attempts, 'satisfactory_on_time_night': accepted,
        'busy_hours': busy, 'idle_hours': idle, 'preparation_hours': prep,
        'incremental_kwh_night': kwh, 'gross_kwh_night': gross,
        'incremental_joules_per_accepted': kwh*3.6e6/accepted if accepted else None,
        'costs_usd_night': {'electricity': energy, 'bandwidth': bandwidth, 'hardware_allocation': capital,
                            'operator_labor': labor, 'platform': platform, 'automated_review': review},
        'contributor_incremental_usd_night': contributor_incremental,
        'contributor_full_usd_night': contributor_full,
        'reward_service_value_usd_equivalent_night': reward,
        'contributor_surplus_before_hardware': reward-contributor_incremental,
        'contributor_surplus_after_hardware': reward-contributor_full,
        'operator_cost_before_payment_fees_usd_night': operator_total,
        'consolidated_cost_before_payment_fees_usd_night': real_total,
        'operator_paid_break_even_revenue_usd_night': revenue,
        'payment_fee_fraction': fee,
        'payment_fees_usd_night': revenue*fee,
        'loss_reserve_usd_night': revenue*s['loss_reserve_fraction'],
        'electricity_usd_per_accepted': energy/accepted if accepted else None,
        'consolidated_usd_per_accepted_before_payment_fees': real_total/accepted if accepted else None,
        'consolidated_usd_per_accepted_with_payment_fees': (real_total+revenue*fee)/accepted if accepted else None,
        'gross_energy_boundary_resource_usd_per_accepted_before_payment_fees': (real_total+(gross-kwh)*s['tariff_usd_kwh'])/accepted if accepted else None,
        'alternative_searxng_hosting_only_usd_per_accepted': s['alternative_searxng_monthly_usd']/c['nights_per_month']/accepted if accepted else None,
        'operator_paid_break_even_usd_per_accepted': revenue/accepted if accepted else None,
        'operator_break_even_usd_per_paid_answer_at_assumed_mix': revenue/(accepted*s['paid_answer_fraction']) if accepted and s['paid_answer_fraction'] else None,
        'paid_answer_fraction': s['paid_answer_fraction'],
        'funding_gap_at_10_cent_paid_price_usd_night': max(0, operator_total-accepted*s['paid_answer_fraction']*0.10*denominator),
        'reward_redeemable_answers_at_break_even_price': reward/(revenue/accepted) if accepted else 0,
        'search_one_query_addon_usd_per_accepted': (data['sources']['brave']['search_usd_per_1000']/1000/p) if p else None,
        'wasted_attempts': attempts-accepted,
        'failed_work_share_of_variable_cost': 1-p,
    }


def results(data):
    m = data['measurements']
    base = data['scenarios'][1]
    rows = [estimate(data, s) for s in data['scenarios']]
    sensitivity = []
    for field, values in [('utilization', [0.1,0.4,0.8,1]),
                          ('quality_pass_fraction', [0.425,0.65,0.9,1]),
                          ('active_incremental_w', [80,180,300]),
                          ('operator_minutes_night', [0,3,10])]:
        for value in values:
            s = dict(base, **{field:value})
            sensitivity.append({'input':field,'value':value, 'result':estimate(data,s)})
    thresholds=[]
    for watts in [80,180,300,450]:
        for price in [0.25,1.28,3.6,10]:
            thresholds.append({'watts':watts,'electricity_usd_kwh':0.20,'alternative_usd_per_million_output':price,
                               'minimum_decode_tokens_s_energy_only':watts/1000*0.20*1e6/(price*3600)})
    alternatives=[dict(model, usd_per_56_in_100_out=token_cost(model,m['input_tokens'],m['output_tokens']))
                  for model in data['sources']['together']['models']]
    rental = data['rental_comparison']
    common_fixed_hour = (base['platform_usd_month']/data['common']['nights_per_month']
                         + base['operator_minutes_night']/60*base['operator_usd_hour'])/data['common']['night_hours']
    review_per_accepted = token_cost(data['sources']['together']['models'][base['review_model_index']],
                                     base['review_input_tokens'], base['review_output_tokens']) / (base['quality_pass_fraction']*base['on_time_fraction'])
    target = rows[1]['consolidated_usd_per_accepted_before_payment_fees']
    rentals=[]
    for offer in rental['offers']:
        hourly = offer['usd_hour']+common_fixed_hour+rental['additional_disk_network_usd_hour_assumption']
        threshold = hourly/(target-review_per_accepted)
        rentals.append(dict(offer,
            instance_usd_8_hours=offer['usd_hour']*8,
            instance_usd_730_hours=offer['usd_hour']*730,
            common_fixed_service_usd_hour=common_fixed_hour,
            review_usd_per_accepted_assumption=review_per_accepted,
            accepted_per_billed_hour_to_beat_reploid_base=threshold,
            complete_service_usd_per_accepted_sensitivity=[
                {'accepted_per_billed_hour':q,'usd_per_accepted':hourly/q+review_per_accepted}
                for q in rental['accepted_answers_per_billed_hour_sensitivity']]))
    return {'status':'estimates, not qualification', 'as_of':data['as_of'], 'scenarios':rows,
            'rental_comparison':rentals, 'sensitivity':sensitivity,'energy_only_break_even':thresholds,'api_price_comparators':alternatives,
            'local_amd_same_precision_answer_s_estimate':m['amd_whole_model_prefill_s']+m['output_tokens']*m['amd_whole_model_decode_s'],
            'illustrative_original_usd_per_million':{'300_watts':300/1000*0.2/(3600/1.2)*1e6,
                                                   '450_watts':450/1000*0.2/(3600/1.2)*1e6}}


def render(data,r):
    lines=['# Calculated estimates', '', 'Generated from `inputs.json` by `calculate.py`. USD; all power and operating scenarios are assumptions, not measured economics.', '',
           '| Per eight-hour route window | Low cost | Base | Stress |','|---|---:|---:|---:|']
    rows=r['scenarios']
    fields=[('Attempted answers','attempts_night'),('Satisfactory, on-time answers (assumed rates)','satisfactory_on_time_night'),
            ('Incremental kWh','incremental_kwh_night'),('Gross kWh','gross_kwh_night'),
            ('Electricity / satisfactory answer, USD','electricity_usd_per_accepted'),
            ('Complete resource cost / satisfactory answer before payment fees, USD','consolidated_usd_per_accepted_before_payment_fees'),
            ('Complete resource cost / satisfactory answer with modeled payment fees, USD','consolidated_usd_per_accepted_with_payment_fees'),
            ('Gross-energy-boundary resource cost before payment fees, USD/answer','gross_energy_boundary_resource_usd_per_accepted_before_payment_fees'),
            ('All-paid break-even / satisfactory answer, USD-equivalent','operator_paid_break_even_usd_per_accepted'),
            ('Paid fraction (assumed)','paid_answer_fraction'),
            ('Break-even price / paid answer with mixed access, USD-equivalent','operator_break_even_usd_per_paid_answer_at_assumed_mix'),
            ('Unfunded night at $0.10 / paid answer and mixed access, USD-equivalent','funding_gap_at_10_cent_paid_price_usd_night'),
            ('Night reward, USD-equivalent service value','reward_service_value_usd_equivalent_night'),
            ('Contributor surplus after hardware allocation, USD-equivalent','contributor_surplus_after_hardware'),
            ('Answers that night reward could buy at modeled break-even price','reward_redeemable_answers_at_break_even_price'),
            ('One Brave search query add-on / satisfactory answer, USD','search_one_query_addon_usd_per_accepted'),
            ('Alternative SearXNG hosting-only add-on / satisfactory answer, USD','alternative_searxng_hosting_only_usd_per_accepted')]
    for label,field in fields:
        lines.append('| '+label+' | '+' | '.join(f'{x[field]:.5f}' if x[field] is not None else 'undefined' for x in rows)+' |')
    lines+=['', 'Search add-ons exclude extra context processing, page fetches and additional semantic checks. The short 56-token fixture does not qualify search workloads. No subsidy or free credit is deducted. Reward is service value, not cash or an approved credit conversion.', '',
            '| Cost per night, USD | Low cost | Base | Stress |','|---|---:|---:|---:|']
    for key in rows[0]['costs_usd_night']:
        lines.append('| '+key+' | '+' | '.join(f'{x["costs_usd_night"][key]:.5f}' for x in rows)+' |')
    lines+=['','## API price references', '', 'Different models, untested quality/latency/permissions. These are raw token charges only, not equivalent-service proof.', '',
            '| Model | Input USD/M | Output USD/M | 56 input + 100 output, USD |','|---|---:|---:|---:|']
    for a in r['api_price_comparators']:
        lines.append(f'| {a["name"]} | {a["input_usd_per_million"]} | {a["output_usd_per_million"]} | {a["usd_per_56_in_100_out"]:.8f} |')
    lines+=['', 'Source: [Together pricing](https://www.together.ai/pricing), checked 2026-10-15. Input, search and review costs must also be counted.', '',
            '## Sensitivity around base', '', '| Changed input only | Value | Complete cost / accepted answer, before payment fees (USD) |','|---|---:|---:|']
    for a in r['sensitivity']:
        lines.append(f'| {a["input"]} | {a["value"]} | {a["result"]["consolidated_usd_per_accepted_before_payment_fees"]:.5f} |')
    lines+=['','## Decode-only energy break-even', '', 'At $0.20/kWh, 100% busy decode and no prefill, failures, idle or other costs. Strictly exceed these rates to beat the price on electricity alone.', '',
            '| Route watts | Alternative USD/M output tokens | Required output tokens/s |','|---|---:|---:|']
    for a in r['energy_only_break_even']:
        lines.append(f'| {a["watts"]} | {a["alternative_usd_per_million_output"]} | {a["minimum_decode_tokens_s_energy_only"]:.3f} |')
    lines+=['',f'AMD-only same-precision short-answer estimate: **{r["local_amd_same_precision_answer_s_estimate"]:.2f} seconds**, summing measured whole-model prefill and 100 decode steps. This is not an installed application measurement. Qualification of that service path remains necessary.', '']
    lines+=['## Rental comparison', '',
            'On-demand rates checked 2026-10-15. No cloud inference was benchmarked. Accepted-answer rates are sensitivity inputs, including idle, startup and failed work per billed hour. Instance availability and NVIDIA correctness remain unqualified.', '',
            '| Instance | GPU GB | USD/hour | USD/8 hours | USD/730 hours |', '|---|---:|---:|---:|---:|']
    for a in r['rental_comparison']:
        lines.append(f'| {a["name"]} | {a["vram_gb"]} | {a["usd_hour"]:.4f} | {a["instance_usd_8_hours"]:.2f} | {a["instance_usd_730_hours"]:.2f} |')
    lines+=['', '[Lambda list prices](https://lambda.ai/instances); [Google accelerator pricing](https://cloud.google.com/products/compute/pricing/accelerator-optimized?hl=en). Google rate requires regional requote; disk/egress separate. Tax excluded.', '',
            'Comparable service boundary: add the same base platform/labor allocation ($0.625/hour), the same assumed review cost per accepted answer, and an assumed $0.02/hour disk/network allowance. Excludes payment fees, search, tax and one-time setup on both sides. Does not add electricity or hardware depreciation on top of rental.', '',
            '| Instance | At 6 accepted/hour | At 25 accepted/hour | At 100 accepted/hour | Accepted/hour needed to beat Reploid base |', '|---|---:|---:|---:|---:|']
    for a in r['rental_comparison']:
        values=' | '.join(f'${x["usd_per_accepted"]:.4f}' for x in a['complete_service_usd_per_accepted_sensitivity'])
        lines.append(f'| {a["name"]} | {values} | {a["accepted_per_billed_hour_to_beat_reploid_base"]:.2f} |')
    lines+=['', f'Reploid base on this before-payment-fee boundary: ${rows[1]["consolidated_usd_per_accepted_before_payment_fees"]:.4f}/accepted answer, at {rows[1]["satisfactory_on_time_night"]/data["common"]["night_hours"]:.2f} accepted/hour. This is an estimate anchored to retained timings, not measured economic proof.', '',
            'Read 25/hour as a condition to verify, not a cloud speed forecast. Higher GPU capacity does not guarantee demand. Startup, idle time, failed quality and deadlines must all be inside the observed accepted-per-billed-hour denominator. No Spot discount, utilization gain or automatic batching gain is assumed.', '']
    return '\n'.join(lines)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--check',action='store_true')
    args=parser.parse_args()
    raw=(ROOT/'inputs.json').read_bytes()
    data=json.loads(raw)
    r=results(data)
    r['inputs_sha256']=hashlib.sha256(raw).hexdigest()
    outputs={'results.json':json.dumps(r,indent=2,sort_keys=True,allow_nan=False)+'\n','RESULTS.md':render(data,r)}
    for name,text in outputs.items():
        p=ROOT/name
        if args.check:
            assert p.read_text()==text, f'{name} is stale; run calculate.py'
        else:p.write_text(text)
    print('Estimates verified.' if args.check else 'Wrote results.json and RESULTS.md.')

if __name__=='__main__':main()
