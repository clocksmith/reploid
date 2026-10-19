"""Regression report: one run's evaluation against a stored baseline run of the same target.

Flags changed answers and every verdict that newly fails or newly passes, tracks pass rates (mechanical,
judge when both runs have one) and per-category counts, keeps per-item details, and labels every output
"automated regression evaluation — not independent acceptance".
"""
from pathlib import Path

from .common import (JUDGE_LABEL, LABEL, SEARCH_SET, SEARCH_SET_SHA256, SCOPE_NOTE, frozen_file,
                     label_block, load_json, now_iso, repo_relative, sha256_file)

USEFUL_FAMILIES = ('mechanical', 'format', 'instruction', 'code', 'judge')
SEARCH_FAMILIES = ('retrievalOutcome', 'answer', 'citations', 'claimCoverage', 'item', 'format', 'judge')
VOLATILE = ('seconds', 'runArmSeconds', 'loadSeconds', 'secondsOriginal', 'secondsReplaced', 'rawArmRunSha256', 'gitHead')


def load_pair(run_dir, evaluation=None):
    run_path = Path(run_dir) / 'run.json'
    evaluation_path = Path(evaluation).resolve() if evaluation else Path(run_dir) / 'evaluation.json'
    run, result = load_json(run_path), load_json(evaluation_path)
    if result['run']['sha256'] != sha256_file(run_path):
        raise SystemExit(f'{evaluation_path} does not evaluate {run_path}')
    return run, result, run_path, evaluation_path


def verdict(row, family):
    if row is None or row.get('notRun'):
        return None
    if family in ('retrievalOutcome', 'answer', 'citations', 'claimCoverage'):
        value = (row.get('search') or {}).get(family)
        return value.get('pass') if isinstance(value, dict) else None
    if family == 'item':
        return (row.get('search') or {}).get('pass')
    value = row.get(family)
    return value.get('pass') if isinstance(value, dict) else None


def flatten(value, prefix=''):
    if isinstance(value, dict):
        out = {}
        for key, inner in value.items():
            if key in VOLATILE:
                continue
            out.update(flatten(inner, f'{prefix}.{key}' if prefix else key))
        return out
    return {prefix: value}


def identity_changes(baseline, candidate):
    a, b = flatten(baseline.get('identities') or {}), flatten(candidate.get('identities') or {})
    rows = [{'path': key, 'baseline': a.get(key), 'candidate': b.get(key)} for key in sorted(set(a) | set(b)) if a.get(key) != b.get(key)]
    sampling = [row for row in rows if row['path'].split('.')[0] in ('sampling', 'limits')]
    return rows, bool(sampling)


def first_divergence(a, b):
    if a is None or b is None:
        return None
    for index, (x, y) in enumerate(zip(a, b)):
        if x != y:
            return index
    return None if len(a) == len(b) else min(len(a), len(b))


def turn_changes(base_item, cand_item):
    rows = []
    base_turns = {t['turn']: t for t in (base_item or {}).get('turns', [])}
    cand_turns = {t['turn']: t for t in (cand_item or {}).get('turns', [])}
    for number in sorted(set(base_turns) | set(cand_turns)):
        a, b = base_turns.get(number), cand_turns.get(number)
        if a is None or b is None:
            rows.append({'turn': number, 'changed': True, 'detail': 'turn present in only one run',
                         'baselineRan': a is not None, 'candidateRan': b is not None})
            continue
        text_changed = (a.get('output') or '') != (b.get('output') or '')
        tokens_changed = (a.get('outputTokenIds') != b.get('outputTokenIds')
                          if a.get('outputTokenIds') is not None and b.get('outputTokenIds') is not None else None)
        prompt_changed = (a.get('promptTokenIds') != b.get('promptTokenIds')
                          if a.get('promptTokenIds') is not None and b.get('promptTokenIds') is not None else None)
        row = {'turn': number, 'changed': bool(text_changed or tokens_changed), 'textChanged': text_changed,
               'tokensChanged': tokens_changed, 'promptChanged': prompt_changed}
        if row['changed']:
            row.update({'firstTokenDivergence': first_divergence(a.get('outputTokenIds'), b.get('outputTokenIds')),
                        'baselineStopReason': a.get('stopReason'), 'candidateStopReason': b.get('stopReason'),
                        'baselineOutput': a.get('output'), 'candidateOutput': b.get('output')})
        rows.append(row)
    return rows


def check_transitions(base_row, cand_row):
    """Individual check verdicts that changed, per turn and family."""
    changes = []

    def by_key(rows):
        return {(row.get('turn'), row['type'], index): row['pass'] for index, row in enumerate(rows or [])}

    if base_row and cand_row and not base_row.get('notRun') and not cand_row.get('notRun'):
        pairs = []
        for family in ('mechanical',):
            b = {t['turn']: t for t in (base_row.get(family) or {}).get('turns', [])}
            c = {t['turn']: t for t in (cand_row.get(family) or {}).get('turns', [])}
            for number in set(b) & set(c):
                pairs.append((family, number, b[number].get('checks'), c[number].get('checks')))
        b_turns = {t['turn']: t for t in base_row.get('turns', [])}
        c_turns = {t['turn']: t for t in cand_row.get('turns', [])}
        for number in set(b_turns) & set(c_turns):
            for family in ('format', 'instruction'):
                pairs.append((family, number, b_turns[number].get(family), c_turns[number].get(family)))
        for family, number, a, b in pairs:
            ka, kb = by_key(a), by_key(b)
            for key in sorted(set(ka) & set(kb), key=str):
                if ka[key] != kb[key]:
                    changes.append({'family': family, 'turn': number, 'check': key[1], 'baseline': ka[key], 'candidate': kb[key]})
    return changes


def tally(rows, family):
    graded = [verdict(row, family) for row in rows]
    graded = [v for v in graded if v is not None]
    return {'pass': sum(1 for v in graded if v), 'total': len(graded),
            'rate': round(sum(1 for v in graded if v) / len(graded), 4) if graded else None}


def validate_search_inputs(run):
    """Bind generated answers to the frozen documents and actual dispatched messages.

    Retrieval failures stay comparable failures. A generated answer with missing or
    changed source evidence cannot be attributed to a model/package regression.
    Verification, timing and cost metadata are deliberately outside this identity.
    """
    from .checks import prepare_retrieval
    data = frozen_file(SEARCH_SET, SEARCH_SET_SHA256, 'search-task set')
    if run['itemSet']['sha256'] != SEARCH_SET_SHA256:
        raise SystemExit('Search comparison requires the frozen search-task set')
    from .context_candidate import candidate_for_run
    candidate = candidate_for_run(run)
    items = {item['id']: item for item in data['items']}
    seen = set()
    for row in run['items']:
        item_id = row['id']
        if item_id in seen or item_id not in items:
            raise SystemExit(f'{item_id}: duplicate or unknown search item')
        seen.add(item_id)
        item = items[item_id]
        turns = row.get('turns') or []
        if len(turns) > 1:
            raise SystemExit(f'{item_id}: frozen search items have one turn')
        for turn in turns:
            if turn.get('dispatched') is not True:
                if turn.get('output') or turn.get('outputTokenIds'):
                    raise SystemExit(f'{item_id}: generated answer has no dispatched source evidence')
                continue
            if candidate:
                retained = candidate[0][item_id]
                expected = {'record': retained['retrieval'], 'dispatchedMessages': retained['dispatchedMessages']}
            else:
                expected = prepare_retrieval(item, data, [{'role': 'user', 'content': item['prompt']}])
            record = turn.get('retrieval') or {}
            if (record.get('outcome') != 'retrieved'
                    or record.get('sources') != expected['record']['sources']
                    or record.get('context') != expected['record']['context']
                    or turn.get('messages') != expected['dispatchedMessages']):
                raise SystemExit(f'{item_id}: generated answer does not bind the frozen source context and dispatched messages')


def compare_runs(baseline_dir, candidate_dir, baseline_evaluation=None, candidate_evaluation=None):
    b_run, b_eval, b_run_path, b_eval_path = load_pair(baseline_dir, baseline_evaluation)
    c_run, c_eval, c_run_path, c_eval_path = load_pair(candidate_dir, candidate_evaluation)
    if b_run['target']['id'] != c_run['target']['id'] or b_run['target']['kind'] != c_run['target']['kind']:
        raise SystemExit('The baseline and candidate must be runs of the same target '
                         f"({b_run['target']['id']} vs {c_run['target']['id']})")
    if b_run['itemSet']['sha256'] != c_run['itemSet']['sha256']:
        raise SystemExit('The baseline and candidate ran different item sets')
    if b_run['itemSet'].get('contextCandidate') != c_run['itemSet'].get('contextCandidate'):
        raise SystemExit('Changed source context requires a separate context-candidate baseline')
    kind = b_run['itemSet']['kind']
    if kind == 'search':
        validate_search_inputs(b_run)
        validate_search_inputs(c_run)
        item_rows = (b_run['items'], c_run['items'], b_eval['items'], c_eval['items'])
        memberships = [{row['id'] for row in rows} for rows in item_rows]
        if any(len(rows) != len(ids) for rows, ids in zip(item_rows, memberships)):
            raise SystemExit('Search comparison requires unique evaluated item IDs')
        # Evaluators retain notRun rows for the rest of a frozen set on partial runs.
        # Those placeholders must not conceal missing evaluations or changed subsets.
        run_ids = memberships[0]
        if (memberships[1] != run_ids or memberships[2] != memberships[3]
                or not run_ids <= memberships[2]
                or any(row['id'] not in run_ids and not row.get('notRun')
                       for rows in item_rows[2:] for row in rows)):
            raise SystemExit('Search comparison requires the same evaluated item IDs in both runs')
    families = USEFUL_FAMILIES if kind == 'useful-answer' else SEARCH_FAMILIES
    b_items = {row['id']: row for row in b_eval['items']}
    c_items = {row['id']: row for row in c_eval['items']}
    b_runs = {item['id']: item for item in b_run['items']}
    c_runs = {item['id']: item for item in c_run['items']}
    order = list(dict.fromkeys([row['id'] for row in b_eval['items']] + [row['id'] for row in c_eval['items']]))
    items, newly_failing, newly_passing = [], {f: [] for f in families}, {f: [] for f in families}
    for item_id in order:
        b_row, c_row = b_items.get(item_id), c_items.get(item_id)
        transitions = {}
        for family in families:
            a, b = verdict(b_row, family), verdict(c_row, family)
            if a == b:
                continue
            kind_of = ('newly failing' if a is True and b is False else 'newly passing' if a is False and b is True
                       else 'availability changed')
            transitions[family] = {'baseline': a, 'candidate': b, 'change': kind_of}
            if kind_of == 'newly failing':
                newly_failing[family].append(item_id)
            elif kind_of == 'newly passing':
                newly_passing[family].append(item_id)
        turns = turn_changes(b_runs.get(item_id), c_runs.get(item_id))
        row = (b_row or c_row)
        items.append({'id': item_id, 'category': row.get('category'), 'answerChanged': any(t['changed'] for t in turns),
                      'turns': turns, 'transitions': transitions, 'checkChanges': check_transitions(b_row, c_row),
                      'baseline': {f: verdict(b_row, f) for f in families}, 'candidate': {f: verdict(c_row, f) for f in families}})
    categories = list(dict.fromkeys(item['category'] for item in items))
    b_rows, c_rows = list(b_items.values()), list(c_items.values())
    rates = {family: {'baseline': tally(b_rows, family), 'candidate': tally(c_rows, family)} for family in families}
    if kind == 'useful-answer':
        rates['mechanical'] = {'baseline': b_eval['summary']['mechanical'], 'candidate': c_eval['summary']['mechanical']}
    judge_present = bool(b_eval.get('judge')) and bool(c_eval.get('judge'))
    if not judge_present:
        rates.pop('judge', None)
    by_category = {category: {family: {'baseline': tally([r for r in b_rows if r.get('category') == category], family),
                                       'candidate': tally([r for r in c_rows if r.get('category') == category], family)}
                              for family in families if family != 'judge' or judge_present}
                   for category in categories}
    changes, sampling_changed = identity_changes(b_run, c_run)
    changed_turns = sum(1 for item in items for turn in item['turns'] if turn['changed'])
    return {
        'schema': 'reploid.answer-regression.report/v1', **label_block(), 'comparedAt': now_iso(),
        'judgeLabel': JUDGE_LABEL if judge_present else None,
        'baseline': {'runId': b_run.get('runId'), 'run': repo_relative(b_run_path), 'runSha256': sha256_file(b_run_path),
                     'evaluation': repo_relative(b_eval_path), 'evaluationSha256': sha256_file(b_eval_path),
                     'judge': b_eval.get('judge')},
        'candidate': {'runId': c_run.get('runId'), 'run': repo_relative(c_run_path), 'runSha256': sha256_file(c_run_path),
                      'evaluation': repo_relative(c_eval_path), 'evaluationSha256': sha256_file(c_eval_path),
                      'judge': c_eval.get('judge')},
        'target': b_run['target'], 'itemSet': b_run['itemSet'],
        'identityChanges': changes,
        'samplingOrLimitsChanged': sampling_changed,
        'samplingNote': ('Sampling or limits differ between the runs, so answer differences are not attributable to arithmetic alone.'
                         if sampling_changed else None),
        'summary': {'answersChanged': changed_turns, 'itemsWithChangedAnswers': sum(1 for item in items if item['answerChanged']),
                    'newlyFailing': {f: ids for f, ids in newly_failing.items() if ids},
                    'newlyPassing': {f: ids for f, ids in newly_passing.items() if ids},
                    'newlyFailingTotal': sum(len(ids) for ids in newly_failing.values()),
                    'newlyPassingTotal': sum(len(ids) for ids in newly_passing.values()),
                    'rates': rates},
        'byCategory': by_category,
        'items': items,
    }


def fmt_rate(value):
    if not value or value.get('total') in (None, 0):
        return 'n/a'
    return f"{value['pass']}/{value['total']}" + (f" ({value['rate'] * 100:.1f}%)" if value.get('rate') is not None else '')


def excerpt(text, limit=160):
    text = (text or '').replace('\n', ' ⏎ ').replace('|', '\\|')
    return text if len(text) <= limit else text[:limit] + '…'


def render_markdown(report):
    lines = [f"# Answer regression report: {report['target']['id']}", '', f"**{LABEL}.**", '', SCOPE_NOTE, '']
    lines += ['| | Baseline | Candidate |', '|---|---|---|',
              f"| Run | `{report['baseline']['runId']}` | `{report['candidate']['runId']}` |",
              f"| Run sha256 | `{report['baseline']['runSha256'][:16]}…` | `{report['candidate']['runSha256'][:16]}…` |",
              f"| Item set | {report['itemSet']['name']} (`{report['itemSet']['sha256'][:16]}…`) | same |", '']
    if report['judgeLabel']:
        lines += [f"Judge rows are labeled **{report['judgeLabel']}**.", '']
    lines += ['## Identity changes', '']
    if report['identityChanges']:
        lines += ['| Identity | Baseline | Candidate |', '|---|---|---|']
        lines += [f"| `{row['path']}` | {excerpt(str(row['baseline']), 70)} | {excerpt(str(row['candidate']), 70)} |"
                  for row in report['identityChanges'][:60]]
        if len(report['identityChanges']) > 60:
            lines.append(f"| … | {len(report['identityChanges']) - 60} more in the JSON report | |")
    else:
        lines.append('None: both runs recorded the same package, model, Capsule, placement, sampling and limits.')
    if report['samplingNote']:
        lines += ['', f"**{report['samplingNote']}**"]
    summary = report['summary']
    lines += ['', '## Summary', '', f"- Changed answers: {summary['answersChanged']} turns in {summary['itemsWithChangedAnswers']} items.",
              f"- Newly failing verdicts: {summary['newlyFailingTotal']}; newly passing: {summary['newlyPassingTotal']}.", '',
              '| Verdict family | Baseline | Candidate |', '|---|---|---|']
    lines += [f"| {family} | {fmt_rate(values['baseline'])} | {fmt_rate(values['candidate'])} |"
              for family, values in summary['rates'].items()]
    for title, groups in (('Newly failing', summary['newlyFailing']), ('Newly passing', summary['newlyPassing'])):
        lines += ['', f'## {title}', '']
        lines += [f"- **{family}**: {', '.join(f'`{i}`' for i in ids)}" for family, ids in groups.items()] or ['None.']
    lines += ['', '## Changed answers', '']
    changed = [(item, turn) for item in report['items'] for turn in item['turns'] if turn['changed']]
    if changed:
        lines += ['| Item | Turn | First token divergence | Baseline | Candidate |', '|---|---|---|---|---|']
        lines += [f"| `{item['id']}` | {turn['turn']} | {turn.get('firstTokenDivergence')} | {excerpt(turn.get('baselineOutput'))} | "
                  f"{excerpt(turn.get('candidateOutput'))} |" for item, turn in changed]
    else:
        lines.append('None: every answer is identical to the baseline.')
    lines += ['', '## By category', '']
    families = [f for f in next(iter(report['byCategory'].values()), {}).keys()] if report['byCategory'] else []
    if families:
        lines += ['| Category | ' + ' | '.join(families) + ' |', '|---|' + '---|' * len(families)]
        for category, values in report['byCategory'].items():
            cells = [f"{fmt_rate(values[f]['baseline'])} → {fmt_rate(values[f]['candidate'])}" for f in families]
            lines.append(f'| {category} | ' + ' | '.join(cells) + ' |')
    detail = [item for item in report['items'] if item['transitions'] or item['checkChanges']]
    lines += ['', '## Item details', '']
    if detail:
        for item in detail:
            lines.append(f"- `{item['id']}` ({item['category']}): "
                         + '; '.join(f"{family} {t['baseline']} → {t['candidate']}" for family, t in item['transitions'].items())
                         + (' | checks: ' + ', '.join(f"t{c['turn']} {c['family']}.{c['check']} {c['baseline']} → {c['candidate']}"
                                                      for c in item['checkChanges']) if item['checkChanges'] else ''))
    else:
        lines.append('No verdict changed. Per-item details for every item are in the JSON report.')
    lines += ['', '---', f'*{LABEL}.*', '']
    return '\n'.join(lines)
