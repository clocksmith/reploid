# Run a native Reploid participant

This is the same application host and participant protocol as the browser.
The generated delivery copies canonical source and catalog bytes; it does not
maintain another runtime. Linux/Vulkan native computation has physical evidence
under [native files](https://github.com/clocksmith/reploid/tree/main/artifacts/native-files-20261012). Signed opening and
whole-model numerical and document-quality acceptance remain separate gates.

Use Node 22.13 or newer. From the checkout, run `npm ci`, then
`npm run start:native -- --help`. WebRTC and WebGPU dependencies are declared
optional at the application root so browser development can omit them.

## One command

The packaged CLI accepts short model names or full catalog IDs. Start with
`npx reploid models` to see the models included in your installation, their file
sizes, solo RAM estimates, whole/split support and sources for missing whole-model weights. File
sizes describe storage. Runtime memory also depends on context and backend.

```sh
npx reploid ask 2b "Count to five"   # send one plaintext request to an approved recipient, no model download
npx reploid doctor                   # check local prerequisites and signaling
npx reploid serve 2b                 # contribute this GPU to the public room
npx reploid connect                  # discover peers
npx reploid share 2b --weights ./weights
npx reploid help split               # see stage and private-room options
npx reploid help options             # full participant reference
```

For Tab completion of commands, models and options in Zsh (after `compinit`),
run `source <(npx reploid completion zsh)`. In Bash, save it first with
`npx reploid completion bash > ~/.reploid-completion.bash`, then run
`source ~/.reploid-completion.bash`. The generated script can be saved and
sourced from the shell startup file. For Fish, run `npx reploid completion fish | source`. Completions use the catalog at generation time.

`ask` searches the selected room for a ready exact model; it prefers whole-model
serving and can use a ready split. It prints the recipient IDs to standard error
before disclosure and the completed answer to standard output. Providers in the
selected room can read the request. The default is 2B in the public room; use
`--room`, `--room-token-file` and `--signaling-url` to use a private room.
`doctor` enumerates a GPU adapter and checks the installed Doppler package version
and signaling handshake. A successful diagnostic does not establish model fit.

The original positional form still works:

```sh
reploid qwen-3-5-2b-q4k-ef16-af32
```

With no model id, `reploid` serves `qwen-3-5-2b-q4k-ef16-af32`, the model public
peers supply; any options may follow directly (`reploid --connect-only`).

It runs `reploid-participant --contribute --execution-mode whole-model` for that
catalog model with state under `~/.reploid` (`weights/<model id>/` and
`identity.json`) and the supported transport and GPU packages, and prints what
it chose. One machine then holds the whole model and serves requests alone. Any
participant option may follow and replaces the chosen value:
`--execution-mode partition` (or a partition-only option such as
`--partition-index`, `--ordered-config`, `--canonical` or `--readiness-log`)
keeps partition execution, which needs another contributor for the same model;
`--connect-only` or `--share-files` choose another mode.

Whole-model contribution with an incomplete model directory first fills it
(`model-fill` status lines: `start`, `waiting-for-supplier`, `source`,
`source-failed`, `piece`, `file`, `complete`; piece lines and the per-source
`sources` totals name where bytes came from). Every line, including the final
`complete` receipt, also carries `suppliers`: verified pieces and bytes per
supplier, keyed by the supplying peer's room participant id or
`origin:<repo>@<revision>`, for example
`{"peer_k3x9":{"pieces":412,"bytes":927449088},"origin:clocksmith/rdrr@3a05b346b1c86abf02c7620f2369a9a7b82cb62f":{"pieces":507,"bytes":1159774368}}`.
Local reuse appears only under `sources`; at most 16 suppliers are named and the
rest are summed under `other`; addresses are never recorded. A partition
source's custody receipt carries the same `suppliers` summary. Sources are tried in order: the
verified piece cache and pieces already written, authorized custody peers, then
the model's pinned public origin when
[`server/native-model-origins.json`](../server/native-model-origins.json) pins
one. A pin binds the exact model identity to a Hugging Face repository, an
immutable 40-hex revision and a path; nothing from peers or requests can name
an origin, requests carry no credentials, and shards are read by HTTP range per
pinned piece. The manifest always comes from the delivery's pinned copy, never
an origin. With a pin, the fill gives peers a 15 s grace to announce and then
uses the origin for pieces no peer offers or that peers fail to deliver, so it
also completes with no peer online. Partition acquisition uses the same pinned
origin as its last source. The native delivery pins three models in `clocksmith/rdrr`.

| CLI name | Repository directory | Immutable revision |
| --- | --- | --- |
| `0.8b` | `models/qwen-3-5-0-8b-q4k-ehaf16` | `ea7b211b72c4d43687fa72802dee7aba74eca293` |
| `2b` | `models/qwen-3-5-2b-q4k-ehaf16` | `3a05b346b1c86abf02c7620f2369a9a7b82cb62f` |
| `27b` | `models/qwen-3-8-27b-text-q4k-ef16-af32` | `03345c4dde66115b9d3e26dca3362ef2fb39220e` |

`reploid serve 27b` fills missing pieces for the whole model. A
`reploid split 27b --stage 0` or `--stage 1` contributor fetches its
assigned ranges as needed. Both use the same pinned 27B manifest and verify
each piece. The 0.8B and 2B origins retain their earlier directory names.
35B and Flash use a local directory or authorized peers for weights.

Every model in the catalog was reissued on 2026-11-20 under a name that
describes its manifest. A reissue is a new manifest over the same weights, so
it has a new identity; the catalog entry lists what it replaces (`supersedes`).
The earlier name still selects the model. Without a directory of its own the
model uses the weights directory of the earlier name, and a directory that
holds the earlier manifest is adopted: each file is used only after its whole
hash matches, nothing is downloaded for files that match, and the manifest is
replaced last. After that the directory holds the new manifest, and Reploid
0.1.4 and earlier refuse it as another model. Each piece is checked
against the catalog's pinned piece index, each assembled shard against the
manifest's SHA-256 and each other file against the catalog. A file is written as
`<name>.partial` and renamed only after its whole hash matches; the manifest is
written last. A restart reuses verified pieces already written. The fill needs
free space for the missing files, follows the owner policy's admission and rates,
and drops its cached piece copies once a shard is in place. Without a pinned
origin it waits while no supplier is online; once one has delivered, a piece no
connected supplier offers within one channel timeout stops contribution with
that piece named. A directory
holding another model's manifest is refused, never overwritten. A complete
directory is used unchanged, as before.

A whole-model fill may prepare two verified pieces at once. Across all active
peer grants the native requester admits two signed chunk requests at a time.
If a peer can serve only one grant, the fill retries one at a time. The
owner's bandwidth controls still apply. The requester fetches pinned-origin ranges one at a time.

`npm run package:native -- --publishable` builds the same delivery with a
manifest npm accepts. It names the pinned Doppler release by version, and it
carries its resolved dependency graph as `npm-shrinkwrap.json`, because npm
leaves `package-lock.json` out of a published package; `native-delivery.json`
lists that file. Published under the name `reploid`, the command above
becomes `npx reploid qwen-3-5-2b-q4k-ef16-af32` with no checkout. The example names
2B because the fleet supplies it; a model with no supplier online starts and
waits. `--omit-model <catalog id>` (repeatable) leaves a model and its bundled
files out of a delivery. Reploid 0.1.3 and 0.1.4 omitted the 27B, whose manifest
named a home directory; it was reissued on 2026-11-20 as
`qwen-3-8-27b-text-q4k-ef16-af32` over the same 254 shards, with the upstream
checkpoint as its source, and no model is omitted now. Checked: the built package
installs, and its three commands start through npm's links (help text and
argument expansion). On 2026-11-11 the package built from `65a2a7339`, run as
`reploid qwen-3-5-2b-q4k-ehaf16` (the 2B's name at the time) on one Linux x64 host (Intel integrated GPU,
Vulkan) with an empty state directory, filled the 2B from a public custody
supplier (919 verified pieces, 2,087,223,456 bytes, 504 s; no origin bytes),
became ready and answered one Chat Completions request through a separate
connect-only requester. That is a single-host functional check, not model
quality or throughput qualification.

To supply the 27B to peers, run `reploid share 27b --weights /path/to/27b --supply-limit-gib 16`
with a fresh supplier cache. A complete copy needs about 15.84 GiB. The default
lifetime upload allowance is 4 GiB per cache. Large indexes can advertise whole
verified shards within the inventory limit. A requester verifies the requested
pieces against its pinned index. On a machine already serving another model, give the sharing process
its own `--identity-file` and `--cache-directory` so each service can start and stop independently.
Sharing opens no GPU. The room's peers can request the advertised files. To restrict grants,
repeat `--supply-to <computer-id>` for the permitted signing identities. Inventory stays visible to
the room. The supplier verifies the requester's current connection before reserving upload bytes.
Stop the sharing process with SIGTERM; its lifetime budget is kept in the cache directory.

## Delivery archive

To create an installable native delivery without a source checkout on its host:

```sh
npm run package:native
```

The output reports an archive path and its SHA-256. Copy that archive to the
native host, verify its reported hash, extract it, and enter the `reploid`
directory. Its `native-delivery.json` binds the source files, catalog, lockfile
and unchanged accepted Doppler archive. No model weights are included.

```sh
npm ci --no-audit --no-fund
npm start -- --help
mkdir -p weights
npm start -- --connect-only \
  --model qwen-3-5-0-8b-q4k-ef16-af32-vf16 \
  --model-directory ./weights \
  --identity-file ./state/identity.json \
  --rtc-module @roamhq/wrtc --ws-module ws
```

`--connect-only` authenticates and discovers participants without starting the
GPU or offering files. The model directory may start empty. Use `--contribute`
and `--gpu-module webgpu` to authorize compute: the existing coordinator chooses
the assigned partition and obtains its missing verified pieces from authorized
suppliers. Use `--share-files` to authorize file supply independently, or combine
it with `--contribute`. Neither mode grants disclosure of requester messages.

The native delivery requires `@roamhq/wrtc` and `ws`; `webgpu` is optional for
connections and file supply. For a host with no compute, installation may use
`npm ci --omit=optional`. Compute must have an installed compatible WebGPU
provider, Vulkan driver and adapter. Optional dependency installation failure
does not qualify compute; selecting an unavailable provider fails explicitly.

Public discovery uses the application's existing bootstrap configuration.
Private deployments can supply `--signaling-url`, `--room`, `--room-token-file`
and `--origin` explicitly. `--room-token-file` takes an absolute path to a
regular file owned by the participant's user with mode `0600`; the token is read
once at startup and one trailing newline is removed. Any other path, owner or
mode stops startup before the identity, modules or network are touched.

### Model and split JSON

`--model-config /absolute/model.json` adds an operator-local model or replaces a
catalog model's cuts in a private room. It is rejected in public discovery before
identity creation or provider startup. This is configuration authority, not a
public model release or signed partition qualification. It requires the matching
Doppler package (0.6.36 or newer with the manifest-driven plan API).

```json
{
  "schema": "reploid.native-model/v1",
  "model": "qwen-3-8-27b-text-q4k-ef16-af32",
  "partition": {
    "splitLayers": [32],
    "activationDtype": "f32",
    "activationPrecision": "f32"
  },
  "partitionRuntime": {
    "maxGpuBufferBytes": [17179869184, 17179869184],
    "runtimeConfig": "model"
  }
}
```

`model` can be a catalog ID or a complete model descriptor with `id`, `name`,
`provider: "doppler"`, exact manifest `identity`, explicit `generation`,
`executionModes`, and the ordinary pinned `source.files` metadata. Local source
files include the manifest and SHA-256-bound verified piece index; creating a
descriptor does not download or copy weights. The actual manifest bytes and
model ID must match before the runtime is imported. Geometry comes from that
manifest, not an operator-supplied hidden width or layer count.

`partitionRuntime.runtimeConfig` is a complete runtime overlay object, or the
explicit string `"model"` to reuse `model.loadOptions.runtimeConfig`. One positive
`maxGpuBufferBytes` value is required for each stage. A profile that runs
whole-model warm generation must be copied and set
`shared.kernelWarmup.warmGeneration` to `null` for partition execution. Unsupported
precision, fusion or generator modes fail; selecting a split never changes them
silently.

Use the same model JSON on every contributor and requester. Supply a separate
`--ordered-config /absolute/host.json` for each host's placement and limits:

```json
{
  "stage": {
    "modelId": "qwen-3-8-27b-text-q4k-ef16-af32",
    "index": 0,
    "residentId": "operator-stage-zero",
    "executionId": "operator-program-zero"
  },
  "maxStages": 4,
  "maxStageOffersPerPeer": 4,
  "maxRouteBytes": 32768,
  "maxSelectionSteps": 2000,
  "maxRoutes": 4
}
```

The next host uses index 1 and its own allocation identities; a weightless
requester uses `"stage": null`. For contributor-chosen placement use
`"stage": { "modelId": "...", "assignment": "auto" }` together with
`"orchestration": { "autoStage": { "dwellMs": 60000 } }`.
[Additional orchestration controls](launch-3-orchestration.md) remain opt-in.
Automatic assignment, replica demand and timing hints match the exact plan
identity, so peers with different cuts of the same model are excluded. Byte
admission cannot exceed the configured stage budget; an automatic contributor
uses the smallest of its authorized stage budgets. Owner limits can reduce it.

Qwen 35B can request `[10, 20, 30]` and Flash-Next `[16, 32]`, with matching
runtime configuration, budgets and source metadata. Doppler's
[retained AMD component checks](https://github.com/clocksmith/doppler/tree/main/reports/ordered-qwen-partitions-20261109)
compare those splits against their unsplit GPU programs. They do not qualify
cross-machine numerics or public availability. Flash-Next boundaries retain all
four residual streams. Cuts cannot change during an active attempt; idle
placement and new-request routing do not migrate conversation state.

```sh
umask 077                              # new files are owner-only (0600)
cat > /srv/reploid/state/room-token    # paste the token, then Ctrl-D
npm start -- --contribute ... --room reploid-swarm-<name> \
  --room-token-file /srv/reploid/state/room-token
```

`--room-token <token>` still works for compatibility, but the token is then
visible in process arguments and in any service journal that records them; the
CLI prints a warning on stderr. The two options cannot be combined. Protect the identity file and its parent directory;
they contain the contributor's signing key. SIGINT or SIGTERM settles work,
closes authenticated channels and releases owned resources before natural exit.

The retained development runs used absolute temporary module paths; ordinary
installation uses the named packages above. Installing or connecting alone
does not establish useful distributed answers, numerical accuracy or release
qualification. No package publication or deployment occurs during packaging.

## GPU shader cache

On Linux, `--contribute` gives the Vulkan driver a private Mesa shader cache and
never reuses one that an unfinished preparation wrote. Mesa ANV 24.2.8 stores a
shader's intermediate form before its compiled binary; a process stopped
mid-compile leaves an entry that can crash every later process needing that
pipeline ([investigation](https://github.com/clocksmith/reploid/tree/main/artifacts/native-crash-20261014)).

- The cache is keyed by the installed Doppler runtime and its pinned archive, the
  WebGPU provider, the Vulkan driver files and render devices, driver environment
  variables, and the model, Capsule, catalog entry, partition policy and stage.
- Without a sealed cache for its key, a start compiles into its own new staging
  directory. Once the stage reports complete pipeline preparation and Mesa's cache
  writers are idle, a hashed, read-only snapshot becomes the sealed cache.
- With a sealed cache, a start verifies every file and works on a private copy;
  the sealed directory is never given to the driver. A sealed cache that fails
  verification is removed and the start compiles cold.
- Each start removes staging left by a process that has exited.

The root defaults to `shader-cache` beside the identity file; choose another with
`--shader-cache-root <absolute directory>`. Startup fails if
`MESA_SHADER_CACHE_DIR` or `MESA_SHADER_CACHE_DISABLE` is already set.
`shader-cache` status lines report the binding, discarded or rejected caches and
the seal outcome. A driver that does not use `MESA_SHADER_CACHE_DIR` is reported
and never sealed. A cold start always compiles every pipeline the stage needs;
the protocol does not reduce that cost.

## Owner limits

`--owner-policy <absolute JSON path>` applies the owner's approved contribution
limits. Without it, behavior is unchanged and status lines report
`"owner":{"status":"no owner policy"}`. The file is read once at startup, so a
restart with the same file restores the same limits.

```json
{
  "schema": "reploid.native-owner-policy/v1",
  "authorization": {
    "equipment": { "granted": true, "ownership": "workplace", "grantedBy": "A. Owner", "workplaceApproval": "IT ticket 1234" },
    "network": { "granted": true, "ownership": "personal", "grantedBy": "A. Owner" }
  },
  "sampleIntervalMs": 5000,
  "schedule": { "timeZone": "America/New_York",
    "windows": [{ "days": ["mon", "tue", "wed", "thu", "fri"], "start": "22:00", "end": "07:00" }] },
  "memory": { "maxProcessResidentBytes": 8589934592, "maxGpuBufferBytes": 1073741824 },
  "bandwidth": { "uploadBytesPerSecond": 1048576, "downloadBytesPerSecond": 4194304 },
  "temperature": { "sensors": ["amdgpu"], "reduceAboveCelsius": 80, "deferAboveCelsius": 90 },
  "power": { "requireExternalPower": true, "gpuSensors": ["amdgpu"], "deferAboveWatts": 150 },
  "foreground": { "source": "owner-signal", "signalFile": "/run/user/1000/reploid-foreground", "action": "defer" },
  "reduced": { "maxConcurrentAttempts": 1, "maxSupplyTransfers": 1 }
}
```

- Equipment and network grants are required; workplace resources also need
  `workplaceApproval`. Unknown keys fail startup. No limit has a built-in
  default; an omitted section requests no control.
- Schedule windows use local wall time in `timeZone`; a window that ends before
  it starts continues into the next day.
- `defer` admits no new stage attempt, contribution preparation or piece supply;
  `reduce` lowers new admission to the `reduced` limits. Admitted attempts and
  granted transfers finish or settle. Nothing cancels conversations, and the
  process takes no wake lock.
- Rates pace custody piece and file bytes, not execution activations. Each rate
  must be at least the custody deadline floor (74,566 bytes per second with the
  current file policy). Cumulative file allowances are unchanged.
- `maxGpuBufferBytes` lowers Doppler's GPU buffer budget (application
  allocations, not physical VRAM); `maxProcessResidentBytes` defers new work
  while the process exceeds it.
- A requested control without a readable source rejects new work; missing or
  stale readings defer it.
- With `owner-signal`, new work defers or reduces while `signalFile` exists.
- `power.gpuSensors` without watt thresholds only measures GPU energy.

| Control | Linux | macOS | Windows |
| --- | --- | --- | --- |
| Schedule, process memory, GPU buffer budget, rates, owner signal | Supported | Supported | Supported |
| Temperature | Named hwmon sensors (`temp*_input`) | Unsupported (needs root) | Unsupported |
| GPU power | Named hwmon sensors (`power*`, `energy*`); component estimate | Unsupported (needs root) | Unsupported |
| External power | `power_supply` | `pmset -g batt` | Unsupported |
| Input idle | Unsupported; use `owner-signal` | `ioreg` `HIDIdleTime` | Unsupported |
| Wall power | Unsupported (external meter) | Unsupported | Unsupported |

`native-initialized` declares the policy and every control. `network` lines
report the decision, readings and measured CPU, memory, transfer and GPU energy;
`partition-state` lines carry the current decision and `at`, the observation
time in ISO 8601 UTC. These are source controls; installed and physical
qualification are separate.

## Readiness records

`--readiness-log <absolute JSONL path>` (with `--contribute`) appends the
records `scripts/capacity-utilization.js` measures. There is no default path;
without the flag nothing is written. The file is created owner-only (`0600`).

- `reploid.readiness-span/v1`: one stage of this participant (`participantId`,
  `modelIdentity`, `planId`, `stageIndex`) was `ready` with `capacity`
  (`attempt-slots` it holds or admits, after any owner limit) or `unready` from
  `from` to `to` (epoch ms). A span is written when it opens (`to: null`),
  re-written every 60 s while open and closed with `end` (for example `stopped`,
  `failed`, `capacity-changed`, `observation-gap`, `shutdown`). A stage is ready
  only while offered, Doppler reports it ready and it admits at least one slot.
- `reploid.stage-admission/v1`: one admitted attempt's identities, reservation
  and settlement times and slot count, written when reserved, while held and
  when settled.

Records hold no conversation text, thread or requester identities, or error
text. SIGINT/SIGTERM closes every span when shutdown starts. After a crash the
last span stays open: the CLI counts it only through its last observation, lists
it, and treats the time until the next start as unknown. A start writes nothing
for a stage until it is prepared; the stage is then recorded unready back to the
start. More than 60 s without an observation ends a ready span (a suspended
machine serves nothing). Pass the log and the requester's exports to the CLI
with an explicit interval:

```sh
node scripts/capacity-utilization.js readiness.jsonl attempts.json \
  --from 2026-10-15T22:00:00Z --to 2026-10-16T07:00:00Z
```

## Opt-in text HTTP APIs

The installed native entry exports `createChatCompletions`, `createResponses` and `createMessages`. Each borrows an ordinary
participant's existing requester; it neither loads a fallback model nor grants
permission. No HTTP endpoint is mounted by the CLI or standalone signaling server
by default. A host application can mount the adapter explicitly:

```js
import http from 'node:http';
import { createNativeParticipant, createChatCompletions, createResponses, createMessages } from './server/native-participant.js';
import { nativeOptions, authenticate, authorize } from './api-host.js';

const participant = await createNativeParticipant(nativeOptions);
const api = createChatCompletions({ participant, authenticate, authorize });
const responses = createResponses({ participant, authenticate, authorize });
const messages = createMessages({ participant, authenticate, authorize });
const server = http.createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  return (path === '/v1/messages' ? messages : path === '/v1/responses' ? responses : api).handle(req, res);
});
server.listen(8788, '127.0.0.1');
// On host shutdown: await Promise.all([api.close(), responses.close(), messages.close()]), close the HTTP server,
// then await participant.close(). Failed settlement must remain retryable.
```

`api-host.js` is the application's credential and consent owner. It must provide
`authenticate(request, {signal})`, returning a verified `{subject}` or rejecting,
and `authorize({action, principal, request, preview?, signal})`, returning `true`
only for approved actions. `chat.execute` covers the immutable request;
`chat.disclose` separately presents the actual route, recipients and input chosen
by the existing requester. Approval of execution does not approve disclosure.
Use a separately qualified prepared route; connection alone is not readiness.

An ordinary native requester now projects ready whole-model peers as well as its
partition routes. It prefers a ready whole-model route for the exact base model;
adapter variants use their catalog `selectionId`. Artifact and adapter identities
remain bound through disclosure and completion. A whole-model contributor and an
ordinary requester remain separate roles: the requester does not load weights.
A whole-model route accepts a caller output limit only as a generation setting
(`reploid.generation-settings/v1`), and only when at least one ready provider of the model
advertises that it enforces it; Chat Completions sends its limit this way. The
Responses `max_output_tokens` and Messages `max_tokens` paths still use the earlier
generation request, which a whole-model route refuses below its prepared ceiling.
Tools are a generation setting too. A native whole-model provider advertises them
only for a model whose catalog entry declares `toolCallFormat:
"reploid.tool-call/hermes-v1"` (an unknown value is refused when the model is
configured); no shipped catalog entry declares it yet. For such a request the
provider renders tools, earlier calls and tool results into plain chat text, masks
tokens so a call names a declared tool with arguments valid for its schema, and
reports the identity of that constraint, which is signed into the receipt. The
requester computes the same identity from the settings and refuses a receipt that
names another or none. The end-of-sequence tokens the mask allows come from the
loaded session (`advanced.getStopTokenIds()` and the tokenizer's `eos`).
Completion metadata is provider-reported, not validated billing evidence.

Before enabling a catalog model, qualify the exact model and installed package
with [the opt-in physical fixture](../tests/fixtures/tool-call-physical.js):

```sh
REPLOID_FLEET_PHYSICAL=1 node tests/fixtures/tool-call-physical.js /absolute/operator/tool-call.json
```

Use an isolated coordinator and a private model descriptor declaring the format.
Qwen 3.5 2B is the candidate to start with; do not infer support for a different
model or release from its result. The streamed and non-streamed rounds require
the requested arguments and an exact caller-generated receipt that was not in
the prompt. A valid tool-call shape or a correct arithmetic answer alone is not
evidence that the model used the tool result. This check does not deploy or
qualify the public chat UI.

The application server can mount `/v1/models`, `/v1/chat/completions`,
`/v1/responses` and `/v1/messages` before the earning router by setting
`REPLOID_TEXT_API_COMPOSITION` to an absolute module outside this repository.
That module exports `createTextApiComposition({env, production})`, returning
`participant`, `authenticate`, `authorize`, an `accounting.run(request, controls,
execute)` port, and optional `close()`. Production also requires an
`executionPolicyFor(request, controls)` port that issues a current
`reploid.execution-policy/v2` from operator authorization. Create the policy
with the [execution policy contract](execution-privacy.md). `controls.principal` is the authenticated
caller. Model listing additionally requires authorization for `models.list`.
Production refuses a `testOnly` composition and requires accounted execution.
Controlled tests may explicitly opt into `allowUnbilledTest` outside production.
Without the environment setting, these routes remain unmounted. Hosting rewrites
and deployment of the configured server remain separate release actions.

`server/trial-admission.js` supplies an exposure gate over the existing
transactional backend interface, using `TRIAL_COLLECTIONS`. It creates no
credits or prices. The accounting owner supplies an accepted reservation reader
returning `{reservationId, accountId, quoteIdentity, accepted, currency,
maxSubsidyMinor, expiresAt}` and a settlement reader returning
`{reservationId, accountId, settlementId, currency, subsidyMinor,
executionSettled}`. Amounts must come from the bound, approved ledger conversion
and settlement; they must not come from client-supplied prices or text estimates.
The gate reserves global and lifetime-account exposure atomically, admits a
reservation once, and retains the slot across restarts until both execution and
ledger settlement are confirmed. Cancellation or an expired quote does not
release uncertain execution. Production requires shared Firestore storage.

Evidence: [HTTP composition tests](../tests/integration/text-api.test.js),
[whole-model requester tests](../tests/unit/whole-model-requester.test.js) and
[trial admission tests](../tests/unit/trial-admission.test.js). These use controlled
execution and ledger fixtures; they do not qualify live inference, contributor
rewards, cash accounting, or a production earn-and-redeem loop. A production
composition must still supply approved terms and those ledger/execution projections.

| Surface | Implemented contract |
| --- | --- |
| `POST /v1/chat/completions` | `model`, `messages`, optional boolean `stream`, optional positive integer `max_completion_tokens` (or its older name `max_tokens`), optional `tools`, `tool_choice` and `parallel_tool_calls`; one choice |
| Output limit | Carried as generation settings and bound, with the messages and model identity, into the credit reservation, provider admission and signed receipt; the provider applies it. Refused with 400 before any disclosure when the route does not advertise it |
| Messages | `system`, `user`, `assistant` with string `content`; with `tools` declared, also assistant `tool_calls` (`content` may be null, `function.arguments` must be a JSON object as a string) and `tool` messages with `tool_call_id` and string `content`. Each call needs exactly one result directly after its assistant message; caller ids are kept |
| Tools | Up to 16 `type:"function"` tools; `tool_choice` `auto`, `none`, `required` or one named function; `parallel_tool_calls` is accepted and a forced call is still exactly one call. Parameters use the JSON Schema subset in `shared/infrastructure/output-constraint.js`: `$schema`, `$id`, `$comment`, `default` and `examples` are dropped, any other unsupported keyword is a 400 naming the keyword and the tool. Refused with 400 before any reservation or disclosure when the route does not advertise tools |
| Tool calls | `message.tool_calls` with a deterministic `id` per attempt, `content:null` and `finish_reason:"tool_calls"`. A call is returned only whole and valid for its schema. A call cut off by the output limit ends with `length` and no call. Under `auto`, only output that begins with the call wrapper is a call. A provider result that is not the one call the constraint admits is a 502 and never a call. A native requester reads it before countersigning the receipt, so it is not settled or charged; the credit hold then stays until the provider signs cleanup or the policy's claim window passes. `/v1/reploid/recover` returns the generated text as it was written and does not read calls out of it |
| Streaming | SSE deltas, stable completion identity, actual terminal reason and `[DONE]` only on success. While a call may still come, text is held back: it is released as text deltas once it cannot be a call, and a call is sent only after it has validated, as one `tool_calls` delta with `id` and `name` followed by `arguments` fragments. Token counts ride on the finish chunk |
| Termination | Stop token/sequence/EOS maps to `stop`; token/context limit maps to `length`; unknown reason fails |
| Cancellation | HTTP disconnect aborts the existing requester; unresolved HTTP calls remain charged until their promises settle |
| Unsupported parameters | Explicit 400 for sampling overrides including `temperature`, `top_p`, `seed`, `n`, structured outputs (`response_format`), thinking controls, `logprobs`, `stream_options` and other unrecognized fields |
| `POST /v1/responses` | Explicit `store:false`, `model`, string `input` or an array of the text messages above; optional string `instructions`, boolean `stream`, caller `max_output_tokens`, `text.format.type=json_object`, and function `tools` with `tool_choice` and `parallel_tool_calls` |
| Responses tools | Flat `type:"function"` tools (`name`, `description`, `parameters`, `strict`) under the same schema rules as Chat Completions; `tool_choice` `auto`, `none`, `required` or `{type:"function",name}`. With tools declared, `input` may hold `function_call` items (joined to the assistant turn they follow) and `function_call_output` items with string `output`. A call is a `function_call` output item with the deterministic `call_id`; nothing is stored, so the caller sends the call and its output back. Not combinable with `json_object` |
| Responses streaming | Typed SSE events with contiguous sequence numbers, stable response/item identities, and one completed or incomplete response. A validated call is sent as `response.output_item.added`, `response.function_call_arguments.delta`/`.done` and `response.output_item.done` |
| Responses termination | Stop/EOS completes; output-token limit is `incomplete/max_output_tokens` with `completed_at:null`; context-limit and unknown termination fail explicitly |
| Responses unsupported state | Rejects omitted/true `store`, previous response IDs, conversations, background, hosted tools, `json_schema`, sampling and unknown fields; no lookup or response persistence |
| `POST /v1/messages` | Messages wire adapter, mounted beside the other routes: `model`, alternating user/assistant `messages` ending in user, optional string `system`, positive `max_tokens`, optional `stream`, client `tools` and `tool_choice` |
| Messages tools | Client tools (`name`, `description`, `input_schema`) under the same schema rules as Chat Completions; `tool_choice` `{type: auto \| any \| none}` or `{type:"tool",name}`. Only in a request that declares tools, content may be a block list: assistant `text` and `tool_use`, user `tool_result` (string or text-block content, before any `text`). A call is a `tool_use` block with `stop_reason:"tool_use"`. `is_error` results and server tools are rejected |
| Messages limits | Requires a route advertising caller-limit and raw-token usage support; the requested ceiling must fit its prepared allocation, and a whole-model route refuses one below its prepared ceiling. Zero/cache-only, prefill, content blocks without tools, thinking, structured output, sampling and custom stop sequences are rejected |
| Messages streaming | On a partition route the tokenization observation produces `message_start` before numerical dispatch. A whole-model provider reports the token count of the prompt it tokenized before its first output token (one `reploid:generation-update` carrying `usage.inputTokens` and no `chunk`, ahead of any text), so `message_start` opens with that count and text streams as it arrives; the requester then refuses, before countersigning, a completion or receipt whose input count differs. A provider that predates the report sends text first: its text is kept and the whole stream is sent at completion, opening with the actual count. No count is invented. While output could still be a tool call its text stays held, and a call is published only whole and valid. Typed content deltas (a validated call as `input_json_delta`) and the final cumulative sampled count end with `message_stop` |
| Messages termination | EOS/stop token → `end_turn`; a validated call → `tool_use`; output ceiling → `max_tokens`; context-limit or unmatched stop-sequence metadata fails explicitly |
| Other paths | Unimplemented routes return 404 |
| Usage | Chat Completions omits counts. Responses with a caller ceiling and Messages use actual `raw-model-tokens/v1` local accounting described below; missing counts remain absent |

The adapter uses existing input/output/admission limits from
`apps/poolday/config/partition-policy.json`. Adapters borrowing the same participant share
the HTTP admission limit; closing one adapter aborts only its own requests.
`getState().active` counts that adapter's HTTP requests,
not GPU ownership; remote cleanup debt remains with participant/resident owners.
This ordinary streamed execution path does not claim canonical durable publication.

The [installed consumer evidence](https://github.com/clocksmith/reploid/tree/main/artifacts/text-chat-completions-20261013)
uses the official OpenAI JavaScript SDK against loopback, with injected numerical
text and no cloud or GPU calls. Separate source controls reach the real automatic
requester, signed grants and ordered peer owners through a mounted HTTP handler.
Neither establishes physical model correctness or coding quality. Wire fields
follow the official [Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

Stateless Responses requires the caller to resend its intended text history.
Instructions are included in the exact messages presented for authorization and
disclosure. There is no prior-response lookup or hidden continuation state, and
no token counts are invented. Generation
uses the prepared route's declared policy. Responses `max_output_tokens` and
Messages `max_tokens` enter the existing signed generation request and must fit
the prepared allocation and policy ceiling. A route without caller-limit/usage
capability rejects the request. General sampling overrides remain unsupported.

Responses JSON-object mode adds an explicit JSON instruction to the authorized
messages and validates that final text parses as an object. It does not supply
constrained decoding or JSON-schema guarantees. Invalid output cannot publish a
successful terminal event; streamed text remains provisional.

An optional namespaced `reploid` field narrows, without replacing, the host's
existing authorization:

```json
{
  "pool_id": "valera-private-pool-v1",
  "expected_model_identity": "sha256:REPLACE-WITH-READY-MODEL-IDENTITY",
  "expected_adapter_identities": [],
  "expected_plan_identity": null,
  "allowed_recipients": ["REPLACE-WITH-ADMITTED-PEER-THUMBPRINT"],
  "include_execution": true
}
```

The native host exposes its authoritative `roomId` and `executionClass`. Public-pool
or unknown classes, changed pools, model/adapter/plan mismatches and undeclared
recipients fail closed. Checks span execution authorization, disclosure authorization
and completion. Actual recipients include `preview.input.recipients`, route stage
participant IDs and pair participants; a room name is not a recipient identity.
Expected adapters must be active on the selected route, not merely available.

The completed Responses object then includes `reploid.http-execution/v1` metadata:
thread/attempt, model, pool/class, selected adapters/plan, approved recipients and
the existing native execution result. Headers retain request/attempt/model identity
and the raw-token usage schema when admitted. This is provider-reported evidence;
HTTP compatibility does not independently attest remote hardware or model quality.
The request field grants neither admission nor disclosure rights. Source integration
tests cover these bindings with injected computation; no physical inference is
implied by those tests. Mounting remains an explicit host operation.

The [Responses installed consumer evidence](https://github.com/clocksmith/reploid/tree/main/artifacts/stateless-responses-20261013)
uses OpenAI SDK 7.32.0 for nonstreaming, streaming, terminal errors and cancellation
against an installed native adapter with injected computation. Source HTTP tests
add the actual automatic requester, grants and ordered peers. This proves protocol
composition, not physical inference. Event shapes follow the official
[Responses streaming guide](https://developers.openai.com/api/docs/guides/streaming-responses)
and [conversation state guide](https://developers.openai.com/api/docs/guides/conversation-state).

The text Messages adapter reports `x-reploid-token-usage: raw-model-tokens/v1`.
`usage.input_tokens` is the selected model's actual templated prompt token count;
`usage.output_tokens` counts actual sampled tokens, including a terminal token
that decodes to no visible text. These are local execution counts, not Claude
tokenizer equivalence, Anthropic billing, cache usage or visible-text estimates.
No cache/billing fields are fabricated. A caller limit enters the existing signed
generation digest, and cannot change mid-attempt. Input-usage or text publication
prevents automatic retry from splicing a fresh attempt into the same response.
The host must authenticate `x-api-key` or other credentials through its existing
authentication port; the adapter itself grants no identity or disclosure rights.

The [Messages compatibility evidence](https://github.com/clocksmith/reploid/tree/main/artifacts/text-messages-20261013)
uses the official Anthropic SDK against an installed, explicit loopback mount with
injected numerical output. Source tests exercise real request/grant/entry/peer
owners, smaller caller caps, cancellation and actual token arrays. Neither proves
physical model quality. The supported wire subset follows the official
[Messages reference](https://platform.claude.com/docs/en/api/messages/create) and
[streaming events](https://platform.claude.com/docs/en/build-with-claude/streaming);
unsupported features fail explicitly.

## Contributor browser search

`--browser-search-profile /absolute/path/to/new-dedicated-profile` opts this
participant into Google search through an owned, visible Chrome session. It can
run with `--connect-only`: neither model preparation nor file sharing is needed.
The host needs Chrome and Playwright (`npm install --no-save playwright` in a
native delivery; the source checkout already includes it for browser tests).
Do not point this option at a personal Chrome profile or sign into this profile.
Existing non-Reploid profiles are refused. Keep its local browser state private;
it can retain search queries and Google's verification cookies.

Human verification remains manual in the contributor window. Closing the browser
withdraws its offer; a verification challenge suspends it until resolved. Search
runs one query at a time and refuses overlap; cancellation closes its search tab
and waits for bounded outstanding redirect requests. Only search-engine redirects
use the browser session. Source pages go through the existing DNS-guarded public
fetcher without browser cookies. Individual extraction failures remain recorded.

The browser application waits for a browser-Google contributor for new searches;
it does not automatically fall back to the unreliable legacy Bing RSS service. Each attempt binds its exact contributor, service and version;
there is no silent mid-request switch. A new Send or Retry authorizes the query
under the existing settings without adding a popup. Search quality and continued
availability still depend on the external search engine and source sites.

## Bounded local worker gathering diagnostic

The offline `tests/fixtures/qwen-partition-worker.js` diagnostic accepts
`workerGather: { maxPartBytes, memoryBudgetBytes, concurrency }` only with a pinned `pieceIndex`
and explicit partition indices. Optional `concurrency` selects independently owned
worker lanes; omission keeps one. The memory bound must cover all lanes, and the
native host rejects an older reader that silently ignores a requested lane count.
Whole-model mode and an absent piece index fail
before GPU initialization. The installed Doppler must support `nodeGather`, the
owned-range storage port and `getGatherReceipt`; older packages fail explicitly.
This does not update the pinned deployment package automatically.
Delivery activation is a separate versioned dependency update: assign a new
ordinary Doppler package version, then run `scripts/sync-doppler.js` so the npm
archive, lockfile, browser vendor tree and delivery manifests agree. The sync
refuses changed bytes under an existing version; never overwrite the retained
`0.7.4` archive to activate this path. Source-only contract evidence does not
qualify the currently pinned deployment package.

The native adapter resolves available indexed files inside the approved model
directory, rejecting escapes and non-regular files. Missing unassigned files do
not prevent opening a partition. Requesting a missing file still fails; the worker
does not download it or replace authorized custody/peer acquisition. Local worker
gathering is rejected for custody-backed sources and custom source resolvers.

The diagnostic's `receipts` operation captures generic and worker authentication
evidence separately while idle. `close` collects the same evidence before
teardown and reports a receipt failure separately if collection was unavailable.
Counts describe authentication work, including verified prefixes or work whose
publication was cancelled, not successful request bytes. No throughput or model
correctness claim follows from this wiring or the CPU contract tests.

For an **offline source diagnostic** without repacking a release, keep
`installedPackage` as an absolute path to a frozen Doppler checkout, omit
`packageArchive`, and set `sourceTree: { treeSha256 }`. Capture the expected hash
before starting workers with
`inspectDiagnosticSource(directory)` from
`tests/fixtures/diagnostic-runtime-identity.js`. Keep the diagnostic config and
outputs outside that directory. The hash inventories every file except root
`.git` and `node_modules`. Internal links are recorded and their targets must
remain within the inventoried checkout; escaping links, links to excluded bytes
and special entries are refused.
Dependencies retain their separate locked/provider identity. Source mode never
falls back to archive mode or updates an installed deployment.

Run the existing worker `identity` operation before `open`. Its distinct
`reploid.diagnostic-source-identity/v1` receipt reports source bytes, not a
published npm archive or a Git commit. All stages must report the expected
source receipt. Opening rechecks the same pin before importing Doppler or
acquiring the GPU. Keep the checkout unchanged through teardown: this preflight
is not an immutable snapshot, runtime attestation, or protection against edits
after the check. Archive-only runners must not relabel source evidence as
installed-package qualification. Model/piece authentication and provider
identity remain separate and unchanged. Use the existing worker gather limits
and receipt collection above; this source activation path does not qualify
physical correctness, speed, or production deployment.

### Whole-model worker gathering

A whole-model contributor normally reads its weights through the plain file loader. An operator model
configuration (`--model-config`, private rooms only) can instead ask for authenticated worker gathering, the
loading path the split stages use:

```json
{
  "schema": "reploid.native-model/v1",
  "model": { "id": "...", "identity": "sha256:...", "executionModes": ["whole-model"],
    "source": { "files": [{ "role": "model-piece-index", "path": "pieces.json", "hashAlgorithm": "sha256", "hash": "..." }] } },
  "wholeRuntime": { "gather": { "maxPartBytes": 3670016, "memoryBudgetBytes": 67108864, "concurrency": 8, "maxRanges": 3,
    "verificationCache": { "directory": "/absolute/state/piece-state" } } }
}
```

Every weight piece is then hashed against the model's pinned piece index by parallel workers before it is used,
the manifest and tokenizer come from the same authenticated storage, and no URL can replace those bytes. With a
`verificationCache`, pieces verified for a file's exact state (device, inode, size and times) are remembered across
restarts, and each file's admitted identity is bound. The model directory holds the manifest and indexed weight files. Operator-defined models also supply their piece index locally. Bounds are explicit; nothing is chosen automatically.
Routed-expert settings that need this storage (`sourceReadMode: "expert-lease-batch"`, `uploadStaging: "mapped"`)
go in the model's `loadOptions.runtimeConfig` as usual. A model with no `wholeRuntime` is loaded as before.

A reviewed catalog entry can carry the same `wholeRuntime.gather` bounds without a `verificationCache`: a
catalog cannot name a machine directory, so the provider remembers verified pieces in `piece-state` beside its
identity file. Flash’s large piece index is loaded when a provider needs it. A custody-enabled host checks
its cache, model directory and authorized peers before using the catalog’s immutable Hugging Face URL. A
standalone host checks its model directory first. The host verifies the byte count and SHA-256 digest and
retains the index beside the weights when writable. Asking a remote provider requires no index download.
The hosted file contains the piece map. Flash weight files still need a separate source.

Checked on 2026-11-19 on one AMD host (Vulkan) with Qwen 3.8 Flash-Next in a private room, loopback signaling and
a connect-only requester over WebRTC using the Chat Completions adapter: the model opened in 6.3 to 7.0 s and
answered six requests, one of them with text identical to the earlier benchmark reference. That is a single-host
functional check with one requester, not qualification for public serving.

### Explicit local source runtime

`--runtime-source-config /absolute/runtime.json` activates an operator-selected
Doppler checkout for native partition computation. It leaves the installed
package, browser delivery, archive pin and ordinary startup unchanged. This mode
requires `--contribute` and an explicit private `--room`. It rejects signed
Capsules, canonical execution, adapters, earning, whole-model execution,
`--share-files`, and `--cache-directory`. All required model files must be local;
there is no custody or peer-acquisition fallback in this mode.

```json
{
  "schema": "reploid.native-runtime-source/v1",
  "directory": "/absolute/doppler-checkout",
  "treeSha256": "<64 lowercase SHA-256 hex digits>",
  "gather": {
    "maxPartBytes": 2097152,
    "memoryBudgetBytes": 67108864,
    "concurrency": 4
  }
}
```

Compute the expected tree hash with `inspectNativeRuntimeSource(directory)` from
`server/native-runtime-source.js`, review the selected checkout, then record that
hash in the config outside the checkout. The inventory covers the complete tree
except `.git` and `node_modules`; internal links must target inventoried bytes.
Dependency, provider and model identities remain separate. Changing a source file
requires a new explicit expected hash and a new process; Node's cached modules
cannot be relabeled with a new disk-tree identity. The source is checked before import,
after import and before each partition preparation; this is local byte identity,
not protection against a concurrent privileged writer or release qualification.

Preparation, owner memory inspection and GPU shutdown use the same selected
runtime. Gather bounds are charged by Doppler's existing admission rules; they do
not increase the configured GPU budget. Generic loads retain complete-piece
verification, while exact-piece worker loads hash the complete owned output
before transfer. Startup and partition receipts identify the source tree and
worker policy separately from installed archive identity. Shader caches use that
source identity, so they cannot reuse an installed-archive cache key.

The synchronous partition acquisition receipt covers generic reads only. The
program's optional asynchronous `getGatherReceipt()` reports worker evidence
while no lease is outstanding and before closing. Neither receipt establishes
model correctness or a performance win. Model, transport and physical lifecycle
qualification must exercise this exact selected source separately.

The separate offline `tests/fixtures/qwen-partition-worker.js` diagnostic supports
whole-model authenticated gathering with `indices: null` and a pinned
`pieceIndex`. This does not enable whole-model source mode in the participant
CLI. Whole diagnostic loads pass the captured manifest text/hash and owned
storage through Doppler's existing inline source API with an isolated loader;
URL loading cannot replace those bytes. All retained sources close after model
owners unload, including failed-load cleanup retries. The preparation signal
bounds admission and loading; after successful loading its deadline no longer
aborts storage reads. Storage keeps its own close lifetime, and leased generation
reads still honor their individual operation signals.

The diagnostic `preflight` operation verifies the selected runtime identity and
model/index metadata bindings without importing that runtime or opening a GPU.
It reports canonical whole-source file availability and explicitly leaves weight
contents unverified. Missing files block whole opening before runtime import or
provider startup. Existing piece-oriented caches are not silently interpreted as
full source files. Qualified preparation must supply an approved compatible
source layout. `openWallMs` includes all opening/preflight work;
`modelPreflightMs` and `packageRecheckMs` identify metadata/identity overhead,
while `elapsedMs` retains its narrower pipeline-opening scope. These are load
metrics, separate from complete generation-request and decode timings.

An offline worker config may explicitly select an existing source layout with
`sourceMap: { schema: "reploid.diagnostic-source-map/v1", manifestIdentity,
indexIdentity, files, tokenizerPiecesDirectory }`. Both identities must match the
captured manifest and piece index. `files` maps every indexed weight filename to
an operator-selected absolute local file; physical paths embedded in the model
never authorize access. An indexed `tokenizer.json` may instead use its existing
`tokenizer.json.<offset>` pieces in the selected absolute cache directory. Omit
`tokenizerPiecesDirectory` when mapping a complete tokenizer file.

Approved weight symlinks resolve once to canonical regular-file targets of the
declared sizes. Device/inode/size snapshots bind generic readers and, with
gathering, the worker's no-follow descriptor admission and reads. Replacing the
original alias does not retarget that snapshot; replacing the canonical file
rejects reads. Complete-piece SHA verification remains mandatory, including
in-place mutations. Cache-piece symlinks are rejected. Failed cleanup remains
owned and retryable, and close settles actual mapped-file I/O and worker reads.
Gathering fails explicitly if the selected Doppler lacks file-identity support.
These options do not modify participant CLI modes, custody, package pins or
provider configuration. Metadata preflight establishes layout availability only.

The offline worker's `request` operation takes `prompt` and exact `promptIds`
after a whole model has opened. It uses the public `inspect.generate` path with
`demo/always-on`, checks the actual prefilled IDs and sampled-token observations,
and exports token timing rather than raw logit vectors. `requestTimeoutMs` is
required in the worker config; the deadline covers reset and generation and
prevents publication after cancellation. The model's next independent request
starts with reset. A deadline does not promise immediate GPU termination.
`generationWallMs`, reset-inclusive `requestWallMs`, first-token time and
first-to-last observed token time have distinct scopes. Neither loader timings
nor these diagnostics establish a performance win without matched full requests.

Two additional whole-model operations provide explicit, nonrepresentative
diagnostics. `profile-request` uses `demo/deep-xray`, requires physical GPU
timestamp queries and exports only complete decode compute-pass timings and
selected scalar clocks alongside exact tokens and text. This inspection policy
collects quality evidence and changes command batching; its wall time is not a
benchmark result. Partial timestamp coverage is an error.

`numerical-request` requires exactly one input token and generates two tokens.
It captures every decode layer output through `demo/activation-grid`, then resets
and captures both full logits vectors through the public generation API. It
requires matching model identity, tokens and text between passes, finite F32
values and complete layer coverage. Encoded vectors have a 32 MiB payload bound;
keep them in private diagnostic artifacts. The caller declares the comparison
tolerance. Activation capture disables command batching, so numerical-only
configs must explicitly set `usePreparedDecodeWorkspace: false` and
`decodeLoop.layerSubmitInterval: null` in `runtimeConfig.inference.session` when
the timed configuration requires recorded execution. Both numerical arms must
use the same declared observation settings. The worker does not silently change
those settings. Neither operation replaces ordinary complete-request correctness,
timing, allocation or lifecycle qualification, and both honor the request deadline.

## Expiring TURN configuration

Native participants default to the configured STUN-only transport. For networks
requiring relay, pass `--rtc-config-file /absolute/private/rtc.json`. This is an
operator-supplied credential **consumer**, not a credential issuer. An authorized
external producer must atomically replace the file before expiry. Use the
`reploid.pool.turn_credentials/v1` response shape with `expiresAt` and `rtcConfig`
(`iceTransportPolicy: "all"` or `"relay"`, and credential-bearing `iceServers`).

The file must be regular, owned by the current POSIX user, mode 0600, no final
symlink, at most 32 KiB, and valid for more than 60 additional seconds. It is
validated before provider startup and reread at negotiation and transport
heartbeat. Invalid/expired explicit configuration blocks new negotiations rather
than silently falling back to STUN. Existing healthy channels are retained when
a refresh fails. Keep the file outside the repository; credentials must never be
placed in command arguments or logs. Programmatic hosts can supply an async
`getRtcConfig` port directly to `createNativeParticipant`.

This option alone does not establish relay reachability or unattended credential
renewal. Qualify a forced-relay connection on the actual requester/provider pair.

### Native credential renewal

Run `node server/native-rtc-renewal-cli.js /absolute/private/rtc-state` as a
single supervised process. It uses the public Firebase anonymous authentication
flow and existing authorized TURN issuer, not administrator credentials. The
directory must be owned by the service user with mode 0700. Its identity refresh
token and `rtc.json` are mode 0600; keep both outside repositories and backups
intended for sharing. Point the participant at `--rtc-config-file
/absolute/private/rtc-state/rtc.json` only after initial renewal succeeds.

Renewal reuses its dedicated identity across restarts and runs every four minutes
or sooner for short expiry. Failed renewal retains the last validated file and
retries after 30 seconds; expired credentials still block new negotiations. A
revoked identity fails closed rather than silently creating another account.
Supervise one renewal process per state directory. Changing these files does not
retrofit a running participant that started without `--rtc-config-file`; restart
that participant in an idle service window. A renewal success is not a relay
connectivity or inference qualification.
