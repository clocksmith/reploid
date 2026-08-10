import { describe, expect, it } from 'vitest';

import {
  renderRequesterConsentRows,
  renderRequesterIntentFields
} from '../../self/ui/pool-home/requester-controls.js';

describe('Research Room requester controls', () => {
  it('renders the same consent contract for home and /ask prefixes', () => {
    const home = renderRequesterConsentRows({
      prefix: 'pool-home',
      includeSavedNotice: true,
      sequenceConsentAttributes: ' data-pool-sequence-consent-row',
      requestAttributes: ' data-pool-request-control'
    });
    const ask = renderRequesterConsentRows({ prefix: 'pool-run', rowElement: 'span' });

    expect(home).toContain('id="pool-home-sequence-public"');
    expect(home).toContain('id="pool-home-research-public"');
    expect(home).toContain('data-pool-sequence-consent-row');
    expect(home).toContain('data-pool-sequence-consent-saved');
    expect(ask).toContain('id="pool-run-sequence-public"');
    expect(ask).toContain('id="pool-run-research-public"');
    expect(ask).toContain('<span class="pool-consent-row">');
    expect(ask).not.toContain('<label class="pool-consent-row">');
    expect(ask).not.toContain('data-pool-sequence-consent-saved');
    expect(home.match(/Save the question and result to this room/g)).toHaveLength(1);
    expect(ask.match(/Save the question and result to this room/g)).toHaveLength(1);
  });

  it('keeps intent IDs stable while adapting the question control to each route', () => {
    const home = renderRequesterIntentFields({ prefix: 'pool-home' });
    const ask = renderRequesterIntentFields({ prefix: 'pool-run', textTag: 'textarea' });

    expect(home).toContain('id="pool-home-intent-kind"');
    expect(home).toContain('id="pool-home-intent-text"');
    expect(home).toContain('placeholder="What do you want to learn?"');
    expect(home).toContain('<input id="pool-home-intent-text"');
    expect(home).toContain('id="pool-home-intent-conditions"');
    expect(home).toContain('id="pool-home-intent-observation"');
    expect(home).toContain('id="pool-home-intent-unknowns"');
    expect(ask).toContain('id="pool-run-intent-kind"');
    expect(ask).toContain('id="pool-run-intent-text"');
    expect(ask).toContain('<textarea id="pool-run-intent-text"');
    expect(ask).toContain('id="pool-run-intent-decision"');
  });
});
