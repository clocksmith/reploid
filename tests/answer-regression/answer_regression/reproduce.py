"""Confirms the harness reproduces the useful-answer set's frozen mechanical results exactly.

1. Check equivalence: the harness's mechanical verdicts for the stored 2026-10-14 Q4_K and bf16 arm runs equal
   results.json item by item, turn by turn and check by check (pass and detail text).
2. Generation reproduction: a fresh cpu-q4k-control run's prompts and outputs equal the stored Q4_K arm run token
   for token.
3. Baseline verdicts: that fresh run's mechanical verdicts equal results.json's Q4_K verdicts.
4. Rates: the harness's mechanical pass rates by category equal results.json's mechanical rates for both arms.
5. Whole evaluation: when the run directory has evaluation.json, the stored Q4_K arm run is evaluated the same way
   and every verdict family must agree with it.

Only mechanical fields of results.json are read. Its review section, provisional rubric grades and
reviewer-adjusted view are earlier grades and are not used.
"""
from .common import USEFUL_ANSWER_DIR, USEFUL_ANSWER_SET, label_block, load_json, now_iso, repo_relative, sha256_file
from .checks import mechanical_item
from .targets import arm_run_items

PINS = {'results.json': '5a915efda2fc381506589c2ab8a5d576d4b2c69be53ef60d7894710b427db97c',
        'q4k-run.json': 'bb26a677e58b9ab721ca0859e172ee430419a15063e329c76bd78e887cd85c09',
        'bf16-run.json': 'f18c9089eacefe071dff8ed4408e49808c1ee8962fa3000a4a3cbf40443e8b4b'}
TURN_KEYS = ('promptTokenIds', 'renderedPromptSha256', 'outputTokenIds', 'output', 'stopReason', 'decodeSteps',
             'minMarginTop1Top2', 'minMarginStep', 'reusedFrom')


def frozen_file(name):
    path = USEFUL_ANSWER_DIR / name
    if sha256_file(path) != PINS[name]:
        raise SystemExit(f'{path} changed; it is pinned to {PINS[name]}')
    return load_json(path)


def mechanical_view(result):
    return {'pass': result['pass'], 'checksPass': result.get('checksPass'), 'overPromptLimit': result['overPromptLimit'],
            'turns': [{'turn': t['turn'], 'pass': t['pass'], 'empty': t.get('empty'),
                       'checks': [(c['type'], c['pass'], c['detail']) for c in t.get('checks', [])]} for t in result['turns']]}


def compare_mechanical(answer_set, run_items, frozen_items, arm, label):
    by_run = {item['id']: item for item in run_items}
    by_frozen = {item['id']: item for item in frozen_items}
    mismatches, compared_checks, compared = [], 0, 0
    for item in answer_set['items']:
        if item['judgment'] != 'mechanical':
            continue
        compared += 1
        harness = mechanical_view(mechanical_item(item, by_run[item['id']]))
        frozen = mechanical_view(by_frozen[item['id']]['arms'][arm])
        compared_checks += sum(len(t['checks']) for t in frozen['turns'])
        if harness != frozen:
            mismatches.append({'comparison': label, 'item': item['id'], 'harness': harness, 'frozen': frozen})
    return {'comparison': label, 'items': compared, 'checks': compared_checks, 'mismatches': len(mismatches)}, mismatches


def mechanical_rates(answer_set, run_items):
    by_run = {item['id']: item for item in run_items}
    rows = [(item['category'], mechanical_item(item, by_run[item['id']])['pass'])
            for item in answer_set['items'] if item['judgment'] == 'mechanical']
    categories = list(dict.fromkeys(item['category'] for item in answer_set['items']))

    def block(subset):
        passed = sum(1 for _, ok in subset if ok)
        return {'pass': passed, 'total': len(subset), 'rate': round(passed / len(subset), 4) if subset else None}
    return {'overall': block(rows), 'byCategory': {c: block([r for r in rows if r[0] == c]) for c in categories}}


def reproduce(run_dir, scratch=None, log=print):
    run_path = run_dir / 'run.json'
    run = load_json(run_path)
    if run['target']['kind'] != 'cpu-q4k-control' or run['itemSet']['kind'] != 'useful-answer':
        raise SystemExit('Reproduction needs a cpu-q4k-control run of the useful-answer set')
    answer_set = load_json(USEFUL_ANSWER_SET)
    results, q4k_raw, bf16_raw = frozen_file('results.json'), frozen_file('q4k-run.json'), frozen_file('bf16-run.json')
    limit = run['target']['routePromptTokenLimit']
    stored = {'q4k': arm_run_items(q4k_raw, 'useful-answer-set-20261014-q4k', limit),
              'bf16': arm_run_items(bf16_raw, 'useful-answer-set-20261014-bf16', limit)}
    sections, mismatches = {}, []

    # 1. Check equivalence on the stored arm runs.
    for arm in ('q4k', 'bf16'):
        summary, rows = compare_mechanical(answer_set, stored[arm], results['items'], arm, f'stored {arm} arm run vs results.json')
        sections[f'checkEquivalence{arm.upper()}'] = summary
        mismatches += rows

    # 2. Generation reproduction against the stored Q4_K arm run.
    by_stored = {item['id']: item for item in stored['q4k']}
    turns_compared, differing = 0, []
    for item in run['items']:
        old = by_stored[item['id']]
        if len(old['turns']) != len(item['turns']):
            differing.append({'item': item['id'], 'detail': 'different number of turns'})
            continue
        for new_turn, old_turn in zip(item['turns'], old['turns']):
            turns_compared += 1
            keys = [key for key in TURN_KEYS if new_turn.get(key) != old_turn.get(key)]
            if keys:
                differing.append({'item': item['id'], 'turn': new_turn['turn'], 'fields': keys})
    sections['generationReproduction'] = {'comparison': 'fresh run vs stored Q4_K arm run (2026-10-14)',
                                          'turns': turns_compared, 'fieldsCompared': list(TURN_KEYS),
                                          'differingTurns': len(differing)}
    mismatches += [{'comparison': 'generation', **row} for row in differing]

    # 3. The fresh run's mechanical verdicts against results.json.
    summary, rows = compare_mechanical(answer_set, run['items'], results['items'], 'q4k', 'fresh run vs results.json q4k')
    sections['baselineVerdicts'] = summary
    mismatches += rows

    # 4. Mechanical rates.
    rates = {'fresh': mechanical_rates(answer_set, run['items']),
             'storedQ4K': mechanical_rates(answer_set, stored['q4k']), 'storedBF16': mechanical_rates(answer_set, stored['bf16'])}
    frozen_rates = results['rates']['mechanicalItems']
    rate_rows = []
    for name, arm in (('fresh', 'q4k'), ('storedQ4K', 'q4k'), ('storedBF16', 'bf16')):
        expected = {'overall': frozen_rates['overall'][arm],
                    'byCategory': {c: v[arm] for c, v in frozen_rates['byCategory'].items()}}
        rate_rows.append({'harness': name, 'frozenArm': arm, 'equal': rates[name] == expected})
        if rates[name] != expected:
            mismatches.append({'comparison': f'rates {name} vs results.json {arm}', 'harness': rates[name], 'frozen': expected})
    sections['mechanicalRates'] = {'rows': rate_rows, 'harness': rates}

    # 5. Whole evaluation of the stored Q4_K run against the fresh run's evaluation.
    evaluation_path = run_dir / 'evaluation.json'
    if evaluation_path.exists():
        from .evaluation import evaluate_run
        from .report import USEFUL_FAMILIES, verdict
        baseline_eval = load_json(evaluation_path)
        stored_run = {**run, 'items': stored['q4k']}
        stored_eval = evaluate_run(None, scratch=scratch, log=log, run=stored_run)
        fresh_rows = {row['id']: row for row in baseline_eval['items']}
        family_mismatch = []
        for row in stored_eval['items']:
            for family in USEFUL_FAMILIES:
                if verdict(row, family) != verdict(fresh_rows[row['id']], family):
                    family_mismatch.append({'item': row['id'], 'family': family,
                                            'stored': verdict(row, family), 'fresh': verdict(fresh_rows[row['id']], family)})
        sections['wholeEvaluation'] = {'comparison': 'stored Q4_K arm run evaluated now vs the fresh run evaluation',
                                       'families': [f for f in USEFUL_FAMILIES if f != 'judge'],
                                       'items': len(stored_eval['items']), 'differences': len(family_mismatch)}
        mismatches += [{'comparison': 'whole evaluation', **row} for row in family_mismatch]

    return {'schema': 'reploid.answer-regression.reproduction/v1', **label_block(), 'checkedAt': now_iso(),
            'run': {'runId': run['runId'], 'file': repo_relative(run_path), 'sha256': sha256_file(run_path)},
            'frozen': {name: {'file': repo_relative(USEFUL_ANSWER_DIR / name), 'sha256': sha} for name, sha in PINS.items()},
            'notUsed': 'results.json review, provisional rubric grades and reviewer-adjusted view (earlier grades)',
            'sections': sections, 'mismatches': mismatches,
            'verdict': 'reproduced exactly' if not mismatches else f'{len(mismatches)} differences'}
