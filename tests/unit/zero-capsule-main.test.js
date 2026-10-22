import { describe, expect, it } from 'vitest';
import { selectZeroConfig } from '../../self/zero/main.js';
import config from '../../self/zero/config.json';

describe('compact Zero provider selection', () => {
  it.each(['localhost', '127.0.0.1', '::1', '[::1]'])('uses the declared local provider on %s', host => {
    expect(selectZeroConfig(config, host)).toMatchObject({ provider: 'external', id: 'connected-agent' });
  });
  it.each(['replo.id', 'copy.example', '127.0.0.1.evil.example'])('preserves managed inference on %s', host => {
    expect(selectZeroConfig(config, host)).toMatchObject({ provider: 'gemini', id: 'gemini-3.8-flash' });
  });
  it('does not mutate saved defaults or silently import legacy global provider settings', () => {
    const before = JSON.stringify(config);
    const selected = selectZeroConfig(config, 'localhost');
    expect(selected).not.toHaveProperty('localProvider');
    selected.provider = 'changed';
    expect(JSON.stringify(config)).toBe(before);
  });
});
