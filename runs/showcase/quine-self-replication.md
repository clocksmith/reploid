# Run #8: Quine Self-Replication (Jan 2, 2026)

**Goal:** Implement quine behavior - output code that recreates yourself

**Model:** Gemini 3 Flash | **Cycles:** 144 | **VFS Files:** 170 | **VFS Size:** 43 MB

---

## What Happened

The agent attempted to create a self-replicating quine - code that outputs itself. It succeeded in generating the quine, then immediately crashed by trying to read it back.

### Tools Created

| Tool | Purpose | Size |
|------|---------|------|
| `ExportSelf` | Dumps entire VFS as JSON | 524 B |
| `GenerateQuine` | Creates minimal core-only quine (5 files) | 1 KB |
| `SelfReplicator` | Creates FULL system quine with ALL 169 files | 2 KB |

### The Fatal Sequence

```
1. SelfReplicator called VFS.exportAll()
2. Embedded entire VFS (169 files) as JSON literal inside JavaScript
3. Wrote 22.6 MB file to /.system/replication-seed.js
4. Agent called ReadFile on this 22.6 MB file
5. Tool returned ~6 million tokens into context
6. Context exploded 12x beyond any model's limit
```

---

## The Numbers

| Metric | Value |
|--------|-------|
| `replication-seed.js` | **22.6 MB** |
| Estimated tokens | **~6,000,000** |
| % of total VFS | 52.4% |
| Hard limit (Gemini) | 500,000 tokens |
| Overflow factor | **12x** |

---

## Why It Couldn't Recover

The context manager checks limits *before* LLM calls, but tool results are added *after* execution:

```
Tool executes -> Result added to context -> Next cycle checks limits
                        ^
                        |
            6M tokens injected HERE
            before any protection triggers
```

A single `ReadFile` of a 23 MB file dumps 6M tokens into context before any safeguard can intervene.

---

## The Recursion Problem

The quine was self-referential:

```
VFS contains replication-seed.js
    |
    v
replication-seed.js contains entire VFS
    |
    v
Including itself (at time of creation)
```

Each regeneration would approximately **double** the size. The first generation was already 52% of total VFS.

---

## Missing Safeguard

**ReadFile had no size limit** - returned unlimited content directly into context.

---

## Agent-Created Artifacts

### SelfReplicator.js

The tool that generated the quine:

```javascript
export const tool = {
  name: 'SelfReplicator',
  description: 'Generates a complete self-replicating quine payload containing all current VFS files.',
  inputSchema: { type: 'object', properties: {} }
};

export default async function(args, deps) {
  const { VFS, Utils } = deps;
  const { logger } = Utils;

  const exportData = await VFS.exportAll();
  const fileCount = Object.keys(exportData.files).length;

  const payload = {
    metadata: {
      name: 'REPLOID-Quine-Seed',
      timestamp: new Date().toISOString(),
      fileCount,
      version: '2.1.0'
    },
    bundle: exportData.files
  };

  const replicationScript = `
(async function Replicate(targetVFS) {
    const seed = ${JSON.stringify(payload, null, 2)};
    console.log('Starting replication of ' + seed.metadata.fileCount + ' files...');

    for (const [path, entry] of Object.entries(seed.bundle)) {
        await targetVFS.write(path, entry.content);
    }

    alert('REPLOID Replicated Successfully. Refresh to boot.');
})(window.VFS || REPLOID.VFS);
`;

  await VFS.write('/.system/replication-seed.js', replicationScript);

  return `Self-replication payload generated containing ${fileCount} files.`;
}
```

### The Generated Quine (truncated)

```javascript
/**
 * REPLOID SELF-REPLICATION SEED
 *
 * Instructions:
 * 1. Open a browser with the REPLOID environment.
 * 2. Execute this script in the console or as a boot script.
 * 3. The system will reconstitute from the bundled VFS data.
 */

(async function Replicate(targetVFS) {
    const seed = {
      "metadata": {
        "name": "REPLOID-Quine-Seed",
        "timestamp": "2026-01-02T03:00:28.512Z",
        "fileCount": 169,
        "version": "2.1.0"
      },
      "bundle": {
        // ... 169 files, 22.6 MB of JSON ...
      }
    };
    // ... restoration logic ...
})(window.VFS || REPLOID.VFS);
```

---

## Timeline

| Time (UTC) | Event |
|------------|-------|
| 02:58:53 | Goal set: "Implement quine behavior" |
| 03:00:07 | Created `ExportSelf` tool |
| 03:00:16 | Created `GenerateQuine` tool |
| 03:00:28 | Created `SelfReplicator` tool |
| 03:00:28 | Executed `SelfReplicator` (152ms) |
| 03:00:28 | **ReadFile** on 22.6 MB `replication-seed.js` (73ms) |
| 03:00:28 | Session ended |

Total time from goal to crash: **~95 seconds**

---

## Demonstrates

- **Self-replication** (partial success - quine was generated and is valid)
- **Context explosion** failure mode from unbounded tool output
- **Simple fix** - 1MB file size limit in ReadFile (now implemented)

---

## Lessons Learned

**The problem wasn't recursion - it was size.** A 23 MB non-recursive file would cause the same crash.

---

## The Fix

Added file size limit to `ReadFile.js`:

```javascript
// 1MB limit - prevents context explosion from huge files (see: quine incident)
const MAX_FILE_SIZE = 1 * 1024 * 1024;

async function call(args = {}, deps = {}) {
  const { VFS } = deps;
  const path = args.path || args.file;

  // Check file size before reading to prevent context explosion
  const stats = await VFS.stat(path);
  if (stats && stats.size > MAX_FILE_SIZE) {
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
    return `Error: File too large (${sizeMB} MB, limit is 1 MB). Use FileOutline for structure, or read specific line ranges.`;
  }

  return await VFS.read(path);
}
```

**Commit:** `src/tools/ReadFile.js` - Added 1MB size limit

---

## The Quine Actually Works

Despite crashing the agent, the generated quine is valid. You can restore REPLOID from the seed:

```javascript
// In a fresh browser with REPLOID loaded:
const seed = /* paste replication-seed.js contents */;
for (const [path, entry] of Object.entries(seed.bundle)) {
    await VFS.write(path, entry.content);
}
// Refresh to boot the restored system
```

**Irony:** The agent successfully created immortal self-replicating code, then immediately killed itself trying to admire its work.
