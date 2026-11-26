// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { releaseWindowNotes, tradeStatus } from '../../scripts/settlement/trade.js';

const state = (network, rest = {}) => ({ computerId: 'c', preparing: false, error: null, selected: { modelId: 'tiny' }, network, execution: { ready: false, offering: false }, ...rest });

describe('the status lines of a trade host', () => {
  it('says once that the signaling server refused the host, in words, and again only after a connection was lost', () => {
    const lines = [], status = tradeStatus({ role: 'earner', signaling: 'ws://127.0.0.1:1/signaling', say: line => lines.push(line) });
    status(state({ connectionState: 'retrying', peerCount: 0 }));
    for (let i = 0; i < 3; i++) status({ warning: '[WebRTCSwarm] Signaling failed: [object Object]' });
    expect(lines.filter(line => line.startsWith('NOT CONNECTED'))).toHaveLength(1);
    expect(lines.join('\n')).toContain('loopback --page-origin');
    expect(lines).toContain('Signaling: retrying.');
    status(state({ connectionState: 'connected', peerCount: 0 }));
    status({ warning: '[WebRTCSwarm] Signaling failed: [object Object]' });
    expect(lines.filter(line => line.startsWith('NOT CONNECTED'))).toHaveLength(2);
  });

  it('prints a line only when the connection, the room or the model changes, and tells the earner when it can serve', () => {
    const lines = [], status = tradeStatus({ role: 'earner', signaling: 'ws://x/signaling', say: line => lines.push(line) });
    const loading = state({ connectionState: 'connected', peerCount: 0 }, { preparing: true });
    for (let i = 0; i < 30; i++) status(loading);
    expect(lines).toEqual(['Signaling: connected.', 'Other computers in the room: 0.', 'The model is loading: nothing can be served yet.']);
    status(state({ connectionState: 'connected', peerCount: 1 }, { execution: { ready: true, offering: true } }));
    expect(lines.slice(3)).toEqual(['Other computers in the room: 1.', 'The model tiny is loaded and offered. This host can now serve.']);
    status(state({ connectionState: 'connected', peerCount: 1 }, { execution: { ready: true, offering: true }, error: 'device lost' }));
    expect(lines.at(-1)).toBe('Host error: device lost');
    status(state({ connectionState: 'connected', peerCount: 1 }, { preparing: true }));
    expect(lines.at(-1)).toBe('The model is no longer offered: this host is not serving.');
  });

  it('says nothing about a model for the spender, which holds none', () => {
    const lines = [], status = tradeStatus({ role: 'spender', signaling: 'ws://x/signaling', say: line => lines.push(line) });
    status(state({ connectionState: 'connected', peerCount: 1 }));
    expect(lines).toEqual(['Signaling: connected.', 'Other computers in the room: 1.']);
  });
});

describe('the release-window note before a trade', () => {
  const policy = (wholeModel, partition) => ({ wholeModelUnclaimedReleaseMs: wholeModel, partitionUnclaimedReleaseMs: partition });

  it('says nothing when the two windows are equal', () => {
    expect(releaseWindowNotes(policy(120000, 120000))).toEqual([]);
  });

  it('does not claim the signed terms name the split window: whole-model terms sign the whole-model one', () => {
    const [note, ...rest] = releaseWindowNotes(policy(120000, 60000));
    expect(rest).toEqual([]);
    expect(note).toContain('whole-model release window, 120000 ms');
    expect(note).not.toMatch(/signed terms name 60000/);
    expect(note).not.toMatch(/longer of the two/);
  });
});
