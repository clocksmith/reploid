"""Executed-code checks: an answer's own code runs verbatim in a fresh scratch directory outside the
repository, with a timeout, a minimal environment and, where the platform allows, no network and no
writes outside that directory. A harness probe appended after the code calls the named function.

Nothing here repairs, completes or reformats answer code.
"""
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

from .common import require_outside_repo, tool_version

PROBE_MARK = '__REPLOID_REGRESSION_PROBE__'
TAGS = {'python': ('python', 'py', ''), 'javascript': ('javascript', 'js', '')}
OUTPUT_LIMIT = 64 * 1024
FILE_SIZE_LIMIT = 8 * 1024 * 1024
SANDBOX_EXEC = '/usr/bin/sandbox-exec'


def code_of(output, language):
    """Fenced blocks tagged with the language (or untagged); the whole answer if unfenced (run-answer-code.py)."""
    blocks = re.findall(r'```([^\n]*)\n(.*?)```', output, re.S)
    if not blocks:
        return output
    return '\n'.join(body for tag, body in blocks if tag.strip().lower() in TAGS[language])


JS_DECLARATION = re.compile(r'function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*'
                            r'(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)')
PY_DECLARATION = re.compile(r'^\s*def\s+([A-Za-z_]\w*)\s*\(', re.M)


def first_function(code, language):
    if language == 'python':
        match = PY_DECLARATION.search(code)
        return match.group(1) if match else None
    match = JS_DECLARATION.search(code)
    return (match.group(1) or match.group(2)) if match else None


def probe_lines(language, function, probes):
    """The appended probe program, returned separately so records keep it apart from the answer's code."""
    if language == 'python':
        lines = ['', '# --- appended by the answer regression harness ---', 'import json as __rh_json',
                 'def __rh_probe(__rh_name, __rh_args):',
                 '    try:',
                 '        __rh_value = globals()[__rh_name](*__rh_args)',
                 '        try:',
                 '            __rh_text = __rh_json.dumps({"ok": True, "value": __rh_value})',
                 '        except (TypeError, ValueError):',
                 '            __rh_text = __rh_json.dumps({"ok": True, "repr": repr(__rh_value)})',
                 '    except BaseException as __rh_error:',
                 '        __rh_text = __rh_json.dumps({"ok": False, "error": type(__rh_error).__name__ + ": " + str(__rh_error)[:200]})',
                 f'    print("\\n{PROBE_MARK} " + __rh_text, flush=True)']
        lines += [f'__rh_probe({json.dumps(function)}, __rh_json.loads({json.dumps(json.dumps(p["args"]))}))' for p in probes]
        return '\n'.join(lines) + '\n'
    lines = ['', '// --- appended by the answer regression harness ---']
    for probe in probes:
        lines.append('(() => { let __rhText; try { const __rhValue = (' + function + ')(...' + json.dumps(probe['args']) + '); '
                     '__rhText = JSON.stringify(__rhValue === undefined ? { ok: true, undefined: true } : { ok: true, value: __rhValue }); } '
                     'catch (__rhError) { __rhText = JSON.stringify({ ok: false, error: String(__rhError && __rhError.name) + ": " '
                     '+ String(__rhError && __rhError.message).slice(0, 200) }); } '
                     f'console.log("\\n{PROBE_MARK} " + __rhText); }})();')
    return '\n'.join(lines) + '\n'


def _limits():
    import resource
    resource.setrlimit(resource.RLIMIT_FSIZE, (FILE_SIZE_LIMIT, FILE_SIZE_LIMIT))


class Sandbox:
    """A scratch root outside the repository; each execution gets a fresh empty directory under it."""

    def __init__(self, root=None, timeout=10):
        self.owned = root is None
        self.root = Path(tempfile.mkdtemp(prefix='reploid-answer-regression-')) if root is None else Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.root = self.root.resolve()
        require_outside_repo(self.root, 'The code-execution scratch directory')
        for parent in [self.root, *self.root.parents]:
            if (parent / 'package.json').exists():
                raise SystemExit(f'Code-execution scratch must have no package.json above it: {parent}')
        self.timeout = timeout
        self.count = 0
        self.isolation = self._detect_isolation()

    def _detect_isolation(self):
        if sys.platform == 'darwin' and os.path.exists(SANDBOX_EXEC):
            return {'kind': 'sandbox-exec', 'network': 'denied', 'writes': 'case directory only'}
        if shutil.which('unshare'):
            probe = subprocess.run(['unshare', '--user', '--map-root-user', '--net', 'true'], capture_output=True)
            if probe.returncode == 0:
                return {'kind': 'unshare', 'network': 'denied (new network namespace)', 'writes': 'not restricted'}
        return {'kind': 'none', 'network': 'not isolated', 'writes': 'not restricted'}

    def _wrap(self, command, case):
        if self.isolation['kind'] == 'sandbox-exec':
            profile = ('(version 1)(allow default)(deny network*)(deny file-write*)'
                       f'(allow file-write* (subpath "{case}") (literal "/dev/null"))')
            return [SANDBOX_EXEC, '-p', profile, *command]
        if self.isolation['kind'] == 'unshare':
            return ['unshare', '--user', '--map-root-user', '--net', *command]
        return command

    def environment(self):
        return {'os': sys.platform, 'python': sys.version.split()[0], 'node': tool_version(['node', '--version']),
                'timeoutSeconds': self.timeout, 'isolation': self.isolation,
                'environmentVariables': ['PATH', 'HOME (the case directory)'], 'fileSizeLimitBytes': FILE_SIZE_LIMIT}

    def run(self, language, program, name):
        self.count += 1
        case = self.root / f'case-{self.count:03d}-{re.sub(r"[^A-Za-z0-9_.-]", "-", name)[:60]}'
        case.mkdir()
        case = case.resolve()
        filename = 'main.py' if language == 'python' else 'main.js'
        (case / filename).write_text(program, encoding='utf-8')
        command = [sys.executable, '-I', filename] if language == 'python' else ['node', filename]
        stdout_path, stderr_path = case / '.stdout', case / '.stderr'
        timed_out = False
        with open(stdout_path, 'wb') as out, open(stderr_path, 'wb') as err:
            process = subprocess.Popen(self._wrap(command, case), cwd=case, stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                                       env={'PATH': os.environ.get('PATH', ''), 'HOME': str(case)},
                                       start_new_session=True, preexec_fn=_limits)
            try:
                exit_code = process.wait(timeout=self.timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                exit_code = None

        def read(path):
            data = path.read_bytes()[:OUTPUT_LIMIT].decode('utf-8', 'replace')
            return data.replace(str(case), '<case dir>')
        shown = ['python3', '-I', filename] if language == 'python' else ['node', filename]
        return {'command': ' '.join(shown), 'exitCode': exit_code, 'timedOut': timed_out,
                'stdout': read(stdout_path), 'stderrTail': read(stderr_path).strip().splitlines()[-3:]}

    def close(self):
        if self.owned:
            shutil.rmtree(self.root, ignore_errors=True)


def same_value(actual, expected):
    if isinstance(expected, bool) or isinstance(actual, bool):
        return actual is expected if isinstance(actual, bool) and isinstance(expected, bool) else False
    if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
        return actual == expected
    if isinstance(expected, list) and isinstance(actual, list):
        return len(actual) == len(expected) and all(same_value(a, e) for a, e in zip(actual, expected))
    return actual == expected


def parse_probes(stdout):
    rows = []
    for line in stdout.splitlines():
        if line.startswith(PROBE_MARK + ' '):
            try:
                rows.append(json.loads(line[len(PROBE_MARK) + 1:]))
            except ValueError:
                rows.append({'ok': False, 'error': 'unparseable probe output'})
    return rows


def run_case(sandbox, case, output):
    """One overlay case against one answer: returns the execution record and per-probe verdicts."""
    code = code_of(output, case['language'])
    function = case.get('function') or first_function(code, case['language'])
    record = {'item': case['item'], 'turn': case['turn'], 'language': case['language'], 'function': function,
              'functionFromAnswer': case.get('function') is None}
    if not code.strip():
        return {**record, 'pass': False, 'reason': 'no code in the answer for this language', 'probes': []}
    if not function:
        return {**record, 'pass': False, 'reason': 'no function declaration found', 'probes': []}
    appended = probe_lines(case['language'], function, case['probes'])
    result = sandbox.run(case['language'], code + '\n' + appended, f"{case['item']}-t{case['turn']}")
    observed = parse_probes(result['stdout'])
    probes = []
    for index, probe in enumerate(case['probes']):
        seen = observed[index] if index < len(observed) else None
        ok = bool(seen and seen.get('ok') and 'value' in seen and same_value(seen['value'], probe['expect']))
        probes.append({'args': probe['args'], 'expect': probe['expect'], 'observed': seen, 'pass': ok})
    reason = None
    if result['timedOut']:
        reason = 'timed out'
    elif len(observed) < len(case['probes']):
        reason = 'the code stopped before every probe ran'
    elif not all(p['pass'] for p in probes):
        reason = 'a probe returned a different value or raised'
    return {**record, 'pass': reason is None, 'reason': reason, 'probes': probes,
            'program': {'answerCode': code, 'appendedByHarness': appended}, 'execution': result}


def run_reference(sandbox, reference):
    result = sandbox.run(reference['language'], reference['program'] + '\n', f"reference-{reference['item']}")
    return {'item': reference['item'], 'language': reference['language'], 'program': reference['program'],
            'expectStdout': reference['expectStdout'], 'execution': result,
            'pass': result['exitCode'] == 0 and result['stdout'] == reference['expectStdout']}
