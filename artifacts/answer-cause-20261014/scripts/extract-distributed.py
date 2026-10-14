"""Extract the two failed distributed answers, exactly as recorded, from the
signed-completion journey requester reports (run 5 and run 4).

Reads evidence only; writes one JSON file. Run with `python3 -I`.

Usage:
  python3 -I extract-distributed.py <run-5 report> <run-4 report> <installed catalog> <out.json>
"""
import hashlib
import json
import sys

HIDDEN_BYTES_PER_ROW = 1024 * 8  # hiddenSize 1024, two-f32 => 8 bytes per element
EDGES = 2  # stage 0 -> 1 and stage 1 -> 2


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''):
            digest.update(chunk)
    return 'sha256:' + digest.hexdigest()


def stream_deltas(samples, attempt_id):
    """Each recorded sample is a cumulative content snapshot. A change is one
    streamed delta (the coordinator emits one onDelta per decode step)."""
    previous, deltas, statuses = '', [], []
    for sample in samples:
        if sample['attemptId'] != attempt_id:
            continue
        statuses.append(sample['status'])
        content = sample['content']
        if content == previous:
            continue
        if not content.startswith(previous):
            raise SystemExit('Non-monotonic stream for ' + attempt_id)
        deltas.append({'at': sample['at'], 'text': content[len(previous):]})
        previous = content
    return deltas, previous, statuses


def attempt_record(report, thread, attempt, label):
    execution = attempt['execution']
    steps = execution['stepSummary']['count']
    activation_bytes = execution['activationBytes']
    rows_per_edge = activation_bytes // (HIDDEN_BYTES_PER_ROW * EDGES)
    response = next(m for m in thread['messages'] if m.get('id') == attempt['responseId'])
    deltas, streamed, statuses = stream_deltas(report.get('streamSamples', []), attempt['id'])
    return {
        'label': label,
        'threadId': thread['id'],
        'attemptId': attempt['id'],
        'status': attempt['status'],
        'requestMessages': attempt['request']['messages'],
        'systemContext': attempt.get('systemContext'),
        'output': response['content'],
        'stopReason': execution['stopReason'],
        'decodeSteps': steps,
        'activationBytes': activation_bytes,
        'activationRowsPerEdge': rows_per_edge,
        # Each edge carries the whole prompt at step 0 and one row per later step.
        # The final (EOS) step's token is never fed back, so rows = prompt + steps - 1.
        'impliedPromptTokens': rows_per_edge - (steps - 1),
        'streamedDeltas': deltas,
        'streamedDeltaCount': len(deltas),
        'streamedTextEqualsOutput': streamed == response['content'],
        'streamStatuses': sorted(set(statuses)),
        'route': [{k: s[k] for k in ('index', 'machine', 'host')} for s in report['freeze']['route']],
        'stageStepMsTotals': [s['stepMs']['total'] for s in execution['stepSummary']['stages']],
    }


def extract(path):
    with open(path) as handle:
        report = json.load(handle)
    thread = report['beforeReload']['threads'][0]
    attempts = sorted(thread['attempts'], key=lambda a: a['createdAt'])
    if len(attempts) != 2:
        raise SystemExit('Expected two attempts in ' + path)
    return {
        'report': path,
        'reportSha256': sha256_file(path),
        'freeze': report['freeze'],
        'questions': report['questions'],
        'turns': [attempt_record(report, thread, attempts[0], 'turn-1'),
                  attempt_record(report, thread, attempts[1], 'turn-2-follow-up')],
    }


def main():
    run5, run4, catalog_path, out = sys.argv[1:5]
    with open(catalog_path) as handle:
        catalog = json.load(handle)
    entry = next(m for m in catalog if m['id'] == 'qwen-3-5-0-8b-q4k-ehaf16')
    runs = {'run-5': extract(run5), 'run-4': extract(run4)}
    for index in range(2):
        a, b = runs['run-5']['turns'][index], runs['run-4']['turns'][index]
        for key in ('requestMessages', 'output', 'stopReason', 'decodeSteps', 'activationBytes'):
            if a[key] != b[key]:
                raise SystemExit(f'run-5 and run-4 differ at turn {index + 1} {key}')
    result = {
        'schema': 'reploid.answer-cause.distributed-observed/v1',
        'installedCatalog': {'path': catalog_path, 'sha256': sha256_file(catalog_path),
                             'modelId': entry['id'], 'identity': entry['identity'],
                             'generation': entry['generation'],
                             'partitionPlanSplitLayers': entry['partitionPlan']['splitLayers']},
        'runsAgree': True,
        'runs': runs,
    }
    with open(out, 'x') as handle:
        json.dump(result, handle, indent=1, ensure_ascii=False)
        handle.write('\n')
    for turn in runs['run-5']['turns']:
        print(turn['label'], 'steps', turn['decodeSteps'], 'deltas', turn['streamedDeltaCount'],
              'impliedPromptTokens', turn['impliedPromptTokens'], 'output', repr(turn['output'][-30:]))


if __name__ == '__main__':
    main()
