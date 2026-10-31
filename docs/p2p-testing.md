# P2P development sessions

Use the local machine as the requester and separate physical machines as
executors. Repeat the remote setup for each available machine. All connection
values below are placeholders; keep real addresses, usernames, keys, passwords,
and relay credentials outside Git.

## Connect over Tailscale

Both machines must already belong to the same tailnet. The destination needs an
SSH server, an authorized key, and a tailnet policy permitting the connection.
These commands use ordinary SSH over Tailscale; they do not change access policy
or enable the separate [Tailscale SSH service](https://tailscale.com/docs/features/tailscale-ssh).

On the local machine, replace the dummy values:

```bash
export P2P_HOST='PEER_TAILSCALE_IP_OR_NAME'
export P2P_USER='REMOTE_USERNAME'
tailscale status
tailscale ping "$P2P_HOST"
ssh "$P2P_USER@$P2P_HOST"
```

Use `ssh -i /path/to/authorized_private_key` if the key is not in your SSH agent.
A successful Tailscale ping does not establish SSH authorization. If SSH fails,
check the username, authorized key, SSH server, and existing access policy.

## Keep a terminal session running

On the remote machine, use a dedicated checkout and read its `AGENTS.md`:

```bash
cd /path/to/reploid-p2p
tmux -L reploid-dev new-session -A -s p2p
```

This creates the session or attaches to it. Detach with **Ctrl-B**, then **D**.
Reconnect from the local machine:

```bash
ssh -t "$P2P_USER@$P2P_HOST" 'tmux -L reploid-dev attach -t p2p'
```

Inside tmux, **Ctrl-B C** creates a window; **Ctrl-B N** selects the next one.
Use separate windows for Reploid, Doppler, tests, and logs. An existing session
created with `tmux new -s reploid-test` uses the default socket instead; reconnect
with `tmux attach -t reploid-test` on that machine.

Sessions survive SSH disconnects, not machine reboots. They share files,
processes, ports, and GPU resources. Use separate checkouts and browser profiles
for experiments; coordinate GPU runs with other work on the machine. Stop only
your own foreground process with **Ctrl-C**, rather than killing all browsers.

## Prepare and test

In the dedicated Reploid checkout, use Node.js 22+, npm, and Chrome with working
WebGPU. Use matching source revisions and the lockfile's Doppler package across
executors. `npm ci` replaces dependencies in this checkout:

```bash
npm ci
npx vitest run --config tests/vitest.config.js tests/unit/partition-data-channel.test.js
node scripts/run-mesh-contributor.js --help
```

For a hosted P2P run, set the same deployed application URL on each machine.
The following command explicitly enables compute contribution. Use a separate
profile from any existing public contributor:

```bash
export P2P_APP_URL='https://reploid.example.invalid/'
export P2P_MODEL='qwen-3-5-0-8b-q4k-ehaf16'
node scripts/run-mesh-contributor.js \
  --url "$P2P_APP_URL" --model "$P2P_MODEL" \
  --profile "$HOME/.local/share/reploid/p2p-test-compute" --contribute compute
```

Start a contributor on each executor. A supplier must also make the model pieces
available. To explicitly seed identical local model files, use another window:

```bash
node scripts/run-mesh-contributor.js \
  --url 'https://reploid.example.invalid/' --model qwen-3-5-0-8b-q4k-ehaf16 \
  --profile "$HOME/.local/share/reploid/p2p-test-files" --contribute files \
  --model-directory /path/to/exact/catalog-model-files
```

The launcher opens Network → This device and enables only the explicitly chosen
compute or file-sharing switch. It runs inference in a browser, not in Node.
Use `--browser chromium` to select installed Playwright Chromium when system
Chrome lacks the required WebGPU or Ed25519 support; the default is `chrome`.
Keep the launcher running while contributing and use Ctrl-C to close its browser.

On the requester, open the application in a fresh browser, approve input
disclosure, and ask a question. Discovery and partition placement are automatic.
For the automated hosted journey, run from its Reploid checkout:

```bash
REPLOID_PUBLIC_URL='https://reploid.example.invalid/' \
REPLOID_E2E_SKIP_LOCAL_SERVER=1 REPLOID_E2E_CHROMIUM_CHANNEL=chrome \
  npx playwright test --config tests/playwright.config.js tests/e2e/chat-public-mesh.spec.js --project=chromium
```

Inspect `test-results/e2e-results.json`. Check complete answers, retained-weight
reuse, concurrent conversations, and no requester weight downloads. Record which
physical machines executed the partitions; multiple browser profiles on one
computer do not prove cross-device inference. Unit tests and a connected terminal
alone do not prove P2P execution.

## Optional local server access

To view a server already running on remote port 8000, keep this command running
in a separate local terminal and open `http://localhost:18000`:

```bash
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:18000:127.0.0.1:8000 "$P2P_USER@$P2P_HOST"
```

The tunnel exposes the app locally. It does not connect Reploid peers or prove
that model pieces and activations use a direct WebRTC path. Record their actual
transport separately. Keep raw logs private until machine identifiers and
credentials have been removed.

## Archive identity before private numerical diagnostics

The existing `qwen-partition-control.js` and `qwen-partition-cross-host.js`
fixtures under `tests/fixtures/` require an explicit `packageArchive` in each
controller and worker configuration:

```json
{
  "packageArchive": {
    "path": "/path/on/this/host/doppler-gpu-exact.tgz",
    "sha256": "REPLACE_WITH_REVIEWED_64_CHARACTER_LOWERCASE_SHA256"
  },
  "installedPackage": "/path/on/this/host/node_modules/doppler-gpu"
}
```

Use the reviewed archive digest from the frozen run contract on every host;
archive paths can differ. The controller needs its own copy of that archive.
`installedPackage` belongs to worker configs (including the same-host control).
Keep the remaining model, manifest, generation, baseline, resource limits and
worker command fields from the frozen diagnostic configuration. These fields do
not create a complete run contract or authorize a GPU campaign.

Before importing Doppler or opening a GPU model, each worker hashes the archive,
derives a sorted file inventory from its captured bytes, and checks its installed
package against that inventory. Missing, changed, additional source files, links
and bundled dependencies fail. The controller requires matching identity receipts
from both workers before opening either stage; the same-host control verifies
each fresh worker too. Workers recheck immediately before opening. Keep these
dedicated installations unchanged for the entire run.

Reports retain `packages` receipts with archive SHA-256, installed file-tree
SHA-256, package name/version, file count and byte count. Rejected runs retain
partial receipts and cleanup outcomes. Preflight is setup work outside the
fixtures' model-open and generation timing windows; count it separately when
comparing total setup costs. `packageArchiveInspectionMs`, each package receipt's
`elapsedMs`, and each open result's `packageRecheckMs` record those checks.

The `node_modules` subtree is explicitly excluded: external dependencies, native
provider binaries, the Node executable and the OS/driver need separate identity
evidence. Archive equality is neither a signature check nor remote attestation.
This remains a private SSH/stdin diagnostic, not public WebRTC, signed-release
qualification, or proof of a current two-physical-device journey. Focused tests
exercise admission and failure handling without acquiring a GPU:

```bash
npx vitest run --config tests/vitest.config.js tests/unit/installed-package-identity.test.js
```

*Last updated: October 2026*
