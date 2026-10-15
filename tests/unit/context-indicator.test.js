import { describe, it, expect } from 'vitest';
import { projectContextIndicator } from '../../self/ui/pool-home/context-indicator.js';

const model = { id: 'model', identity: 'sha256:model', name: 'Model', contextLength: 1000 };
const state = execution => ({ models: [model], participantId: 'self', activeThread: { model, messages: [], attempts: [{ status: 'completed', execution }] } });
describe('Context indicator evidence', () => {
  it('uses measured tokens and deduplicates recorded participants, not discovery', () => {
    const view = projectContextIndicator({ ...state({ placement: 'two-device-layer-partition', requesterId: 'self', participantA: 'self', participantB: 'peer', completion: { promptTokenCount: 300, generatedTokenCount: 120 } }), network: { consumer: { peers: [{ id: 'unrelated' }] } } });
    expect(view.text).toBe('42%'); expect(view.peers.map(peer => peer.id)).toEqual(['self', 'peer']);
    expect(view.title).toContain('advertised context window'); expect(view.title).toContain('Unsent draft is not counted');
  });
  it('never infers tokens from text or substitutes another model window', () => {
    expect(projectContextIndicator(state(null)).text).toBe('—');
    expect(projectContextIndicator({ ...state({ completion: { promptTokenCount: 1, generatedTokenCount: 1 } }), models: [{ ...model, identity: 'other' }] }).text).toBe('—');
  });
  it('does not round a measured nonzero fraction down to zero', () => {
    expect(projectContextIndicator(state({ completion: { promptTokenCount: 1, generatedTokenCount: 1 } })).text).toBe('<1%');
  });
});
