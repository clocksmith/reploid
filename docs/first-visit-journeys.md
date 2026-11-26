# First-visit journeys

These four journeys are the owner's statement of what a first-time visitor to
[replo.id](https://replo.id) must be able to do. The owner calls them critical. The text of
each journey and of the acceptance line is the owner's and is kept unchanged; change it only
on the owner's word. The wider [journey catalogue](critical-user-journeys.md) describes every
outcome Reploid supports; these four are the bar for the public page.

## The journeys

1. **First visit → join the mesh.** When replo.id opens, the browser automatically joins the
   peer network and discovers available model storage and compute. No Join button or network
   setup. Joining lets the visitor use the mesh. It does not make their device a contributor.
2. **Join → ask → get an answer.** The visitor types and sends. Reploid picks defaults
   automatically using what the browser can detect or infer about the device and what's
   available on the mesh. The visitor can change the model or request settings, but neither is
   a prerequisite for sending. Do not infer a privacy preference or budget. The answer appears
   in the conversation, where the visitor can continue chatting.
3. **Use the mesh → contribute.** A visitor can find and start contribution from the same
   experience. They explicitly choose to offer model storage, compute, or both. The journey is
   complete when they can tell what their device is offering and whether it's available to the
   mesh.
4. **Inspect the mesh.** When curious or troubleshooting, a visitor can see which devices are
   ready and what each offers. This is optional; it never gates Ask.

**Acceptance:** A first-time visitor can open replo.id and get an answer without configuring
anything. If they want to contribute, they can find that path without leaving the experience
to figure out how the network works.

## Rules that follow from them

These are the owner's rulings on how the page applies the journeys. The code that implements
them is the conversation controller
([`apps/poolday/host/decisions/conversation-controller.js`](../apps/poolday/host/decisions/conversation-controller.js)).

- **The bar is type and send.** Between opening the page and the first answer the visitor
  presses Send once. No sheet, permission prompt, Join step, charge, budget or authorization
  step stands in between.
- **The page may choose the model; it must say which.** With no model picked by the visitor,
  any ready model may answer. The model shown before Send, the model named on the answer and
  the model that served it are the same model, and the shown default follows availability as
  computers come and go, without the visitor acting.
- **A pick is kept.** A model the visitor picked is never replaced for them. When nothing
  serves it, the page says so and sends to no other model. A pick stays a pick across a reload;
  a choice the page made is not remembered as one.
- **Before Send the composer states where the question goes and who can read it.** A visitor
  who chose nothing, on a device that stores no model, asks a public computer; the composer
  names that computer kind, the model and "The answering computer can read your prompt."
  With nobody to answer, nothing leaves the device.

## Checking them

- `npm run verify:public-answer -- --url <site> [--viewport mobile|desktop] [--follow-up]`
  ([`scripts/verify-public-answer.js`](../scripts/verify-public-answer.js)) walks the journeys in
  a fresh browser profile and prints what held and what did not. It sends one fixed public
  prompt to a public computer (two with `--follow-up`). It checks that one press produced the
  answer, that the composer, the answer row, the conversation and the stored execution record
  name one model, that a provider-signed receipt verifies when one was sent, and that the
  Computers view lists ready computers, shows where to contribute and shows this device as not
  sharing. It never starts a contribution. `npm run deploy` runs it after each deploy.
- [`tests/unit/first-answer-defaults.test.js`](../tests/unit/first-answer-defaults.test.js) holds
  the decisions behind journey 2: the automatic computer and model, following availability,
  a held Send while computers are being found, and kept picks.

A run of the check on one day shows that the journeys held for that browser, on that network,
with the computers then online. It is not a statement about capacity or reliability.
