/**
 * Result view component that leads with deliverables and grounded outcome tags.
 * Displays distinction badges ("Patch drafted", "JSON validated", "Needs execution"),
 * artifact downloads, review actions, and an audit details disclosure.
 */
export function renderResultView() {
  return [
    '<section class="pool-work-output" data-work-output aria-label="Task result">',
    '  <div class="pool-work-section-heading">',
    '    <div class="pool-work-heading-group">',
    '      <h2 class="type-h2">Result</h2>',
    '      <div class="pool-work-tags" data-work-outcome-tags></div>',
    '    </div>',
    '    <span class="type-caption" data-work-review-status></span>',
    '  </div>',
    '  <p class="type-caption" data-work-result-criteria></p>',
    '  <div class="pool-work-answer" data-work-answer></div>',
    '  <div class="pool-work-artifacts" data-work-artifacts></div>',
    '  <details class="pool-work-progress" data-work-progress open>',
    '    <summary>Activity &amp; checks</summary>',
    '    <ol data-work-events></ol>',
    '    <pre data-work-draft></pre>',
    '  </details>',
    '  <div class="pool-work-actions" data-work-review-actions hidden>',
    '    <button class="btn btn-ghost" type="button" data-work-accept>Accept result</button>',
    '    <button class="btn btn-ghost" type="button" data-work-reject>Needs changes</button>',
    '    <button class="btn btn-ghost" type="button" data-work-revise-selected>Revise with feedback</button>',
    '  </div>',
    '  <details class="pool-work-details" data-work-details>',
    '    <summary>Result details</summary>',
    '    <div class="pool-work-details-body">',
    '      <div class="pool-work-actions">',
    '        <button class="btn btn-ghost" type="button" data-work-export>Export all evidence</button>',
    '      </div>',
    '      <div class="pool-work-audit-meta" data-work-audit-metadata></div>',
    '    </div>',
    '  </details>',
    '</section>'
  ].join('\n');
}
