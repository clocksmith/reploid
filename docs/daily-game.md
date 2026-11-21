# Reploid Daily

A circle gets one target answer per UTC day. Write a prompt that gets its model to say the target without using the listed words. A winning player can send a dare such as “Got it in 12 words. Can you?” A recipient can watch the recorded result immediately and use the host’s invitation to take their own turn.

## Preview

Use the Reploid **source checkout** with its installed dependencies and Node 22.13 or later (SQLite). From the repository root run:

~~~sh
npm ci
npm run daily -- preview
~~~

Open the printed loopback address. The preview displays the rules and a staged target. Real ranked play requires the qualifications below. The server has its own origin, cookie and score database. The hosted chat site and ordinary chat permissions are independent.

## Private physical playtest

Use a source checkout and a private state directory to play before ranked qualification. The default state directory is `~/.local/share/reploid/daily-playtest`. The playtest has its own SQLite ledger, challenge pins, daily host budget and three turns per stable player. It binds only to loopback. Ranked play continues to require the signed calendar and physical qualification.

To use an existing enrolled fleet, save `playtest.json` in that directory with `fleetConfig` (private requester config path), `providerId`, `backendIdentityHash`, `target`, `circleName`, `port` and `hostDailyCap`. Configure `auth` for verified email if desired. A separate operator-provisioned local player grant works without email. Launch the private circle from the source checkout.

~~~sh
npm run daily -- playtest
~~~

Alternatively, use a local model directory plus the physical backend digest recorded by the Doppler collector. The direct runner verifies the installed runtime against its pinned archive, rechecks the manifest, tokenizer and shard bytes, opens the physical GPU on first use and resets model state before each turn. It records the generated output and Doppler evidence fingerprint. The fleet route records a countersigned and settled peer receipt. Pick one runner per host.

~~~sh
npm run daily -- playtest --model /private/pinned-model --backend "$BACKEND_IDENTITY_HASH" --target Paris --port 4180
~~~

Open `open-owner.html` in the printed private directory to play with the operator seat. `private-links.json` contains the operator link and three separately assigned guest links by default. Both files are owner-readable. Each player's bootstrap link contains the circle invitation and a credential for that player's own seat. Give each guest only their own link. The in-game dare includes the shared invitation alone. Reopening a bootstrap link restores that same player's attempt count. An ordinary visit can read a recorded dare without using GPU time. Private playtest submissions and scores stay separate from ranked results.

## Rules

- Three submitted turns per verified account per UTC day across cookies, browsers and invitations. The host also sets a finite daily turn budget. A failed admission before dispatch returns the turn. An ambiguous dispatch keeps its place in the budget; retrying the same submission key retrieves its record.
- Players see the forbidden words before play. Prompts can use any language. Translations, riddles and analogies are legal. For banned words, the judge folds case, accents and Unicode-to-Latin lookalikes and detects adjacent fragments. It rejects invisible formatting and controls. For “I resign.” the explicit ban also covers resigns, resigned, resigning, resignation and resignations. “I” is forbidden as a standalone word. For the word count, apply Unicode NFKC and count consecutive runs of letters or digits. Hyphens and apostrophes separate words.
- Prompts have a 240-character limit. Trim and normalize to NFC before counting Unicode code points. Rank a guest’s best winning submission by fewest words, then fewest characters. Equal scores share rank.
- The judge compares the entire recorded answer after trimming surrounding whitespace, normalizing to NFC, lowercasing and removing one final punctuation character from each side. Extra words, extra internal spaces and a second trailing punctuation mark count.
- Every scored request uses the same enrolled peer, pinned base model, non-thinking template, fresh context, system message, greedy decoding and 16-token limit. The system message contains neither the target nor the answer rule. The board scores the run on that circle’s GPU. Another GPU can produce different text.
- The serving computer can read the prompt. Publishing a dare exposes the score, output and a fingerprint of the private countersigned receipt. Reading a dare performs no inference. Sharing carries the existing host-issued invitation. Yesterday’s first-place prompt appears only with the author’s permission and the host’s review.

## Qualify and schedule a target

A trusted operator maintains a private bank, an Ed25519 signing key and its public verification key. The bank is a JSON array of objects with a target string and a prompts array. Prepare several independently worded legal solutions for each proposed target. Store the bank, raw attempts and signed qualification files outside the served tree. The repository contains only aggregate results. [Physical pilot](../reports/daily-pilot/summary.json)

Use the pinned Doppler archive and the model directory containing the matching manifest, tokenizer and complete verified shards. Run the collector on each physical backend when it is available. Supply the enrolled peer ID on the actual circle provider. A reference-only machine can use a dash. The collector writes a new private file and refuses to overwrite an existing report.

~~~sh
node scripts/qualify-daily.mjs collect /models/pinned /private/bank.json - /private/reference.json
node scripts/qualify-daily.mjs collect /models/pinned /private/bank.json "$PROVIDER_ID" /private/circle.json
~~~

Review the private evidence on the operator’s machine. Endorse accepted reports with the owner key. Create a JSON calendar mapping ISO UTC dates to target strings, then sign it. Standard Ed25519 PEM keys work. Use a private directory and restrict access to its contents.

~~~sh
umask 077
openssl genpkey -algorithm ED25519 -out /private/calendar.key
openssl pkey -in /private/calendar.key -pubout -out /private/calendar.pub
node scripts/qualify-daily.mjs endorse /private/reference.json /private/calendar.key /private/reference.signed.json
node scripts/qualify-daily.mjs sign-calendar /private/days.json /private/calendar.key /private/calendar.signed.json
~~~

Endorse the other reports in the same way. For each target, the gate requires two distinct legal winning prompts on Apple Metal, AMD Vulkan, and the exact backend of the enrolled serving peer. An Apple or AMD serving peer can supply its own vendor evidence. Punctuation-only and casing-only variations count once. Signed records bind measured backend, generation configuration, transcript, completion and model hashes. These are operator-endorsed measurements. The verifier pins the provider and backend to that day’s leaderboard. A schedule change affecting those pins requires a new day.

## Run an invited circle

Choose a public circle name that identifies who will receive submissions. Set up a dedicated HTTPS origin with a reverse proxy to the loopback service. For local tests the origin may be HTTP on loopback. Configure a dedicated Supabase project for email OTP, turn on email sign-in, and configure the email template to display {{ .Token }}. Use its publishable API key. The server exchanges the code, checks the confirmed user with the issuer, and derives a stable circle-local account identifier. The recipient of a dare can view it before signing in. Clearing browser storage removes the session; using the same verified account restores its history and turn count. A person controlling several verified accounts can still enter separately. [Email OTP setup](https://supabase.com/docs/guides/auth/auth-email-passwordless)

Prepare separate, enrolled requester and provider identities and a private room. Use the fleet coordinator’s noncash credit service with a policy covering the pinned model and at least 16 output tokens. Put the existing identity keys, room token and requester config in owner-only files. The public page only accesses the circle HTTP service. [Native fleet configuration and enrollment](fleet-service.md)

For the model entry, start with the full entry for `qwen-3-5-0-8b-q4k-ef16-af32-vf16` in `shared/config/chat-models.json`. Apply `generation: {...resolvePartitionGeneration(entry), maxTokens:16}` from `apps/poolday/config/partition-generation.js`, and use an empty adapters array. Its manifest digest is `sha256:cdda7ddc748f581e3c79b5067fc8647a20d43c7030644e0c48b1560a1ac30d7d`.

- In the native requester’s `models` array, use `{model:entry,mode:'partition',ordered:null,directory:'/absolute/manifest-directory'}`. This selects the private remote whole-model route. Give it a dedicated existing identity, and leave contribution, the chat HTTP API and the browser bridge off.
- On the native provider use `{model:entry,mode:'whole-model',directory:'/absolute/verified-model-directory'}`. Add `reversePromptBackend` under the model’s `wholeRuntime`, with the exact backend identity hash from the endorsed physical report. Start the enrolled provider when the operator is ready to serve.

Create a private circle config. File paths in this config resolve relative to its directory. Fleet-native paths must be absolute. Replace the uppercase placeholders with your own values.

~~~json
{
  "circleName": "Saturday Circle",
  "origin": "https://circle.example",
  "port": 4180,
  "hostDailyCap": 60,
  "database": "circle.sqlite",
  "providerId": "ENROLLED_PEER_ID",
  "backendIdentityHash": "MEASURED_BACKEND_IDENTITY_HASH",
  "fleetConfig": "requester.json",
  "calendarPublicKey": "calendar.pub",
  "signedCalendar": "calendar.signed.json",
  "qualifications": ["apple.signed.json", "amd.signed.json", "circle.signed.json"],
  "auth": {"projectUrl": "https://PROJECT.supabase.co", "publishableKey": "PUBLISHABLE_KEY"}
}
~~~

Start one server for the database. Issue a time-limited invitation from a second terminal. The issue command prints the revocation ID and the complete bearer link. Share it only with people who may play or pass it on. The browser reads the fragment and sends it as a same-origin request header. The public replay works without the invitation. A full host still serves recorded scores and links to the hosting guide.

~~~sh
npm run daily -- serve --config /private/circle.json
npm run daily -- issue --config /private/circle.json --expires "$EXPIRY_UTC"
npm run daily -- revoke --config /private/circle.json --id "$INVITE_ID"
~~~

Once qualified, the first submitted turn opens the requester. Discovery allows 20 seconds to locate the enrolled provider. Each turn has a 60-second HTTP deadline. Private signed receipts and attempt records stay in the circle’s SQLite database. Keep the database private and persistent, including its salt. A new database starts a new circle history.

## Isolated public and private circles on one GPU

An operator can serve two ranked circles together. Prepare a second config with its own origin, loopback port, score database, and access directory. Both configs must select the exact same fleet requester file, provider identity and backend digest. Each has its own passkeys, board, receipts and daily budget. Set `sharedHostDailyCap` to the same finite number in both files to limit their combined daily workload. Otherwise the combined limit is the sum of their individual caps. The public invitation allows twelve passkey ceremonies per minute without recording IP addresses. Both listeners share one requester identity and admit only one physical turn at a time. A second simultaneous request receives a busy response and keeps its try.

~~~sh
npm run daily -- serve --config /private/friends/circle.json --also /private/public/circle.json
~~~

Set `publicChallenge` to `true`, `auth.type` to `passkey`, and `bootstrapPlayers` to an empty array in the public config. Set its `origin` to the exact HTTPS address of the tunnel or reverse proxy and send that endpoint to the public loopback port. Keep the private circle on its original origin and separate port. Visitors register on the public origin. The private owner launcher and its three-turn allowance remain attached to the private circle. The databases persist across a coordinated restart; a new public hostname changes the WebAuthn relying party.

## Host the game files on a stable HTTPS origin

A phone opens the static site on its permanent hostname. The browser makes credentialed requests directly to the ranked API over HTTPS. The static site’s hostname is the passkey relying party and the address used in shared dares. In the public circle config, set the API `origin` and allow the exact frontend under `trustedFrontendOrigins`. Public sign-in requires `publicChallenge` and passkey authentication.

~~~json
{
  "origin": "https://api.example.org",
  "trustedFrontendOrigins": ["https://my-daily.example.workers.dev"],
  "publicChallenge": true,
  "auth": {"type": "passkey"}
}
~~~

Merge these fields into the ranked configuration described above. Confirm that a request to `/api/today` carrying the frontend’s `Origin` receives that exact value in `Access-Control-Allow-Origin` and `true` in `Access-Control-Allow-Credentials`. Use the same API origin when packaging the public files.

~~~sh
bundle=$(mktemp -d)
node scripts/package-daily-static.mjs --api-origin https://api.example.org \
  --out "$bundle/site" --name my-daily
npx --no-install wrangler deploy --dry-run --config "$bundle/site/wrangler.json"
~~~

The packager creates a new local directory. Its `public/` folder contains the game interface, styles, icon, public host guide and HTTP headers. The HTML and its content security policy both pin the API origin. The accompanying `wrangler.json` configures an assets-only Worker. With an authenticated deployment account and an unused Worker name, publish it using `npx --no-install wrangler deploy --config "$bundle/site/wrangler.json"`. For another static host, serve the contents of `public/` and apply the response headers in `_headers`. [Cloudflare static asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)

If the API tunnel address changes, check the replacement’s credentialed API response, package a fresh directory with the new `--api-origin`, and redeploy under the same Worker name. Players can refresh the page and use their existing passkeys on the stable frontend. Their API session may need a new sign-in.

## Review and measure

~~~sh
npm run daily -- review --config /private/circle.json
npm run daily -- approve --config /private/circle.json --id "$ATTEMPT_ID"
npm run daily -- reject --config /private/circle.json --id "$ATTEMPT_ID"
npm run daily -- stats --config /private/circle.json
~~~

Review returns yesterday’s consenting first-place prompts. Read them before approval. A signed-in author can withdraw a prompt from the next-day reveal. Stats count published dares, distinct dares opened, dares that led a different guest to play, players who returned, players active on consecutive UTC days, and distinct third players who submitted through a same-day chain of two dares. The owner also sees distinct guests who played through another person’s dare. For next-day retention, group guest-days by whether a reviewed prompt was available at the first accepted turn. Count a return only after the entire following UTC day has elapsed. Historical observations with unknown reveal availability stay in a separate group. These descriptive groups measure availability, not whether the person read a reveal or why they returned. The open count records each link once, without a visitor identifier. A page view alone cannot complete a three-player chain.

The Chrome acceptance journey runs against a local circle with a fixture identity and model. From the checkout run `node tests/fixtures/daily-browser.mjs` with Playwright Chromium installed, or set `PLAYWRIGHT_CHANNEL=chrome` for installed Chrome. The physical qualification tool exercises Doppler separately.
