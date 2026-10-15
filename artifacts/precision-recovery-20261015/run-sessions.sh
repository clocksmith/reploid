#!/bin/sh
# Runs sessions p1c, p2 and p3 in order on amd-host (each job health-checked by run-jobs.sh).
cd /var/tmp/precision-recovery-20261015 || exit 1
./run-jobs.sh p1c jobs-p1c.txt
grep -q "^STOP" session-p1c.log && exit 1
./run-jobs.sh p2 jobs-p2.txt
grep -q "^STOP" session-p2.log && exit 1
./run-jobs.sh p3 jobs-p3.txt
