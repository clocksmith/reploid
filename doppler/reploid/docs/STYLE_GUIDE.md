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

*Last updated: December 2025*
