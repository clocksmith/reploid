"""Checks applied to a run. Every verdict is an automated regression signal, never an acceptance grade.

- mechanical: the useful-answer set's own frozen check code (scripts/check.py, pinned by sha256), loaded
  and called unchanged, so its verdicts equal the 2026-10-14 results by construction;
- format: generic delivery checks on every generated turn;
- instruction: the overlay's explicit-requirement checks;
- code: answer code executed in a sandboxed scratch directory (codeexec.py);
- search: retrieval outcome, asked point and deterministic citation validity from the retrieval component.
"""
import ast
import json
import re
import subprocess
import sys
import types
from pathlib import Path

from .common import (OVERLAY, OVERLAY_SHA256, RETRIEVAL_HELPER, USEFUL_ANSWER_DIR, frozen_file, require_outside_repo,
                     sha256_bytes)
from . import codeexec

FROZEN_CHECK = USEFUL_ANSWER_DIR / 'scripts' / 'check.py'
FROZEN_CHECK_SHA256 = '1a303808caf85a14745177b8b8c1b51e17684688b16c213310f512d4dc180f34'
_frozen = None


def frozen():
    """The frozen check module. Its main() is not run; its argv unpacking gets placeholders."""
    global _frozen
    if _frozen is None:
        source = FROZEN_CHECK.read_bytes()
        if sha256_bytes(source) != FROZEN_CHECK_SHA256:
            raise SystemExit(f'{FROZEN_CHECK} changed; the frozen mechanical checks are pinned to {FROZEN_CHECK_SHA256}')
        module = types.ModuleType('frozen_useful_answer_check')
        module.__file__ = str(FROZEN_CHECK)
        saved = sys.argv
        sys.argv = [str(FROZEN_CHECK)] + ['-'] * 6
        try:
            exec(compile(source, str(FROZEN_CHECK), 'exec'), module.__dict__)
        finally:
            sys.argv = saved
        _frozen = module
    return _frozen


def frozen_identity():
    return {'file': 'artifacts/useful-answer-set-20261014/scripts/check.py', 'sha256': FROZEN_CHECK_SHA256,
            'use': 'run_check and grade_arm called unchanged; no review file, so rubric items stay ungraded'}


def run_check(check, output):
    ok, detail = frozen().run_check(check, output)
    return {'type': check['type'], 'pass': bool(ok), 'detail': detail}


# ---- mechanical ----------------------------------------------------------------------------

def mechanical_item(item, run_item):
    """grade_arm from the frozen script, unchanged. Rubric ('human') items return pass None."""
    shaped = {'arm': run_item.get('arm', 'target'), 'turns': [frozen_row(t) for t in run_item['turns']]}
    graded = frozen().grade_arm(item, shaped, {})
    turns = [{'turn': t['turn'], 'notRun': t.get('notRun', False), 'empty': t.get('empty'), 'pass': t['pass'],
              'checks': t.get('checks', [])} for t in graded['turns']]
    return {'grading': graded['grading'], 'pass': graded['pass'], 'checksPass': graded.get('checksPass'),
            'overPromptLimit': graded['overPromptLimit'], 'status': graded.get('status'), 'turns': turns}


def frozen_row(turn):
    keys = ('promptTokenCount', 'overPromptLimit', 'output', 'stopReason', 'decodeSteps', 'seconds', 'reusedFrom',
            'minMarginTop1Top2')
    return {key: turn.get(key) for key in keys} | {'overPromptLimit': bool(turn.get('overPromptLimit'))}


# ---- format --------------------------------------------------------------------------------

TEMPLATE_TOKEN = re.compile(r'<\|[A-Za-z0-9_]+\|>|</?think>')


def repeated_window(text, size=12, times=3):
    words = text.split()
    counts = {}
    for index in range(len(words) - size + 1):
        key = tuple(words[index:index + size])
        counts[key] = counts.get(key, 0) + 1
        if counts[key] >= times:
            return ' '.join(key)
    return None


def repeated_lines(text, times=3):
    run, previous = 1, None
    for line in (line.strip() for line in text.split('\n')):
        if not line:
            continue
        run = run + 1 if line == previous and len(line) >= 8 else 1
        previous = line
        if run >= times:
            return line
    return None


def format_checks(turn):
    output = turn.get('output') or ''
    stop = turn.get('stopReason')
    loop = repeated_window(output) or repeated_lines(output)
    template = TEMPLATE_TOKEN.search(output)
    rows = [
        {'type': 'nonEmpty', 'pass': bool(output.strip()), 'detail': f'{len(output)} characters'},
        {'type': 'stoppedOnEndOfTurn', 'pass': stop in ('eos-token', 'stop-token', 'stop'),
         'detail': f'stop reason {stop!r}'},
        {'type': 'noTemplateTokens', 'pass': template is None, 'detail': f'found {template.group(0)!r}' if template else 'none'},
        {'type': 'noReplacementCharacters', 'pass': '�' not in output,
         'detail': f"{output.count(chr(0xfffd))} U+FFFD"},
        {'type': 'noDegenerateRepetition', 'pass': loop is None, 'detail': f'repeats {loop[:80]!r}' if loop else 'none'},
        {'type': 'promptWithinRouteLimit', 'pass': not turn.get('overPromptLimit'),
         'detail': f"{turn.get('promptTokenCount')} prompt tokens" if turn.get('promptTokenCount') is not None else 'not reported'},
    ]
    return rows


# ---- instruction ---------------------------------------------------------------------------

def code_only(output, language, sandbox):
    blocks = list(re.finditer(r'```[^\n]*\n.*?```', output, re.S))
    if blocks:
        outside = re.sub(r'```[^\n]*\n.*?```', '', output, flags=re.S)
        return not outside.strip(), f'{len(blocks)} fenced block(s); outside text {outside.strip()[:60]!r}'
    if language == 'python':
        try:
            ast.parse(output)
            return True, 'unfenced; parses as Python'
        except SyntaxError as error:
            return False, f'unfenced; not Python: {error.msg} at line {error.lineno}'
    case = sandbox.root / f'syntax-{sandbox.count}'
    sandbox.count += 1
    case.mkdir()
    (case / 'main.js').write_text(output, encoding='utf-8')
    done = subprocess.run(['node', '--check', 'main.js'], cwd=case, capture_output=True, text=True, timeout=20)
    return done.returncode == 0, 'unfenced; ' + ('parses as JavaScript' if done.returncode == 0 else 'not JavaScript')


def instruction_check(check, output, sandbox):
    if check['type'] == 'codeOnly':
        ok, detail = code_only(output, check['language'], sandbox)
        return {'type': 'codeOnly', 'pass': ok, 'detail': detail}
    return run_check(check, output)


def load_overlay():
    return frozen_file(OVERLAY, OVERLAY_SHA256, 'useful-answer overlay'), OVERLAY_SHA256


# ---- search --------------------------------------------------------------------------------

def node_helper(requests):
    done = subprocess.run(['node', str(RETRIEVAL_HELPER)], input=json.dumps(requests), capture_output=True, text=True,
                          timeout=120)
    if done.returncode != 0:
        raise SystemExit(f'retrieval helper failed: {done.stderr.strip()[-400:]}')
    return json.loads(done.stdout)


def prepare_retrieval(item, search_set, messages):
    reply = node_helper({'op': 'prepare', 'documents': item['documents'], 'query': item.get('query', item['prompt']),
                         'limits': search_set['retrieval']['limits'], 'now': search_set['retrieval']['fixedNow'],
                         'messages': messages})
    if not reply.get('ok'):
        raise SystemExit(f"retrieval for {item['id']} failed in the harness: {reply.get('error')}")
    return reply


def verify_citations(answer, record):
    reply = node_helper({'op': 'verify', 'answer': answer, 'record': record})
    if not reply.get('ok'):
        raise SystemExit(f"citation verification failed in the harness: {reply.get('error')}")
    return reply['verification']


def search_item(item, run_item, search_set):
    """Verdict families for one search item: answer, citation validity, claim coverage."""
    turn = run_item['turns'][0]
    record = turn.get('retrieval')
    outcome = record['outcome'] if record else None
    outcome_ok = outcome == item['expectedOutcome']
    result = {'retrievalOutcome': {'expected': item['expectedOutcome'], 'observed': outcome, 'pass': outcome_ok}}
    if turn.get('unsupported'):
        return {**result, 'exercised': False, 'reason': turn['unsupported'], 'pass': None}
    if item['expectedOutcome'] != 'retrieved' or outcome != 'retrieved':
        nothing_sent = not turn.get('dispatched')
        result.update({'exercised': True, 'answer': None, 'citations': None, 'claimCoverage': None,
                       'nothingDispatched': nothing_sent, 'pass': outcome_ok and nothing_sent})
        return result
    output = turn.get('output') or ''
    answer = [run_check(check, output) for check in item['answerChecks']]
    if item['abstain']:
        match = re.search(search_set['abstentionPattern'], frozen().normalize(output), re.IGNORECASE)
        answer.append({'type': 'abstains', 'pass': bool(match), 'detail': f'match {match.group(0)!r}' if match else 'no match'})
    verification = verify_citations(output, record)
    numbers = {source['sourceId']: source['number'] for source in record['sources']}
    cited = {citation['marker'] for claim in verification['claims'] for citation in claim['citations'] if citation['resolved']}
    flags = [flag['kind'] for flag in verification['flags']]
    spans = verification.get('claimSupport')
    validity = [
        {'type': 'citationsResolve', 'pass': verification['summary']['unresolvedCitations'] == 0,
         'detail': f"{verification['summary']['unresolvedCitations']} unresolved of {verification['summary']['citations']}"},
        {'type': 'referencesResolve', 'pass': not any(k in ('unresolved-reference', 'mismatched-reference') for k in flags),
         'detail': f"{sum(k in ('unresolved-reference', 'mismatched-reference') for k in flags)} bad reference entries"},
        {'type': 'noUnrecordedUrls', 'pass': not verification['unrecordedUrls'], 'detail': f"{verification['unrecordedUrls'][:5]}"},
    ]
    if spans is not None:
        problems = sorted({p for claim in spans['claims'] for c in claim['citations'] for p in c['problems']})
        validity += [
            {'type': 'contextDigestHolds', 'pass': bool(spans['contextValid']), 'detail': f"contextValid {spans['contextValid']}"},
            {'type': 'citationSpansValid', 'pass': spans['summary']['invalidCitations'] == 0,
             'detail': f"{spans['summary']['validCitations']} valid, {spans['summary']['invalidCitations']} invalid; problems {problems}"}]
    validity += [{'type': 'citesExpectedSource', 'source': source, 'marker': numbers.get(source),
                  'pass': numbers.get(source) in cited, 'detail': f"marker {numbers.get(source)} cited: {numbers.get(source) in cited}"}
                 for source in item['citedSources']]
    coverage = None if item['abstain'] else {
        'pass': verification['summary']['uncitedClaims'] == 0,
        'detail': f"{verification['summary']['uncitedClaims']} uncited of {verification['summary']['claims']} claims"}
    over = bool(turn.get('overPromptLimit'))
    answer_pass = bool(output.strip()) and all(c['pass'] for c in answer) and not over
    result.update({'exercised': True, 'answer': {'checks': answer, 'pass': answer_pass, 'overPromptLimit': over},
                   'citations': {'checks': validity, 'pass': all(c['pass'] for c in validity),
                                 'summary': verification['summary'], 'flags': verification['flags'][:40],
                                 'claimSupportSummary': spans['summary'] if spans else None,
                                 'supportJudged': False},
                   'claimCoverage': coverage,
                   'pass': outcome_ok and answer_pass and all(c['pass'] for c in validity)})
    return result


def new_sandbox(root, timeout):
    if root is not None:
        require_outside_repo(Path(root), 'The code-execution scratch directory')
    return codeexec.Sandbox(root, timeout)
