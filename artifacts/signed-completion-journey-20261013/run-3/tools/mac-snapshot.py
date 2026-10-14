"""Read-only mac-host snapshot for run-1 preflight and settlement.
Usage: python3 mac-snapshot.py <comma-separated ports> <owned marker> > out.json
Never changes the host. Hostnames are not read; room tokens are masked."""
import datetime, json, re, subprocess, sys

ports, marker = [int(p) for p in sys.argv[1].split(',') if p], sys.argv[2]
run = lambda *args: subprocess.run(list(args), capture_output=True, text=True).stdout
TAILNET = re.compile(r'[A-Za-z0-9.-]+\.' + r'ts' + r'\.net\b')
LOGIN = re.compile(r'\b[a-z_][a-z0-9_.-]*@[A-Za-z0-9.-]+')
def mask(text):
    text = re.sub(r'(--room-token\s+)\S+', r'\1[REDACTED]', text)
    text = re.sub(r'swarmToken=[^&\s]+', 'swarmToken=[REDACTED]', text)
    return TAILNET.sub('[tailnet-redacted]', LOGIN.sub('[login-redacted]', text))

rows = []
for line in run('ps', '-axo', 'pid=,ppid=,etime=,args=').splitlines():
    parts = line.split(None, 3)
    if len(parts) < 4: continue
    pid, ppid, etime, args = parts
    if not re.search(r'node |Google Chrome --|ssh ', args): continue
    if 'Helper' in args: continue
    rows.append({'pid': int(pid), 'ppid': int(ppid), 'elapsed': etime, 'owned': marker in args, 'args': mask(args)[:300]})

listen = run('lsof', '-nP', '-iTCP', '-sTCP:LISTEN')
port_state = {}
for port in ports:
    found = [l.split()[0:2] + [l.split()[8]] for l in listen.splitlines()[1:] if l.split()[8].endswith(':' + str(port))]
    port_state[str(port)] = {'listening': bool(found), 'rows': found}

print(json.dumps({
    'schema': 'reploid.run-1-host-snapshot/v1', 'machine': 'mac-host',
    'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'loadavg': run('sysctl', '-n', 'vm.loadavg').strip(),
    'memoryBytes': int(run('sysctl', '-n', 'hw.memsize').strip()),
    'memoryPressure': run('memory_pressure').strip().splitlines()[-1:],
    'processes': rows,
    'ports': port_state,
    'scope': 'Read-only snapshot; hostnames not recorded; processes not owned by this run are listed for comparison only'
}, indent=1))
