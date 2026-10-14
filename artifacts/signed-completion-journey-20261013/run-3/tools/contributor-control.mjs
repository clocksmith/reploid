// Run-3 contributor control module for run-contributor-loss.mjs (README "Control module contract").
// stop(stage): abrupt contributor loss. SIGKILL to every process in the native's owned scope; the
//   application gets no chance to retire, so peers observe an unannounced disappearance.
// restore(stage): a new owned bounded scope with the same identity, cache, ledger, checkpoint store
//   and --ordered-config (tools/native-launch.sh). Nothing else is restarted.
// SSH destinations are supplied only through the environment (SCJ_RUN3_SSH_AMD, SCJ_RUN3_SSH_INTEL);
// no machine name is written here. Current unit names live in the private control-state file.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';

const STATE = '/var/tmp/reploid-signed-completion-journey-run3-20261013/control-state.json';
const LAUNCH = new URL('./native-launch.sh', import.meta.url).pathname;
const ENV = { 'amd-host': 'SCJ_RUN3_SSH_AMD', 'intel-host': 'SCJ_RUN3_SSH_INTEL' };
const PREFIX = { 'amd-host': 'scj-run3-amd-native-', 'intel-host': 'scj-run3-intel-native-' };

function destination(machine) {
  const value = process.env[ENV[machine]];
  if (!value) throw Error(`Control destination for ${machine} is not configured in the environment`);
  return value;
}
function ssh(machine, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile('ssh', ['-o', 'BatchMode=yes', destination(machine), ...args], { timeout: 120000 }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(Error(`ssh control failed: ${String(stderr).slice(-300)}`), { cause: error })); else resolve(String(stdout));
    });
    if (input !== undefined) child.stdin.end(input);
  });
}
const readState = async () => JSON.parse(await fs.readFile(STATE, 'utf8'));
const writeState = async state => fs.writeFile(STATE, JSON.stringify(state, null, 1));

const KILL = `set -eu
unit=$1
case "$unit" in scj-run3-*) ;; *) exit 2 ;; esac
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
procs=$(cat "/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/$unit.scope/cgroup.procs" | tr '\\n' ' ')
test -n "$procs"
at=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
kill -KILL $procs
for i in $(seq 1 30); do systemctl --user is-active --quiet "$unit.scope" || break; sleep 1; done
echo "{\\"stoppedAt\\":\\"$at\\",\\"pids\\":\\"$procs\\",\\"scopeAfter\\":\\"$(systemctl --user is-active "$unit.scope" 2>&1 || true)\\"}"
`;

export async function stopContributor(stage) {
  const state = await readState(), unit = state.current[stage.machine];
  if (!unit?.startsWith(PREFIX[stage.machine])) throw Error('No owned native scope recorded for ' + stage.machine);
  const result = JSON.parse((await ssh(stage.machine, ['sh', '-s', '--', unit], KILL)).trim().split('\n').at(-1));
  state.history.push({ action: 'stop', machine: stage.machine, unit, ...result, at: new Date().toISOString() }); await writeState(state);
  return { method: 'SIGKILL to every process of the owned native systemd scope (abrupt, unannounced contributor loss)', stoppedAt: result.stoppedAt,
    detail: { unit, pids: result.pids.trim(), scopeAfter: result.scopeAfter, participantId: stage.participantId, stage: stage.stage } };
}

export async function restoreContributor(stage) {
  const state = await readState();
  const next = (state.counter[stage.machine] || 1) + 1, unit = PREFIX[stage.machine] + next;
  const output = await ssh(stage.machine, ['sh', '-s', '--', stage.machine, unit, state.share[stage.machine] || 'noshare'], await fs.readFile(LAUNCH));
  if (!/active=active/.test(output)) throw Error('Restored native scope is not active: ' + output.slice(0, 300));
  const restoredAt = new Date().toISOString();
  state.counter[stage.machine] = next; state.current[stage.machine] = unit;
  state.history.push({ action: 'restore', machine: stage.machine, unit, restoredAt, share: state.share[stage.machine] || 'noshare' }); await writeState(state);
  return { method: 'new owned bounded systemd scope with the same identity, cache, ledger, checkpoint store and ordered config', restoredAt,
    detail: { unit, share: state.share[stage.machine] || 'noshare', launch: output.split('\n').filter(line => /^(active|pids|ActiveEnter)/.test(line)) } };
}
