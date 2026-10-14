"""Read-only Linux host snapshot for run-1 preflight and settlement.
Usage (piped over ssh): python3 - <machine-alias> <comma-separated ports> <owned-unit-prefix> < host-snapshot.py
Never changes the host. Hostnames are not read; process arguments are truncated and
room tokens are masked."""
import datetime, glob, json, os, re, subprocess, sys, time

alias, ports, unit_prefix = sys.argv[1], [int(p) for p in sys.argv[2].split(',') if p], sys.argv[3]

def read(path, default=None):
    try:
        with open(path) as source: return source.read().strip()
    except OSError: return default

def mask(text):
    return re.sub(r'(--room-token\s+)\S+', r'\1[REDACTED]', re.sub(r'(--room\s+)\S+', r'\1[PRIVATE ROOM]', text))

meminfo = {}
for line in (read('/proc/meminfo', '') or '').splitlines():
    key, _, value = line.partition(':')
    meminfo[key] = int(value.split()[0]) * 1024 if value.split() else None

procs = []
for pid_dir in glob.glob('/proc/[0-9]*'):
    pid = int(os.path.basename(pid_dir))
    cmd = (read(pid_dir + '/cmdline', '') or '').replace('\0', ' ').strip()
    if not cmd: continue
    if not re.search(r'native-participant\.js|run-mesh-contributor\.js|chrome|chromium|node ', cmd): continue
    stat = (read(pid_dir + '/stat', '') or '').split(')')[-1].split()
    procs.append({'pid': pid, 'ppid': int(stat[1]) if len(stat) > 1 else None,
                  'cgroup': read(pid_dir + '/cgroup', ''), 'args': mask(cmd)[:400]})

public = [p for p in procs if ('native-participant.js --contribute' in p['args'] and '/public-native/' in p['args'])
          or 'run-mesh-contributor.js' in p['args']]
owned = [p for p in procs if unit_prefix and unit_prefix in p['cgroup']]

listening = subprocess.run(['ss', '-ltnH'], capture_output=True, text=True).stdout.splitlines()
port_state = {}
for port in ports:
    rows = [row.split()[3] for row in listening if row.split()[3].endswith(':' + str(port))]
    port_state[str(port)] = {'listening': bool(rows), 'addresses': rows}

scopes = subprocess.run(['systemctl', '--user', 'list-units', '--type=scope', '--all', '--no-pager', '--plain', '--no-legend'],
                        capture_output=True, text=True).stdout.splitlines()
owned_scopes = [row.split()[0:4] for row in scopes if unit_prefix and unit_prefix in row]

gpu = []
for _ in range(3):
    gpu.append({'amdBusyPercent': [read(p) for p in glob.glob('/sys/class/drm/card*/device/gpu_busy_percent')],
                'intelActMhz': [read(p) for p in glob.glob('/sys/class/drm/card*/gt_act_freq_mhz')]})
    time.sleep(1)

print(json.dumps({
    'schema': 'reploid.run-1-host-snapshot/v1', 'machine': alias,
    'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'loadavg': (read('/proc/loadavg', '') or '').split()[:3],
    'memory': {k: meminfo.get(k) for k in ['MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree']},
    'gpuSamples': gpu,
    'publicContributors': [{'pid': p['pid'], 'ppid': p['ppid'], 'args': p['args']} for p in public],
    'ownedProcesses': [{'pid': p['pid'], 'args': p['args']} for p in owned],
    'ownedScopes': owned_scopes,
    'allUserScopes': [row.split()[0] for row in scopes],
    'ports': port_state,
    'scope': 'Read-only snapshot; hostnames not recorded'
}, indent=1))
