# Poolday Artifact Manifest

Poolday treats a model as a content-addressed package, not as a trusted URL.

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

*Last updated: June 2026*
