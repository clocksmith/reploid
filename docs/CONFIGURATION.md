# Configuration Reference

All configurable settings exposed in the boot UI and their corresponding localStorage keys.

---

## Boot UI: Advanced Options

Expand "Advanced options" in the boot UI to access these settings.

Primary `/` Reploid keeps boot minimal:
- Access code input for the provisioned browser-cloud path
- `Configure` toggle for BYOK direct inference
- `Swarm` toggle for provider or consumer launch

Zero and X keep the broader research configuration surface.

### Runtime Mode

| Setting | localStorage Key | Values | Default |
|---------|------------------|--------|---------|
| Boot Mode | `REPLOID_MODE` | `reploid`, `zero`, `x` | `reploid` |
| Genesis Level | `REPLOID_GENESIS_LEVEL` | `full`, `substrate`, `cognition`, `reflection`, `spark`, `capsule`, `tabula` | `capsule` |
| Module Overrides | `REPLOID_MODULE_OVERRIDES` | JSON map of module id to `on` or `off` | `{}` |

### Safety & Approval

Settings stored in `REPLOID_HITL_CONFIG` as JSON object.

| Setting | localStorage Key | Values | Default |
|---------|------------------|--------|---------|
| Security enforcement | `REPLOID_SECURITY_MODE` | `'on'`, `'off'` | `'off'` |
| HITL approval | `approvalMode` | `autonomous`, `hitl`, `every_n` | `autonomous` |
| HITL cadence | `everyNSteps` | `1` - `100` | `5` |

### Execution Limits

| Setting | localStorage Key | Values | Default |
|---------|------------------|--------|---------|
| Max iterations | `REPLOID_MAX_ITERATIONS` | `0` (unlimited) or positive integer | `25` |
| Approval interval | `REPLOID_APPROVAL_INTERVAL` | `0` (never) or positive integer | `0` |

### Data

| Setting | localStorage Key | Values | Default |
|---------|------------------|--------|---------|
| Fresh Genesis | `REPLOID_RESET_ALL` | `'true'`, `'false'` | `'true'` |
| Preserve VFS on boot | `REPLOID_PRESERVE_ON_BOOT` | `'true'`, `'false'` | `'false'` |

### Goal

| Setting | localStorage Key | Values | Default |
|---------|------------------|--------|---------|
| Goal | `REPLOID_GOAL` | Free text | `''` |
| Include bootstrapper within self | `REPLOID_INCLUDE_BOOTSTRAPPER_WITHIN_SELF` | `'true'`, `'false'` | `'false'` |
| Use your own inference on `/` | `REPLOID_USE_OWN_INFERENCE` | `'true'`, `'false'` | `'false'` |

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
| API keys | `REPLOID_KEY_<PROVIDER>` | e.g., `REPLOID_KEY_GEMINI`, `REPLOID_KEY_OPENAI` |

---

## Security Settings

See [SECURITY.md](./SECURITY.md) for details.

| Setting | localStorage Key | Values | Default |
|---------|------------------|--------|---------|
| Arena gating | `REPLOID_ARENA_GATING` | `'true'`, `'false'` | `'false'` |

---

## Programmatic Access

### From Boot UI (Global)

```javascript
// Read configs
window.getCognitionConfig()   // → { semantic, symbolic, minSimilarity, topK }
window.getGEPAConfig()        // → { populationSize, maxGenerations, ... }
window.getExecutionLimits()   // → { maxIterations, approvalInterval }
window.getReploidMode()       // → 'reploid' | 'zero' | 'x'
window.getGenesisLevel()      // → 'capsule' | 'spark' | 'tabula' | 'reflection' | 'cognition' | 'substrate' | 'full'
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
| `?swarm=true` | Enable swarm mode with the default room |
| `?swarm=<room>` | Enable swarm mode and join a specific room id |
| `?dopplerBase=<url>` | Override the Doppler asset base URL for browser-local models |

---

## Genesis Config (`config/genesis-levels.json`)

Settings used by boot seeding and module registration.

| Key | Purpose |
|-----|---------|
| `moduleFiles` | Module entry and auxiliary files used for module registration and lazy imports |
| `sharedFiles` | Always hydrated files (tools, UI, styles) |
| `levelFiles` | Level-specific file lists (tools/UI/styles per genesis level) |
| `levels` | Genesis level ladder and module grouping |

VFS hydration loads `config/vfs-manifest.json` at bootstrap and fetches all listed `src/` files into IndexedDB before boot. Set `REPLOID_PRESERVE_ON_BOOT` to `'true'` to keep existing VFS files and only fill missing paths.

---

## VFS Manifest (`config/vfs-manifest.json`)

List of all files under `src/` used for VFS hydration at bootstrap.

| Key | Purpose |
|-----|---------|
| `files` | Relative paths from `src/` to hydrate |

---

## Blueprint Registry (`config/blueprint-registry.json`)

Canonical map of runtime JavaScript files to blueprint documents.

| Key | Purpose |
|-----|---------|
| `features` | Blueprint entries with file lists |

---

## Module Registry (`config/module-registry.json`)

Derived map of runtime modules, dependencies, and genesis introduction levels.

| Key | Purpose |
|-----|---------|
| `modules` | Module metadata with dependency lists |

*Last updated: March 2026*
