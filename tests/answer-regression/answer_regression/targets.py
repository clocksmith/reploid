"""Answer targets behind one interface.

Every target takes a plan (items with the exact user content to send per turn) and returns run items whose
turns carry the same fields, so the same checks and comparisons apply to all of them:

  cpu-q4k-control         The useful-answer set's CPU Q4_K control: its frozen run-arm.py, unchanged, on mac-host CPU.
  doppler-single-machine  Doppler's own Node/Dawn pipeline for a given package and model on one host (node/doppler-run.mjs).
  installed-route         An installed native participant's opt-in text HTTP API (chat request API).

Each target records the identities it ran with: package or archive hash, model manifest, Capsule, route or
placement, prompts, sampling and limits. Configured machine paths come from ${ENV} references and are never
written into records; records keep the configured text, hashes and identifiers.
"""
import json
import os
import shlex
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request
from pathlib import Path

from .common import (HARNESS, USEFUL_ANSWER_DIR, describe_path, expand, load_json, repo_relative, require_outside_repo,
                     resolve_path, sha256_file, sha256_text, write_json)

RUN_ARM = USEFUL_ANSWER_DIR / 'scripts' / 'run-arm.py'
RUN_ARM_SHA256 = 'ddc741581d65bc931aaa3e102403a8921c42708cd7ac7bb34947f8043d955571'
DOPPLER_TEXT = USEFUL_ANSWER_DIR / 'scripts' / 'doppler-text.mjs'
DOPPLER_TEXT_SHA256 = 'f369092f750b757513a35eea3e8be1a821c7a71af68af176311dcb0768573dc7'
DOPPLER_RUNNER = HARNESS / 'node' / 'doppler-run.mjs'
TARGET_SCHEMA = 'reploid.answer-regression.target/v1'
TURN_FIELDS = ('turn', 'messages', 'userTyped', 'renderedPromptSha256', 'promptTokenIds', 'promptTokenCount', 'overPromptLimit',
               'output', 'outputTokenIds', 'stopReason', 'decodeSteps', 'seconds', 'minMarginTop1Top2', 'minMarginStep',
               'reusedFrom', 'retrieval', 'dispatched', 'unsupported', 'error', 'responseModel')


def load_target(path, environ=None):
    path = Path(path).resolve()
    config = load_json(path)
    if config.get('schema') != TARGET_SCHEMA:
        raise SystemExit(f'{path}: schema must be {TARGET_SCHEMA}')
    kinds = {'cpu-q4k-control': CpuQ4kControl, 'doppler-single-machine': DopplerSingleMachine,
             'installed-route': InstalledRoute}
    if config.get('kind') not in kinds:
        raise SystemExit(f"{path}: kind must be one of {sorted(kinds)}")
    return kinds[config['kind']](config, path, environ)


def turn_row(**fields):
    row = {key: None for key in TURN_FIELDS}
    row.update(fields)
    unknown = set(row) - set(TURN_FIELDS)
    if unknown:
        raise ValueError(f'unknown turn fields {sorted(unknown)}')
    return row


def catalog_entry(catalog_path, model_id):
    entries = load_json(catalog_path)
    entry = next((m for m in entries if m.get('id') == model_id), None)
    if entry is None:
        raise SystemExit(f'model {model_id} is not in the configured catalog')
    return entry


def entry_identity(entry, catalog_path, configured):
    capsule = entry.get('capsule') or {}
    return {'catalog': {**describe_path(configured, catalog_path), 'sha256': sha256_file(catalog_path),
                        'entrySha256': sha256_text(json.dumps(entry, sort_keys=True, separators=(',', ':')))},
            'modelId': entry['id'], 'manifestIdentity': entry.get('identity'),
            'capsuleId': capsule.get('capsuleId'), 'targetPlanCount': len(capsule.get('targetPlans') or []),
            'generation': entry.get('generation')}


class Target:
    kind = None

    def __init__(self, config, path, environ=None):
        self.config, self.path, self.environ = config, path, environ
        self.id = config['id']
        self.route_limit = config.get('routePromptTokenLimit')

    def path_of(self, key, section='paths'):
        template = self.config[section][key]
        return template, resolve_path(template, environ=self.environ)

    def describe(self):
        return {'id': self.id, 'kind': self.kind, 'host': self.config.get('host'), 'description': self.config.get('description'),
                'configFile': repo_relative(self.path), 'configSha256': sha256_file(self.path),
                'routePromptTokenLimit': self.route_limit}

    def supports_search(self):
        return True, None

    def over_limit(self, count):
        return bool(self.route_limit is not None and count is not None and count > self.route_limit)


# ---- (a) CPU Q4_K control ---------------------------------------------------------------------

def extract_archive(archive, destination):
    destination.mkdir(parents=True)
    with tarfile.open(archive, 'r:gz') as handle:
        handle.extractall(destination, filter='data')
    root = destination / 'package'
    if not (root / 'package.json').exists():
        raise SystemExit('The Doppler archive has no package/package.json')
    return root


class CpuQ4kControl(Target):
    """The useful-answer set's CPU control. run-arm.py and doppler-text.mjs run unchanged, pinned by sha256."""
    kind = 'cpu-q4k-control'
    MODEL_ID = 'qwen-3-5-0-8b-q4k-ehaf16'

    def scripts(self):
        for path, expected in ((RUN_ARM, RUN_ARM_SHA256), (DOPPLER_TEXT, DOPPLER_TEXT_SHA256)):
            if sha256_file(path) != expected:
                raise SystemExit(f'{path} changed; the CPU control is pinned to {expected}')
        return {'runArm': {'file': repo_relative(RUN_ARM), 'sha256': RUN_ARM_SHA256},
                'dopplerText': {'file': repo_relative(DOPPLER_TEXT), 'sha256': DOPPLER_TEXT_SHA256}}

    def generate(self, plan, work, log):
        require_outside_repo(work, 'The work directory')
        scripts = self.scripts()
        archive_template, archive = self.path_of('packageArchive')
        capsule_template, capsule = self.path_of('capsuleDir')
        catalog_template, catalog = self.path_of('catalog')
        checkpoint_template, checkpoint = self.path_of('checkpointDir')
        gguf_template, gguf = self.path_of('ggufDir')
        contract_template, contract = self.path_of('tokenContract')
        package = extract_archive(archive, work / 'package-archive')
        archive_sha = sha256_file(archive)
        if plan['setKind'] == 'useful-answer':
            set_path = plan['setPath']
        else:
            # Derived set in run-arm's schema: each turn's user content is the dispatched content.
            derived = {'schema': 'reploid.answer-regression.derived-arm-set/v1', 'settings': {
                'promptTokenLimit': 4096, 'maxTokens': plan['maxTokens'],
                'note': 'run-arm requires a turn-1 limit; the route limit is applied by the harness instead.'},
                'items': [{'id': item['id'], 'category': item['category'],
                           'turns': [{'user': turn['send']} for turn in item['turns']]}
                          for item in plan['items'] if all(turn['dispatch'] for turn in item['turns'])]}
            set_path = write_json(work / 'derived-set.json', derived)
        raw_path = work / 'arm-run.json'
        python = self.config.get('python', sys.executable)
        command = [python, '-I', str(RUN_ARM), 'q4k', str(set_path), str(package), str(capsule), str(catalog), str(checkpoint),
                   str(gguf), str(contract), str(raw_path)]
        started = time.time()
        with open(work / 'run-arm.log', 'w') as handle:
            done = subprocess.run(command, stdout=handle, stderr=subprocess.STDOUT, timeout=self.config.get('timeoutSeconds', 7200))
        if done.returncode != 0:
            raise SystemExit(f'run-arm.py exited {done.returncode}; see {work / "run-arm.log"}')
        log(f'run-arm finished in {time.time() - started:.1f} s')
        raw = load_json(raw_path)
        items = self.rows_from_arm_run(raw, plan)
        entry = catalog_entry(catalog, self.MODEL_ID)
        identities = self.identities_from(raw, entry, catalog, catalog_template, scripts)
        identities['package'] = {'archive': {**describe_path(archive_template, archive), 'sha256': archive_sha,
                                             'bytes': archive.stat().st_size},
                                 'version': load_json(package / 'package.json').get('version'),
                                 'use': 'application text path only: qwen template, bundled tokenizer, incremental decoder',
                                 'extractedBy': 'the harness, from the archive, into the work directory'}
        identities['capsule']['dir'] = describe_path(capsule_template, capsule)
        capsule_json = capsule / 'capsule.json'
        identities['capsule']['capsuleJsonSha256'] = sha256_file(capsule_json) if capsule_json.exists() else None
        identities['checkpoint'] = {**describe_path(checkpoint_template, checkpoint),
                                    'configSha256': sha256_file(checkpoint / 'config.json'),
                                    'use': 'text_config for the Q4_K graph and the HF template/tokenizer cross-check'}
        identities['gguf'] = {**describe_path(gguf_template, gguf)}
        identities['tokenContractSource'] = {**describe_path(contract_template, contract), 'sha256': sha256_file(contract)}
        return items, identities, {'rawArmRunSha256': sha256_file(raw_path), 'runArmSeconds': raw.get('seconds')}

    def identities_from(self, raw, entry, catalog, catalog_template, scripts):
        model = raw['model']
        return {
            'model': {'catalogId': model['catalogId'], 'manifestIdentity': model['catalogIdentity'],
                      'source': 'Qwen/Qwen3.5-0.8B', 'weights': model['kind'], 'shards': model.get('shards'),
                      'tensorDtypeCounts': model.get('tensorDtypeCounts'), 'lmHeadDtype': model.get('lmHeadDtype'),
                      'embedDtype': model.get('embedDtype'), 'kvStorage': model.get('kvStorage'),
                      'arithmetic': model.get('arithmetic')},
            'capsule': entry_identity(entry, catalog, catalog_template),
            'placement': {'kind': 'cpu-control', 'machine': raw.get('machine'), 'device': raw.get('device'),
                          'threads': raw.get('threads'),
                          'description': 'Hugging Face transformers Qwen3_5ForCausalLM in float32 over the deployed Q4_K bytes '
                                         'decoded by gguf; K/V rounded to f16 at storage. Not the GPU route.'},
            'sampling': {**raw['generation'], 'tokenContract': raw['tokenContract'], 'padMasked': True},
            'limits': {'maxTokens': raw['maxTokensUsed'], 'maxSeqLen': raw['generation'].get('maxSeqLen'),
                       'routePromptTokenLimit': self.route_limit},
            'chatTemplate': raw.get('chatTemplate'),
            'runtime': {**raw.get('versions', {}), 'convReplacementCheck': raw.get('convReplacementCheck')},
            'scripts': scripts,
        }

    def rows_from_arm_run(self, raw, plan=None):
        return arm_run_items(raw, self.id, self.route_limit, plan)


def arm_run_items(raw, target_id, route_limit, plan=None):
    """Maps run-arm.py's per-turn rows onto the harness turn fields. Without a plan (an imported arm run),
    each run turn's own last user message is the typed content."""
    def over_limit(count):
        return bool(route_limit is not None and count is not None and count > route_limit)
    by_id = {item['id']: item for item in raw['items']}
    if plan is None:
        plan = {'items': [{'id': item['id'], 'category': item['category'],
                           'turns': [{'user': turn['messages'][-1]['content'], 'dispatch': True, 'retrieval': None}
                                     for turn in item['turns']]} for item in raw['items']]}
    items = []
    for item in plan['items']:
        raw_turns = by_id.get(item['id'], {'turns': []})['turns']
        turns = []
        for index, planned in enumerate(item['turns']):
            if not planned['dispatch']:
                turns.append(turn_row(turn=index + 1, userTyped=planned['user'], retrieval=planned['retrieval'],
                                      dispatched=False, overPromptLimit=False))
                break
            if index >= len(raw_turns):
                break
            row = raw_turns[index]
            turns.append(turn_row(
                turn=row['turn'], messages=row['messages'], userTyped=planned['user'],
                renderedPromptSha256=sha256_text(row['renderedPrompt']), promptTokenIds=row['promptTokenIds'],
                promptTokenCount=row['promptTokenCount'], overPromptLimit=over_limit(row['promptTokenCount']),
                output=row['output'], outputTokenIds=row['outputTokenIds'], stopReason=row['stopReason'],
                decodeSteps=row['decodeSteps'], seconds=row['seconds'], minMarginTop1Top2=row['minMarginTop1Top2'],
                minMarginStep=row.get('minMarginStep'), reusedFrom=row.get('reusedFrom'),
                retrieval=planned['retrieval'], dispatched=True))
        items.append({'id': item['id'], 'category': item.get('category'), 'arm': target_id, 'turns': turns})
    return items


# ---- (b) Doppler single machine (Node/Dawn) ---------------------------------------------------

class DopplerSingleMachine(Target):
    """Doppler's own pipeline for one package and model on one host, through node/doppler-run.mjs.

    host 'local' runs here; any other value is an SSH alias resolved by the operator's own SSH configuration.
    Only the runner, the plan and the small result file cross the connection; logs stay on the host.
    """
    kind = 'doppler-single-machine'

    def remote(self, key):
        return expand(self.config['remote'][key], self.environ)

    def _ssh(self, command, timeout):
        host = self.config['host']
        if host == 'local':
            return subprocess.run(['sh', '-c', command], capture_output=True, text=True, timeout=timeout)
        return subprocess.run(['ssh', '-o', 'BatchMode=yes', host, command], capture_output=True, text=True, timeout=timeout)

    def _copy(self, source, destination, upload=True):
        host = self.config['host']
        if host == 'local':
            shutil.copyfile(source, destination)
            return
        pair = [str(source), f'{host}:{destination}'] if upload else [f'{host}:{source}', str(destination)]
        done = subprocess.run(['scp', '-q', '-o', 'BatchMode=yes', *pair], capture_output=True, text=True, timeout=600)
        if done.returncode != 0:
            raise SystemExit(f'scp failed: {done.stderr.strip()[-300:]}')

    def generate(self, plan, work, log, preflight=False):
        require_outside_repo(work, 'The work directory')
        placement = self.config.get('placement', 'unsplit')
        if placement not in ('unsplit', 'ordered-three-stage'):
            raise SystemExit('placement must be unsplit or ordered-three-stage')
        runner_plan = {'schema': 'reploid.answer-regression.doppler-plan/v1', 'setKind': plan['setKind'],
                       'items': [{'id': item['id'], 'category': item['category'],
                                  'turns': [{'send': turn['send'], 'dispatch': turn['dispatch']} for turn in item['turns']]}
                                 for item in plan['items']]}
        plan_path = write_json(work / 'doppler-plan.json', runner_plan)
        run_dir = f"{self.remote('workDir').rstrip('/')}/{work.name}"
        mkdir = self._ssh(f'mkdir -p {shlex.quote(run_dir)}', 60)
        if mkdir.returncode != 0:
            raise SystemExit(f'could not create the run directory on {self.config["host"]}: {mkdir.stderr.strip()[-300:]}')
        self._copy(DOPPLER_RUNNER, f'{run_dir}/doppler-run.mjs')
        self._copy(plan_path, f'{run_dir}/plan.json')
        env = ' '.join(f'{name}={shlex.quote(expand(value, self.environ))}'
                       for name, value in self.config['remote'].get('env', {}).items())
        args = ['--package-root', self.remote('packageRoot'), '--capsule', self.remote('capsuleDir'),
                '--catalog', self.remote('catalog'), '--policy', self.remote('partitionPolicy'),
                '--model-id', self.config['modelId'], '--placement', placement, '--plan', 'plan.json', '--out', 'out.json',
                '--host-label', self.config.get('hostLabel', self.config['host'])]
        if self.config['remote'].get('packageArchive'):
            args += ['--archive', self.remote('packageArchive')]
        if preflight:
            args.append('--preflight')
        node = expand(self.config['remote'].get('node', 'node'), self.environ)
        command = (f'cd {shlex.quote(run_dir)} && {env} {shlex.quote(node)} doppler-run.mjs '
                   + ' '.join(shlex.quote(a) for a in args) + ' > run.log 2>&1')
        log(f"running Doppler on {self.config['host']} ({placement}{', preflight' if preflight else ''})")
        done = self._ssh(command, self.config.get('timeoutSeconds', 14400))
        if done.returncode != 0:
            tail = self._ssh(f'tail -n 20 {shlex.quote(run_dir)}/run.log', 60).stdout
            raise SystemExit(f'doppler-run.mjs failed on {self.config["host"]} (log kept there: {run_dir}/run.log):\n{tail}')
        self._copy(f'{run_dir}/out.json', work / 'doppler-out.json', upload=False)
        raw = load_json(work / 'doppler-out.json')
        if preflight:
            return [], raw['identities'], {'preflight': raw.get('preflight'), 'runnerSha256': sha256_file(DOPPLER_RUNNER)}
        items = []
        raw_items = {item['id']: item for item in raw['items']}
        for item in plan['items']:
            turns, got = [], raw_items.get(item['id'], {'turns': []})['turns']
            for index, planned in enumerate(item['turns']):
                if not planned['dispatch']:
                    turns.append(turn_row(turn=index + 1, userTyped=planned['user'], retrieval=planned['retrieval'],
                                          dispatched=False, overPromptLimit=False, unsupported=planned.get('unsupported')))
                    break
                if index >= len(got):
                    break
                row = got[index]
                turns.append(turn_row(
                    turn=index + 1, messages=row['messages'], userTyped=planned['user'],
                    renderedPromptSha256=row.get('renderedPromptSha256'), promptTokenIds=row['promptTokenIds'],
                    promptTokenCount=row['promptTokenCount'], overPromptLimit=self.over_limit(row['promptTokenCount']),
                    output=row['output'], outputTokenIds=row['outputTokenIds'], stopReason=row['stopReason'],
                    decodeSteps=row['decodeSteps'], seconds=row['seconds'], minMarginTop1Top2=row.get('minMarginTop1Top2'),
                    minMarginStep=row.get('minMarginStep'), reusedFrom=row.get('reusedFrom'), retrieval=planned['retrieval'],
                    dispatched=True))
            items.append({'id': item['id'], 'category': item['category'], 'arm': self.id, 'turns': turns})
        identities = raw['identities']
        identities['limits']['routePromptTokenLimit'] = self.route_limit
        identities['runner'] = {'file': repo_relative(DOPPLER_RUNNER), 'sha256': sha256_file(DOPPLER_RUNNER)}
        return items, identities, {'gpu': raw.get('gpu'), 'seconds': raw.get('seconds'),
                                   'remoteRunDirectory': 'kept on the host; not recorded'}


# ---- (c) installed route through the chat request API ------------------------------------------

class InstalledRoute(Target):
    """An installed native participant's mounted text API (docs/native-participant.md, 'Opt-in text HTTP APIs').

    The API takes no sampling overrides: the route's prepared generation policy applies and is recorded from the
    installed catalog. Credentials come from an environment variable named in the configuration.
    """
    kind = 'installed-route'

    def supports_search(self):
        if self.config.get('retrieval') is True:
            return True, None
        return False, 'The installed chat request API has no retrieval opt-in yet; search items are not sent.'

    def _post(self, body):
        url = expand(self.config['baseUrl'], self.environ).rstrip('/') + self.endpoint()
        headers = {'content-type': 'application/json'}
        auth = self.config.get('auth') or {}
        if auth.get('env'):
            secret = os.environ.get(auth['env'])
            if not secret:
                raise SystemExit(f"Environment variable {auth['env']} is required for the installed route")
            headers[auth.get('header', 'authorization')] = auth.get('prefix', 'Bearer ') + secret
        request = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method='POST')
        started = time.time()
        try:
            with urllib.request.urlopen(request, timeout=self.config.get('timeoutSeconds', 600)) as response:
                return json.loads(response.read()), time.time() - started, None
        except urllib.error.HTTPError as error:
            return None, time.time() - started, f'HTTP {error.code}: {error.read()[:300].decode("utf-8", "replace")}'
        except (urllib.error.URLError, TimeoutError, ValueError) as error:
            return None, time.time() - started, f'{type(error).__name__}: {error}'

    def endpoint(self):
        return {'chat-completions': '/v1/chat/completions', 'messages': '/v1/messages'}[self.config['protocol']]

    def ask(self, messages):
        model = self.config['modelId']
        if self.config['protocol'] == 'chat-completions':
            reply, seconds, error = self._post({'model': model, 'messages': messages, 'stream': False})
            if error:
                return {'error': error, 'seconds': seconds}
            choice = reply['choices'][0]
            reason = {'stop': 'stop', 'length': 'max-tokens'}.get(choice.get('finish_reason'), choice.get('finish_reason'))
            return {'output': choice['message']['content'] or '', 'stopReason': reason, 'seconds': seconds,
                    'responseModel': reply.get('model')}
        reply, seconds, error = self._post({'model': model, 'messages': messages, 'max_tokens': self.config['maxTokens'],
                                            'stream': False})
        if error:
            return {'error': error, 'seconds': seconds}
        text = ''.join(block.get('text', '') for block in reply.get('content', []) if block.get('type') == 'text')
        reason = {'end_turn': 'stop', 'max_tokens': 'max-tokens'}.get(reply.get('stop_reason'), reply.get('stop_reason'))
        usage = reply.get('usage') or {}
        return {'output': text, 'stopReason': reason, 'seconds': seconds, 'responseModel': reply.get('model'),
                'promptTokenCount': usage.get('input_tokens'), 'decodeSteps': usage.get('output_tokens')}

    def generate(self, plan, work, log):
        items = []
        for item in plan['items']:
            messages, turns = [], []
            for index, planned in enumerate(item['turns']):
                if not planned['dispatch']:
                    turns.append(turn_row(turn=index + 1, userTyped=planned['user'], retrieval=planned['retrieval'],
                                          dispatched=False, overPromptLimit=False,
                                          unsupported=planned.get('unsupported')))
                    break
                messages = messages + [{'role': 'user', 'content': planned['send']}]
                answer = self.ask(messages)
                count = answer.get('promptTokenCount')
                turns.append(turn_row(turn=index + 1, messages=messages, userTyped=planned['user'], promptTokenCount=count,
                                      overPromptLimit=self.over_limit(count), output=answer.get('output', ''),
                                      stopReason=answer.get('stopReason'), decodeSteps=answer.get('decodeSteps'),
                                      seconds=round(answer['seconds'], 2), retrieval=planned['retrieval'], dispatched=True,
                                      error=answer.get('error'), responseModel=answer.get('responseModel')))
                log(f"{item['id']} turn {index + 1}: {answer.get('stopReason') or answer.get('error')}")
                if index + 1 < len(item['turns']):
                    if not answer.get('output', '').strip():
                        break
                    messages = messages + [{'role': 'assistant', 'content': answer['output']}]
            items.append({'id': item['id'], 'category': item['category'], 'arm': self.id, 'turns': turns})
        return items, self.identities(), {}

    def identities(self):
        app_template, app = self.path_of('installedApp', section='paths')
        catalog = app / 'self' / 'config' / 'chat-models.json'
        entry = catalog_entry(catalog, self.config['modelId'])
        pin_path = app / 'self' / 'config' / 'doppler-package.json'
        pin = load_json(pin_path) if pin_path.exists() else None
        archive = None
        if pin and isinstance(pin.get('spec'), str) and pin['spec'].startswith('file:'):
            candidate = app / pin['spec'][5:]
            archive = {'spec': pin['spec'], 'sha256': sha256_file(candidate) if candidate.exists() else None}
        policy = app / 'self' / 'config' / 'partition-policy.json'
        return {
            'package': {'pin': pin, 'archive': archive, 'installedApp': describe_path(app_template, app)},
            'model': {'catalogId': entry['id'], 'manifestIdentity': entry.get('identity')},
            'capsule': entry_identity(entry, catalog, f'{app_template}/self/config/chat-models.json'),
            'route': {'protocol': self.config['protocol'], 'endpoint': self.endpoint(),
                      'baseUrl': {'configured': self.config['baseUrl']},
                      'declaredPlacement': self.config.get('declaredPlacement'),
                      'placementSource': 'declared by the operator in the target configuration; the API does not report it'},
            'sampling': {'source': 'installed catalog generation; the API accepts no sampling overrides',
                         **(entry.get('generation') or {})},
            'limits': {'maxTokens': self.config.get('maxTokens') or (entry.get('generation') or {}).get('maxTokens'),
                       'routePromptTokenLimit': self.route_limit,
                       'partitionPolicySha256': sha256_file(policy) if policy.exists() else None},
            'tokenIds': 'not reported by this API; answers compare by text',
        }
