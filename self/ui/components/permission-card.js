/** Presentation only. The caller owns exact-payload binding and authorization. */
export function renderPermissionSummary() {
  return `<div class="permission-summary"><p data-permission-scope></p><p data-permission-recipient></p>
    <div class="permission-content" data-permission-content></div>
    <details><summary>Technical details</summary><pre data-permission-technical></pre></details></div>`;
}

export function updatePermissionSummary(root, { recipient, scope, input, technical }) {
  root.querySelector('[data-permission-recipient]').textContent = recipient;
  root.querySelector('[data-permission-scope]').textContent = scope;
  const content = root.querySelector('[data-permission-content]');
  const messages = Array.isArray(input) ? input : Array.isArray(input?.messages) ? input.messages : null;
  const text = messages ? messages.map(message => `${message.role || 'Message'}:\n${typeof message.content === 'string' ? message.content : JSON.stringify(message.content)}`).join('\n\n')
    : typeof input === 'string' ? input : input?.text || input?.prompt || JSON.stringify(input, null, 2);
  if (content.textContent !== text) content.textContent = text || '';
  root.querySelector('[data-permission-technical]').textContent = JSON.stringify(technical, null, 2);
}
