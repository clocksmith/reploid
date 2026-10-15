"""Route-specific planning arithmetic; no network calls or measured-cost claims."""
import argparse
import json
from pathlib import Path

PATH = Path(__file__).with_name('question-synthesis-scenario.json')


def calculate(data):
    assumptions = data['assumptions']
    model, search, payment = data['sources'][:3]
    answers = assumptions['hypothetical_answers_per_topup']
    topup = assumptions['topup_usd']
    net = topup * (1 - payment['us_domestic_card_fraction']) - payment['fixed_usd']
    inference = answers * assumptions['model_calls_per_answer'] * (
        assumptions['input_tokens_per_answer'] * model['input_usd_per_million']
        + assumptions['output_tokens_per_answer'] * model['output_usd_per_million']) / 1e6
    rows = []
    for fraction in [0, 0.1, 0.5, 1]:
        lookups = answers * 3
        paid_requests = lookups * fraction
        api_cost = paid_requests * search['search_request_usd']
        rows.append({
            'answers': answers, 'searches_per_answer': 3,
            'paid_fallback_fraction': fraction,
            'no_fee_success_fraction': 1 - fraction,
            'paid_api_requests': paid_requests,
            'model_cost_usd': inference, 'paid_search_api_cost_usd': api_cost,
            'remaining_after_payment_model_and_paid_search_usd': net - inference - api_cost,
            'no_fee_route_resource_cost_usd': None,
            'complete_service_cost_usd': None,
            'profit_usd': None})
    return rows


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = json.loads(PATH.read_text())
    rows = calculate(data)
    if args.check:
        assert data['mixed_route_rows'] == rows, 'Mixed-route calculations are stale'
        # A 100% paid route must reconcile to the original three-search comparator.
        original = next(r for r in data['rows'] if r['searches_per_answer'] == 3)
        assert abs(rows[-1]['remaining_after_payment_model_and_paid_search_usd']
                   - original['remaining_after_payment_and_direct_providers_usd']) < 1e-10
        assert abs(rows[1]['paid_search_api_cost_usd'] - 1.5) < 1e-10
        assert abs(rows[1]['remaining_after_payment_model_and_paid_search_usd'] - 7.075) < 1e-10
        assert all(row['profit_usd'] is None for row in rows)
        print('Route arithmetic, API-only reconciliation and unknown-cost boundaries verified.')
    else:
        data['mixed_route_rows'] = rows
        PATH.write_text(json.dumps(data, indent=2) + '\n')
        print('Updated mixed-route scenarios; unknown resource costs remain unknown.')
