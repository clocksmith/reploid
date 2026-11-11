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

The delivered package has a short command that stands for the full one:

```sh
reploid qwen-3-5-2b-q4k-ehaf16
```

With no model id, `reploid` serves `qwen-3-5-2b-q4k-ehaf16`, the model public
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
`sources` totals name where bytes came from). Sources are tried in order: the
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
origin as its last source. Only `qwen-3-5-2b-q4k-ehaf16` is pinned
(`clocksmith/rdrr` at `3a05b346b1c86abf02c7620f2369a9a7b82cb62f`,
`models/qwen-3-5-2b-q4k-ehaf16`); its 32 shard hashes there equal the pinned
manifest's. Each piece is checked
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

`npm run package:native -- --publishable` builds the same delivery with a
manifest npm accepts. Published under the name `reploid`, the command above
becomes `npx reploid qwen-3-5-2b-q4k-ehaf16` with no checkout. The example names
2B because the fleet supplies it; a model with no supplier online starts and
waits. `--omit-model <catalog id>` (repeatable) leaves a model and its bundled
files out of a delivery; the publishable build omits
`qwen3-8-27b-text-q4k-ehaf16`, whose content-addressed manifest names a home
directory and whose identity a live provider uses, so it cannot be re-issued
in place. The package
is not published; that is an owner decision. Checked: the built package
installs, and its three commands start through npm's links (help text and
argument expansion). On 2026-11-11 the package built from `65a2a7339`, run as
`reploid qwen-3-5-2b-q4k-ehaf16` on one Linux x64 host (Intel integrated GPU,
Vulkan) with an empty state directory, filled the 2B from a public custody
supplier (919 verified pieces, 2,087,223,456 bytes, 504 s; no origin bytes),
became ready and answered one Chat Completions request through a separate
connect-only requester. That is a single-host functional check, not model
quality or throughput qualification.

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
  --model qwen-3-5-0-8b-q4k-ehaf16 \
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
  "model": "qwen3-8-27b-text-q4k-ehaf16",
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
    "modelId": "qwen3-8-27b-text-q4k-ehaf16",
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
The current whole-model mesh does not support caller-selected token ceilings, so
it refuses Responses `max_output_tokens` and cannot serve Messages' required
`max_tokens`. Completion metadata is provider-reported, not validated billing evidence.

The application server can mount `/v1/models`, `/v1/chat/completions` and
`/v1/responses` before the earning router by setting
`REPLOID_TEXT_API_COMPOSITION` to an absolute module outside this repository.
That module exports `createTextApiComposition({env, production})`, returning
`participant`, `authenticate`, `authorize`, an `accounting.run(request, controls,
execute)` port, and optional `close()`. `controls.principal` is the authenticated
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
| `POST /v1/chat/completions` | `model`, `messages`, optional boolean `stream`; one text choice |
| Messages | `system`, `user`, `assistant` with string `content` only |
| Streaming | SSE deltas, stable completion identity, actual terminal reason and `[DONE]` only on success |
| Termination | Stop token/sequence/EOS maps to `stop`; token/context limit maps to `length`; unknown reason fails |
| Cancellation | HTTP disconnect aborts the existing requester; unresolved HTTP calls remain charged until their promises settle |
| Unsupported parameters | Explicit 400 for sampling overrides including `temperature`, `top_p`, `seed`, `max_tokens`, `n`, tools, structured outputs and other unrecognized fields |
| `POST /v1/responses` | Explicit `store:false`, `model`, string `input` or an array of the text messages above; optional string `instructions`, boolean `stream`, caller `max_output_tokens`, and `text.format.type=json_object` |
| Responses streaming | Typed SSE events with contiguous sequence numbers, stable response/item identities, and one completed or incomplete response |
| Responses termination | Stop/EOS completes; output-token limit is `incomplete/max_output_tokens` with `completed_at:null`; context-limit and unknown termination fail explicitly |
| Responses unsupported state | Rejects omitted/true `store`, previous response IDs, conversations, background, tools, `json_schema`, sampling and unknown fields; no lookup or response persistence |
| `POST /v1/messages` | Text Messages wire adapter: `model`, alternating user/assistant string `messages` ending in user, optional string `system`, positive `max_tokens`, optional `stream` |
| Messages limits | Requires a route advertising caller-limit and raw-token usage support; the requested ceiling must fit its prepared allocation. Zero/cache-only, prefill, content blocks, tools, thinking, structured output, sampling and custom stop sequences are rejected |
| Messages streaming | Actual tokenization observation produces `message_start` before numerical dispatch; typed content deltas and final cumulative sampled count end with `message_stop` |
| Messages termination | EOS/stop token → `end_turn`; output ceiling → `max_tokens`; context-limit or unmatched stop-sequence metadata fails explicitly |
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
