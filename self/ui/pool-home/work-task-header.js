/**
 * Compact task header shown during active work or reviewing.
 * Displays collapsed goal, model identity, step budget counter, and stop button.
 */
export function renderTaskHeader({ embedded = false } = {}) {
  return [
    '<div class="pool-work-task-header' + (embedded ? ' pool-work-embedded' : '') + '" data-work-task-header hidden>',
    '  <div class="pool-work-task-summary">',
    '    <p class="pool-work-task-goal" data-work-active-goal></p>',
    '    <div class="pool-work-task-meta">',
    '      <span class="pool-work-model-badge" data-work-active-model></span>',
    '      <span class="type-caption" data-work-budget></span>',
    '    </div>',
    '  </div>',
    '  <div class="pool-work-task-status-row">',
    '    <p class="pool-work-status" role="status" aria-live="polite" data-work-status></p>',
    '    <button class="btn btn-ghost" type="button" data-work-cancel hidden>Stop work</button>',
    '  </div>',
    '</div>'
  ].join('\n');
}
