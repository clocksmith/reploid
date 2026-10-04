# Curated session summaries

These five JSON files contain counts and SHA-256 digests of historical browser
exports. They omit conversation text, prompts, goals, activity payloads, internal
state, metadata, and complete virtual filesystems, including nested snapshots.
They are **not replayable exports**, and their counters do not establish success,
correctness, or independent evaluation.

The original bytes were preserved in a private local backup during curation.
Source digests identify those originals without publishing their contents. Git
history still contains the earlier public exports; this change does not purge it.

Run `npm run verify:showcase-privacy` before committing. The check rejects raw
exports and unknown fields. To curate a new local export, use
`node scripts/curate-showcase.js --sanitize /absolute/private/backup` after placing
it here; backups must be outside the repository. New raw exports are gitignored.
Review any prose excerpts separately before publication.
