"""Read-only shared-host sensors; never attributes aggregate power to one request."""
import glob, json, time, datetime, socket
paths = sorted(set(glob.glob('/sys/class/drm/card*/device/hwmon/hwmon*/power*_average')
                   + glob.glob('/sys/class/drm/card*/device/hwmon/hwmon*/power*_input')
                   + glob.glob('/sys/class/powercap/intel-rapl*/energy_uj')))
for index in range(12):
    values, errors = {}, {}
    for path in paths:
        try:
            with open(path) as source: values[path] = int(source.read().strip())
        except (OSError, ValueError) as error: errors[path] = type(error).__name__
    print(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
                     'host':socket.gethostname(), 'sample':index,
                     'scope':'Shared-host aggregate; public co-tenants remain; not per-request energy',
                     'values':values, 'errors':errors, 'available':bool(values)}), flush=True)
    if index < 11: time.sleep(5)
