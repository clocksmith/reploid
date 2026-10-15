"""Optional automated whole-answer judge through a configurable model adapter.

Off unless a judge configuration is passed to `evaluate --judge`. Credentials come from an environment variable
or a file outside the repository, and are never written anywhere. The judge must be a different model from the
generator: its configured model, its configured identity and the model each response reports are checked against
the run's generator identities, and the judge endpoint cannot be the run's own route. Every judge record is labeled
"automated judge, not independent review"; it is a regression signal, not a grade under the review protocol.

Adapters: openai-chat (any OpenAI-compatible /v1/chat/completions endpoint) and anthropic-messages (/v1/messages).
"""
import json
import os
import re
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from .common import (JUDGE_LABEL, POLICIES, POLICIES_SHA256, expand, inside_repo, load_json, resolve_path, sha256_file,
                     sha256_text)

JUDGE_SCHEMA = 'reploid.answer-regression.judge/v1'
ADAPTERS = ('openai-chat', 'anthropic-messages')
GRADES = ('correct', 'incorrect', 'unverified')
STATUSES = ('whole-answer-correct', 'has-incorrect-element', 'unverified-only')


def name_key(value):
    """Lowercase alphanumerics of the last path segment: 'Qwen/Qwen3.5-0.8B' and 'qwen-3-5-0-8b-q4k' share 'qwen3508b'."""
    return re.sub(r'[^a-z0-9]', '', str(value).lower().split('/')[-1])


def generator_identity(run):
    identities = run.get('identities') or {}
    model = identities.get('model') or {}
    route = identities.get('route') or {}
    names = [n for n in (model.get('catalogId'), model.get('source'), model.get('modelId')) if n]
    base = route.get('baseUrl', {}).get('configured') if isinstance(route.get('baseUrl'), dict) else None
    return {'names': names, 'manifestIdentity': model.get('manifestIdentity'), 'routeBaseUrl': base}


def same_model(candidate, generator):
    key = name_key(candidate)
    if not key:
        return True
    for name in generator['names']:
        other = name_key(name)
        if other and (key in other or other in key):
            return True
    return False


def ensure_distinct(config, generator):
    """Refuses a judge that is, or could be, the generator."""
    problems = []
    if same_model(config['model'], generator):
        problems.append(f"judge model {config['model']!r} matches the generator {generator['names']}")
    identity = config.get('modelIdentity')
    if identity and generator['manifestIdentity'] and identity == generator['manifestIdentity']:
        problems.append('judge modelIdentity equals the generator manifest identity')
    if generator['routeBaseUrl']:
        route = expand(generator['routeBaseUrl']) if '${' in generator['routeBaseUrl'] else generator['routeBaseUrl']
        try:
            same_host = urlsplit(route).netloc and urlsplit(route).netloc == urlsplit(expand(config['endpoint'])).netloc
        except SystemExit:
            same_host = False
        if same_host:
            problems.append("judge endpoint is the run's own installed route")
    if problems:
        raise SystemExit('The judge must be a different model from the generator: ' + '; '.join(problems))


def read_key(credentials):
    if credentials.get('env'):
        key = os.environ.get(credentials['env'])
        if not key:
            raise SystemExit(f"Judge credentials: environment variable {credentials['env']} is empty")
        return key.strip()
    if credentials.get('file'):
        path = resolve_path(credentials['file'])
        if inside_repo(path):
            raise SystemExit('Judge credentials must be outside the repository')
        return path.read_text(encoding='utf-8').strip()
    raise SystemExit('Judge credentials need env or file')


INSTRUCTIONS = """You are an automated judge for engineering regression tests of a small language model's answers.
Your output is labeled "automated judge, not independent review": it is a regression signal for engineers, not a
review under the human review protocol, and it grants no acceptance.

Grade the answer under the frozen evaluation policies below, using the policy letter given (Q, S or R).
Enumerate every element of the answer, grade each one correct, incorrect or unverified, and derive the status from
the grades exactly as section 3 says. You cannot run code yourself; when harness executions of the answer's code are
given, treat them as execution evidence for the inputs they ran. For policy R, the retrieval record's sources are the
only sources the answer may cite.

Return only one JSON object, with no other text:
{"reference": [{"part": "...", "correctAnswer": "..."}],
 "elements": [{"kind": "...", "quote": "...", "claim": "...", "addition": false, "grade": "correct|incorrect|unverified", "basis": "..."}],
 "status": "whole-answer-correct|has-incorrect-element|unverified-only"}

FROZEN EVALUATION POLICIES
"""


def derive_status(elements):
    grades = [element.get('grade') for element in elements]
    if not grades:
        return None
    if 'incorrect' in grades:
        return 'has-incorrect-element'
    if 'unverified' in grades:
        return 'unverified-only'
    return 'whole-answer-correct'


def parse_reply(text):
    body = text.strip()
    fenced = re.fullmatch(r'```(?:json)?\s*\n(.*?)\n?```', body, re.S)
    if fenced:
        body = fenced.group(1)
    start, end = body.find('{'), body.rfind('}')
    if start < 0 or end <= start:
        raise ValueError('no JSON object in the judge reply')
    value = json.loads(body[start:end + 1])
    elements = value.get('elements')
    if not isinstance(elements, list) or not elements:
        raise ValueError('the judge reply has no elements')
    for element in elements:
        if element.get('grade') not in GRADES:
            raise ValueError(f"invalid grade {element.get('grade')!r}")
    derived = derive_status(elements)
    return {'reference': value.get('reference'), 'elements': elements, 'declaredStatus': value.get('status'),
            'status': derived, 'statusCorrected': value.get('status') != derived}


class Judge:
    def __init__(self, config, generator):
        if config.get('schema') != JUDGE_SCHEMA or config.get('adapter') not in ADAPTERS:
            raise SystemExit(f'Judge configuration needs schema {JUDGE_SCHEMA} and adapter in {ADAPTERS}')
        for key in ('endpoint', 'model', 'credentials'):
            if not config.get(key):
                raise SystemExit(f'Judge configuration needs {key}')
        config = {**config, **{key: expand(config[key]) for key in ('endpoint', 'model', 'provider', 'modelIdentity')
                               if isinstance(config.get(key), str)}}
        ensure_distinct(config, generator)
        self.config, self.generator = config, generator
        policy_path = resolve_path(config['policyFile']) if config.get('policyFile') else POLICIES
        self.policy_sha = sha256_file(policy_path)
        if not config.get('policyFile') and self.policy_sha != POLICIES_SHA256:
            raise SystemExit('The frozen evaluation policies changed')
        self.policy_text = policy_path.read_text(encoding='utf-8')
        self.key = read_key(config['credentials'])
        self.endpoint = expand(config['endpoint'])

    def describe(self):
        return {'label': JUDGE_LABEL, 'adapter': self.config['adapter'], 'endpointHost': urlsplit(self.endpoint).netloc,
                'model': self.config['model'], 'modelIdentity': self.config.get('modelIdentity'),
                'provider': self.config.get('provider'), 'temperature': self.config.get('temperature', 0),
                'policySha256': self.policy_sha, 'generator': self.generator,
                'distinctFromGenerator': 'enforced by model name, manifest identity, endpoint and each reported response model'}

    def _request(self, system, user):
        temperature, max_tokens = self.config.get('temperature', 0), self.config.get('maxTokens', 4096)
        if self.config['adapter'] == 'openai-chat':
            body = {'model': self.config['model'], 'temperature': temperature, 'max_tokens': max_tokens,
                    'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': user}]}
            headers = {'content-type': 'application/json', 'authorization': f'Bearer {self.key}'}
        else:
            body = {'model': self.config['model'], 'temperature': temperature, 'max_tokens': max_tokens, 'system': system,
                    'messages': [{'role': 'user', 'content': user}]}
            headers = {'content-type': 'application/json', 'x-api-key': self.key, 'anthropic-version': '2023-06-01'}
        request = urllib.request.Request(self.endpoint, data=json.dumps(body).encode(), headers=headers, method='POST')
        with urllib.request.urlopen(request, timeout=self.config.get('timeoutSeconds', 180)) as response:
            reply = json.loads(response.read())
        if self.config['adapter'] == 'openai-chat':
            text = reply['choices'][0]['message']['content'] or ''
        else:
            text = ''.join(block.get('text', '') for block in reply.get('content', []) if block.get('type') == 'text')
        return text, reply.get('model'), reply.get('id')

    def _call(self, system, user):
        retries = self.config.get('retries', 2)
        for attempt in range(retries + 1):
            try:
                return self._request(system, user)
            except urllib.error.HTTPError as error:
                if error.code not in (429, 500, 502, 503, 504, 529) or attempt == retries:
                    raise
            except (urllib.error.URLError, TimeoutError):
                if attempt == retries:
                    raise
            time.sleep(2 * 4 ** attempt)
        raise RuntimeError('unreachable')

    def judge(self, item_id, policy, context, prompt, answer, retrieval=None, executions=None):
        payload = {'itemId': item_id, 'policy': policy, 'earlierTurns': context, 'prompt': prompt, 'answer': answer}
        if executions:
            payload['harnessExecutions'] = executions
        if policy == 'R':
            payload['retrievalRecord'] = None if retrieval is None else {
                'outcome': retrieval.get('outcome'), 'error': retrieval.get('error'), 'query': retrieval.get('query'),
                'sources': [{k: s.get(k) for k in ('number', 'sourceId', 'url', 'title', 'retrievedAt', 'contentHash', 'passage')}
                            for s in retrieval.get('sources', [])]}
        system = INSTRUCTIONS + self.policy_text
        user = json.dumps(payload, ensure_ascii=False, indent=1)
        record = {'label': JUDGE_LABEL, 'promptSha256': sha256_text(system + '\n' + user), 'answerSha256': sha256_text(answer)}
        started = time.time()
        try:
            text, response_model, response_id = self._call(system, user)
        except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as error:
            return {**record, 'status': None, 'error': f'{type(error).__name__}: {str(error)[:200]}'}
        record.update({'responseModel': response_model, 'responseId': response_id, 'seconds': round(time.time() - started, 2),
                       'replySha256': sha256_text(text)})
        if response_model and same_model(response_model, self.generator):
            return {**record, 'status': None, 'error': 'the response came from the generator model; discarded'}
        configured = name_key(self.config['model'])
        if response_model and not name_key(response_model).startswith(configured):
            return {**record, 'status': None, 'error': f'the response model {response_model!r} is not the configured judge'}
        try:
            parsed = parse_reply(text)
        except (ValueError, json.JSONDecodeError) as error:
            return {**record, 'status': None, 'error': f'unparseable judge reply: {error}', 'reply': text[:2000]}
        return {**record, **parsed}


def load_judge(path, run):
    return Judge(load_json(path), generator_identity(run))
