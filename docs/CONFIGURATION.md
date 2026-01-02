# Configuration Reference

All configurable settings exposed in the boot page and their corresponding localStorage keys.

---

## Boot Page: Advanced Options

Expand "Advanced options" on the boot page to access these settings.

### Agent Configuration

| Setting | localStorage Key | Values | Default |
|---------|------------------|--------|---------|
| Persona | `REPLOID_PERSONA_ID` | `default`, `architect`, `explorer`, `debugger` | `default` |
| Genesis Level | `REPLOID_GENESIS_LEVEL` | `full`, `reflection`, `tabula` | `full` |
| Blueprint Path | `REPLOID_BLUEPRINT_PATH` | `none`, `reflection`, `full`, `beyond` | `none` |

### Execution Limits

| Setting | localStorage Key | Values | Default |
|---------|------------------|--------|---------|
| Max iterations | `REPLOID_MAX_ITERATIONS` | `0` (unlimited) or positive integer | `25` |
| Approval interval | `REPLOID_APPROVAL_INTERVAL` | `0` (never) or positive integer | `0` |

### Data

| Setting | localStorage Key | Values | Default |
|---------|------------------|--------|---------|
| Fresh Genesis | `REPLOID_RESET_ALL` | `'true'`, `'false'` | `'true'` |

### Cognition

Settings stored in `REPLOID_COGNITION_CONFIG` as JSON object.

| Setting | Config Key | Values | Default |
|---------|------------|--------|---------|
| Semantic Memory | `semantic` | `true`, `false` | `true` |
| Symbolic Reasoning | `symbolic` | `true`, `false` | `true` |
| Similarity threshold | `minSimilarity` | `0.0` - `1.0` | `0.5` |
| Top-K results | `topK` | `1` - `20` | `5` |

**Read via:** `window.getCognitionConfig()`

### GEPA Evolution

Settings stored in `REPLOID_GEPA_CONFIG` as JSON object.

| Setting | Config Key | Values | Default |
|---------|------------|--------|---------|
| Population size | `populationSize` | `2` - `20` | `6` |
| Max generations | `maxGenerations` | `1` - `50` | `5` |
| Mutation rate | `mutationRate` | `0.0` - `1.0` | `0.3` |
| Crossover rate | `crossoverRate` | `0.0` - `1.0` | `0.5` |
| Elite count | `eliteCount` | `1` - `populationSize` | `2` |
| Match mode | `matchMode` | `'exact'`, `'includes'` | `'exact'` |

**Read via:** `window.getGEPAConfig()`

### Swarm / P2P

| Setting | localStorage Key | Values | Default |
|---------|------------------|--------|---------|
| Enable P2P Swarm | `REPLOID_SWARM_ENABLED` | `'true'`, `'false'` | `'false'` |

---

## Model Configuration

Settings managed by the model selection UI.

| Setting | localStorage Key | Description |
|---------|------------------|-------------|
| Selected models | `SELECTED_MODELS` | JSON array of model configs |
| Consensus type | `CONSENSUS_TYPE` | `'arena'`, `'peer-review'` |
| Primary model | `SELECTED_MODEL` | Model ID of first selected model |
| Provider | `AI_PROVIDER` | Provider of primary model |
| API keys | `{PROVIDER}_API_KEY` | e.g., `GEMINI_API_KEY`, `OPENAI_API_KEY` |

---

## Security Settings

See [SECURITY.md](./SECURITY.md) for details.

| Setting | localStorage Key | Values | Default |
|---------|------------------|--------|---------|
| Arena gating | `REPLOID_ARENA_GATING` | `'true'`, `'false'` | `'false'` |
| HITL mode | `REPLOID_HITL_MODE` | `'AUTONOMOUS'`, `'EVERY_N'`, `'HITL'` | `'AUTONOMOUS'` |
| HITL interval | `REPLOID_HITL_N` | Positive integer | `5` |

---

## Programmatic Access

### From Boot Page (Global)

```javascript
// Read configs
window.getCognitionConfig()   // → { semantic, symbolic, minSimilarity, topK }
window.getGEPAConfig()        // → { populationSize, maxGenerations, ... }
window.getExecutionLimits()   // → { maxIterations, approvalInterval }
window.getGenesisLevel()      // → 'full' | 'reflection' | 'tabula'
window.getBlueprintPath()     // → 'none' | 'reflection' | 'full' | 'beyond'
```

### From Modules

Modules read config at factory initialization:

```javascript
// cognition-api.js, semantic-memory.js
const bootConfig = typeof window !== 'undefined' && window.getCognitionConfig
  ? window.getCognitionConfig()
  : {};

// gepa-optimizer.js
const bootConfig = typeof window !== 'undefined' && window.getGEPAConfig
  ? window.getGEPAConfig()
  : {};
```

---

## URL Parameters

Some settings can be set via URL:

| Parameter | Effect |
|-----------|--------|
| `?swarm=true` | Enable swarm mode |
| `?genesis=tabula` | Set genesis level |
| `?debug=true` | Enable debug logging |

---

## Genesis Config (`config/genesis-levels.json`)

Settings used by boot hydration and module registration.

| Key | Purpose |
|-----|---------|
| `moduleFiles` | Module entry and auxiliary files used for hydration and lazy imports |
| `sharedFiles` | Always hydrated files (tools, UI, styles) |

VFS hydration refreshes module and shared files from `src/` on each boot. Writes are skipped when content is byte-identical.

*Last updated: December 2025*
