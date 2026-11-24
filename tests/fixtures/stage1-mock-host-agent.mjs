/**
 * The real Stage 1 host agent with its machine-facing ports replaced: no GPU, no weights and no system services.
 * Inventory comes from the directory's role, the runtime is the harness fake, and the device refusal is scripted.
 * The stage loader's allowlist and record are the real harness code; only its byte reader is replaced (no weight bytes
 * exist). The earning machine's whole-model answer is FAKE: a fixed text and a declared token count, no model loads.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };
import { runHostAgent } from '../../scripts/stage1/host-agent.js';
import { createFakeStageRuntime } from '../../scripts/stage1/fake-runtime.js';
import { openStage1Participant } from '../../scripts/stage1/stage-participant.js';
import { STAGE1_MODEL_ID } from '../../scripts/stage1/expectations.js';

const scenario = JSON.parse(await fs.readFile(process.env.STAGE1_MOCK_SCENARIO, 'utf8'));
const label = process.env.STAGE1_MOCK_LABEL, mine = scenario.hosts[label] ?? {};
const model = catalog.find(row => row.id === STAGE1_MODEL_ID);
const keys = new Set((scenario.stageKeys?.[label] ?? []));
const serviceFile = () => path.join(scenario.root, `${label}-service-state`);

const ports = {
  async measure({ directory, ranges }) {
    if (directory.endsWith('/full')) return ranges;
    if (directory.endsWith('/stage')) return ranges.filter(range => keys.has(`${range.path}:${range.offset}`));
    return [];
  },
  readPressure: async () => 'some avg10=0.50 avg60=0.10 avg300=0.00 total=1',
  assertCopy: async () => {},
  async service({ action }) {
    if (action === 'is-active') return { state: await fs.readFile(serviceFile(), 'utf8').catch(() => 'inactive') };
    await fs.writeFile(serviceFile(), action === 'start' ? 'active' : 'inactive');
    return { done: true };
  },
  async loadSolo() {
    throw Object.assign(Error('This computer\'s GPU ran out of memory while loading the model'), { code: 'GPU_OUT_OF_MEMORY',
      detail: 'VK_ERROR_OUT_OF_DEVICE_MEMORY allocating buffer of size 536870912 bytes', stage1During: 'whole-model-load',
      liveBytesAtFailure: mine.liveBytesAtFailure ?? 12348030976 });
  },
  async openParticipant({ stageIndex, identity, config }) {
    let sourceRuntime = null;
    if (stageIndex !== null) {
      const manifest = JSON.parse(await fs.readFile(path.join(config.modelDirectory, 'manifest.json'), 'utf8'));
      const { reference } = JSON.parse(Buffer.from(config.fixtureBase64, 'base64'));
      sourceRuntime = loader => ({ runtime: createFakeStageRuntime({ model, manifest, reference, loader, pieces: config.assignedRanges }),
        gather: { maxPartBytes: 4096, memoryBudgetBytes: 8192, concurrency: 1 },
        receipt: { schema: 'reploid.diagnostic-source-identity/v1' }, assertCurrent: async () => {} });
    }
    return openStage1Participant({ stageIndex, identity, config, nativeGpu: async () => ({}), sourceRuntime, readBytes: async () => new Uint8Array(0) });
  },
  /** FAKE whole-model serving for the earn phase: no model, a fixed answer, the request's own token limit as the count. */
  async openWhole({ model: earnModel }) {
    return { runtime: 'fake-whole-model',
      async generate({ settings, signal }) {
        // As the real resident does: a generation that cannot be cancelled is refused.
        if (!(signal instanceof AbortSignal)) throw TypeError('A whole-model generation needs an AbortSignal');
        signal.throwIfAborted();
        const generatedTokenCount = settings?.maxOutputTokens ?? 4;
        return { content: 'Fake earn answer.', modelIdentity: earnModel.identity, adapterIdentities: [],
          completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 4, generatedTokenCount, stopReason: 'length' } };
      },
      async close() {} };
  }
};
await runHostAgent({ mode: process.argv[2], ports });
