import { describe, expect, it } from 'vitest';

import {
  escapeChangePassportHtml,
  renderChangePassportApp,
  renderChangePassportDetail
} from '../../self/ui/change-passport/index.js';

const result = () => ({
  projection: {
    schema: 'change.passport/v1',
    passportId: 'passport:ui:1',
    organizationId: 'org:test',
    changeClass: 'agent_configuration',
    proposal: {
      title: 'Promote <unsafe> agent configuration',
      summary: 'Exact candidate under frozen policy.',
      candidateRevision: 'candidate-sha',
      repository: { owner: 'clocksmith', name: 'agent' },
      target: { targetId: 'service:agent' }
    },
    policy: {
      policyHash: `sha256:${'1'.repeat(64)}`,
      requiredReviewerRoles: ['security_reviewer']
    },
    rollback: { artifactHash: `sha256:${'2'.repeat(64)}` },
    evidence: {
      state: 'frozen',
      admitted: [{
        evidenceId: 'evidence:tests',
        kind: 'tests',
        digest: `sha256:${'3'.repeat(64)}`,
        source: 'CI',
        summary: '<script>unsafe()</script>'
      }],
      excluded: [{
        evidenceId: 'evidence:stale',
        kind: 'benchmark',
        digest: `sha256:${'4'.repeat(64)}`,
        source: 'old benchmark',
        summary: 'Stale model identity.',
        reason: 'Candidate did not match.'
      }]
    },
    decision: {
      state: 'reopened',
      reopenings: [{ reopeningId: 'reopening:1', reason: 'Dependency changed.' }]
    },
    effect: {
      state: 'applied',
      history: [{ status: 'applied', summary: 'Deployment remains active.' }],
      rollbackRequests: [],
      rollbackHistory: []
    },
    evaluations: [{ evaluationId: 'evaluation:1', conclusion: 'pass', actor: { authorityId: 'evaluator:1', role: 'evaluator' } }],
    objections: [{ objectionId: 'objection:1', severity: 'blocking', statement: 'Review changed dependency.', resolution: null }],
    reviews: [],
    outcomes: [],
    triggers: { observed: [{ ruleId: 'rule:1', action: 'review' }] }
  },
  gate: { eligible: false, status: 'blocked', reasons: ['decision is reopened'] }
});

describe('Change Passport interface', () => {
  it('renders evidence, decision, and effect as independent state axes', () => {
    const html = renderChangePassportDetail(result(), []);
    document.body.innerHTML = html;
    expect(document.querySelector('[data-axis="Evidence"] strong').textContent).toBe('frozen');
    expect(document.querySelector('[data-axis="Decision"] strong').textContent).toBe('reopened');
    expect(document.querySelector('[data-axis="Effect"] strong').textContent).toBe('applied');
    expect(document.body.textContent).toContain('Excluded evidence');
    expect(document.body.textContent).toContain('Objections and disagreement');
    expect(document.querySelector('[data-form="review"]')).not.toBeNull();
    expect(document.querySelector('[data-form="decision"]')).not.toBeNull();
    expect(document.querySelector('[data-form="lifecycle"]')).not.toBeNull();
  });

  it('escapes untrusted proposal and evidence content', () => {
    const html = renderChangePassportDetail(result(), []);
    expect(html).not.toContain('<unsafe>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;unsafe&gt;');
    expect(html).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
    expect(escapeChangePassportHtml('"<&')).toBe('&quot;&lt;&amp;');
  });

  it('never renders the session access token', () => {
    const html = renderChangePassportApp({
      serverUrl: 'https://reploid.example/change-control',
      accessToken: 'secret-session-token',
      client: {},
      passports: [],
      current: result(),
      events: []
    });
    expect(html).not.toContain('secret-session-token');
    expect(html).toContain('type="password"');
  });

  it('shows only actions granted to the authenticated principal', () => {
    const html = renderChangePassportDetail(result(), [], {
      authorityId: 'authority:reviewer',
      roles: ['security_reviewer']
    });
    document.body.innerHTML = html;
    expect(document.querySelector('[data-authorized-action="review"]')).not.toBeNull();
    expect(document.querySelector('[data-authorized-action="decision"]')).toBeNull();
    expect(document.querySelector('[data-authorized-action="evidence"]')).toBeNull();
    expect(document.querySelector('[data-authorized-action="lifecycle"] select').textContent).toContain('objection.recorded');
    expect(document.querySelector('[data-authorized-action="lifecycle"] select').textContent).not.toContain('effect.execute');
  });
});
