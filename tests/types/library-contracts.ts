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
