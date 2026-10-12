"""Read-only official serializer control; no model weights loaded or generated."""
import argparse
import hashlib
import json
from pathlib import Path
from transformers import AutoTokenizer

parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True)
parser.add_argument('--previous-results', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent
binding = json.loads((root / 'template-binding.json').read_text())
assert hashlib.sha256((Path(args.source) / 'tokenizer_config.json').read_bytes()).hexdigest() == binding['tokenizerConfigSha256']
tokenizer = AutoTokenizer.from_pretrained(args.source, trust_remote_code=False)
assert hashlib.sha256(tokenizer.chat_template.encode()).hexdigest() == binding['templateSha256']
tools = json.loads((root / 'tools.json').read_text())
for phase in ['extract', 'answer']:
    path = Path(args.previous_results) / ('result-fresh-bathroom-comparison-' + phase + '.json')
    receipt = json.loads(path.read_text())['results'][0]
    rendered = tokenizer.apply_chat_template(receipt['messages'], tools=tools, tokenize=False,
                                            add_generation_prompt=True, enable_thinking=False)
    assert rendered == receipt['renderedPrompt']
    assert tokenizer.encode(rendered, add_special_tokens=False) == receipt['inputIds']
example = json.loads((root / 'example.json').read_text())
raw = '<tool_call>\n<function=Calculate>\n' + ''.join('<parameter=' + key + '>\n' + json.dumps(value) + '\n</parameter>\n' for key, value in example['plan'].items()) + '</function>\n</tool_call>'
suite = json.loads((root / 'suite.json').read_text())
for case in suite['cases']:
    history = [{'role': 'system', 'content': suite['answerInstruction']}, *case['messages']]
    response = {'role': 'tool', 'content': json.dumps({'ok': False, 'error': 'independent serializer audit only'})}
    structured = [*history, {'role': 'assistant', 'content': '', 'tool_calls': [{'type': 'function', 'function': {'name': 'Calculate', 'arguments': example['plan']}}]}, response]
    retained = [*history, {'role': 'assistant', 'content': raw}, response]
    def render(messages):
        return tokenizer.apply_chat_template(messages, tools=tools, tokenize=False, add_generation_prompt=True, enable_thinking=False)
    assert render(structured) == render(retained), case['id']
print(json.dumps({'sourceTokenizerConfigSha256': binding['tokenizerConfigSha256'],
                  'officialChatTemplateSha256': binding['templateSha256'],
                  'previousTwoExecutedPromptsReproducedExactly': True,
                  'structuredVersusRawValidToolHistoryIdenticalForAllSevenCases': True,
                  'weightsLoaded': False, 'modelOutputRead': 'previous rejected control only',
                  'evaluatorSerializationDefectEstablished': False}, indent=2))
