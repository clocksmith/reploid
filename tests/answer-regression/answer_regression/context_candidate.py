"""One retained development input candidate; no model execution or evaluator changes."""
import subprocess

from .common import HARNESS, load_json, sha256_file

CANDIDATE = 'whole-passages-250'
FIXTURE_SHA256 = 'b013d023d522ff42b07feb5dc91d523287d4ae581c29440db6d7db4c66747eda'
INPUT_SHA256 = 'd71ebf6f9d1d6f9c2c4c51c7ba2a4d684fec5fe77760bc96538eca64ca59f6b9'


def load_candidate(name):
    if name != CANDIDATE:
        raise SystemExit('Unknown retained context candidate')
    directory = HARNESS / 'context-candidates'
    fixture = directory / 'whole-passages-250.json'
    if sha256_file(fixture) != FIXTURE_SHA256:
        raise SystemExit('The retained context candidate changed')
    # Reuse the existing public-API replay and identity validator. It is read-only.
    done = subprocess.run(['node', str(HARNESS / 'test-context-candidate.js')],
                          capture_output=True, text=True, timeout=30)
    if done.returncode:
        raise SystemExit('The retained context candidate failed public retrieval replay: ' + done.stderr[-400:])
    identity = load_json(directory / 'identity.json')
    if identity['selectedInputSha256'] != INPUT_SHA256:
        raise SystemExit('The retained context candidate identity changed')
    fixture = load_json(fixture)
    selected = next(row for row in fixture['variants'] if row['id'] == fixture['selectedCandidate'])
    return ({'id': CANDIDATE, 'selectedInputSha256': INPUT_SHA256,
             'fixtureSha256': FIXTURE_SHA256},
            {row['id']: row for row in selected['items']}, fixture['policy'])


def candidate_for_run(run):
    identity = run['itemSet'].get('contextCandidate')
    if identity is None:
        return None
    if run['itemSet']['kind'] != 'search':
        raise SystemExit('Context candidates apply only to search runs')
    expected, rows, policy = load_candidate(identity.get('id'))
    if identity != expected:
        raise SystemExit('Run does not bind the exact retained context candidate')
    return rows, policy
