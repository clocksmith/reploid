"""Applies every configured check to one run and writes an evaluation record.

Verdict families per item: mechanical (frozen checks), format, instruction, code (useful-answer set);
retrievalOutcome, answer, citations, claimCoverage (search set); judge (only when a judge is configured).
"""
from pathlib import Path

from .common import (JUDGE_LABEL, SEARCH_SET, USEFUL_ANSWER_SET, environment_versions, harness_identity, label_block, load_json, now_iso,
                     repo_relative, retrieval_component_identity, sha256_file, sha256_text)
from . import checks
from .codeexec import run_case, run_reference

FORMAT_DEFINITION = {
    'nonEmpty': 'The delivered answer is not empty after trimming.',
    'stoppedOnEndOfTurn': "Generation stopped on the model's end-of-turn or stop token, not a length limit.",
    'noTemplateTokens': 'No chat-template control token (<|...|>, <think>) appears in the delivered text.',
    'noReplacementCharacters': 'No U+FFFD replacement character (broken decoding) appears.',
    'noDegenerateRepetition': 'No 12-word sequence occurs three times, and no line of 8+ characters repeats three times in a row.',
    'promptWithinRouteLimit': "The prompt fits the target's declared route prompt limit.",
}


def policy_letter(item, kind):
    if kind == 'search':
        return 'R'
    return 'S' if item['category'] == 'rewrite' else 'Q'


def rate(passed, total):
    return {'pass': passed, 'total': total, 'rate': round(passed / total, 4) if total else None}


def all_pass(rows):
    return all(row['pass'] for row in rows)


def evaluate_useful(data, run, sandbox, judge, log):
    overlay, overlay_sha = checks.load_overlay()
    if overlay['appliesTo']['sha256'] != run['itemSet']['sha256']:
        raise SystemExit('The overlay applies to a different item set')
    instructions = {(e['item'], e['turn']): e for e in overlay['instructionChecks']['items']}
    cases = {(c['item'], c['turn']): c for c in overlay['codeExecution']['cases']}
    references = [run_reference(sandbox, reference) for reference in overlay['codeExecution']['referencePrograms']]
    run_items = {item['id']: item for item in run['items']}
    rows = []
    for item in data['items']:
        run_item = run_items.get(item['id'])
        if run_item is None:
            rows.append({'id': item['id'], 'category': item['category'], 'notRun': True})
            continue
        mechanical = checks.mechanical_item(item, run_item)
        turns, instruction_rows, code_rows = [], [], []
        for planned_index in range(len(item['turns'])):
            number = planned_index + 1
            turn = run_item['turns'][planned_index] if planned_index < len(run_item['turns']) else None
            entry, case = instructions.get((item['id'], number)), cases.get((item['id'], number))
            if turn is None:
                turns.append({'turn': number, 'notRun': True})
                if entry:
                    instruction_rows.append({'type': 'turnNotRun', 'turn': number, 'pass': False, 'detail': 'turn not run'})
                if case:
                    code_rows.append({'item': item['id'], 'turn': number, 'pass': False, 'reason': 'turn not run'})
                continue
            output = turn.get('output') or ''
            fmt = checks.format_checks(turn)
            ins = [checks.instruction_check(check, output, sandbox) | {'turn': number} for check in entry['checks']] if entry else []
            instruction_rows += ins
            if case:
                code_rows.append(run_case(sandbox, case, output))
            turns.append({'turn': number, 'outputSha256': sha256_text(output), 'stopReason': turn.get('stopReason'),
                          'format': fmt, 'formatPass': all_pass(fmt), 'instruction': ins})
        ran = [t for t in turns if not t.get('notRun')]
        row = {'id': item['id'], 'category': item['category'], 'judgment': item['judgment'], 'policy': policy_letter(item, 'useful'),
               'turns': turns, 'mechanical': mechanical,
               'format': {'pass': bool(ran) and len(ran) == len(item['turns']) and all(t['formatPass'] for t in ran)},
               'instruction': {'pass': all_pass(instruction_rows) if instruction_rows else None},
               'code': {'pass': all_pass(code_rows) if code_rows else None, 'cases': code_rows}}
        if judge:
            row['judge'] = judge_item(judge, item, run_item, 'useful', code_rows, log)
        rows.append(row)
    return rows, {'overlay': {'file': repo_relative(checks.OVERLAY), 'sha256': overlay_sha},
                  'formatDefinition': FORMAT_DEFINITION, 'referencePrograms': references}


def evaluate_search(data, run, judge, log):
    from .context_candidate import candidate_for_run
    candidate = candidate_for_run(run)
    if candidate:
        from .report import validate_search_inputs
        validate_search_inputs(run)
    policy = candidate[1] if candidate else None
    run_items = {item['id']: item for item in run['items']}
    rows = []
    for item in data['items']:
        run_item = run_items.get(item['id'])
        if run_item is None or not run_item['turns']:
            rows.append({'id': item['id'], 'category': 'search', 'kind': item['kind'], 'notRun': True})
            continue
        result = checks.search_item(item, run_item, data, policy)
        turn = run_item['turns'][0]
        fmt = checks.format_checks(turn) if turn.get('dispatched') else []
        row = {'id': item['id'], 'category': 'search', 'kind': item['kind'], 'policy': 'R', 'search': result,
               'turns': [{'turn': 1, 'outputSha256': sha256_text(turn.get('output') or ''), 'stopReason': turn.get('stopReason'),
                          'format': fmt, 'formatPass': all_pass(fmt) if fmt else None}],
               'format': {'pass': all_pass(fmt) if fmt else None}}
        if judge and turn.get('dispatched') and result.get('exercised'):
            row['judge'] = judge_item(judge, item, run_item, 'search', [], log)
        rows.append(row)
    return rows, {'searchSet': {'file': repo_relative(SEARCH_SET), 'sha256': sha256_file(SEARCH_SET)},
                  'retrievalComponent': retrieval_component_identity(), 'formatDefinition': FORMAT_DEFINITION}


def judge_item(judge, item, run_item, kind, code_rows, log):
    """Judges each turn; the item passes only when every turn is whole-answer correct."""
    records, context = [], []
    for index, turn in enumerate(run_item['turns']):
        if not turn.get('dispatched'):
            continue
        prompt = turn.get('userTyped') or (item.get('prompt') if kind == 'search' else item['turns'][index]['user'])
        executions = [{'probes': c.get('probes'), 'reason': c.get('reason')} for c in code_rows if c.get('turn') == index + 1]
        record = judge.judge(item_id=item['id'], policy=policy_letter(item, kind), context=list(context), prompt=prompt,
                             answer=turn.get('output') or '', retrieval=turn.get('retrieval'), executions=executions)
        records.append({'turn': index + 1, **record})
        context.append({'prompt': prompt, 'answer': turn.get('output') or ''})
        log(f"judge {item['id']} turn {index + 1}: {record.get('status') or record.get('error')}")
    usable = [r for r in records if r.get('status')]
    complete = len(usable) == len(records) and len(records) == len(item.get('turns', [None]))
    if any(r['status'] != 'whole-answer-correct' for r in usable):
        verdict = False
    else:
        verdict = True if complete else None
    return {'label': JUDGE_LABEL, 'turns': records, 'pass': verdict}


def count(rows, family, key=None):
    values = [(row.get(family) or {}).get('pass') if key is None else ((row.get(family) or {}).get(key) or {}).get('pass')
              for row in rows if not row.get('notRun')]
    graded = [v for v in values if v is not None]
    return rate(sum(1 for v in graded if v), len(graded))


def summarize(kind, rows, data):
    categories = list(dict.fromkeys(row['category'] for row in rows))
    summary = {'items': len(rows), 'notRun': [row['id'] for row in rows if row.get('notRun')]}
    if kind == 'useful-answer':
        mechanical = [row for row in rows if row.get('judgment') == 'mechanical' and not row.get('notRun')]
        summary['mechanical'] = {**rate(sum(1 for r in mechanical if r['mechanical']['pass']), len(mechanical)),
                                 'note': 'Mechanical items only; the two rubric items are not graded by the harness.'}
        summary['rubricItemsNotGraded'] = [row['id'] for row in rows if row.get('judgment') == 'human']
        summary['format'] = count(rows, 'format')
        summary['instruction'] = count(rows, 'instruction')
        summary['code'] = count(rows, 'code')
        summary['byCategory'] = {category: {
            'items': sum(1 for r in rows if r['category'] == category),
            'mechanical': rate(sum(1 for r in mechanical if r['category'] == category and r['mechanical']['pass']),
                               sum(1 for r in mechanical if r['category'] == category)),
            'format': count([r for r in rows if r['category'] == category], 'format'),
            'instruction': count([r for r in rows if r['category'] == category], 'instruction'),
            'code': count([r for r in rows if r['category'] == category], 'code'),
            **({'judge': count([r for r in rows if r['category'] == category], 'judge')}
               if any('judge' in r for r in rows) else {})} for category in categories}
    else:
        exercised = [row for row in rows if not row.get('notRun') and row['search'].get('exercised')]
        summary['exercised'] = len(exercised)
        summary['unexercised'] = [row['id'] for row in rows if row.get('notRun') or not row['search'].get('exercised')]
        for family in ('retrievalOutcome', 'answer', 'citations', 'claimCoverage'):
            summary[family] = count(exercised, 'search', family)
        summary['item'] = count(exercised, 'search')
        summary['format'] = count(exercised, 'format')
    if any('judge' in row for row in rows):
        summary['judge'] = {**count(rows, 'judge'), 'label': JUDGE_LABEL,
                            'errors': sum(1 for r in rows for t in (r.get('judge') or {}).get('turns', []) if t.get('error'))}
    return summary


def evaluate_run(run_path, judge_path=None, scratch=None, log=print, run=None):
    run = run if run is not None else load_json(run_path)
    run_sha = sha256_file(run_path) if run_path else None
    kind = run['itemSet']['kind']
    set_path = USEFUL_ANSWER_SET if kind == 'useful-answer' else SEARCH_SET
    if sha256_file(set_path) != run['itemSet']['sha256']:
        raise SystemExit(f'The run used a different {kind} set than the one in this checkout')
    data = load_json(set_path)
    judge = None
    if judge_path:
        from .judge import load_judge
        judge = load_judge(judge_path, run)
    sandbox = checks.new_sandbox(scratch, 10)
    try:
        if kind == 'useful-answer':
            rows, sources = evaluate_useful(data, run, sandbox, judge, log)
        else:
            rows, sources = evaluate_search(data, run, judge, log)
        environment = sandbox.environment()
    finally:
        sandbox.close()
    return {
        'schema': 'reploid.answer-regression.evaluation/v1', **label_block(), 'evaluatedAt': now_iso(),
        'harness': harness_identity(),
        'run': {'runId': run.get('runId'), 'file': repo_relative(run_path) if run_path else None, 'sha256': run_sha,
                'target': run['target']},
        'itemSet': run['itemSet'],
        'checkSources': {'mechanical': checks.frozen_identity(), **sources,
                         'codeExecution': environment, 'harnessEnvironment': environment_versions()},
        'judge': judge.describe() if judge else None,
        'summary': summarize(kind, rows, data),
        'items': rows,
    }


def evaluation_path(run_dir, explicit=None):
    return Path(explicit).resolve() if explicit else Path(run_dir) / 'evaluation.json'
