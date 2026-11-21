# Reploid Daily

A circle gets one target answer per UTC day. Write a prompt that gets its model to say the target without using the listed words. A winning player can send a dare such as “Got it in 12 words. Can you?” A recipient can watch the recorded result immediately and use the host’s invitation to take their own turn.

## Preview

Use the Reploid **source checkout** with its installed dependencies and Node 22.13 or later (SQLite). From the repository root run:

~~~sh
npm ci
npm run daily -- preview
~~~

Open the printed loopback address. The preview displays the rules and a staged target. Real ranked play requires the qualifications below. The server has its own origin, cookie and score database. The hosted chat site and ordinary chat permissions are independent.

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

## Review and measure

~~~sh
npm run daily -- review --config /private/circle.json
npm run daily -- approve --config /private/circle.json --id "$ATTEMPT_ID"
npm run daily -- reject --config /private/circle.json --id "$ATTEMPT_ID"
npm run daily -- stats --config /private/circle.json
~~~

Review returns yesterday’s consenting first-place prompts. Read them before approval. A signed-in author can withdraw a prompt from the next-day reveal. Stats count published dares, distinct dares opened, dares that led a different guest to play, players who returned, players active on consecutive UTC days, and distinct third players who submitted through a same-day chain of two dares. The owner also sees distinct guests who played through another person’s dare. For next-day retention, group guest-days by whether a reviewed prompt was available at the first accepted turn. Count a return only after the entire following UTC day has elapsed. Historical observations with unknown reveal availability stay in a separate group. These descriptive groups measure availability, not whether the person read a reveal or why they returned. The open count records each link once, without a visitor identifier. A page view alone cannot complete a three-player chain.

The Chrome acceptance journey runs against a local circle with a fixture identity and model. From the checkout run `node tests/fixtures/daily-browser.mjs` with Playwright Chromium installed, or set `PLAYWRIGHT_CHANNEL=chrome` for installed Chrome. The physical qualification tool exercises Doppler separately.
