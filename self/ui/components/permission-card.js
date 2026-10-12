import { escapeHtml as escape } from './attachments.js';
/** Presentation only. The caller owns exact-payload binding and authorization. */
export function renderPermissionSummary() {
  return `<div class="permission-summary"><p data-permission-scope></p><p data-permission-recipient></p>
    <details data-permission-review><summary data-permission-review-label>Review shared content</summary><div class="permission-content" data-permission-content></div></details>
    <details><summary>Technical details</summary><pre data-permission-technical></pre></details></div>`;
}

export function updatePermissionSummary(root, { recipient, scope, input, technical, getSources }) {
  root.querySelector('[data-permission-recipient]').textContent = recipient;
  root.querySelector('[data-permission-scope]').textContent = scope;
  const content = root.querySelector('[data-permission-content]');
  const messages = Array.isArray(input) ? input : Array.isArray(input?.messages) ? input.messages : null;
  let attachments = 0;
  const rows = messages || [{ role: 'Input', content: typeof input === 'string' ? input : input?.text || input?.prompt || JSON.stringify(input, null, 2) }];
  const markup = rows.map(message => {
    const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
    const sources = getSources?.(text);
    attachments += sources?.documents.length || 0;
    return `<section class="permission-message"><p>${escape(message.role || 'Message')}:\n${escape(sources?.question ?? text)}</p>`
      + (sources?.documents || []).map(document => `<details><summary>${escape(document.name)}</summary>${document.passages.map(passage => `<p><small>${escape(passage.id)}</small> ${escape(passage.text)}</p>`).join('')}</details>`).join('') + '</section>';
  }).join('');
  if (content.dataset.projection !== markup) { content.innerHTML = markup; content.dataset.projection = markup; }
  root.querySelector('[data-permission-review-label]').textContent = `Review ${rows.length} ${messages ? (rows.length === 1 ? 'message' : 'messages') : 'input'}`
    + (attachments ? ` · ${attachments} ${attachments === 1 ? 'attachment' : 'attachments'}` : '');
  root.querySelector('[data-permission-technical]').textContent = JSON.stringify(technical, null, 2);
}
