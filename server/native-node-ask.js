import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { setTimeout } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { partitionAdapterIdentities } from '../packages/reploid/src/mesh/partitions/partition-contract.js';

export function parseAsk(argv) {
  const options = Object.fromEntries(['signaling', 'room', 'room-token-file', 'model-config', 'ordered-config',
    'weights'].map(name => [name, { type: 'string' }]));
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true,
    options: { ...options, yes: { type: 'boolean' } } });
  const prompt = positionals.at(-1);
  if (positionals.length > 2 || !prompt?.trim()) throw new Error('Use reploid ask [model] "<prompt>"');
  const model = positionals.length === 2 ? [positionals[0]] : [];
  const forwarded = Object.entries(values).filter(([name]) => name !== 'yes').map(([name, value]) => `--${name}=${value}`);
  return { prompt, yes: values.yes === true, participantArgs: [...model, '--connect-only', ...forwarded] };
}

function previewRecipients(preview) {
  return [...new Set([
    preview.recipientIdentity, preview.providerId, preview.participantA, preview.participantB,
    ...(preview.recipients ?? []), ...(preview.input?.recipients ?? []),
    ...(preview.route?.stages ?? []).map(stage => stage.participantId),
    ...(preview.disclosure?.tokenRecipients ?? []), ...(preview.disclosure?.outputRecipients ?? []),
    ...(preview.disclosure?.activationPaths ?? []).flat(),
  ].map(value => typeof value === 'string' ? value : value?.participantId).filter(Boolean))].sort();
}

export function askOnce({ prompt, yes, confirm = null, discoveryMs = 30_000, requestMs = 180_000 }) {
  return async (participant, exactModel, signal) => {
    const discovery = AbortSignal.any([signal, AbortSignal.timeout(discoveryMs)]);
    const ready = () => participant.getState().models?.find(model => model.id === exactModel.id
      && model.identity === exactModel.identity && !model.canonical && !partitionAdapterIdentities(model).length
      && (model.partition || model.availability === 'ready' && model.providerIds?.length));
    let model;
    try {
      while (!(model = ready())) await setTimeout(200, null, { signal: discovery });
      discovery.throwIfAborted();
    } catch (error) {
      signal.throwIfAborted();
      if (!discovery.aborted) throw error;
      throw new Error(`No ready route for ${exactModel.id} in this room`);
    }
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(requestMs)]);
    let approvedRoute = null;
    const result = await participant.generate({ model, threadId: randomUUID(), attemptId: randomUUID(),
      messages: [{ role: 'user', content: prompt }] }, {
      signal: requestSignal,
      async requestApproval(preview) {
        const recipients = previewRecipients(preview).filter(id => id !== participant.identity);
        if (!recipients.length || preview.modelIdentity !== exactModel.identity) return false;
        const route = JSON.stringify(recipients);
        if (route === approvedRoute) return true;
        const allowed = confirm ? await confirm(recipients, requestSignal) : yes && approvedRoute === null;
        if (allowed) approvedRoute = route;
        return allowed;
      },
    });
    if (typeof result?.content !== 'string') throw new Error('Provider returned no text answer');
    return { content: result.content, receiptId: result.execution?.receipt?.receiptId ?? result.executionReceipt?.receiptId };
  };
}

export async function confirmRecipients(recipients, signal) {
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await terminal.question(`Send the prompt to ${recipients.join(', ')}? [y/N] `, { signal })).trim());
  } finally { terminal.close(); }
}
