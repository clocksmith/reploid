"""Read-only Linux sensor discovery: five samples, no workload or control changes.
Run on a contributor: python3 read-component-power.py
Power channels may overlap. Never sum them or label them wall power.
"""
import datetime
import glob
import json
import time

samples=[]
for i in range(5):
    sensors=[]
    for base in glob.glob('/sys/class/hwmon/hwmon*'):
        try:
            name=open(base+'/name').read().strip()
        except OSError:
            continue
        readings={}
        for path in glob.glob(base+'/power*_average')+glob.glob(base+'/power*_input'):
            try:
                readings[path.rsplit('/',1)[-1]]=int(open(path).read())
            except (OSError,ValueError):
                continue
        if readings:
            sensors.append({'component':name,'readings_microwatts':readings})
    samples.append({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sensors':sensors})
    if i<4: time.sleep(1)
print(json.dumps({'schema':'reploid.component-power-discovery/v1',
                  'scope':'uncontrolled component telemetry, not wall power or incremental service energy',
                  'baseline':None,'workload_attribution':None,'samples':samples},indent=2))
