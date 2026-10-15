"""Preflight for the frozen search set, run before any model: deterministic retrieval records, the sources each
item expects to be cited, context sizes and, when a Doppler archive and Capsule are given, the dispatched prompt's
token count through the application text path (no GPU). No answer is generated.
"""
import json
import re
import subprocess
import tempfile
from pathlib import Path

from .common import SEARCH_SET, SEARCH_SET_SHA256, frozen_file, label_block, now_iso, repo_relative, resolve_path, retrieval_component_identity, sha256_file
from .checks import node_helper
from .targets import DOPPLER_TEXT, DOPPLER_TEXT_SHA256, extract_archive


def numbers(text):
    return {float(m.replace(',', '')) for m in re.findall(r'\d+(?:,\d{3})*(?:\.\d+)?', text)}


def token_counts(archive, capsule, contents):
    if sha256_file(DOPPLER_TEXT) != DOPPLER_TEXT_SHA256:
        raise SystemExit('doppler-text.mjs changed')
    with tempfile.TemporaryDirectory(prefix='reploid-search-preflight-') as work:
        package = extract_archive(archive, Path(work) / 'package-archive')
        process = subprocess.Popen(['node', str(DOPPLER_TEXT), str(package), str(capsule)], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        ready = json.loads(process.stdout.readline())
        counts = []
        for content in contents:
            process.stdin.write(json.dumps({'op': 'render', 'messages': [{'role': 'user', 'content': content}]}) + '\n')
            process.stdin.flush()
            reply = json.loads(process.stdout.readline())
            counts.append(len(reply['ids']) if reply.get('ok') else None)
        process.stdin.close()
        process.wait()
    return counts, {'dopplerVersion': ready.get('dopplerVersion'), 'chatTemplate': ready.get('chatTemplate'),
                    'archiveSha256': sha256_file(archive)}


def preflight(archive_value, capsule_value, log):
    data = frozen_file(SEARCH_SET, SEARCH_SET_SHA256, 'search-task set')
    requests = [{'op': 'prepare', 'documents': item['documents'], 'query': item['prompt'],
                 'limits': data['retrieval']['limits'], 'now': data['retrieval']['fixedNow'],
                 'messages': [{'role': 'user', 'content': item['prompt']}]} for item in data['items']]
    replies = node_helper(requests)
    rows, problems = [], []
    for item, reply in zip(data['items'], replies):
        if not reply.get('ok'):
            problems.append(f"{item['id']}: {reply.get('error')}")
            continue
        record = reply['record']
        numbered = {source['sourceId']: source['number'] for source in record['sources']}
        missing = [doc for doc in item['citedSources'] if doc not in numbered]
        if record['outcome'] != item['expectedOutcome']:
            problems.append(f"{item['id']}: outcome {record['outcome']} != expected {item['expectedOutcome']}")
        if missing:
            problems.append(f"{item['id']}: expected cited sources not retrieved: {missing}")
        for check in item['answerChecks']:
            if check['type'] == 'number' and float(check['value']) in numbers(item['prompt']):
                problems.append(f"{item['id']}: expected {check['value']} appears in the question")
        dispatched = reply['dispatchedMessages']
        rows.append({'id': item['id'], 'kind': item['kind'], 'outcome': record['outcome'], 'error': record['error'],
                     'sources': [[source['number'], source['sourceId']] for source in record['sources']],
                     'citedSourceMarkers': {doc: numbered.get(doc) for doc in item['citedSources']},
                     'contextCharacters': (record['context'] or {}).get('characters'),
                     'contextDigest': (record['context'] or {}).get('digest'),
                     'dispatchedCharacters': len(dispatched[-1]['content']) if dispatched else None,
                     'failureMessage': reply['failureMessage']})
        log(f"{item['id']}: {record['outcome']} {rows[-1]['sources']}")
    text_path = None
    if archive_value and capsule_value:
        dispatched_rows = [(row, reply) for row, reply in zip(rows, replies) if reply.get('dispatchedMessages')]
        counts, text_path = token_counts(resolve_path(archive_value), resolve_path(capsule_value),
                                         [reply['dispatchedMessages'][-1]['content'] for _, reply in dispatched_rows])
        for (row, _), count in zip(dispatched_rows, counts):
            row['dispatchedPromptTokens'] = count
    return {'schema': 'reploid.answer-regression.search-preflight/v1', **label_block(), 'checkedAt': now_iso(),
            'searchSet': {'file': repo_relative(SEARCH_SET), 'sha256': sha256_file(SEARCH_SET)},
            'retrievalComponent': retrieval_component_identity(), 'textPath': text_path,
            'modelRun': False, 'items': rows, 'problems': problems,
            'note': 'No answer was generated. Prompt token counts use the qwen template and tokenizer of the Launch 1 model.'}
