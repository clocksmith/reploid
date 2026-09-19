/**
 * Activity list component showing real-time tool execution events and draft streaming output.
 */
export function renderActivityList() {
  return [
    '<div class="pool-work-activity" data-work-activity hidden>',
    '  <details class="pool-work-progress" data-work-progress open>',
    '    <summary>Activity &amp; checks</summary>',
    '    <ol data-work-events></ol>',
    '    <pre data-work-draft></pre>',
    '  </details>',
    '</div>'
  ].join('\n');
}
