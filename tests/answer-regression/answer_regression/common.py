"""Labels, hashing, file and configuration helpers shared by the harness modules."""
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

LABEL = 'automated regression evaluation — not independent acceptance'
JUDGE_LABEL = 'automated judge, not independent review'
SCOPE_NOTE = ('Engineering regression signal only. It compares one run with a stored run of the same target. '
              'It establishes no answer quality, no acceptance, no release decision and no independent review; '
              'human reviewers assess the working experience separately.')

HARNESS = Path(__file__).resolve().parents[1]
REPO = HARNESS.parents[1]

USEFUL_ANSWER_DIR = REPO / 'artifacts' / 'useful-answer-set-20261014'
USEFUL_ANSWER_SET = USEFUL_ANSWER_DIR / 'answer-set.json'
USEFUL_ANSWER_SET_SHA256 = 'ac174063024054b9ea048b2dd4c532119bea96ae4d330dab89dd2c3ea62dced5'
POLICIES = REPO / 'artifacts' / 'independent-answer-review-20261014' / 'evaluation-policies.md'
POLICIES_SHA256 = '41550353a495f6268ae1a0dffdaf9619af1d0ae0edaab7c3b0241414b19abacb'
SEARCH_SET = HARNESS / 'sets' / 'search-tasks.json'
SEARCH_SET_SHA256 = '1b0a150ec32d163a7f6036b955e3d040fe4d7f66ebbfcbbc34c442d3851ebe33'
OVERLAY = HARNESS / 'sets' / 'useful-answer-overlay.json'
OVERLAY_SHA256 = '1419fd8ebbbbd716a5f69c131f4b1cb36b643664a87bf107d34759ed3f8876d3'
RETRIEVAL_HELPER = HARNESS / 'node' / 'retrieval-helper.js'
RETRIEVAL_COMPONENT = REPO / 'packages' / 'reploid' / 'src' / 'retrieval'


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha256_text(text):
    return sha256_bytes(text.encode('utf-8'))


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 22), b''):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path):
    with open(path, encoding='utf-8') as handle:
        return json.load(handle)


def write_json(path, value, exclusive=True):
    """Writes indented UTF-8 JSON. Exclusive by default: evidence is never overwritten."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'x' if exclusive else 'w', encoding='utf-8') as handle:
        json.dump(value, handle, indent=1, ensure_ascii=False)
        handle.write('\n')
    return path


def write_text(path, text, exclusive=True):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'x' if exclusive else 'w', encoding='utf-8') as handle:
        handle.write(text)
    return path


def now_iso():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def repo_relative(path):
    """Repository-relative POSIX path, or None for a path outside the repository (never recorded)."""
    try:
        return Path(path).resolve().relative_to(REPO).as_posix()
    except ValueError:
        return None


def inside_repo(path):
    return repo_relative(path) is not None


def require_outside_repo(path, what):
    if inside_repo(path):
        raise SystemExit(f'{what} must be outside the repository: {path}')


ENV_REFERENCE = re.compile(r'\$\{([A-Za-z_][A-Za-z0-9_]*)\}')


def expand(value, environ=None):
    """Expands ${NAME} from the environment. Machine paths stay out of committed configuration and records."""
    environ = os.environ if environ is None else environ

    def replace(match):
        name = match.group(1)
        if name not in environ or not environ[name]:
            raise SystemExit(f'Environment variable {name} is required by the configuration')
        return environ[name]
    return ENV_REFERENCE.sub(replace, value) if isinstance(value, str) else value


def resolve_path(value, base=None, environ=None):
    expanded = expand(value, environ)
    path = Path(expanded).expanduser()
    if not path.is_absolute():
        path = (Path(base) if base else REPO) / path
    return path


def describe_path(template, resolved=None):
    """What a record keeps for a configured path: the configured text and the repository path if inside."""
    rel = repo_relative(resolved) if resolved is not None else None
    return {'configured': template, 'repositoryPath': rel}


def git_head():
    try:
        done = subprocess.run(['git', '-C', str(REPO), 'rev-parse', 'HEAD'], capture_output=True, text=True, timeout=10)
        return done.stdout.strip() or None
    except (OSError, subprocess.TimeoutExpired):
        return None


def tool_version(command):
    try:
        done = subprocess.run(command, capture_output=True, text=True, timeout=20)
        return (done.stdout or done.stderr).strip().splitlines()[0] if (done.stdout or done.stderr) else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def environment_versions():
    import platform
    return {'python': sys.version.split()[0], 'node': tool_version(['node', '--version']),
            'os': f'{platform.system()} {platform.release()}', 'machine': platform.machine()}


def directory_digest(root, include=None):
    """sha256 over sorted (relative path, file sha256) pairs; include filters relative paths."""
    root = Path(root)
    rows = []
    for path in sorted(p for p in root.rglob('*') if p.is_file()):
        rel = path.relative_to(root).as_posix()
        if include and not include(rel):
            continue
        rows.append(f'{rel}\0{sha256_file(path)}')
    return {'files': len(rows), 'sha256': sha256_text('\n'.join(rows))}


def retrieval_component_identity():
    """Digest of the retrieval component source the harness ran against (it may change underneath)."""
    return {'path': repo_relative(RETRIEVAL_COMPONENT),
            **directory_digest(RETRIEVAL_COMPONENT, lambda rel: rel.endswith(('.js', '.json')) and '/' not in rel),
            'gitHead': git_head()}


def frozen_file(path, pinned, what):
    """Frozen inputs change only as a new version with a new pin."""
    if sha256_file(path) != pinned:
        raise SystemExit(f'The {what} changed; it is frozen at sha256 {pinned}. A change needs a new version and pin.')
    return load_json(path)


def harness_identity():
    """The harness code that produced a record: its commit and a digest of its code and frozen inputs."""
    code = directory_digest(HARNESS, lambda rel: rel.startswith('sets/') or (
        rel.endswith(('.py', '.js', '.mjs')) and '__pycache__' not in rel and not rel.startswith('baselines/')))
    return {'path': repo_relative(HARNESS), 'gitHead': git_head(), 'codeAndSets': code}


def label_block():
    return {'label': LABEL, 'scope': SCOPE_NOTE}
