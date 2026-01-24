# Intent Bundle LoRA Workflow

This document describes how intent bundles gate LoRA adapter activation in Reploid.
It covers the approval flow, required files, and event hooks.

---

## Overview

IntentBundle LoRA applies a LoRA adapter defined in an intent bundle. The flow:

1) Load the bundle (`/.system/intent-bundle.json` by default).
2) Validate required bundle fields via IntentBundleGate.
3) Request approval (HITL when enabled).
4) Resolve the LoRA manifest path.
5) Optionally verify shard files exist in VFS.
6) Register the adapter and load it via LLMClient.

---

## Required Files

| File | Purpose |
| --- | --- |
| `/.system/intent-bundle.json` | Intent bundle payload and targets |
| `/config/lora-adapters/<id>.json` | LoRA adapter manifest |
| Shard paths referenced by manifest | Adapter weights |

---

## API Usage

Preferred entrypoint:

```javascript
const result = await IntentBundleLoRA.applyIntentBundle('/.system/intent-bundle.json', {
  registerAdapter: true,
  verifyAssets: true
});
```

Direct entrypoint:

```javascript
const result = await NeuralCompiler.applyIntentBundle('/.system/intent-bundle.json', {
  action: 'Approve LoRA bundle',
  timeout: 120000
});
```

---

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `registerAdapter` | boolean | `true` | Register adapter in NeuralCompiler registry |
| `verifyAssets` | boolean | `false` | Verify shard paths exist in VFS |
| `routingText` | string | - | Override routing text for adapter registration |
| `action` | string | - | HITL approval prompt label |
| `timeout` | number | `300000` | HITL approval timeout in ms |

---

## Status Codes

| Status | Meaning |
| --- | --- |
| `loaded` | Adapter loaded and active |
| `missing_assets` | Manifest or shards not found |
| `rejected` | Approval rejected |
| `failed` | Load failed after approval |
| `unavailable` | NeuralCompiler missing |

---

## Events and Audit

IntentBundleGate emits:

- `intent-bundle:requested`
- `intent-bundle:approved`
- `intent-bundle:rejected`

NeuralCompiler emits:

- `intent-bundle:lora:loaded`
- `intent-bundle:lora:missing`
- `intent-bundle:lora:rejected`
- `intent-bundle:lora:error`

Audit records are written by IntentBundleGate when AuditLogger is available.

---

## Notes

- Bundle validation enforces `foundation` and `constraints` fields.
- `verifyAssets` is optional and defaults to false to avoid blocking local flows.
- Missing assets return `stub: true` with a `missing_assets` status.

---

*Last updated: January 2026*
