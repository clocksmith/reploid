"""Read-only shared-host sampler for attribution; never changes the run.
Campaign 3's observe-host.py plus amdgpu VRAM/GTT use and totals, MemAvailable and swap, so the
host's real GPU-memory headroom is recorded beside the per-executor allocation ledgers. 720 samples
at 5 s (one hour)."""
import datetime, glob, json, subprocess, time
def read(path, default=None):
    try:
        with open(path) as source: return source.read().strip()
    except OSError: return default
def meminfo():
    out = {}
    for line in (read('/proc/meminfo', '') or '').split('\n'):
        key, _, rest = line.partition(':')
        if key in ('MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree'): out[key + 'Kb'] = int(rest.split()[0])
    return out
def amdgpu():
    rows = []
    for dev in glob.glob('/sys/class/drm/card*/device'):
        if read(dev + '/mem_info_vram_total') is None: continue
        rows.append({k: int(read(dev + '/' + k, '0')) for k in ['mem_info_vram_total', 'mem_info_vram_used', 'mem_info_gtt_total', 'mem_info_gtt_used', 'mem_info_vis_vram_used']})
    return rows
for index in range(720):
    freqs = [int(read(p, '0')) for p in glob.glob('/sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq')]
    temps = {read(z + '/type', '?'): int(read(z + '/temp', '0')) // 1000 for z in glob.glob('/sys/class/thermal/thermal_zone*')}
    top = subprocess.run(['ps', '-eo', 'pcpu,comm', '--sort=-pcpu'], capture_output=True, text=True).stdout.split('\n')[1:5]
    print(json.dumps({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'sample': index,
        'loadavg': read('/proc/loadavg', '').split()[:3], 'cpuMeanMhz': round(sum(freqs) / len(freqs) / 1000) if freqs else None,
        'temperaturesC': temps, 'gpuBusyPercent': [read(p) for p in glob.glob('/sys/class/drm/card*/device/gpu_busy_percent')],
        'amdgpuMemory': amdgpu(), 'meminfo': meminfo(),
        'topCpu': [row.strip() for row in top], 'scope': 'Shared-host aggregate; not per-request attribution'}), flush=True)
    time.sleep(5)
