"""Source-tokenizer preflight only; never loads model weights or generates text."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from transformers import AutoTokenizer
from protocol import response_messages

parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent
binding = json.loads((root / 'template-binding.json').read_text())
assert hashlib.sha256((Path(args.source) / 'tokenizer_config.json').read_bytes()).hexdigest() == binding['tokenizerConfigSha256']
tokenizer = AutoTokenizer.from_pretrained(args.source, trust_remote_code=False)
assert hashlib.sha256(tokenizer.chat_template.encode()).hexdigest() == binding['templateSha256']
tools = json.loads((root / 'tools.json').read_text())
suite = json.loads((root / 'suite.json').read_text())
parent = json.loads((root.parent / 'official-tool-protocol' / 'suite.json').read_text())
for key in ['cases', 'generation', 'aggregateBudgets', 'modelId', 'sourceRevision', 'modelIdentity', 'enableThinking', 'eosTokenIds', 'toolAttributionCriteria']:
    assert suite[key] == parent[key], key
result = {'schema': 'reploid.lexical-catalog-token-preflight/v1', 'weightsLoaded': False, 'modelGenerated': False,
          'originalSevenHistoriesCriteriaAndPolicyIdentical': True, 'cases': []}
for file in ['suite.json', 'holdouts.json']:
    fixture = json.loads((root / file).read_text())
    for task in fixture['cases']:
        data = json.dumps(json.dumps(task['messages']))
        code = ('import {literalCatalog} from ' + json.dumps((root / 'catalog.js').as_uri()) + ';'
                + 'console.log(JSON.stringify(literalCatalog(JSON.parse(' + data + '))));')
        catalog = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code], text=True))
        catalog_text = '\n<reploid-literal-catalog-v1>\n' + json.dumps({'entries': catalog['entries'], 'scope': catalog['scope']}) + '\n</reploid-literal-catalog-v1>'
        def messages(instruction):
            history = [{'role': 'system', 'content': instruction}, *[dict(m) for m in task['messages']]]
            history[-1]['content'] += catalog_text
            return history
        def tokens(history):
            text = tokenizer.apply_chat_template(history, tools=tools, tokenize=False, add_generation_prompt=True, enable_thinking=False)
            return len(tokenizer.encode(text, add_special_tokens=False))
        first = tokens(messages(fixture['extractionInstruction']))
        probe = '<tool_call>\n<function=Calculate>\n<parameter=operations>\n[]\n</parameter>\n</function>\n</tool_call>'
        last = tokens(response_messages(messages(fixture['answerInstruction']), probe, {'ok': True, 'result': {'results': [], 'scope': 'Preflight only; no task calculations or generated output.'}, 'exitCode': 0}))
        result['cases'].append({'fixture': file, 'id': task['id'], 'catalog': catalog,
                                'extractionPromptTokens': first, 'extractionCap': min(1536, 8192 - first),
                                'finalPromptTokensWithEmptyToolProbe': last,
                                'caveat': 'Empty probe is only a prompt-sizing diagnostic, never a task answer or acceptance. Actual generated call/tool response are charged at runtime.'})
print(json.dumps(result, indent=2))
