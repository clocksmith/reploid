# Poolday Artifact Custody and Manifest

Poolday treats models and adapters as content-addressed packages, never as
trusted URLs. Doppler owns technical artifact identity. Reploid owns the
signed publication, entitlement, routing, revocation, and execution receipt.

## Storage Roles

| Store | Role | Identity pin |
|---|---|---|
| `Clocksmith/rdrr` on Hugging Face | Public or shared RDRR model packages | Full Hugging Face commit and SHA-256 package identity |
| Clocksmith adapter repositories on Hugging Face | Private custody and PEFT interoperability | Full Hugging Face commit, path, adapter SHA-256 |
| Private GCS bucket | Columbo and entitled Reploid delivery | Bucket, object, object generation, adapter SHA-256 |
| Browser OPFS | Verified local cache | Artifact SHA-256 only |

Hugging Face branch names such as `main` are discovery aliases, not artifact
identity. GCS object names without a generation are also mutable aliases.
Neither is valid in an AdapterPack.

## Package Shape

```text
manifest.json
tokenizer.json
shards/*
```

The manifest must bind:

- model id
- model hash
- manifest hash
- tokenizer hash
- shard paths
- shard hashes
- runtime compatibility metadata
- license metadata when available
- policy metadata when available

## Provider Startup

Provider startup must:

1. fetch the manifest
2. verify the manifest hash
3. fetch tokenizer files
4. verify tokenizer hashes
5. fetch shards
6. verify shard hashes
7. assemble the artifact
8. verify model identity
9. cache verified bytes in OPFS
10. advertise capability only after verification

The coordinator can provide artifact hints.
It is not the source of truth for artifact identity.

## Adapter Package Shape

```text
adapter_model.safetensors
adapter_config.json
source-training-manifest.json
training-export-receipt.json
runtime-adapter-manifest.json
```

`reploid.pool.adapter-pack/v2` binds the weight SHA-256 and size, LoRA rank,
alpha and target modules, the exact source checkpoint, the exact converted RDRR
base, evidence receipts, chunks, visibility, one primary origin, and optional
preservation mirrors. The exact RDRR base includes:

- model, manifest, tokenizer, and weight-pack hashes;
- source repository and immutable source revision;
- weight-pack and manifest-variant IDs; and
- conversion-config digest.

A model ID alone is insufficient adapter compatibility evidence.

## Origin Rules

Public artifacts may use a commit-pinned Hugging Face or generation-pinned GCS
primary origin. Private and entitled browser delivery uses GCS. The coordinator
issues an assignment-bound, short-lived V4 read URL for the exact signed object
generation. That URL is authorization material: it is never signed into the
pack, cached as artifact identity, advertised to peers, or stored in an
acquisition receipt.

Preservation mirrors are evidence and recovery locations. The runtime never
silently falls back from a failed primary origin to a mirror. A replacement
origin requires a new signed publication so operators and receipts can observe
the change.

## GCS Deployment Controls

Use a dedicated artifact bucket with uniform bucket-level access, public access
prevention, object versioning, retention appropriate to the campaign, and
service-account read permission only for the coordinator signer. Uploads must
use a create-only generation precondition, then record the returned generation
and checksums before publication. Enable coordinator delivery with:

```bash
REPLOID_ADAPTER_GCS_SIGNED_URLS=true
REPLOID_ADAPTER_SIGNED_URL_TTL_MS=300000
```

The signer rejects TTLs over 15 minutes and signs the exact object generation.
If GCS signing is requested but Firebase Admin storage cannot initialize, the
coordinator fails startup rather than exposing a different delivery path.

*Last updated: July 2026*
