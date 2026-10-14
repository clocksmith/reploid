"""Prompt-size preflight for the useful-answer set, run before any model.

Renders every turn-1 prompt through the application text path (doppler-text.mjs) and
reports its token count against the 250-token limit. For two-turn items it also renders
turn 2 with an empty assistant answer, which gives the number of tokens a turn-1 answer
may use before turn 2 crosses the limit (the budget). Also checks that no numeric
expected value already appears in its own prompt, so a 'number' check cannot pass by
echoing the question.

Usage:
  python3 -I preflight.py <answer-set.json> <doppler package root> <capsule dir> <out.json>
"""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

SET_PATH, PACKAGE, CAPSULE, OUT = sys.argv[1:5]
HELPER = Path(__file__).resolve().parent / 'doppler-text.mjs'


class DopplerText:
    def __init__(self):
        self.proc = subprocess.Popen(['node', str(HELPER), PACKAGE, CAPSULE], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        self.ready = self._read()

    def _read(self):
        reply = json.loads(self.proc.stdout.readline())
        if not reply.get('ok'):
            raise RuntimeError(reply.get('error'))
        return reply

    def call(self, **request):
        self.proc.stdin.write(json.dumps(request) + '\n')
        self.proc.stdin.flush()
        return self._read()

    def close(self):
        self.proc.stdin.close()
        self.proc.wait()


def numbers(text):
    return {float(m.replace(',', '')) for m in re.findall(r'\d+(?:,\d{3})*(?:\.\d+)?', text)}


def main():
    raw = Path(SET_PATH).read_bytes()
    answer_set = json.loads(raw)
    limit = answer_set['settings']['promptTokenLimit']
    helper = DopplerText()
    rows, problems = [], []
    for item in answer_set['items']:
        turns = item['turns']
        first = helper.call(op='render', messages=[{'role': 'user', 'content': turns[0]['user']}])
        row = {'id': item['id'], 'category': item['category'], 'turns': len(turns),
               'turn1PromptTokens': len(first['ids'])}
        if len(first['ids']) > limit:
            problems.append(f"{item['id']}: turn-1 prompt {len(first['ids'])} > {limit}")
        if len(turns) == 2:
            skeleton = helper.call(op='render', messages=[
                {'role': 'user', 'content': turns[0]['user']}, {'role': 'assistant', 'content': ''},
                {'role': 'user', 'content': turns[1]['user']}])
            row['turn2PromptTokensWithEmptyAnswer'] = len(skeleton['ids'])
            row['turn1AnswerTokenBudget'] = limit - len(skeleton['ids'])
        for index, turn in enumerate(turns):
            prompt_numbers = numbers(' '.join(t['user'] for t in turns[:index + 1]))
            for check in turn['checks']:
                if check['type'] == 'number' and float(check['value']) in prompt_numbers:
                    problems.append(f"{item['id']} turn {index + 1}: expected {check['value']} appears in the prompt")
        rows.append(row)
    helper.close()
    report = {'schema': 'reploid.useful-answer-set.preflight/v1', 'machine': 'mac-host',
              'answerSetSha256': hashlib.sha256(raw).hexdigest(), 'promptTokenLimit': limit,
              'textPath': helper.ready, 'items': rows, 'problems': problems,
              'maxTurn1PromptTokens': max(r['turn1PromptTokens'] for r in rows),
              'categories': {c: sum(1 for r in rows if r['category'] == c) for c in dict.fromkeys(r['category'] for r in rows)}}
    with open(OUT, 'x') as handle:
        json.dump(report, handle, indent=1, ensure_ascii=False)
        handle.write('\n')
    for row in rows:
        print(json.dumps(row))
    print(json.dumps({'problems': problems, 'categories': report['categories'],
                      'maxTurn1PromptTokens': report['maxTurn1PromptTokens']}))


if __name__ == '__main__':
    main()
