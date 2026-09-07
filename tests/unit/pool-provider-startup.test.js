import { describe, expect, it } from 'vitest';
import { providerStartupError } from '../helpers/pool-provider-startup.js';

describe('actual provider startup failure detection', () => {
  it('detects the retained text-only Capsule signature failure without waiting for a deadline', () => {
    const raw = "Error: This tab could not start\nReason: Doppler model load failed: Failed to execute 'importKey' on 'SubtleCrypto': Algorithm: Unrecognized name";
    expect(providerStartupError({ providerState: 'error', parsed: null, raw })).toBe(raw);
    expect(providerStartupError({ parsed: null, raw })).toBe(raw);
  });

  it('preserves structured failure reasons and handles an error state without details', () => {
    expect(providerStartupError({ parsed: { status: 'error', reason: 'bad signature' } })).toBe('bad signature');
    expect(providerStartupError({ parsed: { error: 'bad artifact' } })).toBe('bad artifact');
    expect(providerStartupError({ providerState: 'error' })).toBe('provider entered an error state');
  });

  it('does not classify loading or listening as failure', () => {
    expect(providerStartupError({ providerState: 'loading', raw: 'Loading model', parsed: null })).toBeNull();
    expect(providerStartupError({ providerState: 'online', parsed: { runner: 'peer_room_listening' } })).toBeNull();
  });
});
