"""Apply the frozen set's declared checks to both arms, classify Q4_K failures, and report
useful-answer rates.

Inputs are the two arm runs from run-arm.py, the frozen answer-set.json, an optional review
file (provisional rubric grades for the 'human' items and the reviewer's notes on mechanical
verdicts; it never changes a mechanical verdict), and ../answer-cause-20261014 for the
reproduction checks. The check semantics are the ones written in answer-set.json checkTypes.

Classification of each item graded in both arms:
  both pass; source-model failure (both fail); quantization-caused (bf16 passes, Q4_K fails);
  Q4_K-only pass (Q4_K passes, bf16 fails).

Usage:
  python3 -I check.py <answer-set.json> <q4k-run.json> <bf16-run.json> <review.json or ->
      <answer-cause dir> <out.json>
"""
import hashlib
import json
import re
import statistics
import sys
from pathlib import Path

SET_PATH, Q4K_PATH, BF16_PATH, REVIEW_PATH, ANSWER_CAUSE, OUT = sys.argv[1:7]
ARMS = ('q4k', 'bf16')
# Largest top-5 logit difference between Doppler's GPU route and the q4k CPU control in
# ../answer-cause-20261014 (README "What matched"). A Q4_K step whose top-1/top-2 margin is
# below this could pick a different token on the GPU route than in the CPU control.
GPU_CONTROL_MAX_LOGIT_DIFF = 0.0015


def load_json(path):
    with open(path) as handle:
        return json.load(handle)


# ---- text helpers ---------------------------------------------------------------------

def normalize(text):
    text = (text.replace(' ', ' ').replace('‘', "'").replace('’', "'")
            .replace('“', '"').replace('”', '"'))
    text = text.replace('**', '').replace('__', '').replace('`', '')
    return re.sub(r'[ \t]+', ' ', text)


def unfence(text):
    text = text.strip()
    match = re.fullmatch(r'```[^\n]*\n(.*?)\n?```', text, re.S)
    return match.group(1).strip() if match else text


def skip_lead_in(text):
    lines = text.strip().split('\n')
    if lines and normalize(lines[0]).strip().strip('*_ ').endswith(':'):
        return '\n'.join(lines[1:])
    return text


def flags(check):
    return 0 if check.get('caseSensitive') else re.IGNORECASE


def numbers_in(text):
    text = normalize(text).replace('−', '-')
    text = re.sub(r'(?<=\d),(?=\d{3}\b)', '', text)
    text = re.sub(r'[$€£]', '', text)
    values = []
    for match in re.finditer(r'(-?)(\d+(?:\.\d+)?)', text):
        start = match.start()
        if start > 0 and (text[start - 1].isdigit() or text[start - 1] == '.'):
            continue
        negative = match.group(1) == '-' and not (start > 0 and text[start - 1].isalnum())
        value = float(match.group(2))
        values.append(-value if negative else value)
    return values


ARRAY = re.compile(r'\[\s*(-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?)*)?\s*\]')


def arrays_in(text):
    found = []
    for match in ARRAY.finditer(text.replace('−', '-')):
        inner = match.group(1)
        found.append([float(x) for x in re.split(r'\s*,\s*', inner.strip())] if inner else [])
    return found


ABBREVIATIONS = re.compile(r'\b(a\.m\.|p\.m\.|e\.g\.|i\.e\.|vs\.|mr\.|mrs\.|ms\.|dr\.)', re.IGNORECASE)


def sentence_count(text):
    text = ABBREVIATIONS.sub(lambda m: m.group(0).replace('.', ''), normalize(text))
    text = re.sub(r'\s+', ' ', text).strip()
    count = len(re.findall(r'[.!?]+(?=["\')\]]*(\s|$))', text))
    if text and not re.search(r'[.!?]["\')\]]*$', text):
        count += 1
    return count


# ---- checks ---------------------------------------------------------------------------

def run_check(check, output):
    kind = check['type']
    text = normalize(output)
    if kind in ('contains', 'excludes'):
        values = check.get('any') or check.get('all')
        hay = text if check.get('caseSensitive') else text.lower()
        hits = [v for v in values if (v if check.get('caseSensitive') else v.lower()) in hay]
        if kind == 'excludes':
            return not hits, f'found {hits}' if hits else 'none found'
        ok = len(hits) == len(values) if 'all' in check else bool(hits)
        return ok, f'found {hits}'
    if kind in ('regex', 'notRegex'):
        match = re.search(check['pattern'], text, flags(check))
        ok = bool(match) if kind == 'regex' else not match
        return ok, f'match {match.group(0)!r}' if match else 'no match'
    if kind == 'number':
        values = numbers_in(output)
        ok = any(abs(v - check['value']) <= check['tolerance'] + 1e-9 for v in values)
        return ok, f'numbers {values[:40]}'
    if kind == 'onlyAnswer':
        answer = normalize(unfence(output)).strip().strip('*_').strip()
        if len(answer) >= 2 and answer[0] == answer[-1] and answer[0] in '"\'':
            answer = answer[1:-1].strip()
        if answer.endswith(('.', '!')):
            answer = answer[:-1].strip()
        return bool(re.fullmatch(check['pattern'], answer, flags(check))), f'answer {answer[:80]!r}'
    if kind == 'finalArray':
        ignore = [[float(x) for x in a] for a in check.get('ignore', [])]
        stated = [a for a in arrays_in(output) if a not in ignore]
        final = stated[-1] if stated else None
        return final == [float(x) for x in check['equals']], f'final {final}'
    if kind in ('bullets', 'numberedList', 'lines'):
        source = unfence(output) if kind == 'lines' else output
        lines = [line for line in source.split('\n') if line.strip()]
        if kind == 'lines':
            return len(lines) == check['count'], f'{len(lines)} lines'
        pattern = r'^\s*[-*+•‣▪◦]\s+\S' if kind == 'bullets' else r'^\s*\d+[.)]\s+\S'
        marked = [line for line in lines if re.match(pattern, line)]
        ok = len(marked) == check['count'] and (not check.get('only') or len(marked) == len(lines))
        detail = f'{len(marked)} marked of {len(lines)} lines'
        if kind == 'numberedList' and ok and 'itemsFrom' in check:
            allowed = {name.lower() for name in check['itemsFrom']}
            names = [normalize(re.sub(r'^\s*\d+[.)]\s+', '', line)).strip().strip('*_').strip().rstrip('.,;:!').strip().lower()
                     for line in marked]
            ok = all(name in allowed for name in names) and (not check.get('distinct') or len(set(names)) == len(names))
            detail += f'; items {names}'
        return ok, detail
    if kind == 'words':
        source = skip_lead_in(output) if check.get('skipLeadIn') else output
        count = len([w for w in normalize(source).split() if re.search(r'[A-Za-z0-9]', w)])
        ok = check.get('min', 0) <= count <= check.get('max', float('inf'))
        return ok, f'{count} words'
    if kind == 'sentences':
        source = skip_lead_in(output) if check.get('skipLeadIn') else output
        count = sentence_count(source)
        ok = check.get('min', 0) <= count <= check.get('max', float('inf'))
        return ok, f'{count} sentences'
    if kind == 'json':
        try:
            value = json.loads(unfence(output))
        except ValueError as error:
            return False, f'not JSON: {error}'
        expected = check['equals']
        if not isinstance(value, dict) or set(value) != set(expected):
            return False, f'keys {list(value) if isinstance(value, dict) else type(value).__name__}'
        same = all(str(value[k]).strip().lower() == str(v).strip().lower() if isinstance(v, str) else value[k] == v
                   for k, v in expected.items())
        return same, f'value {value}'
    raise ValueError(f'unknown check type {kind}')


# ---- scoring --------------------------------------------------------------------------

def grade_arm(item, run_item, review):
    turns, all_pass, over_limit = [], True, False
    for index, spec in enumerate(item['turns']):
        if index >= len(run_item['turns']):
            turns.append({'turn': index + 1, 'notRun': True, 'pass': False})
            all_pass = False
            continue
        row = run_item['turns'][index]
        over_limit |= row['overPromptLimit']
        empty = not row['output'].strip()
        checks = []
        for check in spec['checks']:
            ok, detail = run_check(check, row['output'])
            checks.append({'type': check['type'], 'pass': ok, 'detail': detail})
        turn_pass = not empty and all(c['pass'] for c in checks)
        all_pass &= turn_pass
        turns.append({'turn': index + 1, 'promptTokenCount': row['promptTokenCount'],
                      'overPromptLimit': row['overPromptLimit'], 'output': row['output'],
                      'stopReason': row['stopReason'], 'decodeSteps': row['decodeSteps'], 'seconds': row['seconds'],
                      'reusedFrom': row.get('reusedFrom'), 'minMarginTop1Top2': row['minMarginTop1Top2'],
                      'empty': empty, 'checks': checks, 'pass': turn_pass})
    result = {'turns': turns, 'overPromptLimit': over_limit}
    if item['judgment'] == 'human':
        grade = review.get('humanItems', {}).get(item['id'], {}).get(run_item['arm'])
        result.update({'grading': 'rubric, provisional', 'pass': None if grade is None else bool(grade['pass']) and not over_limit,
                       'rubricGrade': grade})
    else:
        result.update({'grading': 'mechanical', 'pass': all_pass and not over_limit, 'checksPass': all_pass})
    if over_limit:
        result['status'] = 'promptLimitExceeded'
    return result


def classify(q4k_pass, bf16_pass):
    if q4k_pass is None or bf16_pass is None:
        return None
    if q4k_pass and bf16_pass:
        return 'both pass'
    if not q4k_pass and not bf16_pass:
        return 'source-model failure'
    return 'quantization-caused' if bf16_pass else 'Q4_K-only pass'


def rate(rows, arm):
    graded = [r for r in rows if r['arms'][arm]['pass'] is not None]
    passed = sum(1 for r in graded if r['arms'][arm]['pass'])
    return {'pass': passed, 'total': len(graded), 'rate': round(passed / len(graded), 4) if graded else None}


def first_divergence(a, b):
    for index, (x, y) in enumerate(zip(a, b)):
        if x != y:
            return index
    return None if len(a) == len(b) else min(len(a), len(b))


def main():
    set_bytes = Path(SET_PATH).read_bytes()
    answer_set = json.loads(set_bytes)
    set_sha = hashlib.sha256(set_bytes).hexdigest()
    runs = {'q4k': load_json(Q4K_PATH), 'bf16': load_json(BF16_PATH)}
    review = load_json(REVIEW_PATH) if REVIEW_PATH != '-' else {}
    for arm, run in runs.items():
        assert run['arm'] == arm and run['answerSetSha256'] == set_sha, (arm, run['answerSetSha256'])
        assert run['convReplacementCheck']['logitsBitIdentical'] is True
    by_id = {arm: {i['id']: dict(i, arm=arm) for i in run['items']} for arm, run in runs.items()}

    rows = []
    for item in answer_set['items']:
        arms = {arm: grade_arm(item, by_id[arm][item['id']], review) for arm in ARMS}
        turn_compare = []
        for index in range(min(len(by_id['q4k'][item['id']]['turns']), len(by_id['bf16'][item['id']]['turns']))):
            a = by_id['q4k'][item['id']]['turns'][index]
            b = by_id['bf16'][item['id']]['turns'][index]
            turn_compare.append({'turn': index + 1, 'samePrompt': a['promptTokenIds'] == b['promptTokenIds'],
                                 'sameOutputTokens': a['outputTokenIds'] == b['outputTokenIds'],
                                 'firstTokenDivergence': first_divergence(a['outputTokenIds'], b['outputTokenIds'])})
        rows.append({'id': item['id'], 'category': item['category'], 'judgment': item['judgment'],
                     'expected': item['expected'], 'origin': item.get('origin'),
                     'classification': classify(arms['q4k']['pass'], arms['bf16']['pass']),
                     'arms': arms, 'q4kVsBf16': turn_compare})

    categories = list(dict.fromkeys(item['category'] for item in answer_set['items']))
    mechanical = [r for r in rows if r['judgment'] == 'mechanical']

    def rate_block(subset):
        return {'overall': {arm: rate(subset, arm) for arm in ARMS},
                'byCategory': {c: {arm: rate([r for r in subset if r['category'] == c], arm) for arm in ARMS}
                               for c in categories}}

    classes = ['both pass', 'source-model failure', 'quantization-caused', 'Q4_K-only pass']
    classification = {'mechanicalItems': {c: [r['id'] for r in mechanical if r['classification'] == c] for c in classes},
                      'allItemsWithProvisionalRubric': {c: [r['id'] for r in rows if r['classification'] == c] for c in classes}}

    # Reproduction of ../answer-cause-20261014 by the same harness.
    cause = Path(ANSWER_CAUSE)
    control = load_json(cause / 'q4k-weights-control.json')
    reference = load_json(cause / 'hf-reference.json')
    failed = load_json(cause / 'failed-examples.json')
    q = by_id['q4k']
    reproduction = {
        'q4kCodeDoubleEvensEqualsAnswerCauseControlTurn1': q['code-double-evens']['turns'][0]['outputTokenIds'] == control['turns'][0]['greedy']['tokenIds'],
        'q4kCodeDoubleEvensEqualsDeliveredRun5Turn1': q['code-double-evens']['turns'][0]['outputTokenIds'] == failed['examples'][0]['distributed']['run-5']['outputTokenIds'],
        'q4kFollowUpTurn2PromptEqualsDelivered': q['fu-double-evens']['turns'][1]['promptTokenIds'] == failed['examples'][1]['promptTokenIds'],
        'q4kFollowUpTurn2EqualsAnswerCauseControlTurn2': q['fu-double-evens']['turns'][1]['outputTokenIds'] == control['turns'][1]['greedy']['tokenIds'],
        'q4kFollowUpTurn2EqualsDeliveredRun5Turn2': q['fu-double-evens']['turns'][1]['outputTokenIds'] == failed['examples'][1]['distributed']['run-5']['outputTokenIds'],
        'bf16CodeDoubleEvensEqualsAnswerCauseReferenceFloat32Turn1': by_id['bf16']['code-double-evens']['turns'][0]['outputTokenIds'] == reference['turns'][0]['variants']['float32']['greedy']['tokenIds'],
    }

    prompt_checks, near_ties, timing = {}, [], {}
    for arm, run in runs.items():
        turns = [t for i in run['items'] for t in i['turns']]
        generated = [t for t in turns if not t.get('reusedFrom')]
        prompt_checks[arm] = {
            'turns': len(turns), 'maxPromptTokens': max(t['promptTokenCount'] for t in turns),
            'overPromptLimit': [f"{i['id']} turn {t['turn']} ({t['promptTokenCount']})" for i in run['items'] for t in i['turns'] if t['overPromptLimit']],
            'officialTemplateEqualsApplication': sum(t['officialTemplateEqualsApplication'] for t in turns),
            'hfTokenIdsEqualApplication': sum(t['hfTokenIdsEqualApplication'] for t in turns),
            'hfDecodeEqualsApplication': sum(t['hfDecodeEqualsApplication'] for t in turns),
            'padArgmaxSteps': sum(t['padArgmaxSteps'] for t in generated),
            'stopReasons': {s: sum(1 for t in generated if t['stopReason'] == s) for s in sorted({t['stopReason'] for t in generated})}}
        timing[arm] = {'generations': len(generated), 'decodeSteps': sum(t['decodeSteps'] for t in generated),
                       'generationSeconds': round(sum(t['seconds'] for t in generated), 1),
                       'medianTokensPerSecond': statistics.median(t['tokensPerSecond'] for t in generated),
                       'runSecondsIncludingLoadAndCheck': run['seconds'], 'loadSeconds': run['loadSeconds']}
    # Margins are stored rounded to 4 decimals, so list every turn below twice the threshold
    # and say which are below the threshold itself.
    for i in runs['q4k']['items']:
        for t in i['turns']:
            if not t.get('reusedFrom') and t['minMarginTop1Top2'] is not None and t['minMarginTop1Top2'] < 2 * GPU_CONTROL_MAX_LOGIT_DIFF:
                near_ties.append({'id': i['id'], 'turn': t['turn'], 'minMargin': t['minMarginTop1Top2'], 'step': t['minMarginStep'],
                                  'belowThreshold': t['minMarginTop1Top2'] < GPU_CONTROL_MAX_LOGIT_DIFF,
                                  'stepsBelowThreshold': sum(1 for m in t['marginsTop1Top2'] if m < GPU_CONTROL_MAX_LOGIT_DIFF),
                                  'stepsBelowTwiceThreshold': sum(1 for m in t['marginsTop1Top2'] if m < 2 * GPU_CONTROL_MAX_LOGIT_DIFF)})

    # Reviewer-adjusted view: the review's 'false pass' / 'false fail' entries flip the
    # mechanical verdict. Reported separately; the declared verdicts above are unchanged.
    disagreements = review.get('mechanicalVerdictReview', [])
    flips = {(e['id'], e['arm']): e['kind'] for e in disagreements if e['kind'] in ('false pass', 'false fail')}
    adjusted_rows = []
    for r in mechanical:
        arms = {arm: {'pass': r['arms'][arm]['pass']} for arm in ARMS}
        for arm in ARMS:
            kind = flips.get((r['id'], arm))
            arms[arm]['pass'] = (kind == 'false fail') if kind else r['arms'][arm]['pass']
        adjusted_rows.append({'id': r['id'], 'category': r['category'], 'arms': arms,
                              'classification': classify(arms['q4k']['pass'], arms['bf16']['pass'])})
    reviewer_adjusted = {'note': 'Mechanical items with the reviewer\'s false-pass / false-fail readings applied. '
                                 'Not the declared verdicts.',
                         'rates': rate_block(adjusted_rows),
                         'classification': {c: [r['id'] for r in adjusted_rows if r['classification'] == c] for c in classes},
                         'flipped': [{'id': k[0], 'arm': k[1], 'kind': v} for k, v in flips.items()]}
    report = {'schema': 'reploid.useful-answer-set.results/v1', 'answerSetSha256': set_sha,
              'settings': answer_set['settings'],
              'arms': {arm: {'model': {k: v for k, v in run['model'].items() if k not in ('shards', 'checkpointFiles')},
                             'versions': run['versions'], 'threads': run['threads'], 'maxTokensUsed': run['maxTokensUsed'],
                             'convReplacementCheck': run['convReplacementCheck']} for arm, run in runs.items()},
              'reproduction': reproduction, 'promptChecks': prompt_checks, 'timing': timing,
              'rates': {'mechanicalItems': rate_block(mechanical), 'allItemsWithProvisionalRubric': rate_block(rows)},
              'classification': classification,
              'q4kNearTies': {'threshold': GPU_CONTROL_MAX_LOGIT_DIFF, 'turns': near_ties},
              'review': {'grader': review.get('grader'), 'mechanicalVerdictReview': disagreements,
                         'reviewerAdjusted': reviewer_adjusted},
              'items': rows}
    with open(OUT, 'x') as handle:
        json.dump(report, handle, indent=1, ensure_ascii=False)
        handle.write('\n')

    def fmt(r):
        return f"{r['pass']}/{r['total']}"
    print(json.dumps({'reproduction': reproduction, 'promptChecks': prompt_checks, 'timing': timing}, indent=1))
    for name, block in list(report['rates'].items()) + [('reviewerAdjusted', reviewer_adjusted['rates'])]:
        print(f'\n{name}\n| Category | Q4_K | bf16 |\n|---|---|---|')
        for c, arms in block['byCategory'].items():
            print(f"| {c} | {fmt(arms['q4k'])} | {fmt(arms['bf16'])} |")
        print(f"| overall | {fmt(block['overall']['q4k'])} | {fmt(block['overall']['bf16'])} |")
    for name, groups in list(classification.items()) + [('reviewerAdjusted', reviewer_adjusted['classification'])]:
        print(f'\n{name}: ' + json.dumps({c: len(v) for c, v in groups.items()}))
        for c, ids in groups.items():
            if c != 'both pass':
                print(f'  {c}: {ids}')
    print('\nnear ties:', json.dumps(near_ties))


if __name__ == '__main__':
    main()
