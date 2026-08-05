# Blueprint deduplication audit

**Classification:** Index & Meta Contract

**Audit date:** 2026-08-05

## Result

- Numbered files scanned: **360**.
- Canonical numbered specifications retained: **176**.
- Exact generic module shells removed: **173**.
- Explicit overlapping specifications merged and removed: **11**.
- Final contiguous range: **`0x000000` through `0x0000AF`**.
- Index and meta contracts retained outside the numbered sequence: **9**.

The audit treated content—not byte size—as authority. A concise file remained canonical when it declared a unique protocol, invariant, failure boundary, or implementation contract. Files matching the generic module-template shell exactly were removed; their source modules remain represented in `self/config/module-inventory.json`.

## Explicit merges

| Removed specification | Canonical destination | Disposition |
| --- | --- | --- |
| `0x00007C-toast-notifications.md` | [`0x000028-toast-notification-system.md`](0x000028-toast-notification-system.md) | Interface and severity behavior were already present in the full toast contract; actual component and unit test now anchor status. |
| `0x00007D-diff-viewer-ui.md` | [`0x000048-diff-viewer-ui.md`](0x000048-diff-viewer-ui.md) | Event and operation summaries were already present; corrected canonical implementation path to `ui/components/diff-viewer-ui.js`. |
| `0x000088-agent-bridge.md` | [`0x000072-agent-bridge.md`](0x000072-agent-bridge.md) | Merged task delegation, shared-context, heartbeat, and JSON-RPC intent; rejected stale `/claude-bridge` and method names after source verification. |
| `0x000089-proxy-server.md` | [`0x000073-proxy-server.md`](0x000073-proxy-server.md) | Merged rate-limit, crash-protection, static-host, and WebSocket concerns; replaced stale endpoint inventory with current source routes. |
| `0x00008A-model-config-ui.md` | [`0x000074-model-config-ui.md`](0x000074-model-config-ui.md) | No unique architecture beyond the full model-configuration specification; retained as planned work because the declared directory does not exist. |
| `0x00008B-inline-chat.md` | [`0x000075-inline-chat.md`](0x000075-inline-chat.md) | UI and keyboard intent already covered; rejected stale `chat:inject`/`chat:clear` events in favor of implemented `human:message` and `agent:history` events. |
| `0x00008C-chat-panel.md` | [`0x000076-chat-panel.md`](0x000076-chat-panel.md) | No unique implementable contract beyond the comprehensive planned panel specification. |
| `0x00008D-code-panel.md` | [`0x000077-code-panel.md`](0x000077-code-panel.md) | No unique implementable contract beyond the comprehensive planned panel specification. |
| `0x00008E-llm-config-panel.md` | [`0x000078-llm-config-panel.md`](0x000078-llm-config-panel.md) | No unique implementable contract beyond the comprehensive planned panel specification. |
| `0x00008F-python-repl-panel.md` | [`0x000079-python-repl-panel.md`](0x000079-python-repl-panel.md) | Compact execution, package, VFS sync, event, and shortcut requirements were already present in the full planned REPL specification. |
| `0x0000ee-experimental-intelligence-neural-compiler.md` | [`0x00007C-hot-swappable-neural-compiler.md`](0x00007C-hot-swappable-neural-compiler.md) | Merged trained-adapter Shadow staging, evidence verification, mandatory human promotion, rejection, and activation invariants into the neural-compiler specification. |

## Removed generic module shells

| Removed shell | Target module/artifact | Replacement authority |
| --- | --- | --- |
| `0x000090-boot.md` | `entry/start-app.js` | [`0x000002-application-orchestration.md`](0x000002-application-orchestration.md) plus module inventory |
| `0x000091-boot-config.md` | `boot-helpers/config.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000092-boot-error-ui.md` | `boot-helpers/error-ui.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000093-boot-index.md` | `boot-helpers/index.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000094-boot-modules.md` | `boot-helpers/modules.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000095-boot-services.md` | `boot-helpers/services.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000096-boot-vfs-hydrate.md` | `boot-helpers/vfs-hydrate.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000097-capabilities-cognition-episodic-memory.md` | `capabilities/cognition/episodic-memory.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000098-capabilities-cognition-hybrid-retrieval.md` | `capabilities/cognition/hybrid-retrieval.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000099-capabilities-cognition-index.md` | `capabilities/cognition/index.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00009a-capabilities-cognition-prompt-memory.md` | `capabilities/cognition/prompt-memory.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00009b-capabilities-communication-consensus.md` | `capabilities/communication/consensus.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00009c-capabilities-communication-swarm-sync.md` | `capabilities/communication/swarm-sync.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00009d-capabilities-communication-swarm-transport.md` | `capabilities/communication/swarm-transport.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00009e-capabilities-intelligence-federated-learning.md` | `capabilities/intelligence/federated-learning.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000a0-capabilities-intelligence-multi-model-coordinator.md` | `capabilities/intelligence/multi-model-coordinator.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000a1-capabilities-reflection-prompt-score-map.md` | `capabilities/reflection/prompt-score-map.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000a2-core-async-utils.md` | `core/async-utils.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000a3-core-schema-validator.md` | `core/schema-validator.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000a4-core-worker-agent.md` | `core/worker-agent.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000a5-infrastructure-policy-engine.md` | `infrastructure/policy-engine.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000a6-infrastructure-trace-store.md` | `infrastructure/trace-store.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000a7-sw-module-loader.md` | `sw-module-loader.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000a8-testing-arena-doppler-integration.md` | `testing/arena/doppler-integration.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000a9-testing-arena-index.md` | `testing/arena/index.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000aa-tools-awaitworkers.md` | `tools/AwaitWorkers.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000ab-tools-copyfile.md` | `tools/CopyFile.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000ac-tools-deletefile.md` | `tools/DeleteFile.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000ad-tools-edit-file.md` | `tools/EditFile.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000ae-tools-fileoutline.md` | `tools/FileOutline.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000af-tools-find.md` | `tools/Find.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000b0-tools-git.md` | `tools/git.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000b1-tools-grep.md` | `tools/Grep.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000b2-tools-head.md` | `tools/Head.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000b3-tools-listfiles.md` | `tools/ListFiles.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000b4-tools-listknowledge.md` | `tools/ListKnowledge.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000b5-tools-listmemories.md` | `tools/ListMemories.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000b6-tools-listtools.md` | `tools/ListTools.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000b7-tools-listworkers.md` | `tools/ListWorkers.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000b8-tools-loadmodule.md` | `tools/LoadModule.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000ba-tools-makedirectory.md` | `tools/MakeDirectory.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000bb-tools-movefile.md` | `tools/MoveFile.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000bc-tools-readfile.md` | `tools/ReadFile.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000be-tools-rungepa.md` | `tools/RunGEPA.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000bf-tools-spawnworker.md` | `tools/SpawnWorker.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000c0-tools-swarmgetstatus.md` | `tools/SwarmGetStatus.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000c1-tools-swarmlistpeers.md` | `tools/SwarmListPeers.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000c2-tools-swarmrequestfile.md` | `tools/SwarmRequestFile.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000c3-tools-swarmsharefile.md` | `tools/SwarmShareFile.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000c4-tools-tail.md` | `tools/Tail.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000c5-tools-writefile.md` | `tools/WriteFile.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000c6-tools-python-pyodide-worker.md` | `tools/python/pyodide-worker.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000c7-ui-boot-detection.md` | `ui/boot-wizard/detection.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000c8-ui-boot-goals.md` | `ui/boot-wizard/goals.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000c9-ui-boot-index.md` | `ui/boot-wizard/index.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000ca-ui-boot-state.md` | `ui/boot-wizard/state.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000cb-ui-boot-steps-awaken.md` | `ui/boot-wizard/steps/awaken.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000cc-ui-boot-steps-browser.md` | `ui/boot-wizard/steps/browser.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000cd-ui-boot-steps-choose.md` | `ui/boot-wizard/steps/choose.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000ce-ui-boot-steps-detect.md` | `ui/boot-wizard/steps/detect.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000cf-ui-boot-steps-direct.md` | `ui/boot-wizard/steps/direct.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000d0-ui-boot-steps-goal.md` | `ui/boot-wizard/steps/goal.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000d1-ui-boot-steps-proxy.md` | `ui/boot-wizard/steps/proxy.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000d2-ui-components-arena-results.md` | `ui/components/arena-results.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000d3-ui-components-confirmation-modal.md` | `ui/components/confirmation-modal.js` | [`0x00001F-confirmation-modal-safety.md`](0x00001F-confirmation-modal-safety.md) plus module inventory |
| `0x0000d4-ui-panels-metrics-panel.md` | `ui/panels/metrics-panel.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000d5-ui-proto-index.md` | `ui/proto/index.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000d6-ui-proto-schemas.md` | `ui/proto/schemas.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000d7-ui-proto-telemetry.md` | `ui/proto/telemetry.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000d8-ui-proto-template.md` | `ui/proto/template.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000d9-ui-proto-utils.md` | `ui/proto/utils.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000da-ui-proto-vfs.md` | `ui/proto/vfs.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000db-ui-proto-workers.md` | `ui/proto/workers.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000dc-ui-toast.md` | `ui/toast.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000dd-config-module-resolution.md` | `config/module-resolution.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000de-experimental-semantic-memory-neural.md` | `experimental/semantic-memory-neural.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000df-boot-vfs-bootstrap.md` | `boot-helpers/vfs-bootstrap.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000e0-bootstrap.md` | `entry/seed-vfs.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000e2-capabilities-communication-signaling-config.md` | `capabilities/communication/signaling-config.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000e3-capabilities-intelligence-intent-bundle-lora.md` | `capabilities/intelligence/intent-bundle-lora.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000e4-capabilities-system-doppler-toolbox.md` | `capabilities/system/doppler-toolbox.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000e5-config-boot-modes.md` | `config/boot-modes.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000e6-config-boot-seed.md` | `config/boot-seed.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000e7-config-reploid-environments.md` | `config/reploid-environments.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000e8-core-functiongemma-orchestrator.md` | `core/functiongemma-orchestrator.js` | [`0x00007D-capabilities-intelligence-functiongemma-orchestrator.md`](0x00007D-capabilities-intelligence-functiongemma-orchestrator.md) plus module inventory |
| `0x0000e9-core-multi-model-evaluator.md` | `core/multi-model-evaluator.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000ea-core-provider-registry.md` | `core/provider-registry.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000eb-core-security-config.md` | `core/security-config.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000ec-experimental-intelligence-federated-learning.md` | `experimental/intelligence/federated-learning.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000ed-experimental-intelligence-multi-model-coordinator.md` | `experimental/intelligence/multi-model-coordinator.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000ef-experimental-openclaw-audit-audit-mesh.md` | `experimental/openclaw-audit/audit-mesh.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000f0-experimental-openclaw-audit-index.md` | `experimental/openclaw-audit/index.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000f1-experimental-openclaw-audit-self-audit.md` | `experimental/openclaw-audit/self-audit.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000f2-infrastructure-intent-bundle-gate.md` | `infrastructure/intent-bundle-gate.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000f3-providers-doppler-reploid.md` | `providers/doppler-reploid.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000f4-self-boot-spec.md` | `self/boot-spec.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000f5-self-bridge.md` | `self/bridge.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000f6-self-capsule-index.md` | `self/capsule/index.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000f7-self-cloud-access-status.md` | `self/cloud-access-status.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000f8-self-cloud-access-windows.md` | `self/cloud-access-windows.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000f9-self-cloud-access.md` | `self/cloud-access.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000fa-self-environment.md` | `self/environment.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000fb-self-host-seed-vfs.md` | `self/host/seed-vfs.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000fc-self-host-start-app.md` | `self/host/start-app.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000fd-self-host-sw-module-loader.md` | `self/host/sw-module-loader.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000fe-self-host-vfs-bootstrap.md` | `self/host/vfs-bootstrap.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x0000ff-self-identity.md` | `self/identity.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000100-self-image-export.md` | `self/image/export.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000101-self-image-manifest.md` | `self/image/manifest.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000102-self-instance.md` | `self/instance.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000103-self-kernel-boot.md` | `self/kernel/boot.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000104-self-key-unsealer.md` | `self/key-unsealer.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000105-self-manifest.md` | `self/manifest.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000106-self-receipt.md` | `self/receipt.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000107-self-reward-policy.md` | `self/reward-policy.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000108-self-runtime.md` | `self/runtime.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000109-self-swarm.md` | `self/swarm.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00010a-self-tool-runner.md` | `self/tool-runner.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00010b-sw.md` | `sw.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00010c-ui-ui.md` | `ui/UI.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00010d-ui-boot-home-index.md` | `ui/boot-home/index.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00010e-ui-boot-wizard-reploid-inference.md` | `ui/boot-wizard/reploid-inference.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00010f-ui-boot-wizard-self-preview.md` | `ui/boot-wizard/self-preview.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000110-ui-capsule-index.md` | `ui/capsule/index.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000111-ui-zero-index.md` | `ui/zero/index.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000113-config-lab-route-profiles.md` | `config/lab-route-profiles.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000114-config-tool-surfaces.md` | `config/tool-surfaces.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000115-config-vfs-policy.md` | `config/vfs-policy.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000116-core-cycle-artifacts.md` | `core/cycle-artifacts.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000117-core-import-rewrite.md` | `core/import-rewrite.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000119-lab-mirrors.md` | `lab/mirrors.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00011a-lab-profiles.md` | `lab/profiles.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00011b-lab-runtime-ui.md` | `lab/runtime-ui.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00011c-lab-surface.md` | `lab/surface.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00011d-pool-agent-client.md` | `pool/agent-client.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00011e-pool-config.md` | `pool/config.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000123-pool-layer-scheduler.md` | `pool/layer-scheduler.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000124-pool-model-artifacts.md` | `pool/model-artifacts.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000126-pool-p2p-payload.md` | `pool/p2p-payload.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000127-pool-p2p-signaling.md` | `pool/p2p-signaling.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000128-pool-p2p-transport.md` | `pool/p2p-transport.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00012a-pool-peer-registry.md` | `pool/peer-registry.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00012b-pool-peer-rendezvous.md` | `pool/peer-rendezvous.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00012c-pool-peer-room.md` | `pool/peer-room.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00012d-pool-points-ledger.md` | `pool/points-ledger.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00012e-pool-policy-router.md` | `pool/policy-router.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00012f-pool-provider-client.md` | `pool/provider-client.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000130-pool-reputation.md` | `pool/reputation.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000131-pool-requester-client.md` | `pool/requester-client.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000132-pool-runtime-profile.md` | `pool/runtime-profile.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000133-pool-sdk.md` | `pool/sdk.js` | [`0x0000A8-pool-evidence-network.md`](0x0000A8-pool-evidence-network.md) plus module inventory |
| `0x000134-pool-shard-negotiation.md` | `pool/shard-negotiation.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000135-self-dream-instance.md` | `self/dream-instance.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000136-self-host-start-reploid.md` | `self/host/start-reploid.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000137-tools-promote.md` | `tools/Promote.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000138-ui-boot-wizard-zero-function.md` | `ui/boot-wizard/zero-function.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000139-ui-pool-home-constants.md` | `ui/pool-home/constants.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00013c-ui-pool-home-index.md` | `ui/pool-home/index.js` | [`0x000088-ui-pool-home-controls.md`](0x000088-ui-pool-home-controls.md) plus module inventory |
| `0x00013d-ui-pool-home-simulation-batches.md` | `ui/pool-home/simulation-batches.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00013e-ui-pool-home-simulation-bind.md` | `ui/pool-home/simulation-bind.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00013f-ui-pool-home-simulation-core.md` | `ui/pool-home/simulation-core.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000140-ui-pool-home-simulation-flow-specs.md` | `ui/pool-home/simulation-flow-specs.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000141-ui-pool-home-simulation-flow-transition.md` | `ui/pool-home/simulation-flow-transition.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000142-ui-pool-home-simulation-frame-state.md` | `ui/pool-home/simulation-frame-state.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000143-ui-pool-home-simulation-renderer.md` | `ui/pool-home/simulation-renderer.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000145-ui-reploid-home-index.md` | `ui/reploid-home/index.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000146-ui-shared-reploid-contract.md` | `ui/shared/reploid-contract.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000147-config-doppler-local-models.md` | `config/doppler-local-models.js` | [`0x0000A6-core-doppler-runtime-service.md`](0x0000A6-core-doppler-runtime-service.md) plus module inventory |
| `0x000148-config-immutability.md` | `config/immutability.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x000149-config-surface-intents.md` | `config/surface-intents.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00014a-config-zero-goals.md` | `config/zero-goals.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00014b-config-zero-inference.md` | `config/zero-inference.js` | `self/config/module-inventory.json` (no architectural decision was present) |
| `0x00014c-ui-zero-home-index.md` | `ui/zero-home/index.js` | `self/config/module-inventory.json` (no architectural decision was present) |

## Status and path audit rule

- **Implemented** means the declared canonical implementation boundary has verified tracked artifacts and no known missing artifact required by that blueprint metadata.
- **In-Progress** means at least one implementation or evidence artifact exists, but one or more declared artifacts or verification obligations remain planned.
- **Proposed** means no implementation artifact for the declared boundary exists. A related module elsewhere does not satisfy the claim.
- `Verified Artifacts` are checked against the repository by `scripts/verify-blueprint-registry.js`.
- `Planned Artifacts` are intentionally permitted to be absent and may not be described as implemented.

## Historical-ID rule

Old numeric IDs are not retained as live aliases because the pre-audit filename and heading namespaces conflicted. Historical identity is preserved by exact former file path in each canonical blueprint and in `self/config/blueprint-registry.json`. New references must use the canonical path and ID.
