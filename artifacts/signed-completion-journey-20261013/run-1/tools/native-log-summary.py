"""Read-only summary of an owned native contributor log (run-1). Piped over ssh:
  ssh <dest> python3 - <machine alias> <log path> < native-log-summary.py
Prints JSON: init event, every partition-state transition (complete rows), the latest network
row's peer count, and non-JSON stderr lines. The private room token is masked."""
import json, re, sys
alias, log = sys.argv[1], sys.argv[2]
room = json.load(open('/var/tmp/reploid-signed-completion-journey-run1-20261013/private-room.json'))
mask = lambda text: text.replace(room['token'], '[REDACTED]')
transitions, other, init, last_network, previous = [], [], None, None, None
for number, line in enumerate(open(log, errors='replace'), 1):
    line = line.rstrip('\n')
    try: row = json.loads(line)
    except ValueError:
        if line.strip(): other.append({'line': number, 'text': mask(line)[:400]})
        continue
    if row.get('event') == 'native-initialized': init = row
    elif row.get('event') == 'partition-state':
        key = json.dumps([row.get('phase'), row.get('error'), row.get('unsettledOwners'), row.get('offering'),
                          (row.get('descriptor') or {}).get('ready'), (row.get('progress') or {}).get('message')])
        if key != previous: transitions.append({'line': number, **row}); previous = key
    elif row.get('event') == 'network':
        last_network = {'line': number, 'peerCount': row.get('peerCount'), 'connectionState': row.get('connectionState'),
                        'files': {k: (row.get('files') or {}).get(k) for k in ['sharing', 'offered', 'suppliedBytes', 'supplyBudget', 'supplyBudgetError', 'cache']}}
print(mask(json.dumps({'schema': 'reploid.run-1-native-log-summary/v1', 'machine': alias, 'log': log, 'init': init,
                       'partitionTransitions': transitions, 'lastNetwork': last_network, 'stderrLines': other[-60:],
                       'stderrLineCount': len(other)}, indent=1)))
