import { createReploid, type AgentStatus, type GenerationResult, type AgentCheckpoint } from '../../packages/reploid/src/agent/index.js';
import { createMemoryStore, createVfs } from '../../packages/reploid/src/adapters/browser.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { createPackProviderFactory, type PackPeerJobResult } from '../../packages/reploid/src/mesh/jobs/index.js';
import { createCustodyContracts } from '../../packages/reploid/src/artifacts/custody/runtime.js';
const status: AgentStatus = 'PARKED';
// @ts-expect-error arbitrary lifecycle states are not accepted
const invalid: AgentStatus = 'whatever';
const response: GenerationResult = { content: 'answer', requestedModel: 'a', model: 'a' };
// @ts-expect-error responses require content
const empty: GenerationResult = {};
const vfs = createVfs({ store: createMemoryStore(), ownsStore: true });
void vfs.close();
const agent = createReploid({ config: resolveConfig(), ports: { instanceId: 'typed', authorize: () => true,
  providers: { local: { generate: async () => response } } } });
const checkpoint: Promise<AgentCheckpoint> = agent.checkpoint();
void [status, invalid, empty, checkpoint, createPackProviderFactory, createCustodyContracts];
export function acceptedJob(result: PackPeerJobResult): string { return result.job.messageHash; }

import type { AuthorizationRequest, ExecutionEvent, ToolOutcome } from '../../packages/reploid/src/agent/index.js';
import type { AgentRuntime } from '../../packages/reploid/src/agent/runtime.js';
const native: GenerationResult = { content: '', toolCalls: [{ name: 'ReadFile', args: { path: '/x' } }] };
// @ts-expect-error callbacks cannot invent an authority escalation action
const escalation: AuthorizationRequest = { action: 'permissions.escalate' };
// @ts-expect-error lifecycle events have an explicit vocabulary
const invalidEvent: ExecutionEvent = { sequence: 1, type: 'self.approved' };
// @ts-expect-error completed outcomes must carry their value
const invalidOutcome: ToolOutcome = { status: 'completed' };
export function checkpointGoal(runtime: AgentRuntime): string { return runtime.checkpoint().goal; }
export async function savedCycle() { return (await agent.checkpoint()).state.cycle; }
void [native, escalation, invalidEvent, invalidOutcome];
// @ts-expect-error reusable job factories require explicit host contracts
createPackProviderFactory({});
// @ts-expect-error custody cannot exist without signature and artifact-validation ports
createCustodyContracts({ hashDopplerEvidence: async () => 'sha256:fixture' });
