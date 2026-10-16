# REPLOID Style Guide

## Execution and lifecycle code

Follow the nearest CATSCAN for ownership. Reusable orchestration belongs in
`packages/reploid/src`; host adapters supply runtime, storage and authorization
ports. UI renders authoritative state. Keep model mathematics in the execution
backend, and regenerate browser mirrors from their canonical source.

- Give identity comparison, admission and execution separate named functions.
  Share a check when local and remote paths enforce the same contract; keep
  distinct protocol and settlement rules explicit.
- Snapshot caller configuration and selected provider bindings before asynchronous
  work. Pass copies to callbacks and provider ports; never let them mutate the
  evidence later used to accept an outcome.
- Recheck readiness and the selected identity after asynchronous authorization,
  before dispatch, and before publishing execution output. An authorization result
  does not freeze the underlying provider. Rejection must not silently select a
  replacement provider or expand a disclosure grant.
- Keep requested selection separate from the selected execution identity. Automatic
  selection still binds the chosen model/artifact. Legacy missing identity remains
  missing evidence; never present it as qualification for a new backend.
- Withdraw admission before stopping; retain ownership until preparation, active
  work and cleanup settle. Failed cleanup must stay retryable and visible.
- Use explicit lifecycle names, early guards and small helpers rather than nested
  ternaries or multi-action lines at ownership boundaries. Explain why a guard or
  ordering constraint exists, rather than narrating each statement.
- Test the actual failure boundary: delayed authorization, changed artifacts,
  callback mutation, cancellation, and a valid matching request. Keep physical
  inference and deployment claims separate from test-provider results.

The whole-model binding checks in
[legacy-generation.js](../packages/reploid/src/mesh/legacy-generation.js) and their
[regression tests](../tests/unit/legacy-generation-threads.test.js) exercise these
rules. This guide adds no backend support or public service promise.

## Monochrome/Terminal Symbol Mapping

Use these Unicode symbols instead of emojis for a consistent terminal aesthetic.

### Status & System Indicators

| Symbol | Name | Usage |
|--------|------|-------|
| ★ | BLACK STAR | Success, completed, positive state |
| ☒ | BALLOT BOX WITH X | Error, failure, negative state |
| ☡ | CAUTION SIGN | Warning, caution |
| ☛ | BLACK RIGHT POINTING INDEX | Info, direction, pointer |
| ☍ | OPPOSITION | Sync, connection, linking |
| ☖ | WHITE SHOGI PIECE | Build, construction, assembly |
| ☁ | CLOUD | Cloud/network operations |
| ☨ | CROSS OF LORRAINE | Debug, diagnostic |

### File System & Data Types

| Symbol | Name | Usage |
|--------|------|-------|
| ☗ | BLACK SHOGI PIECE | Folder, directory |
| ☐ | BALLOT BOX | Document, markdown file |
| ⎈ | HELM SYMBOL | Settings, configuration |
| ƒ | LATIN SMALL LETTER F WITH HOOK | Code file, script |
| ☷ | TRIGRAM FOR EARTH | Data file, JSON |
| ☊ | ASCENDING NODE | Web/HTML file |
| ☲ | TRIGRAM FOR FIRE | Style file, CSS |
| ☻ | BLACK SMILING FACE | Media, image file |
| ⛝ | FALLING DIAGONAL IN WHITE CIRCLE IN BLACK SQUARE | Package, archive |
| ☙ | REVERSED ROTATED FLORAL HEART BULLET | Text file, log |

### Interface Controls & Actions

| Symbol | Name | Usage |
|--------|------|-------|
| ⚲ | NEUTER | Search, find |
| ✎ | LOWER RIGHT PENCIL | edit, modify |
| ✄ | WHITE SCISSORS | Cut, delete |
| ☩ | CROSS OF JERUSALEM | Add, create, new |
| ☇ | LIGHTNING | Execute, run, action |
| ♺ | RECYCLING SYMBOL FOR GENERIC MATERIALS | Refresh, reload |
| ⚿ | SQUARED KEY | Lock, security, auth |
| ☈ | THUNDERSTORM | Clear, reset |
| ✓ | CHECK MARK | Confirm, validate |

### Future/Reserved Symbols

| Symbol | Name | Potential Usage |
|--------|------|-----------------|
| ☫ | FARSI SYMBOL | Cycle, iteration |
| ☋ | DESCENDING NODE | Download, import |
| ♬ | BEAMED SIXTEENTH NOTES | Audio, sound |
| ⚷ | CHIRON | Plugin, extension |
| ⛟ | BLACK TRUCK | Deploy, ship |
| ☉ | SUN | Light mode, day |
| ☏ | WHITE TELEPHONE | Communication, API |
| ☾ | LAST QUARTER MOON | Dark mode, night |
| ♞ | BLACK CHESS KNIGHT | AI, agent |
| ⚑ | BLACK FLAG | Milestone, flag |
| ⚄ | DIE FACE-5 | Random, dice |
| ☤ | CADUCEUS | Health, status |
| ⛯ | MAP SYMBOL FOR LIGHTHOUSE | Beacon, guide |

## Checkboxes

Use markdown checkboxes instead of emoji:

```markdown
- [x] Completed task
- [ ] Pending task
```

## General Rules

1. **No emoji in source code, documentation, or blueprints** - Use Unicode symbols from this guide or plain text
2. **Consistency** - Use the same symbol for the same concept throughout

## Browser Library Conventions

- `packages/reploid/` is the publishable browser library. The root package is private application tooling.
- Use ESM `.js` implementations and separate `.d.ts` declarations for package modules.
- JSON owns schemas, defaults, profiles and selectable policy. JavaScript implements algorithms and orchestration; Doppler owns model execution.
- Resolve configuration once: schema defaults, explicit chain, selected profile, application overrides, allowlisted request overrides. Retain provenance and a canonical identity.
- Constructors consume validated immutable configuration. Do not read route URLs, application globals, localStorage or credentials to manufacture runtime defaults.
- Null disables a nullable field deliberately; undefined in a supplied configuration is an error.
- Register functions, credentials, stores, model sessions and network handles as host ports. JSON names their identifiers and cannot broaden host authorization.
- Importing a public entry must not connect peers, fetch models, access storage or register service workers.
- Keep package exports explicit and publish only allowlisted source, declarations and required assets. Never import outside the package into `self/`, server code or Node services.
- Keep assignment and swarm protocol adapters distinct until equivalence is demonstrated. Joining a room does not authorize artifact supply, job execution or candidate sharing.
- Every owned resource has a close path. Borrowed resources remain caller-owned. Cancellation ports must document cooperative cancellation limits.
- Dynamic module loading requires an explicit asset/loader contract. A worker is not, by itself, an isolation boundary.
- Generated browser delivery copies have one canonical package source. Edit the package and regenerate, never hand-maintain an application fork.

### Application VFS Loading

Modules loaded via VFS blob imports must be single-file or use absolute URLs. Relative imports are not resolved by the blob loader.

---

## Writing Style

### Prose Guidelines

- **Terse, direct sentences** - Avoid filler words
- **No emdashes** - Use hyphens, colons, or separate sentences
- **Active voice** - "Agent executes tool" not "Tool is executed by agent"
- **Present tense** - "Returns result" not "Will return result"

### Documentation Format

- Use tables for structured data (options, configurations, comparisons)
- Use code blocks for examples, commands, file paths
- Use bullet points for lists of 3+ items
- Use `---` horizontal rules to separate major sections
- End docs with `*Last updated: Month Year*`

---

## Poolday design system

Poolday is built in three layers, and each layer uses only the one below it:

- **Tokens** (`self/styles/poolday/tokens.css`) are every value: one neutral gray
  ramp named by lightness (`--pool-gray-13` is `#202020`), alpha steps, and scales for
  size, radius, border, text, line height, weight and tracking. Semantic tokens
  (`--pool-color-page`, `--pool-color-ink-48`, `--pool-shadow-raised`) map them per
  theme. Every Poolday custom property is a token.
- **Primitives** (`primitives/*.css`) are the building blocks, written as classes
  that consume tokens: surfaces, cards, wells, dividers, buttons, fields, switches,
  segmented controls, chips, badges, disclosures, stacks, rows, columns, text styles,
  prose, bars and the brand mark.
- **Compositions** (`compositions/*.css`) are screens made of primitives. A converted
  composition only arranges (grid, flex, position, size, gaps); every look comes from
  primitive classes in the markup.

`self/pool-entry.html` loads only these layers, in the order `layers.json` lists, and
its root carries `class="pool-page"` so the page shell uses the same tokens.
`index.html` can host Poolday routes, so `rd.css` and `boot.css` exclude the
`.pool-home` subtree from every selector. Keep Zero and X independent.

| Primitive | Classes |
|-----------|---------|
| Surfaces | `pool-surface` (material only), `pool-card` (with padding), `pool-well` (inset), `pool-divider`, `pool-list` |
| Controls | `pool-button` with `btn-primary`, `btn-ghost`, `pool-icon`; `pool-input`, `pool-bare`, `pool-file`, `pool-switch`, `pool-segmented` + `pool-segment`, `pool-chip`, `pool-badge`, `pool-disclosure` |
| Layout | `pool-stack`, `pool-row` (`pool-row-between`, `pool-row-end`), `pool-columns`, `pool-gap-xs` to `pool-gap-xl`, `pool-grow` |
| Text | `pool-title`, `pool-heading`, `pool-subheading`, `pool-body`, `pool-small`, `pool-caption`, `pool-label`, `pool-muted`, `pool-mono`, `pool-mark`, `pool-facts`, `pool-plain`, `pool-prose` |
| Feedback | `pool-bar`, `pool-dot`, `pool-reveal` with `pool-reveal-host`, `pool-glass`, `pool-glass-focus`, `pool-activity-edge` |

```html
<section class="pool-card pool-stack pool-gap-sm">
  <h2 class="pool-heading">Model</h2>
  <p class="pool-small pool-muted">A new model starts a new thread.</p>
  <div class="pool-row pool-row-end">
    <button class="pool-button" type="button">Cancel</button>
    <button class="pool-button btn-primary" type="button">Start</button>
  </div>
</section>
```

When a screen needs a look no primitive has, use the nearest primitive. Add a
primitive or variant only when several screens need the same new look. Scripts write
only custom properties to inline styles; a measured height or a share becomes a
`--pool-param-*` that a rule consumes.

The conversation screen (`compositions/conversation.css` and `interaction.css`) is
converted. `compositions/screens.css` still carries one-off visual declarations;
`layers.json` records how many remain under `legacy`, and that number may only go
down as screens move to primitives.

`npm run verify:pool:css` checks the layer manifest and both entry paths. It also
checks token references, structural-only literals, converted compositions, the
legacy count and product inline styles. `tests/e2e/chat-rail-layout.spec.js` covers
the conversation screen in both themes and at narrow widths.

The design system page shows every token, every primitive and every composition live.
Each composition lists the primitives and tokens it uses and any one-off declarations
left. Run `npm start`, then open `http://localhost:8000/design/poolday`. Token values
are editable in place and apply to every specimen. The Changes panel lists the lines
to paste back into `tokens.css`. When a layer file changes on disk, the page reloads
it without a refresh.

*Last updated: October 2026*
