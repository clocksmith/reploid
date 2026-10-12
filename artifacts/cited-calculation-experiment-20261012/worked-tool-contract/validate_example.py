"""Validate unrelated demonstration through the unchanged parser and calculator."""
import json
from pathlib import Path
import subprocess
from protocol import parse_call

root = Path(__file__).resolve().parent
example = json.loads((root / 'example.json').read_text())
instruction = (root / 'example-instruction.txt').read_text()
call = instruction[instruction.index('<tool_call>'):instruction.index('</tool_call>') + len('</tool_call>')]
assert parse_call(call)['arguments'] == example['plan']
documents = [{'id': 'D' + str(i), 'name': 'unused demonstration document', 'passages': []} for i in range(1, 4)]
documents.append({'id': 'D4', 'name': 'independent protocol demonstration', 'passages': [example['source']]})
messages = [{'role': 'user', 'content': 'Calculate from this independent demonstration.\n<reploid-document-sources-v1>\n' + json.dumps(documents) + '\n</reploid-document-sources-v1>'}]
data = json.dumps(json.dumps({'plan': example['plan'], 'messages': messages}))
program = ('import {runCalculation} from ' + json.dumps((root.parent / 'calculate.js').as_uri()) + ';'
           + 'const {plan,messages}=JSON.parse(' + data + ');'
           + 'console.log(JSON.stringify(await runCalculation(plan,messages)));')
result = subprocess.run(['node', '--input-type=module', '-e', program], capture_output=True, text=True, check=True)
actual = json.loads(result.stdout)
assert [row['value'] for row in actual['results']] == example['expectedGenericUnitResults']
parent = json.loads((root.parent / 'official-tool-protocol' / 'suite.json').read_text())
candidate = json.loads((root / 'suite.json').read_text())
for key in ['cases', 'generation', 'aggregateBudgets', 'modelId', 'sourceRevision', 'modelIdentity', 'enableThinking', 'eosTokenIds', 'answerInstruction', 'toolAttributionCriteria']:
    assert candidate[key] == parent[key], key
assert candidate['extractionInstruction'] == parent['extractionInstruction'] + instruction.rstrip('\n')
assert candidate['stopAfterStructuralFailure'] is True
corpus = json.dumps(parent['cases']).lower()
for fact in example['plan']['facts']:
    assert fact['value'].lower() not in corpus
    assert fact['source'] not in json.dumps(parent['cases'])
for value in example['expectedGenericUnitResults']:
    assert value not in corpus
print(json.dumps({'exampleStrictParserPassed': True, 'exampleRealCalculatorPassed': True,
                  'evaluationFactsAbsentFromDemonstration': True, 'frozenCasesCriteriaAndBudgetsUnchanged': True,
                  'semanticModelAcceptanceEstablished': False, 'results': actual['results']}, indent=2))
