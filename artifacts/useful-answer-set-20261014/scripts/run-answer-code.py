"""Execute the code in the arms' answers, for the whole-answer assessment.

Each case takes the code exactly as the arm wrote it (the fenced block, or the whole answer
when it is unfenced), optionally appends a probe line written by the assessor that calls the
function on the inputs the question names, and runs it in its own new directory under a
scratch directory given on the command line (never inside the repository), with a 10 s
timeout. Python runs with -I; JavaScript runs with node. A few cases run the question's own
program or a snippet quoted from an answer, to establish ground truth for a claim.

Usage:
  python3 -I run-answer-code.py <q4k-run.json> <bf16-run.json> <empty scratch dir> <out.json>
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

Q4K, BF16, SCRATCH, OUT = sys.argv[1:5]
TIMEOUT = 10


def answers():
    table = {}
    for arm, path in (('q4k', Q4K), ('bf16', BF16)):
        with open(path) as handle:
            for item in json.load(handle)['items']:
                for turn in item['turns']:
                    table[(item['id'], arm, turn['turn'])] = turn['output']
    return table


TAGS = {'py': ('python', 'py', ''), 'js': ('javascript', 'js', '')}


def code_of(output, language):
    """Fenced blocks tagged with the case's language (or untagged); the whole answer if unfenced."""
    blocks = re.findall(r'```([^\n]*)\n(.*?)```', output, re.S)
    if not blocks:
        return output
    return '\n'.join(body for tag, body in blocks if tag.strip().lower() in TAGS[language])


JS_DOUBLE = 'console.log("probe", JSON.stringify(doubleEvens([1, 2, 3, 4])), JSON.stringify(doubleEvens([-2, 3, 6])));'
PY_PAL = 'print("probe", is_palindrome("Racecar"), is_palindrome("racecar"), is_palindrome("hello"), is_palindrome("ab!a"))'

# (item, arm, turn or None, language, source, probe or program, note)
CASES = [
    ('code-double-evens', 'q4k', 1, 'js', 'answer', JS_DOUBLE, 'answer code; probe also gives the turn-2 input'),
    ('code-double-evens', 'bf16', 1, 'js', 'answer', JS_DOUBLE, 'answer code; probe also gives the turn-2 input'),
    ('code-sum-squares', 'q4k', 1, 'py', 'answer', 'r = sum_of_squares([1, 2, 3]); print("probe", repr(r), type(r).__name__)', 'answer code'),
    ('code-sum-squares', 'bf16', 1, 'py', 'answer', 'r = sum_of_squares([1, 2, 3]); print("probe", repr(r), type(r).__name__)', 'answer code'),
    ('code-reverse-string', 'q4k', 1, 'js', 'answer', 'console.log("probe", JSON.stringify(reverseString("stressed")));', 'answer code'),
    ('code-reverse-string', 'bf16', 1, 'js', 'answer', 'console.log("probe", JSON.stringify(reverseString("stressed")));', 'answer code'),
    ('code-count-vowels', 'q4k', 1, 'py', 'answer', 'print("probe", count_vowels("education"))', 'answer code (its own example call runs first)'),
    ('code-count-vowels', 'bf16', 1, 'py', 'answer', 'print("probe", count_vowels("education"))', 'answer code'),
    ('fu-palindrome', 'q4k', 1, 'py', 'answer', PY_PAL, 'turn-1 answer code, unfenced'),
    ('fu-palindrome', 'bf16', 1, 'py', 'answer', PY_PAL, 'turn-1 answer code, unfenced'),
    ('expl-list-tuple', 'bf16', 1, 'py', 'answer',
     'print("probe", my_list, my_tuple, my_tuple_copy, type(my_tuple_copy).__name__, my_tuple[0], [v for v in my_tuple])',
     'the example block in the answer'),
    ('expl-list-tuple', 'q4k', 1, 'py', 'quoted',
     'my_list = [1, 2, 3]\nmy_list.append(4)\nprint("append", my_list)\nmy_tuple = (1, 2, 3)\n'
     'print("index", my_tuple[0])\nprint("iterate", [v for v in my_tuple])\nmixed = [1, "two", 3]\nprint("mixed", mixed, [type(v).__name__ for v in mixed])\n'
     'try:\n    my_tuple.append(4)\nexcept AttributeError as error:\n    print("tuple append", type(error).__name__)\n'
     'try:\n    my_tuple[0] = 9\nexcept TypeError as error:\n    print("tuple assign", type(error).__name__)',
     'snippets quoted from the answer, plus the operations it says fail'),
    ('code-python-slice', None, None, 'py', 'question', 'x = [1, 2, 3, 4, 5]\nprint(x[1:4])', 'the question program'),
    ('code-js-default-sort', None, None, 'js', 'question', 'const nums = [5, 1, 10];\nnums.sort();\nconsole.log(nums);', 'the question program'),
    ('ground-truth', None, None, 'py', 'computation',
     'print("17*24", 17 * 24)\nprint("15% of 80", 0.15 * 80)\nprint("5 mi km", 5 * 1.609344)\nprint("100F C", (100 - 32) * 5 / 9)\n'
     'print("80 less 25%", 80 * 0.75)\nprint("2.5 h s", 2.5 * 3600)\nprint("area", 8 * 5, "perimeter", 2 * (8 + 5))\n'
     'print("cookies", 20 - 4, (20 - 4) / 8)\nprint("vowels education", sum(c in "aeiou" for c in "education"))\n'
     'print("reverse stressed", "stressed"[::-1])\nprint("racecar reversed", "racecar"[::-1], "Racecar"[::-1])\n'
     'print("17 prime", all(17 % d for d in range(2, 17)))\nprint("68*5/9", 68 * 5 / 9, "340/9", 340 / 9)',
     'reference computations'),
]


def run(index, case, table):
    item, arm, turn, language, source, probe, note = case
    if source == 'answer':
        body = code_of(table[(item, arm, turn)], language)
        program = body + ('\n' + probe if probe else '') + '\n'
    else:
        program = probe + '\n'
    work = Path(SCRATCH) / f'case-{index:02d}-{item}-{arm or "none"}'
    work.mkdir(parents=True)
    name = 'main.py' if language == 'py' else 'main.js'
    (work / name).write_text(program)
    command = [sys.executable, '-I', name] if language == 'py' else ['node', name]
    try:
        done = subprocess.run(command, cwd=work, capture_output=True, text=True, timeout=TIMEOUT,
                              env={'PATH': os.environ.get('PATH', ''), 'HOME': str(work)})
        stderr = done.stderr.replace(str(work.resolve()), '<case dir>').replace(str(work), '<case dir>')
        result = {'exitCode': done.returncode, 'stdout': done.stdout, 'stderrTail': stderr.strip().splitlines()[-3:]}
    except subprocess.TimeoutExpired:
        result = {'exitCode': None, 'timedOut': True}
    return {'item': item, 'arm': arm, 'turn': turn, 'language': language, 'source': source, 'note': note,
            'program': program, **result}


def main():
    if any(Path(SCRATCH).iterdir()):
        raise SystemExit('scratch directory must be empty')
    repo = Path(__file__).resolve().parents[3]
    if Path(SCRATCH).resolve().is_relative_to(repo):
        raise SystemExit('scratch directory must be outside the repository')
    table = answers()
    rows = [run(index, case, table) for index, case in enumerate(CASES)]
    report = {'schema': 'reploid.useful-answer-set.code-execution/v1', 'machine': 'mac-host',
              'timeoutSeconds': TIMEOUT, 'python': sys.version.split()[0],
              'node': subprocess.run(['node', '--version'], capture_output=True, text=True).stdout.strip(),
              'cases': rows}
    with open(OUT, 'x') as handle:
        json.dump(report, handle, indent=1, ensure_ascii=False)
        handle.write('\n')
    for row in rows:
        print(f"== {row['item']} {row['arm']} t{row['turn']} [{row['source']}] exit={row.get('exitCode')}")
        print(row.get('stdout', '').rstrip())
        for line in row.get('stderrTail', []):
            print('  stderr:', line)


if __name__ == '__main__':
    main()
