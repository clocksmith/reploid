"""Read-only amd-host sampler for the placement C envelope run (copy of ../../faster-candidate-20261015/journeys/tools/amd-sampler.py; only the scope prefix, stop file and cap default differ): every 2 s, both owned native stage scopes together.
Per fc-env-native-* scope: cgroup memory.current and memory.peak and cumulative CPU time. For the host:
amdgpu VRAM and GTT use and totals, GPU busy percentage, MemAvailable and swap. One JSON line per sample.
Never changes the host. Runs until the stop file exists or the cap (seconds, default 57600) elapses.
Usage (piped): ssh <amd-host> python3 - <out jsonl> [cap seconds] < amd-sampler.py"""
import datetime, glob, json, os, sys, time
out = sys.argv[1]; cap = int(sys.argv[2]) if len(sys.argv) > 2 else 57600
stop = '/var/tmp/reploid-placement-c-envelope-20261015/sampler-stop'
base = f'/sys/fs/cgroup/user.slice/user-{os.getuid()}.slice/user@{os.getuid()}.service/app.slice'
def read(path, default=None):
    try:
        with open(path) as handle: return handle.read().strip()
    except OSError: return default
def meminfo():
    rows = {}
    for line in (read('/proc/meminfo', '') or '').split('\n'):
        key, _, rest = line.partition(':')
        if key in ('MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree'): rows[key + 'Kb'] = int(rest.split()[0])
    return rows
started = time.time()
with open(out, 'a') as handle:
    while time.time() - started < cap and not os.path.exists(stop):
        scopes = {}
        for path in glob.glob(base + '/fc-env-native-*.scope'):
            name = os.path.basename(path)[:-6]
            cpu = dict(line.split() for line in (read(path + '/cpu.stat', '') or '').split('\n') if line)
            scopes[name] = {'current': int(read(path + '/memory.current', '0')), 'peak': int(read(path + '/memory.peak', '0') or 0),
                            'cpuUsec': int(cpu.get('usage_usec', 0))}
        gpu = []
        for dev in glob.glob('/sys/class/drm/card*/device'):
            if read(dev + '/mem_info_vram_total') is None: continue
            gpu.append({k: int(read(dev + '/' + k, '0')) for k in ['mem_info_vram_total', 'mem_info_vram_used', 'mem_info_gtt_total', 'mem_info_gtt_used']}
                       | {'busyPercent': int(read(dev + '/gpu_busy_percent', '0') or 0)})
        row = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'scopes': scopes,
               'scopesCurrentTotal': sum(s['current'] for s in scopes.values()), 'amdgpu': gpu, 'meminfo': meminfo()}
        handle.write(json.dumps(row) + '\n'); handle.flush()
        time.sleep(2)
