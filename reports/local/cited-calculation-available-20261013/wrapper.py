import datetime,json,os,pathlib,subprocess
p=pathlib.Path('/home/x/deco/reploid/reports/local/cited-calculation-available-20261013')
e=dict(os.environ,PYTHONPATH='/tmp/doppler-reference-deps',OPENBLAS_NUM_THREADS='4',OMP_NUM_THREADS='4')
p.joinpath('started.txt').write_text(datetime.datetime.now(datetime.timezone.utc).isoformat()+'\n')
c=subprocess.Popen(json.loads(p.joinpath('command.json').read_text()),env=e)
p.joinpath('source-pid.txt').write_text(str(c.pid)+'\n')
r=c.wait()
p.joinpath('exit-code.txt').write_text(str(r)+'\n')
p.joinpath('finished.txt').write_text(datetime.datetime.now(datetime.timezone.utc).isoformat()+'\n')
