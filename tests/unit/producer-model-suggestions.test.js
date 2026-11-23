import { describe, expect, it, vi } from 'vitest';
import { bindContributionModels, modelSupplyText, suggestedModelId } from '../../apps/poolday/ui/pool-home/contribution-models.js';

const model = (id, providerIds, extra = {}) => ({ id, name: id, provider: 'doppler', identity: `sha256:${id}`, source: { type: 'x' }, localCached: true, providerIds, ...extra });

describe('what a producer is told about a model', () => {
  it('says how many computers serve it, and nothing when that is unknown', () => {
    expect(modelSupplyText(model('m', []))).toBe('No computer serves this now');
    expect(modelSupplyText(model('m', ['a']))).toBe('1 computer serves this');
    expect(modelSupplyText(model('m', ['a', 'b']))).toBe('2 computers serve this');
    expect(modelSupplyText(model('m', undefined))).toBe('');
  });

  it('suggests a model nobody serves, preferring one that needs no download', () => {
    expect(suggestedModelId([model('served', ['a']), model('remote', [], { localCached: false }), model('here', [])])).toBe('here');
    expect(suggestedModelId([model('served', ['a']), model('remote', [], { localCached: false })])).toBe('remote');
  });

  it('suggests nothing when every model is served or supply is unknown', () => {
    expect(suggestedModelId([model('served', ['a'])])).toBeNull();
    expect(suggestedModelId([model('unknown', undefined)])).toBeNull();
  });

  it('a suggestion shows its reason and starts nothing', () => {
    const container = document.createElement('div');
    const session = { getModelDownload: vi.fn(), downloadLocalModel: vi.fn(), setSharing: vi.fn(), setComputeContribution: vi.fn(), setFileContribution: vi.fn() };
    const onChoose = vi.fn();
    const view = bindContributionModels(container, session, { onChoose });
    view.update({ models: [model('served', ['a']), model('here', [])] });
    expect(container.querySelector('[data-production-model="here"] [data-model-supply]').textContent).toBe('Suggested · No computer serves this now');
    expect(container.querySelector('[data-production-model="served"] [data-model-supply]').textContent).toBe('1 computer serves this');
    expect(onChoose).not.toHaveBeenCalled();
    for (const call of [session.downloadLocalModel, session.setSharing, session.setComputeContribution, session.setFileContribution]) expect(call).not.toHaveBeenCalled();
    view.dispose();
  });
});
