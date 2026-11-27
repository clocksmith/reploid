import { describe, expect, it, vi } from 'vitest';
import { modelSupplyText, suggestedModelId } from '../../apps/poolday/ui/pool-home/contribution-models.js';

const model = (id, providerIds, extra = {}) => ({ id, name: id, provider: 'doppler', identity: `sha256:${id}`, source: { type: 'x' }, localCached: true, providerIds, ...extra });

describe('what a producer is told about a model', () => {
  it('says how many computers serve it, and nothing when that is unknown', () => {
    expect(modelSupplyText(model('m', []), { observed: true })).toBe('No visible computer serves this');
    expect(modelSupplyText(model('m', []))).toBe('Availability not known yet');
    expect(modelSupplyText(model('m', ['a']))).toBe('1 visible computer serves this');
    expect(modelSupplyText(model('m', ['a', 'b']))).toBe('2 visible computers serve this');
    expect(modelSupplyText(model('m', undefined))).toBe('');
  });

  it('suggests a model nobody serves, preferring one that needs no download', () => {
    expect(suggestedModelId([model('served', ['a']), model('remote', [], { localCached: false }), model('here', [])], { observed: true })).toBe('here');
    expect(suggestedModelId([model('served', ['a']), model('remote', [], { localCached: false })], { observed: true })).toBe('remote');
  });

  it('suggests nothing when every model is served or supply is unknown', () => {
    expect(suggestedModelId([model('served', ['a'])], { observed: true })).toBeNull();
    expect(suggestedModelId([model('unknown', undefined)], { observed: true })).toBeNull();
  });
});
