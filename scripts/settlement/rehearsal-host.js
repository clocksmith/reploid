#!/usr/bin/env node
/**
 * One host process of the one-operator rehearsal (rehearsal.js; docs/verify-a-trade.md, "Rehearse it on one machine").
 *
 *   node scripts/settlement/rehearsal-host.js /absolute/host.json
 *
 * It is the real fleet native host (server/fleet/native-host.js): its own key file, the real mesh over WebRTC, the
 * real credit admission against the ledger service, the real signed settlement records and their disk store, and the
 * real browser bridge. One thing is replaced: the model. A contributor here answers from a script, so no weights are
 * read and no GPU is opened. The script is chosen by the last user message:
 *
 *   contains "[slow]"    one word every 700 ms, twelve words, until it finishes or is cancelled
 *   contains "[fault]"   one word, then the runtime fails
 *   anything else        "one two three"
 *
 * This is a rehearsal aid. A host started with native-host.js cannot be given a scripted model by its configuration.
 */
import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openFleetNativeHost, runFleetNativeCommands } from '../../server/fleet/native-host.js';

const WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** Stands where server/native-whole-model.js stands: the same ports, a scripted answer, no device. */
export function createScriptedWholeModel({ model, onChange = () => {} }) {
  let offering = false, executing = false, completed = 0, closed = false;
  const getState = () => ({ phase: executing ? 'executing' : offering ? 'ready' : 'idle', mode: 'whole-model', offering, ready: offering && !closed,
    modelId: model.id, modelIdentity: offering ? model.identity : null, adapterIdentities: [], completed, supportedOperations: ['generate'] });
  const wait = (ms, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason ?? new Error('Stopped')); }, { once: true });
  });
  return Object.freeze({
    getState,
    getGenerationSettingsCapability: () => null,
    getExecutionState() { const state = getState(); return { ...state, phase: state.ready ? 'ready' : state.phase, activity: { phase: state.phase, completed, error: null } }; },
    async contribute(approved) {
      if (approved !== true) throw new Error('Approve contribution before serving');
      offering = true; onChange(getState());
      return getState();
    },
    async generate(messages, onUpdate, controls) {
      const prompt = String(messages.at(-1)?.content ?? '');
      const slow = prompt.includes('[slow]'), fault = prompt.includes('[fault]');
      const words = slow ? WORDS : WORDS.slice(0, 3);
      executing = true; onChange(getState());
      try {
        let content = '';
        for (const [index, word] of words.entries()) {
          controls.signal.throwIfAborted();
          const chunk = (index ? ' ' : '') + word;
          content += chunk; onUpdate(chunk);
          if (fault) throw new Error('Scripted runtime failure');
          await wait(slow ? 700 : 40, controls.signal);
        }
        completed += 1;
        return { model: model.id, modelIdentity: model.identity, adapterIdentities: [], content,
          completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: Math.max(1, prompt.split(/\s+/).length), generatedTokenCount: words.length, stopReason: 'eos-token' } };
      } finally { executing = false; onChange(getState()); }
    },
    supportedOperations: () => ['generate'],
    scoreTarget() { throw new Error('The scripted model scores nothing'); },
    executeOperation() { throw new Error('The scripted model runs no other operation'); },
    async stop() { offering = false; onChange(getState()); },
    async close() { closed = true; offering = false; }
  });
}

const entered = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (entered) {
  const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  const host = await openFleetNativeHost({ configuration: config, createWholeModel: createScriptedWholeModel,
    loadGpu: async () => { throw new Error('The rehearsal host opens no GPU'); },
    onChange: value => { if (value?.warning || value?.error) process.stderr.write(JSON.stringify({ event: 'fleet-state', warning: value.warning, error: value.error }) + '\n'); } });
  console.log(JSON.stringify({ ready: true, rehearsal: 'scripted model, no GPU', computerId: config.computerId, participantId: host.identity.peerId }));
  await runFleetNativeCommands({ host, config });
}
