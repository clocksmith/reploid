# REPLOID Style Guide

## Monochrome/Terminal Symbol Mapping

Use these Unicode symbols instead of emojis throughout the codebase for a consistent terminal aesthetic.

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

1. **No emoji in source code** - Use Unicode symbols from this guide
2. **No emoji in documentation** - Use symbols or plain text
3. **No emoji in blueprints** - Keep technical documents clean
4. **Consistency** - Use the same symbol for the same concept throughout

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

### Example Documentation Style

```markdown
## Feature Name

Brief description of what this does.

### Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| enabled | boolean | true | Enable the feature |
| timeout | number | 30000 | Timeout in milliseconds |

### Usage

\`\`\`javascript
const result = doThing(options);
\`\`\`

### Notes

- Note one
- Note two
```

---

## Code Examples

```javascript
// Toast notifications
const TOAST_TYPES = {
  success: { icon: '★' },
  error: { icon: '☒' },
  warning: { icon: '☡' },
  info: { icon: '☛' }
};

// File type icons
const fileIcons = {
  'js': 'ƒ',
  'json': '☷',
  'md': '☐',
  'css': '☲'
};

// Operation indicators
console.log('★ Build complete');
console.log('☒ Test failed');
console.log('☡ Deprecated API');
```

---

## Poolday design system

Poolday extends `self/styles/rd.css`. Keep Zero and X independent. The ordered
manifest in `self/styles/poolday/layers.json` owns the stylesheet list. Both
`self/pool-entry.html` and the synchronous fallback loader in `self/index.html`
mirror it so browsers fetch styles in parallel without CSS imports. The CSS
verifier rejects missing modules or entry lists that drift from the manifest.

| Layer | Ownership |
|-------|-----------|
| `tokens.css` | Raw colors, dimensions, shadows, gradients and motion values |
| `primitives.css` | Semantic surface, spacing, typography and motion variables; light/dark mapping |
| `components/materials.css` | Shared surfaces, buttons, inputs and interaction states |
| `components/conversation.css` | Conversation layout and local component states |
| `components/optical.css` | Composable glass and state-driven light effects |
| `components.css` | Existing navigation, work, network and other route layouts |

Compose material classes with local layout classes. Do not copy border, shadow,
background and focus recipes into individual components. Existing work selectors
alias the shared materials so older views use the same recipe. New markup uses
the explicit classes. Keep component values semantic (`--pool-surface-*`,
`--pool-space-*`, etc.); component-local parameters use `--pool-param-*`.

| Class | Contract |
|-------|----------|
| `pool-surface` | Opaque raised panel; component owns padding and layout |
| `pool-button` | Shared control, 44px minimum height, hover/pressed/focus states; `btn-primary` inverts contrast |
| `pool-focus-within` | Focus ring for a label wrapping a native control |
| `pool-input` | Inset field material and keyboard focus; component owns dimensions |
| `pool-glass` | Restrained prismatic fill and edge |
| `pool-glass-focus` | Applies glass only while focused |
| `pool-glass-selected` | Applies glass when `aria-current="page"` or `aria-pressed="true"` |
| `pool-activity-edge` | Noninteractive light on a positioned wrapper; `data-activity` selects its state |

```html
<section class="chat-conversation-area pool-surface">
  <div class="chat-composer-field pool-activity-edge" data-activity="idle">
    <textarea class="pool-input pool-glass-focus" aria-label="Message"></textarea>
  </div>
  <button class="pool-button btn-primary" type="submit">Send</button>
</section>
```

Large reading surfaces stay opaque. Glass accents belong on selected navigation,
model choice and composer focus. `ready` gives one brief glint; `executing` moves
only while the selected thread is actually executing. Queuing, loading, approval,
cancellation and completion are idle. These attributes project host state; they
never start execution or grant permission. Text remains the authoritative status.
Reduced motion removes animation, and forced colors preserves control outlines.

Run `npm run verify:pool:css` after changing any layer. It checks all manifest
modules, variable ownership, undefined references and both entry paths. Browser
coverage in `tests/e2e/chat-material.spec.js` checks themes, narrow layouts, focus
and activity states using explicit presentation fixtures.

*Last updated: October 2026*
