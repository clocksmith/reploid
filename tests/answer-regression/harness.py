"""Reploid answer regression harness — automated regression evaluation, not independent acceptance.

Commands (run with python3 -I; see README.md):
  run               Generate answers on one target and write its run record.
  evaluate          Apply the checks (and an optional automated judge) to a run.
  compare           Compare a run's evaluation with a stored baseline run of the same target.
  reproduce         Confirm the harness reproduces the useful-answer set's frozen mechanical results.
  search-preflight  Retrieval and prompt sizes for the frozen search set; no model is run.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from answer_regression.common import (LABEL, SEARCH_SET, SEARCH_SET_SHA256, SCOPE_NOTE, USEFUL_ANSWER_SET,  # noqa: E402
                                      USEFUL_ANSWER_SET_SHA256, frozen_file, harness_identity, label_block, load_json, now_iso, repo_relative, require_outside_repo,
                                      retrieval_component_identity, sha256_file, write_json)


def log(message):
    print(f'[answer-regression] {message}', file=sys.stderr, flush=True)


def load_item_set(kind):
    if kind == 'useful-answer':
        if sha256_file(USEFUL_ANSWER_SET) != USEFUL_ANSWER_SET_SHA256:
            raise SystemExit('The frozen useful-answer set changed; its sha256 is pinned.')
        data = load_json(USEFUL_ANSWER_SET)
        return data, {'kind': kind, 'name': data['name'], 'file': repo_relative(USEFUL_ANSWER_SET),
                      'sha256': USEFUL_ANSWER_SET_SHA256}
    data = frozen_file(SEARCH_SET, SEARCH_SET_SHA256, 'search-task set')
    return data, {'kind': kind, 'name': data['name'], 'file': repo_relative(SEARCH_SET), 'sha256': SEARCH_SET_SHA256}


def build_plan(kind, data, only, target, context_candidate=None):
    """The exact content to send per turn. Search turns carry the retrieval record and dispatched content."""
    from answer_regression.checks import prepare_retrieval
    if context_candidate and kind != 'search':
        raise SystemExit('Context candidates apply only to search runs')
    items = [item for item in data['items'] if not only or item['id'] in only]
    if only and len(items) != len(only):
        raise SystemExit(f'unknown item ids: {sorted(set(only) - {item["id"] for item in items})}')
    plan = {'setKind': kind, 'setPath': str(USEFUL_ANSWER_SET if kind == 'useful-answer' else SEARCH_SET),
            'maxTokens': 1024, 'items': []}
    supported, reason = target.supports_search() if kind == 'search' else (True, None)
    for item in items:
        if kind == 'useful-answer':
            turns = [{'user': turn['user'], 'send': turn['user'], 'dispatch': True, 'retrieval': None} for turn in item['turns']]
            plan['items'].append({'id': item['id'], 'category': item['category'], 'turns': turns})
            continue
        if context_candidate:
            retained = context_candidate[item['id']]
            prepared = {'record': retained['retrieval'], 'dispatchedMessages': retained['dispatchedMessages'],
                        'failureMessage': None}
        else:
            prepared = prepare_retrieval(item, data, [{'role': 'user', 'content': item['prompt']}])
        dispatched = prepared['dispatchedMessages']
        turn = {'user': item['prompt'], 'send': dispatched[-1]['content'] if dispatched else None,
                'dispatch': bool(dispatched) and supported, 'retrieval': prepared['record'],
                'failureMessage': prepared['failureMessage'], 'unsupported': None if supported else reason}
        plan['items'].append({'id': item['id'], 'category': item.get('kind', 'search'), 'turns': [turn]})
    if only and kind == 'useful-answer':
        log('a partial useful-answer run cannot use the frozen file directly; only full runs are supported for this target')
    return plan


def command_run(args):
    from answer_regression.targets import load_target
    target = load_target(args.target)
    data, item_set = load_item_set(args.set)
    context_candidate = None
    if args.context_candidate:
        if args.set != 'search':
            raise SystemExit('Context candidates apply only to search runs')
        from answer_regression.context_candidate import load_candidate
        identity, context_candidate, _ = load_candidate(args.context_candidate)
        item_set['contextCandidate'] = identity
    work = Path(args.work).resolve()
    require_outside_repo(work, 'The work directory')
    if work.exists() and any(work.iterdir()):
        raise SystemExit(f'The work directory must be empty: {work}')
    work.mkdir(parents=True, exist_ok=True)
    out = Path(args.out).resolve()
    if (out / 'run.json').exists():
        raise SystemExit(f'{out / "run.json"} exists; runs are never overwritten')
    only = [value for value in (args.items or '').split(',') if value]
    if only and args.set == 'useful-answer' and target.kind == 'cpu-q4k-control':
        raise SystemExit('The CPU control runs the frozen useful-answer file as a whole; --items is not supported there.')
    started = now_iso()
    plan = build_plan(args.set, data, only, target, context_candidate)
    if args.preflight:
        if target.kind != 'doppler-single-machine':
            raise SystemExit('--preflight applies to the doppler-single-machine target')
        _, identities, details = target.generate(plan, work, log, preflight=True)
        report = {'schema': 'reploid.answer-regression.preflight/v1', **label_block(), 'target': target.describe(),
                  'identities': identities, 'details': details, 'itemSet': item_set, 'checkedAt': now_iso()}
        write_json(out / 'preflight.json', report)
        log(f'preflight written to {out / "preflight.json"}')
        return
    items, identities, details = target.generate(plan, work, log)
    record = {
        'schema': 'reploid.answer-regression.run/v1', **label_block(),
        'runId': f"{target.id}-{started.replace(':', '').replace('-', '')}",
        'startedAt': started, 'finishedAt': now_iso(),
        'harness': harness_identity(),
        'target': target.describe(), 'identities': identities, 'details': details, 'itemSet': item_set,
        'retrieval': ({'component': retrieval_component_identity(), 'provider': data['retrieval']['provider'],
                       'fixedNow': data['retrieval']['fixedNow'],
                       'limits': None if context_candidate else data['retrieval']['limits'],
                       'perItemLimits': ({key: row['limits'] for key, row in context_candidate.items()}
                                         if context_candidate else None)}
                      if args.set == 'search' else None),
        'items': items,
    }
    write_json(out / 'run.json', record)
    log(f'run written to {out / "run.json"}')


def command_evaluate(args):
    from answer_regression.evaluation import evaluate_run
    run_dir = Path(args.run).resolve()
    out = Path(args.out).resolve() if args.out else run_dir / 'evaluation.json'
    if out.exists():
        raise SystemExit(f'{out} exists; evaluations are never overwritten')
    if args.scratch:
        require_outside_repo(Path(args.scratch), 'The code-execution scratch directory')
    evaluation = evaluate_run(run_dir / 'run.json', judge_path=args.judge, scratch=args.scratch, log=log)
    write_json(out, evaluation)
    log(f'evaluation written to {out}')


def command_compare(args):
    from answer_regression.report import compare_runs, render_markdown
    report = compare_runs(Path(args.baseline).resolve(), Path(args.candidate).resolve(),
                          baseline_evaluation=args.baseline_evaluation, candidate_evaluation=args.candidate_evaluation)
    out = Path(args.out).resolve()
    write_json(out.with_suffix('.json'), report)
    from answer_regression.common import write_text
    write_text(out.with_suffix('.md'), render_markdown(report))
    log(f"report written to {out.with_suffix('.json')} and {out.with_suffix('.md')}")
    regressions = report['summary']['newlyFailingTotal']
    print(f"{LABEL}: {regressions} newly failing verdicts, {report['summary']['newlyPassingTotal']} newly passing, "
          f"{report['summary']['answersChanged']} changed answers")
    if args.fail_on_regression and regressions:
        sys.exit(1)


def command_reproduce(args):
    from answer_regression.reproduce import reproduce
    out = Path(args.out).resolve()
    if out.exists():
        raise SystemExit(f'{out} exists')
    report = reproduce(Path(args.run).resolve(), scratch=args.scratch, log=log)
    write_json(out, report)
    log(f"reproduction written to {out}: {report['verdict']}")


def command_search_preflight(args):
    from answer_regression.search_preflight import preflight
    out = Path(args.out).resolve()
    if out.exists():
        raise SystemExit(f'{out} exists')
    write_json(out, preflight(args.package_archive, args.capsule, log))
    log(f'search preflight written to {out}')


def main():
    parser = argparse.ArgumentParser(description=f'Reploid answer regression harness ({LABEL}). {SCOPE_NOTE}')
    sub = parser.add_subparsers(dest='command', required=True)
    run = sub.add_parser('run', help='generate answers on one target')
    run.add_argument('--target', required=True, help='target configuration JSON')
    run.add_argument('--set', choices=['useful-answer', 'search'], default='useful-answer')
    run.add_argument('--context-candidate', choices=['whole-passages-250'],
                     help='search only: separately bound retained development input; requires its own baseline')
    run.add_argument('--work', required=True, help='empty work directory outside the repository (raw outputs and logs)')
    run.add_argument('--out', required=True, help='run directory; run.json is written there')
    run.add_argument('--items', help='comma-separated item ids (targets that support partial runs)')
    run.add_argument('--preflight', action='store_true', help='doppler-single-machine: identities and prompt sizes, no GPU')
    run.set_defaults(func=command_run)
    evaluate = sub.add_parser('evaluate', help='apply the checks to a run')
    evaluate.add_argument('--run', required=True, help='run directory containing run.json')
    evaluate.add_argument('--out', help='evaluation file (default: <run>/evaluation.json)')
    evaluate.add_argument('--judge', help='automated judge configuration JSON; off unless given')
    evaluate.add_argument('--scratch', help='code-execution scratch root outside the repository (default: a new temp dir)')
    evaluate.set_defaults(func=command_evaluate)
    compare = sub.add_parser('compare', help='compare a run with a stored baseline of the same target')
    compare.add_argument('--baseline', required=True, help='baseline run directory')
    compare.add_argument('--candidate', required=True, help='candidate run directory')
    compare.add_argument('--baseline-evaluation', help='baseline evaluation file (default: <baseline>/evaluation.json)')
    compare.add_argument('--candidate-evaluation', help='candidate evaluation file (default: <candidate>/evaluation.json)')
    compare.add_argument('--out', required=True, help='report path prefix; writes .json and .md')
    compare.add_argument('--fail-on-regression', action='store_true', help='exit 1 when any verdict newly fails')
    compare.set_defaults(func=command_compare)
    reproduce = sub.add_parser('reproduce', help='confirm the frozen useful-answer mechanical results are reproduced')
    reproduce.add_argument('--run', required=True, help='a cpu-q4k-control run directory of the useful-answer set')
    reproduce.add_argument('--out', required=True)
    reproduce.add_argument('--scratch', help='code-execution scratch root outside the repository')
    reproduce.set_defaults(func=command_reproduce)
    search = sub.add_parser('search-preflight', help='retrieval records and prompt sizes for the search set; no model')
    search.add_argument('--package-archive', help='Doppler archive for prompt token counts (optional)')
    search.add_argument('--capsule', help='Capsule directory for the tokenizer (optional)')
    search.add_argument('--out', required=True)
    search.set_defaults(func=command_search_preflight)
    args = parser.parse_args()
    args.func(args)


if __name__ == '__main__':
    main()
