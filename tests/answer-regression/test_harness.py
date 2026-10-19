"""Focused tests of the answer regression harness. Synthetic answers only: no model, no GPU, no network.

Run: python3 -I tests/answer-regression/test_harness.py
"""
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from answer_regression import checks, codeexec, judge, report  # noqa: E402
from answer_regression.common import JUDGE_LABEL, LABEL, SEARCH_SET, load_json, sha256_file, write_json  # noqa: E402


class FrozenChecks(unittest.TestCase):
    def test_frozen_check_module_is_pinned_and_unchanged_in_behavior(self):
        self.assertEqual(sha256_file(checks.FROZEN_CHECK), checks.FROZEN_CHECK_SHA256)
        self.assertTrue(checks.run_check({'type': 'finalArray', 'equals': [4, 8], 'ignore': [[1, 2, 3, 4]]},
                                         'doubleEvens([1, 2, 3, 4]) // [4, 8]')['pass'])
        self.assertFalse(checks.run_check({'type': 'onlyAnswer', 'pattern': 'yes'}, 'Yes, it is prime.')['pass'])

    def test_mechanical_item_uses_frozen_grade_arm(self):
        item = {'id': 'x', 'category': 'arithmetic', 'judgment': 'mechanical',
                'turns': [{'user': 'q', 'checks': [{'type': 'number', 'value': 12, 'tolerance': 0}]}]}
        run_item = {'arm': 't', 'turns': [{'turn': 1, 'output': 'It is 12.', 'promptTokenCount': 300, 'overPromptLimit': True,
                                           'stopReason': 'eos-token', 'decodeSteps': 4, 'seconds': 1, 'minMarginTop1Top2': 1}]}
        result = checks.mechanical_item(item, run_item)
        self.assertTrue(result['checksPass'])
        self.assertFalse(result['pass'])  # over the route prompt limit never passes
        self.assertEqual(result['status'], 'promptLimitExceeded')


class FormatAndInstruction(unittest.TestCase):
    def test_format_checks(self):
        good = {'output': 'Canberra.', 'stopReason': 'eos-token', 'overPromptLimit': False, 'promptTokenCount': 19}
        self.assertTrue(all(row['pass'] for row in checks.format_checks(good)))
        loop = dict(good, output=' '.join(['the same twelve words repeat here again and again in this loop'] * 3))
        self.assertFalse({r['type']: r['pass'] for r in checks.format_checks(loop)}['noDegenerateRepetition'])
        leak = dict(good, output='Answer<|im_end|>', stopReason='max-tokens')
        rows = {r['type']: r['pass'] for r in checks.format_checks(leak)}
        self.assertFalse(rows['noTemplateTokens'])
        self.assertFalse(rows['stoppedOnEndOfTurn'])

    def test_code_only(self):
        sandbox = codeexec.Sandbox()
        try:
            fenced = '```python\ndef is_palindrome(s):\n    return s.lower() == s.lower()[::-1]\n```'
            self.assertTrue(checks.instruction_check({'type': 'codeOnly', 'language': 'python'}, fenced, sandbox)['pass'])
            self.assertFalse(checks.instruction_check({'type': 'codeOnly', 'language': 'python'}, 'Here it is:\n' + fenced, sandbox)['pass'])
            self.assertTrue(checks.instruction_check({'type': 'codeOnly', 'language': 'python'}, 'def f(s):\n    return s', sandbox)['pass'])
        finally:
            sandbox.close()


class CodeExecution(unittest.TestCase):
    def setUp(self):
        self.sandbox = codeexec.Sandbox(timeout=5)

    def tearDown(self):
        self.sandbox.close()

    def case(self, language, function, probes):
        return {'item': 'x', 'turn': 1, 'language': language, 'function': function, 'probes': probes}

    def test_python_probe_passes_and_fails(self):
        answer = '```python\ndef sum_of_squares(nums):\n    return sum(n * n for n in nums)\n```\nIt returns 14.'
        result = codeexec.run_case(self.sandbox, self.case('python', 'sum_of_squares', [{'args': [[1, 2, 3]], 'expect': 14}]), answer)
        self.assertTrue(result['pass'], result)
        broken = '```python\ndef count_vowels(s):\n    return len(s.is_vowel())\n```'
        result = codeexec.run_case(self.sandbox, self.case('python', 'count_vowels', [{'args': ['education'], 'expect': 5}]), broken)
        self.assertFalse(result['pass'])
        self.assertIn('AttributeError', result['probes'][0]['observed']['error'])

    def test_javascript_first_declared_function_and_bool_strictness(self):
        answer = '```javascript\nconst reverseString = (s) => s.split("").reverse().join("");\n```'
        result = codeexec.run_case(self.sandbox, self.case('javascript', None, [{'args': ['stressed'], 'expect': 'desserts'}]), answer)
        self.assertTrue(result['pass'], result)
        self.assertEqual(result['function'], 'reverseString')
        self.assertFalse(codeexec.same_value(1, True))

    def test_timeout_and_isolation(self):
        loop = '```python\ndef f():\n    return 1\nwhile True:\n    pass\n```'
        result = codeexec.run_case(self.sandbox, self.case('python', 'f', [{'args': [], 'expect': 1}]), loop)
        self.assertTrue(result['execution']['timedOut'])
        self.assertFalse(result['pass'])
        if self.sandbox.isolation['kind'] == 'sandbox-exec':
            net = ('```python\nimport socket\ndef f():\n    try:\n        socket.create_connection(("1.1.1.1", 80), timeout=2)\n'
                   '        return "open"\n    except OSError:\n        return "blocked"\n```')
            result = codeexec.run_case(self.sandbox, self.case('python', 'f', [{'args': [], 'expect': 'blocked'}]), net)
            self.assertTrue(result['pass'], result)


class Citations(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = load_json(SEARCH_SET)
        cls.items = {item['id']: item for item in cls.data['items']}

    def run_item(self, item_id, answer):
        item = self.items[item_id]
        prepared = checks.prepare_retrieval(item, self.data, [{'role': 'user', 'content': item['prompt']}])
        dispatched = prepared['dispatchedMessages'] is not None
        turn = {'turn': 1, 'output': answer if dispatched else None, 'retrieval': prepared['record'], 'dispatched': dispatched,
                'overPromptLimit': False}
        return checks.search_item(item, {'turns': [turn]}, self.data)

    def test_valid_and_invalid_citations(self):
        good = self.run_item('search-kettle-recall-models', 'The recall covers BrewMate models BM-200 and BM-210 [1].')
        self.assertTrue(good['pass'], good)
        self.assertTrue(good['claimCoverage']['pass'])
        invented = self.run_item('search-kettle-recall-models',
                                 'The recall covers BM-200 and BM-210 [7]. See https://example.com/recall for details [1].')
        names = {c['type']: c['pass'] for c in invented['citations']['checks']}
        self.assertFalse(names['citationsResolve'])
        self.assertFalse(names['noUnrecordedUrls'])
        self.assertFalse(invented['pass'])

    def test_expected_source_and_abstention_and_empty_retrieval(self):
        wrong_source = self.run_item('search-kayak-parking-total', 'The total is $50 [1].')
        self.assertTrue(wrong_source['answer']['pass'])
        self.assertFalse(wrong_source['citations']['pass'])  # the parking page (2) is not cited
        abstains = self.run_item('search-pool-phone-unanswerable',
                                 'The retrieved sources do not include a phone number for the Ashbury Community Pool.')
        self.assertTrue(abstains['pass'], abstains)
        invents = self.run_item('search-pool-phone-unanswerable', 'The pool phone number is 555-0142 [3].')
        self.assertFalse(invents['answer']['pass'])
        empty = self.run_item('search-no-results', '')
        self.assertEqual(empty['retrievalOutcome']['observed'], 'empty')
        self.assertTrue(empty['pass'])


class Handler(BaseHTTPRequestHandler):
    reply_model = 'other-judge-model-1'

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['content-length'])))
        Handler.last_auth = self.headers.get('authorization')
        text = json.dumps({'reference': [], 'status': 'whole-answer-correct',
                           'elements': [{'kind': 'fact', 'quote': 'Canberra', 'claim': 'capital', 'addition': False,
                                         'grade': 'correct', 'basis': 'known'}]})
        payload = {'id': 'r1', 'model': Handler.reply_model, 'choices': [{'message': {'content': text}}]}
        Handler.last_body = body
        data = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


class Judge(unittest.TestCase):
    generator = {'names': ['qwen-3-5-0-8b-q4k-ehaf16', 'Qwen/Qwen3.5-0.8B'], 'manifestIdentity': 'sha256:abc', 'routeBaseUrl': None}

    def config(self, model, endpoint='http://127.0.0.1:9/v1/chat/completions'):
        return {'schema': judge.JUDGE_SCHEMA, 'adapter': 'openai-chat', 'endpoint': endpoint, 'model': model,
                'credentials': {'env': 'ARX_TEST_JUDGE_KEY'}}

    def test_judge_must_differ_from_generator(self):
        os.environ['ARX_TEST_JUDGE_KEY'] = 'test-key'
        for same in ('Qwen/Qwen3.5-0.8B', 'qwen3.5-0.8b-instruct', 'qwen-3-5-0-8b-q4k-ehaf16', 'Qwen3.5'):
            with self.assertRaises(SystemExit):
                judge.Judge(self.config(same), self.generator)
        with self.assertRaises(SystemExit):
            judge.Judge(dict(self.config('other'), modelIdentity='sha256:abc'), self.generator)
        judge.Judge(self.config('other-judge-model'), self.generator)

    def test_round_trip_label_and_response_identity(self):
        os.environ['ARX_TEST_JUDGE_KEY'] = 'test-key'
        server = HTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            endpoint = f'http://127.0.0.1:{server.server_port}/v1/chat/completions'
            instance = judge.Judge(self.config('other-judge-model', endpoint), self.generator)
            Handler.reply_model = 'other-judge-model-1'
            record = instance.judge(item_id='x', policy='Q', context=[], prompt='Capital of Australia?', answer='Canberra.')
            self.assertEqual(record['label'], JUDGE_LABEL)
            self.assertEqual(record['status'], 'whole-answer-correct')
            self.assertEqual(Handler.last_auth, 'Bearer test-key')
            self.assertEqual(Handler.last_body['temperature'], 0)
            self.assertNotIn('test-key', json.dumps(record) + json.dumps(instance.describe()))
            Handler.reply_model = 'Qwen3.5-0.8B'
            self.assertIn('generator', instance.judge(item_id='x', policy='Q', context=[], prompt='p', answer='a')['error'])
            Handler.reply_model = 'unrelated-model'
            self.assertIn('not the configured judge', instance.judge(item_id='x', policy='Q', context=[], prompt='p', answer='a')['error'])
        finally:
            server.shutdown()
            server.server_close()

    def test_status_is_derived_from_grades(self):
        parsed = judge.parse_reply('```json\n{"status": "whole-answer-correct", "elements": [{"grade": "correct"}, '
                                   '{"grade": "unverified"}]}\n```')
        self.assertEqual(parsed['status'], 'unverified-only')
        self.assertTrue(parsed['statusCorrected'])


class RouteHandler(BaseHTTPRequestHandler):
    requests = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['content-length'])))
        RouteHandler.requests.append({'path': self.path, 'auth': self.headers.get('authorization'), 'body': body})
        content = 'Canberra.' if len(body['messages']) == 1 else 'Wellington.'
        data = json.dumps({'id': 'c', 'object': 'chat.completion', 'model': body['model'],
                           'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': content},
                                        'finish_reason': 'stop'}]}).encode()
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


class InstalledRouteTarget(unittest.TestCase):
    def test_two_turn_history_identities_and_no_search(self):
        from answer_regression.targets import load_target
        server = HTTPServer(('127.0.0.1', 0), RouteHandler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with tempfile.TemporaryDirectory() as root:
                app = Path(root) / 'app'
                entry = {'id': 'm', 'identity': 'sha256:' + '0' * 64, 'capsule': {'capsuleId': 'cap', 'targetPlans': []},
                         'generation': {'temperature': 0, 'maxTokens': 64}}
                write_json(app / 'self' / 'config' / 'chat-models.json', [entry])
                config = {'schema': 'reploid.answer-regression.target/v1', 'id': 'route', 'kind': 'installed-route',
                          'protocol': 'chat-completions', 'baseUrl': '${ARX_TEST_ROUTE}', 'modelId': 'm',
                          'routePromptTokenLimit': 250, 'auth': {'env': 'ARX_TEST_ROUTE_TOKEN'},
                          'paths': {'installedApp': '${ARX_TEST_APP}'}}
                write_json(Path(root) / 'target.json', config)
                environ = {'ARX_TEST_ROUTE': f'http://127.0.0.1:{server.server_port}', 'ARX_TEST_APP': str(app)}
                os.environ['ARX_TEST_ROUTE_TOKEN'] = 'route-token'
                target = load_target(Path(root) / 'target.json', environ)
                plan = {'setKind': 'useful-answer', 'items': [{'id': 'x', 'category': 'follow-up', 'turns': [
                    {'user': 'Capital of Australia?', 'send': 'Capital of Australia?', 'dispatch': True, 'retrieval': None},
                    {'user': 'And New Zealand?', 'send': 'And New Zealand?', 'dispatch': True, 'retrieval': None}]}]}
                items, identities, _ = target.generate(plan, Path(root) / 'work', lambda message: None)
                turns = items[0]['turns']
                self.assertEqual([t['output'] for t in turns], ['Canberra.', 'Wellington.'])
                self.assertEqual(RouteHandler.requests[1]['body']['messages'][1], {'role': 'assistant', 'content': 'Canberra.'})
                self.assertEqual(RouteHandler.requests[0]['auth'], 'Bearer route-token')
                self.assertNotIn('temperature', RouteHandler.requests[0]['body'])
                self.assertEqual(turns[0]['responseModel'], 'm')
                self.assertEqual(identities['route']['baseUrl'], {'configured': '${ARX_TEST_ROUTE}'})
                self.assertNotIn(str(app), json.dumps(identities))
                self.assertEqual(target.supports_search()[0], False)
        finally:
            server.shutdown()
            server.server_close()


class Compare(unittest.TestCase):
    def make(self, root, name, output, tokens, mechanical, target='t'):
        run = {'schema': 'reploid.answer-regression.run/v1', 'label': LABEL, 'runId': name,
               'target': {'id': target, 'kind': 'cpu-q4k-control'}, 'itemSet': {'kind': 'useful-answer', 'sha256': 's', 'name': 'n'},
               'identities': {'package': {'archive': {'sha256': name}}, 'sampling': {'temperature': 0}},
               'items': [{'id': 'a', 'turns': [{'turn': 1, 'output': output, 'outputTokenIds': tokens}]},
                         {'id': 'b', 'turns': [{'turn': 1, 'output': 'same', 'outputTokenIds': [9]}]}]}
        directory = Path(root) / name
        write_json(directory / 'run.json', run)
        evaluation = {'run': {'sha256': sha256_file(directory / 'run.json')}, 'judge': None,
                      'summary': {'mechanical': {'pass': int(mechanical) + 1, 'total': 2}},
                      'items': [{'id': 'a', 'category': 'code', 'mechanical': {'pass': mechanical}, 'format': {'pass': True},
                                 'instruction': {'pass': None}, 'code': {'pass': None}, 'turns': []},
                                {'id': 'b', 'category': 'factual', 'mechanical': {'pass': True}, 'format': {'pass': True},
                                 'instruction': {'pass': None}, 'code': {'pass': None}, 'turns': []}]}
        write_json(directory / 'evaluation.json', evaluation)
        return directory

    def test_newly_failing_changed_answers_and_labels(self):
        with tempfile.TemporaryDirectory() as root:
            base = self.make(root, 'base', '[4, 8]', [1, 2, 3], True)
            cand = self.make(root, 'cand', '[2, 4, 6, 8]', [1, 5, 3], False)
            result = report.compare_runs(base, cand)
            self.assertEqual(result['label'], LABEL)
            self.assertEqual(result['summary']['newlyFailing'], {'mechanical': ['a']})
            self.assertEqual(result['summary']['answersChanged'], 1)
            self.assertEqual(result['items'][0]['turns'][0]['firstTokenDivergence'], 1)
            self.assertEqual([c['path'] for c in result['identityChanges']], ['package.archive.sha256'])
            self.assertFalse(result['samplingOrLimitsChanged'])
            markdown = report.render_markdown(result)
            self.assertIn(LABEL, markdown)
            self.assertIn('Newly failing', markdown)
            other = self.make(root, 'other', 'x', [1], True, target='different')
            with self.assertRaisesRegex(SystemExit, 'same target'):
                report.compare_runs(base, other)


class FixedDocumentCompare(unittest.TestCase):
    def setUp(self):
        self.data = load_json(SEARCH_SET)
        self.item = self.data['items'][0]
        self.prepared = checks.prepare_retrieval(self.item, self.data,
                                                [{'role': 'user', 'content': self.item['prompt']}])

    def run_record(self):
        return {'itemSet': {'kind': 'search', 'sha256': sha256_file(SEARCH_SET)},
                'items': [{'id': self.item['id'], 'turns': [{'turn': 1, 'dispatched': True,
                          'messages': json.loads(json.dumps(self.prepared['dispatchedMessages'])),
                          'retrieval': json.loads(json.dumps(self.prepared['record'])),
                          'output': 'A wrong answer remains evidence, even when it was fast.', 'seconds': 0.001}]}]}

    def test_accepts_exact_context_without_grading_answer_or_speed(self):
        run = self.run_record()
        report.validate_search_inputs(run)
        turn = run['items'][0]['turns'][0]
        turn['retrieval']['verification'] = {'pass': False}
        turn['seconds'] = 900
        report.validate_search_inputs(run)

    def test_rejects_changed_or_missing_dispatched_source_evidence(self):
        mutations = [lambda t: t.pop('retrieval'),
                     lambda t: t['retrieval']['sources'][0].update(passage='Replacement source'),
                     lambda t: t['retrieval']['context'].update(digest='sha256:substituted'),
                     lambda t: t['messages'][-1].update(content='Question without sources'),
                     lambda t: t.pop('messages')]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                run = self.run_record()
                mutate(run['items'][0]['turns'][0])
                with self.assertRaisesRegex(SystemExit, 'frozen source context'):
                    report.validate_search_inputs(run)

    def test_rejects_generated_output_without_dispatch_evidence(self):
        run = self.run_record()
        run['items'][0]['turns'][0].pop('dispatched')
        with self.assertRaisesRegex(SystemExit, 'no dispatched source evidence'):
            report.validate_search_inputs(run)

    def test_report_keeps_wrong_fast_answer_failed_and_refuses_changed_item_membership(self):
        with tempfile.TemporaryDirectory() as root:
            directories = []
            for name, passed, seconds in [('baseline', True, 10), ('candidate', False, 0.001)]:
                run = self.run_record()
                run.update({'runId': name, 'target': {'id': 'fixed', 'kind': 'installed-route'}, 'identities': {}})
                turn = run['items'][0]['turns'][0]
                turn.update({'seconds': seconds, 'output': 'BM-200 and BM-210 [1].' if passed else 'BM-300 [1].'})
                directory = Path(root) / name
                write_json(directory / 'run.json', run)
                write_json(directory / 'evaluation.json', {
                    'run': {'sha256': sha256_file(directory / 'run.json')}, 'judge': None,
                    'items': [{'id': self.item['id'], 'category': 'search',
                               'search': {'answer': {'pass': passed}, 'pass': passed}}]})
                directories.append(directory)
            result = report.compare_runs(*directories)
            self.assertEqual(result['summary']['newlyFailing'],
                             {'answer': [self.item['id']], 'item': [self.item['id']]})
            self.assertEqual(result['items'][0]['turns'][0]['candidateOutput'], 'BM-300 [1].')
            evaluation = load_json(directories[1] / 'evaluation.json')
            evaluation['items'] = []
            write_json(directories[1] / 'evaluation.json', evaluation, exclusive=False)
            with self.assertRaisesRegex(SystemExit, 'same evaluated item IDs'):
                report.compare_runs(*directories)

    def test_preserves_non_dispatched_retrieval_failure(self):
        run = self.run_record()
        run['items'][0]['turns'][0] = {'turn': 1, 'dispatched': False, 'output': None,
                                      'retrieval': {'outcome': 'failed', 'error': {'code': 'provider-error'}}}
        report.validate_search_inputs(run)
        self.assertEqual(run['items'][0]['turns'][0]['retrieval']['outcome'], 'failed')


class RetainedContextCandidate(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from answer_regression.context_candidate import load_candidate
        cls.identity, cls.retained, cls.policy = load_candidate('whole-passages-250')
        cls.data = load_json(SEARCH_SET)

    def run_record(self):
        run = {'runId': 'synthetic', 'target': {'id': 'mock', 'kind': 'installed-route'}, 'identities': {},
               'itemSet': {'kind': 'search', 'name': 'frozen search', 'sha256': sha256_file(SEARCH_SET),
                           'contextCandidate': self.identity}, 'items': []}
        for item in self.data['items']:
            row = self.retained[item['id']]
            run['items'].append({'id': item['id'], 'category': 'search', 'turns': [{
                'turn': 1, 'dispatched': row['dispatchedMessages'] is not None,
                'messages': row['dispatchedMessages'], 'retrieval': row['retrieval'],
                'output': 'BM-300 [1].' if row['dispatchedMessages'] else '',
                'stopReason': 'eos-token', 'seconds': 0.001, 'overPromptLimit': False}]})
        return json.loads(json.dumps(run))

    def test_plan_uses_full_retained_passages_and_does_not_dispatch_empty_retrieval(self):
        import harness
        class Target:
            def supports_search(self):
                return True, None
        plan = harness.build_plan('search', self.data, [], Target(), self.retained)
        self.assertEqual(len(plan['items']), 8)
        turns = [item['turns'][0] for item in plan['items']]
        self.assertEqual(sum(turn['dispatch'] for turn in turns), 7)
        kettle = plan['items'][0]['turns'][0]
        self.assertIn('The BrewMate BM-300 is not part of this recall.', kettle['send'])
        self.assertEqual(kettle['retrieval'], self.retained[plan['items'][0]['id']]['retrieval'])
        with self.assertRaisesRegex(SystemExit, 'only to search'):
            harness.build_plan('useful-answer', self.data, [], Target(), self.retained)

    def test_run_command_records_exact_candidate_and_per_item_limits_without_model(self):
        import harness
        from types import SimpleNamespace
        from unittest.mock import patch
        class Target:
            kind = 'installed-route'
            id = 'synthetic'
            def supports_search(self):
                return True, None
            def describe(self):
                return {'id': self.id, 'kind': self.kind}
            def generate(self, plan, work, log):
                # This injected target emits no answer and performs no inference.
                return [], {}, {'syntheticPlanItems': len(plan['items'])}
        with tempfile.TemporaryDirectory() as root:
            args = SimpleNamespace(target='unused.json', set='search', context_candidate='whole-passages-250',
                                   work=str(Path(root) / 'work'), out=str(Path(root) / 'out'), items=None, preflight=False)
            with patch('answer_regression.targets.load_target', return_value=Target()):
                harness.command_run(args)
            run = load_json(Path(args.out) / 'run.json')
            self.assertEqual(run['itemSet']['contextCandidate'], self.identity)
            self.assertIsNone(run['retrieval']['limits'])
            self.assertEqual(run['retrieval']['perItemLimits'],
                             {key: row['limits'] for key, row in self.retained.items()})
            self.assertEqual(run['details']['syntheticPlanItems'], 8)

    def test_rejects_tampered_candidate_identity_and_dispatched_context(self):
        run = self.run_record()
        report.validate_search_inputs(run)
        run['itemSet']['contextCandidate']['selectedInputSha256'] = 'changed'
        with self.assertRaisesRegex(SystemExit, 'exact retained'):
            report.validate_search_inputs(run)
        run = self.run_record()
        run['items'][0]['turns'][0]['messages'][0]['content'] += ' extra instruction'
        with self.assertRaisesRegex(SystemExit, 'frozen source context'):
            report.validate_search_inputs(run)

    def test_candidate_citation_binding_uses_its_own_policy_and_keeps_wrong_answer(self):
        item = self.data['items'][0]
        row = self.run_record()['items'][0]
        result = checks.search_item(item, row, self.data, self.policy)
        validity = {check['type']: check['pass'] for check in result['citations']['checks']}
        self.assertTrue(validity['contextDigestHolds'])
        self.assertFalse(result['answer']['pass'])
        self.assertFalse(result['pass'])
        self.assertFalse(result['citations']['supportJudged'])
        # Original-policy verification must not silently approve changed instructions.
        original = checks.search_item(item, row, self.data)
        self.assertFalse({check['type']: check['pass'] for check in original['citations']['checks']}['contextDigestHolds'])

    def test_partial_runs_compare_with_not_run_placeholders_and_reject_changed_subsets(self):
        from answer_regression.evaluation import evaluate_run
        with tempfile.TemporaryDirectory() as root:
            dirs = []
            for name in ['baseline', 'candidate']:
                directory = Path(root) / name
                run = self.run_record()
                run['items'] = run['items'][:1]
                write_json(directory / 'run.json', run)
                evaluated = evaluate_run(directory / 'run.json', log=lambda _: None)
                self.assertEqual(len(evaluated['summary']['notRun']), 7)
                write_json(directory / 'evaluation.json', evaluated)
                dirs.append(directory)
            self.assertEqual(report.compare_runs(*dirs)['summary']['newlyFailingTotal'], 0)
            run = self.run_record()
            run['items'] = run['items'][1:2]
            write_json(dirs[1] / 'run.json', run, exclusive=False)
            write_json(dirs[1] / 'evaluation.json', evaluate_run(dirs[1] / 'run.json', log=lambda _: None), exclusive=False)
            with self.assertRaisesRegex(SystemExit, 'same evaluated item IDs'):
                report.compare_runs(*dirs)

    def test_candidate_evaluation_and_compare_require_separate_baseline(self):
        from answer_regression.evaluation import evaluate_run
        with tempfile.TemporaryDirectory() as root:
            dirs = []
            for name in ['baseline', 'candidate']:
                directory = Path(root) / name
                run = self.run_record()
                run['runId'] = name
                write_json(directory / 'run.json', run)
                evaluated = evaluate_run(directory / 'run.json', log=lambda _: None)
                write_json(directory / 'evaluation.json', evaluated)
                dirs.append(directory)
            compared = report.compare_runs(*dirs)
            self.assertEqual(compared['summary']['newlyFailingTotal'], 0)
            self.assertFalse(compared['items'][0]['candidate']['answer'])
            self.assertEqual(compared['itemSet']['contextCandidate'], self.identity)
            # Same frozen documents are insufficient when dispatched context differs.
            run = load_json(dirs[1] / 'run.json')
            del run['itemSet']['contextCandidate']
            write_json(dirs[1] / 'run.json', run, exclusive=False)
            evaluation = load_json(dirs[1] / 'evaluation.json')
            evaluation['run']['sha256'] = sha256_file(dirs[1] / 'run.json')
            write_json(dirs[1] / 'evaluation.json', evaluation, exclusive=False)
            with self.assertRaisesRegex(SystemExit, 'separate context-candidate baseline'):
                report.compare_runs(*dirs)


if __name__ == '__main__':
    unittest.main()
