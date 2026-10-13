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
Private deployments can supply `--signaling-url`, `--room`, `--room-token`
and `--origin` explicitly. Protect the identity file and its parent directory;
they contain the contributor's signing key. SIGINT or SIGTERM settles work,
closes authenticated channels and releases owned resources before natural exit.

The retained development runs used absolute temporary module paths; ordinary
installation uses the named packages above. Installing or connecting alone
does not establish useful distributed answers, numerical accuracy or release
qualification. No package publication or deployment occurs during packaging.

## Opt-in text HTTP APIs

The installed native entry exports `createChatCompletions` and `createResponses`. Each borrows an ordinary
participant's existing requester; it neither loads a fallback model nor grants
permission. No HTTP endpoint is mounted by the CLI or standalone signaling server
by default. A host application can mount the adapter explicitly:

```js
import http from 'node:http';
import { createNativeParticipant, createChatCompletions, createResponses } from './server/native-participant.js';
import { nativeOptions, authenticate, authorize } from './api-host.js';

const participant = await createNativeParticipant(nativeOptions);
const api = createChatCompletions({ participant, authenticate, authorize });
const responses = createResponses({ participant, authenticate, authorize });
const server = http.createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  return (path === '/v1/responses' ? responses : api).handle(req, res);
});
server.listen(8788, '127.0.0.1');
// On host shutdown: await Promise.all([api.close(), responses.close()]), close the HTTP server,
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
| Other protocols | Anthropic Messages is not implemented; other paths return 404 |
| Usage | Omitted; the adapter does not invent token counts |

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
limit. Anthropic Messages' required usage and caller token-limit semantics remain
unimplemented.

The [Responses installed consumer evidence](https://github.com/clocksmith/reploid/tree/main/artifacts/stateless-responses-20261013)
uses OpenAI SDK 7.32.0 for nonstreaming, streaming, terminal errors and cancellation
against an installed native adapter with injected computation. Source HTTP tests
add the actual automatic requester, grants and ordered peers. This proves protocol
composition, not physical inference. Event shapes follow the official
[Responses streaming guide](https://developers.openai.com/api/docs/guides/streaming-responses)
and [conversation state guide](https://developers.openai.com/api/docs/guides/conversation-state).
