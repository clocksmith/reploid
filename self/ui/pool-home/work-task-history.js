/**
 * Task history component for recent local work attempts.
 */
export function renderTaskHistory() {
  return [
    '<section class="pool-work-history" aria-labelledby="work-history-title">',
    '  <div class="pool-work-section-heading">',
    '    <h2 id="work-history-title" class="type-h2">Your work</h2>',
    '    <button class="btn btn-ghost" type="button" data-work-export>Export all evidence</button>',
    '  </div>',
    '  <div data-work-history></div>',
    '</section>'
  ].join('\n');
}
