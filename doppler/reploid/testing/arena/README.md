# Arena Testing Modules

**Genesis Level:** FULL only

This directory contains the Arena system for multi-model competition and consensus-based verification of high-risk self-modifications.

## Why FULL Level?

Arena testing is used for **RSI (Recursive Self-Improvement) safety gates**:
- Requires multiple LLM models for consensus
- Used to verify core/infrastructure changes before applying
- Optional for basic agent operation

## Modules

| Module | File | Description |
|--------|------|-------------|
| ArenaHarness | `arena-harness.js` | Orchestrates arena battles and runs |
| ArenaCompetitor | `competitor.js` | Agent competitor representation |
| ArenaMetrics | `arena-metrics.js` | Scoring and comparison metrics |
| VFSSandbox | `vfs-sandbox.js` | Snapshot/restore for test isolation |

## Architecture

```
Arena Flow:
1. VFSSandbox.createSnapshot()     # Save current VFS state
2. ArenaHarness.runBattle()        # Execute competing proposals
3. ArenaMetrics.score()            # Evaluate results
4. ArenaHarness.selectWinner()     # Consensus selection
5. VFSSandbox.restoreSnapshot()    # Rollback if needed
```

## Usage

Arena gating is controlled via `REPLOID_ARENA_GATING` in localStorage:
- Auto-enabled when 2+ models are configured
- Required for L2/L3 RSI operations (meta-tool and substrate changes)

```javascript
// Enable arena gating
localStorage.setItem('REPLOID_ARENA_GATING', 'true');

// Check if enabled
const enabled = ToolRunner.isArenaGatingEnabled();
```

## See Also

- [Blueprint 0x000075: Arena Competitor](../blueprints/0x000075-arena-competitor.md)
- [Blueprint 0x000076: Arena Metrics](../blueprints/0x000076-arena-metrics.md)
- [Blueprint 0x000077: Arena Harness](../blueprints/0x000077-arena-harness.md)
- [docs/SECURITY.md](../../docs/SECURITY.md)
