import { it, expect } from 'vitest';
import { openPluginSession } from '../../packages/reploid/src/plugins/session.js';
import { modelImitationPlugin } from '../../self/plugins/model-imitation/plugin.js';
import protocol from '../../self/plugins/model-imitation/protocol.json';

const config = { protocol, target: { id: 'small', identity: 'small-hash', name: 'Small' },
  imitator: { id: 'large', identity: 'large-hash', name: 'Large' }, order: [0, 1, 2, 3], conditionOrder: [0, 1, 2, 3], sides: [1, 0, 1, 0] };
it('keeps assignments, timing, partial answers and calibration examples out of the blind view', async () => {
  const outputs = [], seen = [];
  const session = await openPluginSession({ definition: modelImitationPlugin, config, sessionId: 'study',
    store: { load: async () => null, save: async () => {} }, capabilities: { 'model.generate': async input => {
      seen.push(input); outputs.push(session.view());
      return { content: input.tag.kind === 'calibration' ? 'calibration-only' : input.tag.round === 0 ? '13' : 'test answer',
        model: input.model, elapsedMs: 99999 };
    } } });
  await session.dispatch({ type: 'start' });
  const view = JSON.stringify(session.view());
  expect(view).not.toMatch(/small-hash|large-hash|99999|calibration-only|prompt-only/);
  expect(outputs.every(row => row.content.answers.length === 0)).toBe(true);
  expect(session.view().content.answers).toEqual([['13'], ['13']]);
  expect(seen).toHaveLength(18);
  await session.dispatch({ type: 'followup' });
  expect(seen.find(row => row.tag.round === 0 && row.tag.turn === 1).messages.at(-2)).toEqual({ role: 'assistant', content: '13' });
  for (let i = 0; i < 4; i++) await session.dispatch({ type: 'judge', choice: 'B', confidence: 60 });
  expect(session.view().content.phase).toBe('complete');
  expect(seen).toHaveLength(18);
  const control = session.view().content.results.find(row => row.condition === 'same-model');
  expect(control.actual).toBe('same'); expect(control.correct).toBe(false);
  expect(session.export().configurationHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  const examplesCall = seen.find(row => row.tag.round === 1 && row.model.id === 'large');
  expect(examplesCall.messages[0].content).toContain('calibration-only');
  expect(seen.filter(row => row.tag.round === 2).every(row => row.model.id === 'small')).toBe(true);
});
it('rejects repeated judgments and invalid randomization', () => {
  expect(() => modelImitationPlugin.initialize({ ...config, order: [0, 0, 1, 2] })).toThrow('order');
  const state = modelImitationPlugin.initialize(config);
  expect(() => modelImitationPlugin.transition(state, { type: 'judge', choice: 'A', confidence: 100 })).toThrow('judgment');
});
