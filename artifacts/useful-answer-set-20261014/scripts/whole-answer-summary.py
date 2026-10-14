"""Validate whole-answer-assessment.json and summarize it beside the mechanical scores.

Checks: every item, arm and turn in the two runs is assessed exactly once against the
delivered answer text; every element has a kind, claim, valid grade, basis, at least one
source and a reviewer; every execution record matches code-execution.json; each answer's
status and flags follow from its element grades.

Answer status: 'whole-answer correct' (all elements correct), 'has incorrect element', or
'unverified, no incorrect element'. An item's status combines its turns in the same order of
precedence (any incorrect, then any unverified, else correct). Mechanical verdicts are read
from results.json unchanged.

Usage:
  python3 -I whole-answer-summary.py <answer-set.json> <q4k-run.json> <bf16-run.json> <results.json>
      <code-execution.json> <whole-answer-assessment.json> <out.json>
"""
import json
import sys

SET_PATH, Q4K, BF16, RESULTS, EXECUTION, ASSESSMENT, OUT = sys.argv[1:8]
ARMS = ('q4k', 'bf16')
STATUSES = ('whole-answer correct', 'has incorrect element', 'unverified, no incorrect element')
KINDS = {'fact', 'example', 'code-executed', 'code-general', 'instruction'}


def load(path):
    with open(path) as handle:
        return json.load(handle)


def status_of(grades):
    if 'incorrect' in grades:
        return 'has incorrect element'
    if 'unverified' in grades:
        return 'unverified, no incorrect element'
    return 'whole-answer correct'


def main():
    answer_set, results, execution, assessment = load(SET_PATH), load(RESULTS), load(EXECUTION), load(ASSESSMENT)
    runs = {'q4k': load(Q4K), 'bf16': load(BF16)}
    assert assessment['answerSetSha256'] == results['answerSetSha256']
    assert assessment['reviewer']['humanPanel'] is False
    cases = {f"{c['item']}/{c['arm'] or c['source']}": c for c in execution['cases']}

    expected = {(i['id'], arm, t['turn']): t['output'] for arm in ARMS for i in runs[arm]['items'] for t in i['turns']}
    seen = {}
    for answer in assessment['answers']:
        key = (answer['id'], answer['arm'], answer['turn'])
        assert key in expected and key not in seen, key
        assert answer['answer'] == expected[key], key
        assert answer['elements'], key
        for element in answer['elements']:
            assert element['kind'] in KINDS and element['grade'] in ('correct', 'incorrect', 'unverified'), (key, element)
            assert element['claim'] and element['basis'] and element['sources'] and element['reviewer'], (key, element)
            for record in element.get('execution', []):
                case = cases[record['case']]
                assert record['stdout'] == case['stdout'] and record['exitStatus'] == case['exitCode'], (key, record['case'])
            exec_sources = [s['case'] for s in element['sources'] if s['type'] == 'execution']
            assert exec_sources == [r['case'] for r in element.get('execution', [])], key
        grades = [e['grade'] for e in answer['elements']]
        assert answer['status'] == status_of(grades), key
        assert answer['wholeAnswerCorrect'] == (answer['status'] == 'whole-answer correct'), key
        assert answer['anyIncorrect'] == ('incorrect' in grades) and answer['anyUnverified'] == ('unverified' in grades), key
        assert answer['anyInstructionViolation'] == any(e['kind'] == 'instruction' and e['grade'] == 'incorrect'
                                                        for e in answer['elements']), key
        seen[key] = answer
    assert set(seen) == set(expected), set(expected) - set(seen)

    mechanical = {i['id']: i for i in results['items']}
    categories = list(dict.fromkeys(i['category'] for i in answer_set['items']))
    items = []
    for item in answer_set['items']:
        row = {'id': item['id'], 'category': item['category'], 'judgment': item['judgment'], 'arms': {}}
        for arm in ARMS:
            turns = [a for k, a in seen.items() if k[0] == item['id'] and k[1] == arm]
            grades = [e['grade'] for a in turns for e in a['elements']]
            row['arms'][arm] = {'status': status_of(grades), 'mechanicalPass': mechanical[item['id']]['arms'][arm]['pass'],
                                'failingElements': [f"turn {a['turn']}: {f}" for a in sorted(turns, key=lambda a: a['turn'])
                                                    for f in a['failingElements']]}
        items.append(row)

    def item_counts(rows):
        out = {}
        for arm in ARMS:
            counts = {s: sum(1 for r in rows if r['arms'][arm]['status'] == s) for s in STATUSES}
            mech = [r for r in rows if r['judgment'] == 'mechanical']
            counts.update({'items': len(rows), 'mechanicalPass': sum(1 for r in mech if r['arms'][arm]['mechanicalPass']),
                           'mechanicalItems': len(mech)})
            out[arm] = counts
        return out

    def answer_counts(arm, category=None):
        rows = [a for k, a in seen.items() if k[1] == arm and (category is None or a['category'] == category)]
        return {'answers': len(rows), 'wholeAnswerCorrect': sum(a['wholeAnswerCorrect'] for a in rows),
                'anyIncorrect': sum(a['anyIncorrect'] for a in rows), 'anyUnverified': sum(a['anyUnverified'] for a in rows),
                'anyInstructionViolation': sum(a['anyInstructionViolation'] for a in rows),
                'elements': sum(len(a['elements']) for a in rows),
                'incorrectElements': sum(e['grade'] == 'incorrect' for a in rows for e in a['elements']),
                'unverifiedElements': sum(e['grade'] == 'unverified' for a in rows for e in a['elements'])}

    summary = {
        'schema': 'reploid.useful-answer-set.whole-answer-summary/v1', 'answerSetSha256': results['answerSetSha256'],
        'reviewer': assessment['reviewer'],
        'itemStatus': {'byCategory': {c: item_counts([r for r in items if r['category'] == c]) for c in categories},
                       'overall': item_counts(items)},
        'answerLevel': {arm: {'overall': answer_counts(arm), 'byCategory': {c: answer_counts(arm, c) for c in categories}}
                        for arm in ARMS},
        'mechanicalPassButNotWholeAnswerCorrect': {arm: [r['id'] for r in items if r['judgment'] == 'mechanical' and r['arms'][arm]['mechanicalPass']
                                                         and r['arms'][arm]['status'] != 'whole-answer correct'] for arm in ARMS},
        'wholeAnswerCorrectButMechanicalFail': {arm: [r['id'] for r in items if r['judgment'] == 'mechanical' and r['arms'][arm]['mechanicalPass'] is False
                                                      and r['arms'][arm]['status'] == 'whole-answer correct'] for arm in ARMS},
        'items': items}
    with open(OUT, 'x') as handle:
        json.dump(summary, handle, indent=1, ensure_ascii=False)
        handle.write('\n')

    print('| Category | Items | Q4_K mechanical | Q4_K whole-answer correct | Q4_K has incorrect | Q4_K unverified only '
          '| bf16 mechanical | bf16 whole-answer correct | bf16 has incorrect | bf16 unverified only |')
    print('|---|---|---|---|---|---|---|---|---|---|')
    for name, block in list(summary['itemStatus']['byCategory'].items()) + [('overall', summary['itemStatus']['overall'])]:
        q, b = block['q4k'], block['bf16']
        cells = []
        for x in (q, b):
            cells += [f"{x['mechanicalPass']}/{x['mechanicalItems']}", str(x['whole-answer correct']),
                      str(x['has incorrect element']), str(x['unverified, no incorrect element'])]
        print(f"| {name} | {q['items']} | " + ' | '.join(cells) + ' |')
    print()
    for arm in ARMS:
        print(arm, json.dumps(summary['answerLevel'][arm]['overall']))
    print('mechanical pass but not whole-answer correct:', json.dumps(summary['mechanicalPassButNotWholeAnswerCorrect']))
    print('whole-answer correct but mechanical fail:', json.dumps(summary['wholeAnswerCorrectButMechanicalFail']))


if __name__ == '__main__':
    main()
