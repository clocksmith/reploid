# Run a native Reploid participant

This is the same application host and participant protocol as the browser.
The generated delivery copies canonical source and catalog bytes; it does not
maintain another runtime. Linux/Vulkan native computation has physical evidence
under [native files](https://github.com/clocksmith/reploid/tree/main/artifacts/native-files-20261012). Signed opening and
whole-model numerical and document-quality acceptance remain separate gates.

Use Node 22.13 or newer. From the checkout, run `npm ci`, then
`npm run start:native -- --help`. WebRTC and WebGPU dependencies are declared
optional at the application root so browser development can omit them.

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

| Surface | Implemented contract |
| --- | --- |
| `POST /v1/chat/completions` | `model`, `messages`, optional boolean `stream`; one text choice |
| Messages | `system`, `user`, `assistant` with string `content` only |
| Streaming | SSE deltas, stable completion identity, actual terminal reason and `[DONE]` only on success |
| Termination | Stop token/sequence/EOS maps to `stop`; token/context limit maps to `length`; unknown reason fails |
| Cancellation | HTTP disconnect aborts the existing requester; unresolved HTTP calls remain charged until their promises settle |
| Unsupported parameters | Explicit 400 for sampling overrides including `temperature`, `top_p`, `seed`, `max_tokens`, `n`, tools, structured outputs and other unrecognized fields |
| `POST /v1/responses` | Explicit `store:false`, `model`, string `input` or an array of the text messages above; optional string `instructions` and boolean `stream` |
| Responses streaming | Typed SSE events with contiguous sequence numbers, stable response/item identities, and one completed or incomplete response |
| Responses termination | Stop/EOS completes; output-token limit is `incomplete/max_output_tokens` with `completed_at:null`; context-limit and unknown termination fail explicitly |
| Responses unsupported state | Rejects omitted/true `store`, previous response IDs, conversations, background, tools, structured output, sampling and `max_output_tokens`; no lookup or response persistence |
| `POST /v1/messages` | Text Messages wire adapter: `model`, alternating user/assistant string `messages` ending in user, optional string `system`, positive `max_tokens`, optional `stream` |
| Messages limits | Requires a route advertising caller-limit and raw-token usage support; the requested ceiling must fit its prepared allocation. Zero/cache-only, prefill, content blocks, tools, thinking, structured output, sampling and custom stop sequences are rejected |
| Messages streaming | Actual tokenization observation produces `message_start` before numerical dispatch; typed content deltas and final cumulative sampled count end with `message_stop` |
| Messages termination | EOS/stop token → `end_turn`; output ceiling → `max_tokens`; context-limit or unmatched stop-sequence metadata fails explicitly |
| Other paths | Unimplemented routes return 404 |
| Usage | Chat Completions/Responses omit counts. Messages uses explicit `raw-model-tokens/v1` local accounting described below |

The adapter uses existing input/output/admission limits from
`self/config/partition-policy.json`. Adapters borrowing the same participant share
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
uses the prepared route's declared policy; this adapter cannot override its token
limit. Only the explicit Messages request ceiling is supported; general sampling
overrides remain unsupported.

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
