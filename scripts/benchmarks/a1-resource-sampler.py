"""Passive Linux sampling. Does not load, hash, warm, evict or lock model pages."""
import argparse
import json
import os
import stat
from pathlib import Path
import subprocess
import time


def process_snapshot(pid, proc=Path('/proc')):
    root=proc/str(pid)
    try:
        before=(root/'stat').read_text().rsplit(')',1)[1].split()[19]
        io={k:int(v) for k,v in (line.split(':',1) for line in (root/'io').read_text().splitlines())}
        after=(root/'stat').read_text().rsplit(')',1)[1].split()[19]
        if before!=after:return {'pid':pid,'available':False,'reason':'pid-reused-during-snapshot'}
        return {'pid':pid,'startTicks':before,'available':True,'io':io}
    except (OSError,ValueError,IndexError) as error:
        return {'pid':pid,'available':False,'reason':type(error).__name__}


def io_delta(previous,current):
    if not previous or not previous.get('available') or not current.get('available'):return None
    if (previous['pid'],previous['startTicks'])!=(current['pid'],current['startTicks']):return None
    common=previous['io'].keys()&current['io'].keys()
    delta={key:current['io'][key]-previous['io'][key] for key in common}
    return delta if all(value>=0 for value in delta.values()) else None


def phase_snapshot(marker):
    if marker is None:return {'available':False,'reason':'no-phase-marker'}
    try:
        value=json.loads(marker.read_text())
        if not isinstance(value,dict) or any(not isinstance(value.get(key),str) or not value[key] for key in ('runId','armId','phase','eventId')):
            raise ValueError('phase marker needs runId, armId, phase, eventId')
        return {'available':True,**{key:value[key] for key in ('runId','armId','phase','eventId')}}
    except (OSError,ValueError) as error:return {'available':False,'reason':type(error).__name__}


def residency(files):
    if not files:return {'available':False,'reason':'no-files'}
    try:
        # fincore queries page residency, never reads file contents. Limit each sample's overhead.
        identities=[]
        for file in files:
            info=file.stat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.geteuid():
                return {'available':False,'reason':'residency-requires-caller-owned-regular-file'}
            identities.append((info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns,info.st_uid))
        result=subprocess.run(['fincore','--json','--bytes','--output','FILE,SIZE,RES','--',*map(str,files)],capture_output=True,text=True,check=True,timeout=2)
        for file,identity in zip(files,identities):
            info=file.stat()
            if identity!=(info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns,info.st_uid):
                return {'available':False,'reason':'residency-file-changed'}
        return {'available':True,'files':json.loads(result.stdout)['fincore'],'diagnostic':result.stderr.strip() or None,
                'validityGate':'caller-owned-regular-file-before-and-after'}
    except (OSError,ValueError,KeyError,subprocess.SubprocessError) as error:
        return {'available':False,'reason':type(error).__name__}


_REPORT_CACHE={}

def harness_context(path,expected_freeze):
    """Observe compare-complete.py's existing report; never infer request phase from arm state."""
    if path is None:return None
    try:
        stamp=path.stat()
        identity=(str(path),expected_freeze,stamp.st_dev,stamp.st_ino,stamp.st_size,stamp.st_mtime_ns)
        if identity in _REPORT_CACHE:return _REPORT_CACHE[identity]
        if stamp.st_size>64*1024*1024:raise ValueError('report exceeds observation bound')
        with path.open() as stream:raw=stream.read(64*1024*1024+1)
        if len(raw)>64*1024*1024:raise ValueError('report exceeds observation bound')
        after=path.stat()
        if (stamp.st_dev,stamp.st_ino,stamp.st_size,stamp.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns):raise ValueError('report changed while reading')
        value=json.loads(raw)
        if not isinstance(value,dict) or not isinstance(value.get('arms',[]),list):raise ValueError('invalid harness report shape')
        if not expected_freeze or value.get('freezeSha256')!=expected_freeze:raise ValueError('freeze mismatch')
        result={'available':True,'freezeSha256':expected_freeze,'started':value.get('started'),
                'completedArms':len(value.get('arms',[])),'stage':value.get('stage'),
                'completed':value.get('completed',False),'requestPhaseAttribution':False}
        _REPORT_CACHE.clear();_REPORT_CACHE[identity]=result
        return result
    except (OSError,ValueError,TypeError) as error:return {'available':False,'reason':type(error).__name__}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pid',action='append',type=int,required=True)
    parser.add_argument('--file',action='append',type=Path,default=[])
    parser.add_argument('--phase-marker',type=Path)
    parser.add_argument('--harness-report',type=Path)
    parser.add_argument('--freeze-sha256')
    parser.add_argument('--samples',type=int,default=60)
    parser.add_argument('--interval',type=float,default=1.0)
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    if not 1<=args.samples<=3600 or not 0.1<=args.interval<=60 or any(pid<=0 for pid in args.pid):parser.error('invalid bounded sampling parameters')
    if args.harness_report and (not args.freeze_sha256 or len(args.freeze_sha256)!=64):parser.error('--harness-report requires the pinned --freeze-sha256')
    previous={};previous_phase=None
    # Exclusive output creation preserves prior evidence. stdout is not used for data.
    with args.out.open('x') as output:
        for index in range(args.samples):
            began=time.monotonic_ns();unix_began=time.time_ns();phase_before=phase_snapshot(args.phase_marker)
            processes=[process_snapshot(pid) for pid in args.pid]
            resident=residency(args.file);phase_after=phase_snapshot(args.phase_marker)
            phase_stable=phase_before==phase_after and phase_before.get('available',False)
            interval_attributable=bool(phase_stable and previous_phase==phase_before)
            for process in processes:
                process['ioDelta']=io_delta(previous.get(process['pid']),process)
                process['phaseAttributable']=interval_attributable and process['ioDelta'] is not None
            row={'schema':'reploid.a1-resource-sample/v1','index':index,'collectionBeginMonotonicNs':began,'collectionBeginUnixNs':unix_began,
                 'harnessContext':harness_context(args.harness_report,args.freeze_sha256),'phase':phase_after,'phaseStableDuringSample':phase_stable,'processes':processes,'residency':resident,
                 'collectionDurationNs':time.monotonic_ns()-began}
            output.write(json.dumps(row,sort_keys=True)+'\n');output.flush()
            previous={p['pid']:p for p in processes};previous_phase=phase_after if phase_stable else None
            if index+1<args.samples:time.sleep(args.interval)


if __name__=='__main__':main()
