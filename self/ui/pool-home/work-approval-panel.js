/**
 * Approval panel component for reviewing proposed peer operations before sending.
 * Refusal stops this disclosure; it never silently retries elsewhere.
 */
export function renderApprovalPanel() {
  return [
    '<section class="pool-work-approval" data-work-approval hidden aria-labelledby="work-approval-title">',
    '  <div class="pool-work-section-heading">',
    '    <h2 id="work-approval-title" class="type-h2">Review before sending</h2>',
    '    <span class="pool-work-badge pool-work-badge--approval">&#9675; Approval required</span>',
    '  </div>',
    '  <p class="pool-work-approval-intro">This request has not been sent. Approval shares the payload below with the named peer as public data.</p>',
    '  <p class="type-caption" data-work-approval-identity></p>',
    '  <pre data-work-approval-payload></pre>',
    '  <label class="pool-consent-row">',
    '    <input type="checkbox" data-work-public>',
    '    <span>I approve sharing this exact input with this provider as public data.</span>',
    '  </label>',
    '  <div class="pool-work-actions pool-work-approval-actions">',
    '    <button class="btn btn-primary" type="button" data-work-send disabled>Approve and send</button>',
    '    <button class="btn btn-ghost" type="button" data-work-decline>Decline</button>',
    '  </div>',
    '</section>'
  ].join('\n');
}
