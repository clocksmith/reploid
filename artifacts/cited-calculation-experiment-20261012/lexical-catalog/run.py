"""Artifact-only bounded two-call source experiment. No production code changes."""
import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
from protocol import parse_call, response_messages


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    for field in ['doppler', 'source', 'deployed', 'suite', 'out']:
        parser.add_argument('--' + field, required=True)
    parser.add_argument('--threads', type=int, default=4)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    tools = Path(args.doppler).resolve() / 'tools'
    frozen_identity = json.loads((root / 'freeze.json').read_text())
    assert sha(tools / 'qwen35-original-weight-generation.py') == frozen_identity['sourceLoaderSha256']
    assert sha(tools / 'lib/source_task_quality.py') == frozen_identity['sourceEvaluatorSha256']
    for relative, expected in frozen_identity['reusedSources'].items():
        assert sha(root.parents[2] / relative) == expected, relative
    assert sha(root / 'catalog.js') == frozen_identity['files']['catalog.js']
    sys.path.insert(0, str(tools))
    from lib import source_task_quality as quality
    original_evaluate = quality.evaluate_tasks
    original_messages = quality.task_messages
    tool_schema = json.loads((root / 'tools.json').read_text())
    frozen = json.loads(Path(args.suite).read_text())
    limits = frozen['aggregateBudgets']
    assert limits == {'generatedTokens': 4096, 'promptPlusGeneratedTokens': 8192,
                      'rawOutputUtf16': 16000, 'extractionMaxTokens': 1536}
    assert frozen['generation']['temperature'] == 0 and frozen['generation']['repetitionPenalty'] == 1
    assert frozen['enableThinking'] is False
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)

    def evaluate(model, config, tokenizer, source_tokenizer, suite, report, output):
        template_binding = json.loads((root / 'template-binding.json').read_text())
        assert sha(Path(args.source) / 'tokenizer_config.json') == template_binding['tokenizerConfigSha256']
        actual_template_sha = hashlib.sha256(source_tokenizer.chat_template.encode()).hexdigest()
        assert actual_template_sha == template_binding['templateSha256']
        report.update({'schema': 'reploid.lexical-catalog-source-result/v1', 'qualified': False,
                       'runnerSha256': sha(__file__), 'calculatorSha256': sha(root.parent / 'calculate.js'),
                       'aggregateBudgets': limits, 'cases': []})
        class ToolTokenizer:
            def apply_chat_template(self, messages, **options):
                return source_tokenizer.apply_chat_template(messages, tools=tool_schema, **options)
            def __getattr__(self, name):
                return getattr(source_tokenizer, name)
        effective_tokenizer = ToolTokenizer()
        report['toolSchema'] = tool_schema
        report['protocolSha256'] = sha(root / 'protocol.py')
        report['actualTemplateSha256'] = actual_template_sha
        report['actualTokenizerConfigSha256'] = sha(Path(args.source) / 'tokenizer_config.json')
        for task in suite['cases']:
            row = {'id': task['id'], 'reviewCriteria': task['reviewCriteria'], 'reviewStatus': 'pending',
                   'calls': [], 'tool': None, 'generatedTokens': 0, 'promptTokens': 0,
                   'rawOutputUtf16': 0, 'complete': False, 'passed': None}
            report['cases'].append(row)
            catalog_data = json.dumps(json.dumps(task['messages']))
            catalog_program = ('import {literalCatalog} from ' + json.dumps((root / 'catalog.js').as_uri()) + ';'
                + 'console.log(JSON.stringify(literalCatalog(JSON.parse(' + catalog_data + '))));')
            catalog_process = subprocess.run(['node', '--input-type=module', '-e', catalog_program], text=True, capture_output=True, timeout=10)
            if catalog_process.returncode:
                row['failure'] = 'Catalog construction rejected: ' + catalog_process.stderr
                report['unrunCases'] = [item['id'] for item in suite['cases'][len(report['cases']):]]
                report['stoppedAtStructuralBoundary'] = True
                quality.write_quality_report(output, report)
                break
            catalog = json.loads(catalog_process.stdout)
            row['catalog'] = catalog
            catalog_text = '\n<reploid-literal-catalog-v1>\n' + json.dumps({'entries': catalog['entries'], 'scope': catalog['scope']}) + '\n</reploid-literal-catalog-v1>'
            for phase in ['extract', 'answer']:
                stage = copy.deepcopy(suite)
                stage['cases'] = [copy.deepcopy(task)]
                stage['instruction'] = suite['extractionInstruction'] if phase == 'extract' else suite['answerInstruction']
                exact_messages = original_messages(task, stage)
                assert exact_messages[-1]['role'] == 'user'
                exact_messages[-1]['content'] += catalog_text
                if phase == 'answer':
                    exact_messages = response_messages(exact_messages, row['calls'][0]['text'], row['tool'])
                def bound_messages(actual_task, actual_suite):
                    assert actual_task['id'] == task['id']
                    return copy.deepcopy(exact_messages)
                rendered = effective_tokenizer.apply_chat_template(exact_messages,
                    tokenize=False, add_generation_prompt=True, enable_thinking=False)
                ids = tokenizer.encode(rendered, add_special_tokens=False).ids
                remaining_total = limits['promptPlusGeneratedTokens'] - row['promptTokens'] - row['generatedTokens'] - len(ids)
                maximum = min(limits['generatedTokens'] - row['generatedTokens'], remaining_total)
                if phase == 'extract':
                    maximum = min(maximum, limits['extractionMaxTokens'])
                if maximum <= 0 or row['rawOutputUtf16'] >= limits['rawOutputUtf16']:
                    row['failure'] = 'Aggregate budget leaves no room for ' + phase
                    break
                stage['generation']['maxTokens'] = maximum
                stage['maxOutputCharacters'] = limits['rawOutputUtf16'] - row['rawOutputUtf16']
                phase_report = {'settings': stage['generation'], 'results': []}
                phase_path = output.with_name(output.stem + '-' + task['id'] + '-' + phase + '.json')
                # Adapt only the experiment's message admission to official tool-role history.
                # The existing reference sampling, state and model equations remain unchanged.
                quality.task_messages = bound_messages
                try:
                    original_evaluate(model, config, tokenizer, effective_tokenizer, stage, phase_report, phase_path)
                finally:
                    quality.task_messages = original_messages
                result = phase_report['results'][0]
                assert result['inputIds'] == ids, 'Executed prompt differs from budget-admitted official template'
                raw = tokenizer.decode(result['tokenIds'], skip_special_tokens=False)
                row['calls'].append({'phase': phase, **result})
                row['promptTokens'] += len(result['inputIds'])
                row['generatedTokens'] += len(result['tokenIds'])
                row['rawOutputUtf16'] += len(raw.encode('utf-16-le')) // 2
                row['totalChargedTokens'] = row['promptTokens'] + row['generatedTokens']
                row['withinBudgets'] = (row['totalChargedTokens'] <= limits['promptPlusGeneratedTokens']
                    and row['generatedTokens'] <= limits['generatedTokens']
                    and row['rawOutputUtf16'] <= limits['rawOutputUtf16'])
                if result['stopReason'] != 'eos' or not row['withinBudgets']:
                    row['failure'] = phase + ' did not naturally complete within aggregate budgets'
                    break
                if phase == 'extract':
                    try:
                        assert result['tokenIds'][-1] in suite['eosTokenIds']
                        call_text = tokenizer.decode(result['tokenIds'][:-1], skip_special_tokens=False)
                        if call_text != result['text']:
                            raise ValueError('Unexpected special token inside tool output; no stripping repair allowed')
                        parsed_call = parse_call(call_text)
                        row['parsedCall'] = parsed_call
                        plan = parsed_call['arguments']
                        # Model output remains JSON data, never executable source or shell text.
                        data = json.dumps(json.dumps({'plan': plan, 'messages': task['messages']}))
                        program = ('import {calculateCatalog} from ' + json.dumps((root / 'catalog.js').as_uri()) + ';'
                            + 'const {plan,messages}=JSON.parse(' + data + ');'
                            + 'try { console.log(JSON.stringify({ok:true,result:await calculateCatalog(plan,messages)})); }'
                            + 'catch(error) { console.log(JSON.stringify({ok:false,error:error.message})); }')
                        invocation = subprocess.run(['node', '--input-type=module', '-e', program],
                            text=True, capture_output=True, timeout=10)
                        row['tool'] = json.loads(invocation.stdout)
                        row['tool']['exitCode'] = invocation.returncode
                    except (ValueError, subprocess.TimeoutExpired) as error:
                        row['tool'] = {'ok': False, 'error': str(error)}
                    if not row['tool']['ok']:
                        row['failure'] = 'Extraction/tool validation rejected; retained, no retry'
                else:
                    row['answerText'] = result['text']
                    row['complete'] = bool(row['tool']['ok']) and row['withinBudgets']
                quality.write_quality_report(output, report)
            quality.write_quality_report(output, report)
            if suite['stopAfterStructuralFailure'] and (not row['complete'] or '<tool_call>' in row.get('answerText', '')):
                report['unrunCases'] = [item['id'] for item in suite['cases'][len(report['cases']):]]
                report['stoppedAtStructuralBoundary'] = True
                break
        report['reviewRequired'] = True
        report['passed'] = False
        report['status'] = ('stopped after structural failure; remaining cases unrun' if report.get('stoppedAtStructuralBoundary') else 'completed; independent full factual review required')
        quality.write_quality_report(output, report)

    quality.evaluate_tasks = evaluate
    path = tools / 'qwen35-original-weight-generation.py'
    spec = importlib.util.spec_from_file_location('existing_source_loader', path)
    source = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(source)
    source.run(SimpleNamespace(source=args.source, deployed=args.deployed,
        revision=frozen['sourceRevision'], suite=args.suite, control=None, out=args.out, threads=args.threads))


if __name__ == '__main__':
    main()
