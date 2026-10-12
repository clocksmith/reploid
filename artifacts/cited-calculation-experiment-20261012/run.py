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
    sys.path.insert(0, str(tools))
    from lib import source_task_quality as quality
    original_evaluate = quality.evaluate_tasks
    frozen = json.loads(Path(args.suite).read_text())
    limits = frozen['aggregateBudgets']
    assert limits == {'generatedTokens': 4096, 'promptPlusGeneratedTokens': 8192,
                      'rawOutputUtf16': 16000, 'extractionMaxTokens': 1536}
    assert frozen['generation']['temperature'] == 0 and frozen['generation']['repetitionPenalty'] == 1
    assert frozen['enableThinking'] is False
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)

    def evaluate(model, config, tokenizer, source_tokenizer, suite, report, output):
        report.update({'schema': 'reploid.cited-calculation-source-result/v1', 'qualified': False,
                       'runnerSha256': sha(__file__), 'calculatorSha256': sha(root / 'calculate.js'),
                       'aggregateBudgets': limits, 'cases': []})
        for task in suite['cases']:
            row = {'id': task['id'], 'reviewCriteria': task['reviewCriteria'], 'reviewStatus': 'pending',
                   'calls': [], 'tool': None, 'generatedTokens': 0, 'promptTokens': 0,
                   'rawOutputUtf16': 0, 'complete': False, 'passed': None}
            report['cases'].append(row)
            for phase in ['extract', 'answer']:
                stage = copy.deepcopy(suite)
                stage['cases'] = [copy.deepcopy(task)]
                stage['instruction'] = suite['extractionInstruction'] if phase == 'extract' else suite['answerInstruction']
                if phase == 'answer':
                    # Source quotations remain data in the user turn, never system instructions.
                    stage['cases'][0]['messages'][-1]['content'] += ('\n\n<reploid-calculation-result-v1>\n'
                        + json.dumps(row['tool']) + '\n</reploid-calculation-result-v1>')
                rendered = source_tokenizer.apply_chat_template(quality.task_messages(stage['cases'][0], stage),
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
                original_evaluate(model, config, tokenizer, source_tokenizer, stage, phase_report, phase_path)
                result = phase_report['results'][0]
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
                        plan = json.loads(result['text'])
                        # Model output remains JSON data, never executable source or shell text.
                        data = json.dumps(json.dumps({'plan': plan, 'messages': task['messages']}))
                        program = ('import {runCalculation} from ' + json.dumps((root / 'calculate.js').as_uri()) + ';'
                            + 'const {plan,messages}=JSON.parse(' + data + ');'
                            + 'try { console.log(JSON.stringify({ok:true,result:await runCalculation(plan,messages)})); }'
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
        report['reviewRequired'] = True
        report['passed'] = False
        report['status'] = 'completed; independent full factual review required'
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
