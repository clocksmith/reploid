# Blueprint 0x00014e: DopplerOptimize Tool

**Objective:** Give the X agent a bounded interface to run and inspect Doppler runtime-profile searches.

**Target Upgrade:** tools/DopplerOptimize.js

**Affected Artifacts:** /tools/DopplerOptimize.js

---

### 1. Intent
Expose `run`, `status`, `list`, `cancel`, and `prepare-promotion`. The tool may stage a selected profile but cannot activate it.

### 2. Architecture
The tool delegates to `DopplerOptimizer`. It is present only on the X optimization surface. Activation stays behind the separate critical `Promote` tool and its HITL controller.

### 3. Implementation Notes
The input contract is explicit JSON. Unknown actions fail closed. `prepare-promotion` returns paths and hashes for review; it never writes the active pointer.

### 4. Verification Checklist
- [x] Tool is registered only on X
- [x] DopplerOptimizer dependency is injected through ToolRunner
- [x] Promote remains a distinct human-approved call

*Last updated: July 2026*
