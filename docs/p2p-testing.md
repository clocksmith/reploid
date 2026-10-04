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
npx vitest run tests/unit/partition-data-channel.test.js
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

On the requester, open the application in a fresh browser, approve input
disclosure, and ask a question. Discovery and partition placement are automatic.
For the automated hosted journey, run from its Reploid checkout:

```bash
REPLOID_PUBLIC_URL='https://reploid.example.invalid/' \
REPLOID_E2E_SKIP_LOCAL_SERVER=1 REPLOID_E2E_CHROMIUM_CHANNEL=chrome \
  npx playwright test tests/e2e/chat-public-mesh.spec.js --project=chromium
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

*Last updated: October 2026*
