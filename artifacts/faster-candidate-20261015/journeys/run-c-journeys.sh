#!/bin/sh
# Run 8 attempt c (final-10 pass 3): the remaining installed journeys in order, each with the unchanged
# harness and journey-config-c.json: transactional history check, contributor loss (output-head stage
# amd-host#2), bounded contribution. The supplier (mac-host) and acquirer (amd-host) browsers are started
# first. Destinations come from the environment (FC_RUN8_SSH_AMD).
set -u
J=/Users/xyz/deco/reploid/artifacts/faster-candidate-20261015/journeys; RUN=/var/tmp/reploid-faster-journey-20261015
H=/Users/xyz/deco/reploid/artifacts/signed-completion-journey-20261013; C=$J/config/journey-config-c.json
cd /Users/xyz/deco/reploid
node $H/run-7/tools/history-check.mjs $C $J/reports/history-check-c.json > $J/logs/c-history-check.out 2>&1; echo "history exit=$?"
node $H/run-contributor-loss.mjs $C > $J/logs/c-run-contributor-loss.out 2>&1; echo "loss exit=$?"
rm -f $RUN/supplier-chrome.pid
sh $J/tools/supplier-chrome.sh $J/logs/c-mac-supplier-chrome.log $RUN/supplier-chrome.pid
ssh -o BatchMode=yes "$FC_RUN8_SSH_AMD" sh -s -- fc-run8-amd-acquirer-2 < $J/tools/acquirer-launch.sh
ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -N -L 127.0.0.1:29674:127.0.0.1:29674 "$FC_RUN8_SSH_AMD" > $RUN/logs/tunnel-acquirer-c.log 2>&1 < /dev/null &
echo $! > $RUN/tunnel-acquirer.pid; sleep 3
node $H/run-contribution.mjs $C > $J/logs/c-run-contribution.out 2>&1; echo "contribution exit=$?"
echo done
