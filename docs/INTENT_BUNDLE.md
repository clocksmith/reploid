# Intent Bundle Specification

This document defines the IntentBundle format used to verify and gate
agent-driven changes to kernels, configs, and model weights. It is designed
to be signed, portable, and independently reproducible.

See also: `../doppler/docs/AGENT_INTENT_BUNDLE.md`

## Goals

- Make every behavioral change auditable and reproducible.
- Bind changes to deterministic test proofs (parity reports).
- Provide a single deployable unit that can be verified by peers.

## Format Summary

An IntentBundle packages:
- Metadata (who, when, version).
- Targets (models, kernels, LoRAs, runtime config).
- Proofs (parity reports, test vectors, metrics).
- Signatures (author + optional peer attestations).

## JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://ouroboros.dev/schemas/intent-bundle.json",
  "title": "IntentBundle",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "bundleId",
    "createdAt",
    "author",
    "foundation",
    "constraints",
    "payload",
    "targets",
    "proofs",
    "signatures",
    "state"
  ],
  "properties": {
    "bundleId": { "type": "string", "minLength": 8 },
    "createdAt": { "type": "string", "format": "date-time" },
    "foundation": {
      "type": "object",
      "required": ["baseModelHash", "kernelRegistryVersion", "vfsGenesisId"],
      "additionalProperties": false,
      "properties": {
        "baseModelHash": { "type": "string" },
        "kernelRegistryVersion": { "type": "string" },
        "vfsGenesisId": { "type": "string" }
      }
    },
    "constraints": {
      "type": "object",
      "required": ["parityTolerance", "enforceDeterministicOutput", "maxDriftThreshold"],
      "additionalProperties": false,
      "properties": {
        "parityTolerance": { "type": "number" },
        "enforceDeterministicOutput": { "type": "boolean" },
        "maxDriftThreshold": { "type": "number" }
      }
    },
    "payload": {
      "type": "object",
      "required": ["instructions"],
      "additionalProperties": false,
      "properties": {
        "instructions": { "type": "string" },
        "loraAdapter": { "type": "string" },
        "kernelPatch": { "type": "string" },
        "expectedOutputHash": { "type": "string" },
        "expectedTopK": {
          "type": "array",
          "items": { "type": "number" }
        }
      }
    },
    "author": {
      "type": "object",
      "required": ["id", "publicKey"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string" },
        "publicKey": { "type": "string" },
        "displayName": { "type": "string" }
      }
    },
    "targets": {
      "type": "object",
      "required": ["model", "runtime", "kernels"],
      "additionalProperties": false,
      "properties": {
        "model": {
          "type": "object",
          "required": ["modelId", "format", "manifestHash"],
          "additionalProperties": false,
          "properties": {
            "modelId": { "type": "string" },
            "format": { "type": "string", "enum": ["gguf", "rdrr"] },
            "manifestHash": { "type": "string" },
            "weightsHash": { "type": "string" }
          }
        },
        "runtime": {
          "type": "object",
          "required": ["configHash"],
          "additionalProperties": false,
          "properties": {
            "configHash": { "type": "string" },
            "configSource": { "type": "string" }
          }
        },
        "kernels": {
          "type": "object",
          "required": ["manifestHash"],
          "additionalProperties": false,
          "properties": {
            "manifestHash": { "type": "string" },
            "allowlist": {
              "type": "array",
              "items": { "type": "string" }
            }
          }
        },
        "loras": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["loraId", "hash"],
            "additionalProperties": false,
            "properties": {
              "loraId": { "type": "string" },
              "hash": { "type": "string" },
              "adapterScale": { "type": "number" }
            }
          }
        }
      }
    },
    "proofs": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["proofId", "type", "status", "hashes"],
        "additionalProperties": false,
        "properties": {
          "proofId": { "type": "string" },
          "type": { "type": "string", "enum": ["parity", "benchmark", "unit", "coherence"] },
          "status": { "type": "string", "enum": ["pass", "fail"] },
          "hashes": {
            "type": "object",
            "required": ["inputsHash", "outputsHash"],
            "additionalProperties": false,
            "properties": {
              "inputsHash": { "type": "string" },
              "outputsHash": { "type": "string" },
              "referenceHash": { "type": "string" }
            }
          },
          "metrics": {
            "type": "object",
            "additionalProperties": true
          }
        }
      }
    },
    "signatures": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["signerId", "signature", "role"],
        "additionalProperties": false,
        "properties": {
          "signerId": { "type": "string" },
          "signature": { "type": "string" },
          "role": { "type": "string", "enum": ["author", "peer", "reviewer"] },
          "publicKey": { "type": "string" }
        }
      }
    },
    "state": {
      "type": "string",
      "enum": ["AWAKEN", "EXECUTE", "EVOLVE", "REJECT"]
    }
  }
}
```

## Minimal Example

```json
{
  "bundleId": "intent-2026-02-07-001",
  "createdAt": "2026-02-07T18:31:00Z",
  "author": {
    "id": "reploid.local",
    "publicKey": "ed25519:abc123",
    "displayName": "Reploid"
  },
  "foundation": {
    "baseModelHash": "sha256:base-model-manifest",
    "kernelRegistryVersion": "1.0",
    "vfsGenesisId": "genesis-2026-02-07"
  },
  "constraints": {
    "parityTolerance": 0.001,
    "enforceDeterministicOutput": false,
    "maxDriftThreshold": 0.05
  },
  "payload": {
    "instructions": "Apply LoRA adapter and validate parity on hidden tests",
    "loraAdapter": "/.system/lora.bin"
  },
  "targets": {
    "model": {
      "modelId": "gemma-2-2b-it-wf16",
      "format": "rdrr",
      "manifestHash": "sha256:deadbeef"
    },
    "runtime": {
      "configHash": "sha256:beadfeed",
      "configSource": "runtime-presets/default.json"
    },
    "kernels": {
      "manifestHash": "sha256:11223344",
      "allowlist": ["matmul", "attention", "moe_gather"]
    },
    "loras": [
      { "loraId": "math-adapter-v2", "hash": "sha256:cafef00d", "adapterScale": 0.75 }
    ]
  },
  "proofs": [
    {
      "proofId": "parity-001",
      "type": "parity",
      "status": "pass",
      "hashes": {
        "inputsHash": "sha256:1111",
        "outputsHash": "sha256:2222",
        "referenceHash": "sha256:3333"
      },
      "metrics": { "maxAbsError": 0.0025 }
    }
  ],
  "signatures": [
    {
      "signerId": "reploid.local",
      "signature": "ed25519:abcd",
      "role": "author",
      "publicKey": "ed25519:abc123"
    }
  ],
  "state": "AWAKEN"
}
```

## Integration Notes

- IntentBundle should be stored alongside kernel and runtime manifests in the VFS.
- Doppler kernel loader should refuse unsigned bundles or missing parity proofs.
- Reploid should record bundle IDs in evolution logs and rollback metadata.
