# Configuration Reference

All configurable settings exposed in the boot page and their corresponding localStorage keys.

---

## Boot Page: Advanced Options

Expand "Advanced options" on the boot page to access these settings.

### Agent Configuration

| Setting | localStorage Key | Values | Default |
|---------|------------------|--------|---------|
| Persona | `REPLOID_PERSONA_ID` | `default`, `architect`, `explorer`, `debugger` | `default` |
| Genesis Level | `REPLOID_GENESIS_LEVEL` | `full`, `substrate`, `cognition`, `reflection`, `spark`, `tabula` | `full` |
| Blueprint Path | `REPLOID_BLUEPRINT_PATH` | `none`, `reflection`, `full`, `beyond` | `none` |
| Module Overrides | `REPLOID_MODULE_OVERRIDES` | JSON map of module id to `on` or `off` | `{}` |

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
window.getGenesisLevel()      // → 'full' | 'reflection' | 'spark' | 'tabula'
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
| `?genesis=spark` | Set genesis level |
| `?debug=true` | Enable debug logging |

---

## Genesis Config (`config/genesis-levels.json`)

Settings used by boot seeding and module registration.

| Key | Purpose |
|-----|---------|
| `moduleFiles` | Module entry and auxiliary files used for module registration and lazy imports |
| `sharedFiles` | Always hydrated files (tools, UI, styles) |
| `levels` | Genesis level ladder and module grouping |

VFS seeding loads `config/vfs-seed.json` at bootstrap and writes all `src/` files into IndexedDB before boot. Set `REPLOID_PRESERVE_ON_BOOT` to `'true'` to keep existing VFS files and only fill missing paths.

---

## VFS Manifest (`config/vfs-manifest.json`)

List of all files under `src/` used to generate the VFS seed bundle.

| Key | Purpose |
|-----|---------|
| `files` | Relative paths from `src/` to hydrate |

---

## VFS Seed Bundle (`config/vfs-seed.json`)

Single-file bundle containing the full contents of `src/` for VFS-first boot.

| Key | Purpose |
|-----|---------|
| `files` | Map of VFS path → file contents |
| `generatedAt` | Bundle generation timestamp |

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

*Last updated: December 2025*
