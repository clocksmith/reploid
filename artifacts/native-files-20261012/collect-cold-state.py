"""Summarize observed host events; retains complete unique signed custody receipts."""
import argparse, datetime, json, pathlib
parser = argparse.ArgumentParser()
parser.add_argument('root', type=pathlib.Path)
parser.add_argument('name')
args = parser.parse_args()
state, network, transfers = {}, {}, {}
with (args.root / 'process.log').open() as stream:
    for line in stream:
        if not line.startswith('{'):
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue  # The running process may still be writing the final line.
        if event.get('event') == 'partition-state':
            state = event
        if event.get('event') == 'network':
            network = event
            for receipt in event.get('files', {}).get('receipts', []):
                transfers[receipt['transferId']] = receipt
record = {
    'recordedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'partition': state,
    'files': network.get('files'),
    'transfers': list(transfers.values()),
    'receivedBytes': sum(row.get('receivedBytes', 0) for row in transfers.values()),
    'modelFiles': [path.name for path in (args.root / 'model').iterdir()],
    'cacheFiles': [{'name': path.name, 'size': path.stat().st_size} for path in (args.root / 'cache').iterdir()],
}
(args.root / (args.name + '.json')).write_text(json.dumps(record, indent=2))
print(json.dumps({'phase': state.get('phase'), 'error': state.get('error'),
                  'transfers': len(transfers), 'receivedBytes': record['receivedBytes'],
                  'cacheFiles': len(record['cacheFiles']), 'attempts': len(state.get('attempts', []))}))
