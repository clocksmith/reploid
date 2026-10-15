// Run-8 (placement C) contributor control module for run-contributor-loss.mjs (README "Control module
// contract"). Copy of run-7/tools/contributor-control.mjs. Differences: both native stages run on
// amd-host, so units and launch aliases are keyed by stage (amd-host-1 for stage 1, amd-host-2 for
// stage 2), the unit prefix is fc-run8-amd-native-<stage>-, and the run directory and launcher are run 8's.
// stop(stage): abrupt contributor loss. SIGKILL to every process in the native's owned scope; the
//   application gets no chance to retire, so peers observe an unannounced disappearance.
// restore(stage): a new owned bounded scope with the same identity, cache, ledger, checkpoint store
//   and --ordered-config (tools/native-launch.sh). Nothing else is restarted.
// The SSH destination is supplied only through the environment (FC_RUN8_SSH_AMD); no machine name is
// written here. Current unit names live in the private control-state file.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';

const STATE = '/var/tmp/reploid-faster-journey-20261015/control-state.json';
const LAUNCH = new URL('./native-launch.sh', import.meta.url).pathname;
const key = stage => {
  if (stage.machine !== 'amd-host' || ![1, 2].includes(stage.stage)) throw Error('Run 8 controls only the amd-host native stages 1 and 2');
  return `amd-host-${stage.stage}`;
};
const prefix = stage => `fc-run8-amd-native-${stage.stage}-`;

function ssh(args, input) {
  const destination = process.env.FC_RUN8_SSH_AMD;
  if (!destination) throw Error('Control destination for amd-host is not configured in the environment');
  return new Promise((resolve, reject) => {
    const child = execFile('ssh', ['-o', 'BatchMode=yes', destination, ...args], { timeout: 120000 }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(Error(`ssh control failed: ${String(stderr).slice(-300)}`), { cause: error })); else resolve(String(stdout));
    });
    if (input !== undefined) child.stdin.end(input);
  });
}
const readState = async () => JSON.parse(await fs.readFile(STATE, 'utf8'));
const writeState = async state => fs.writeFile(STATE, JSON.stringify(state, null, 1));

const KILL = `set -eu
unit=$1
case "$unit" in fc-run8-*) ;; *) exit 2 ;; esac
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
procs=$(cat "/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/$unit.scope/cgroup.procs" | tr '\\n' ' ')
test -n "$procs"
at=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
kill -KILL $procs
for i in $(seq 1 30); do systemctl --user is-active --quiet "$unit.scope" || break; sleep 1; done
echo "{\\"stoppedAt\\":\\"$at\\",\\"pids\\":\\"$procs\\",\\"scopeAfter\\":\\"$(systemctl --user is-active "$unit.scope" 2>&1 || true)\\"}"
`;

export async function stopContributor(stage) {
  const state = await readState(), unit = state.current[key(stage)];
  if (!unit?.startsWith(prefix(stage))) throw Error('No owned native scope recorded for ' + key(stage));
  const result = JSON.parse((await ssh(['sh', '-s', '--', unit], KILL)).trim().split('\n').at(-1));
  state.history.push({ action: 'stop', machine: stage.machine, stage: stage.stage, unit, ...result, at: new Date().toISOString() }); await writeState(state);
  return { method: 'SIGKILL to every process of the owned native systemd scope (abrupt, unannounced contributor loss)', stoppedAt: result.stoppedAt,
    detail: { unit, pids: result.pids.trim(), scopeAfter: result.scopeAfter, participantId: stage.participantId, stage: stage.stage } };
}

export async function restoreContributor(stage) {
  const state = await readState(), alias = key(stage);
  const next = (state.counter[alias] || 1) + 1, unit = prefix(stage) + next;
  const output = await ssh(['sh', '-s', '--', alias, unit, state.share[alias] || 'noshare'], await fs.readFile(LAUNCH));
  if (!/active=active/.test(output)) throw Error('Restored native scope is not active: ' + output.slice(0, 300));
  const restoredAt = new Date().toISOString();
  state.counter[alias] = next; state.current[alias] = unit;
  state.history.push({ action: 'restore', machine: stage.machine, stage: stage.stage, unit, restoredAt, share: state.share[alias] || 'noshare' }); await writeState(state);
  return { method: 'new owned bounded systemd scope with the same identity, cache, ledger, checkpoint store and ordered config', restoredAt,
    detail: { unit, share: state.share[alias] || 'noshare', launch: output.split('\n').filter(line => /^(active|pids|ActiveEnter)/.test(line)) } };
}
