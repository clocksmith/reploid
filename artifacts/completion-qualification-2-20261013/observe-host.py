"""Read-only shared-host sampler for attribution; never changes the run."""
import datetime, glob, json, subprocess, time
def read(path, default=None):
    try:
        with open(path) as source: return source.read().strip()
    except OSError: return default
for index in range(360):
    freqs = [int(read(p, '0')) for p in glob.glob('/sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq')]
    temps = {read(z + '/type', '?'): int(read(z + '/temp', '0')) // 1000 for z in glob.glob('/sys/class/thermal/thermal_zone*')}
    top = subprocess.run(['ps', '-eo', 'pcpu,comm', '--sort=-pcpu'], capture_output=True, text=True).stdout.split('\n')[1:5]
    print(json.dumps({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'sample': index,
        'loadavg': read('/proc/loadavg', '').split()[:3], 'cpuMeanMhz': round(sum(freqs) / len(freqs) / 1000) if freqs else None,
        'temperaturesC': temps, 'gpuActMhz': [read(p) for p in glob.glob('/sys/class/drm/card*/gt_act_freq_mhz')],
        'gpuBusyPercent': [read(p) for p in glob.glob('/sys/class/drm/card*/device/gpu_busy_percent')],
        'topCpu': [row.strip() for row in top], 'scope': 'Shared-host aggregate; not per-request attribution'}), flush=True)
    time.sleep(5)
