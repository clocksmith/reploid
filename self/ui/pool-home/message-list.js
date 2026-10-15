import { interfaceIcon } from '../components/interface-icons.js';
import { updateExecutionActivity } from './execution-activity.js';
import { escapeHtml as escape } from '../components/attachments.js';

import { updateMessageMarkdown } from '../components/message-markdown.js';

function failureLabel(attempt) {
  if (attempt.error === 'Disclosure declined') return 'Not sent. You declined sharing this request.';
  if (attempt.status === 'cancelled') return 'Stopped. Your partial answer is saved.';
  if (/disconnect|peer.*lost|contributor.*lost/i.test(attempt.error || '')) return 'A computer disconnected. Retry this answer.';
  if (/memory|allocation|resource.*exhaust|budget/i.test(attempt.error || '')) return 'This answer exceeded the available resources.';
  if (attempt.status === 'interrupted') return 'This answer was interrupted.';
  return 'This answer could not finish.';
}

export function createMessageList(stream, { getSources, positions = new Map(), scrollContainer = stream } = {}) {
  const rows = new Map();
  let selected;
  return {
    update(thread, { usable, busy, state }) {
      const changed = selected !== thread?.id;
      if (changed) {
        if (selected) positions.set(selected, scrollContainer.scrollTop);
        selected = thread?.id; stream.replaceChildren();
      }
      const nearBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < 80;
      const selection = stream.ownerDocument.getSelection?.();
      const selecting = selection && !selection.isCollapsed && stream.contains(selection.anchorNode);
      let targets = new Map();
      const visible = new Set();
      for (const [index, message] of (thread?.messages || []).entries()) {
        const messageId = message.id || `message-${index}`;
        const id = `${thread.id}:${messageId}`; visible.add(id);
        let row = rows.get(id);
        if (!row) {
          row = stream.ownerDocument.createElement('article'); row.dataset.messageId = messageId;
          row.className = message.role === 'user' ? 'chat-message-row is-user pool-well pool-reveal-host' : 'chat-message-row is-assistant';
          row.innerHTML = '<details class="chat-execution-activity pool-small pool-muted" data-execution-activity hidden><summary></summary><div data-activity-detail></div></details><span class="chat-message-author pool-small pool-muted"></span><div class="chat-message-content pool-body pool-prose"></div><div class="chat-message-actions"></div>';
          row.querySelector('.chat-message-author').textContent = message.role === 'user' ? 'You' : 'Assistant'; rows.set(id, row);
        }
        const body = row.querySelector('.chat-message-content');
        const source = message.role === 'user' && getSources?.(message.content);
        if (source) {
          targets = new Map();
          const markup = escape(source.question) + source.documents.map(document => `<details><summary>${escape(document.name)}</summary>`
            + document.passages.map(passage => {
              const anchor = `source-${message.id}-${passage.id.replace(':', '-')}`; targets.set(passage.id, anchor);
              return `<p id="${escape(anchor)}" tabindex="-1"><strong>[${escape(passage.id)}]</strong> ${escape(passage.text)}</p>`;
            }).join('') + '</details>').join('');
          if (body.dataset.source !== markup) { body.innerHTML = markup; body.dataset.source = markup; }
        } else updateMessageMarkdown(body, message.content, targets);
        const attempt = thread.attempts.find(item => item.id === message.attemptId);
        if (message.role === 'assistant') updateExecutionActivity(row.querySelector('[data-execution-activity]'), { ...state, activeThread: { ...thread, attempts: attempt ? [attempt] : [] } });
        const author = row.querySelector('.chat-message-author');
        author.hidden = message.role === 'user' || !!message.content || !row.querySelector('[data-execution-activity]').hidden;
        if (!author.hidden) author.textContent = ({ queued: 'Waiting…', loading: 'Preparing…', executing: 'Thinking…', cancelling: 'Stopping…' })[attempt?.status] || '';
        const failed = message.role === 'assistant' && attempt && ['failed', 'cancelled', 'interrupted'].includes(attempt.status);
        const retryable = failed && attempt.id === thread.attempts.at(-1)?.id && !busy;
        const actions = row.querySelector('.chat-message-actions');
        const sources = message.role === 'assistant' && attempt?.retrieval?.outcome === 'retrieved' ? attempt.retrieval.sources : [];
        const actionKey = JSON.stringify([failed && attempt.status, attempt?.error, attempt?.retryOf, retryable, usable, !!message.content, sources.map(item => item.url)]);
        if (actions.dataset.key !== actionKey) {
          actions.dataset.key = actionKey;
          actions.innerHTML = `${failed ? `<p role="status">${escape(failureLabel(attempt))}</p>${attempt.error ? `<details><summary>Technical details</summary><pre>${escape(attempt.error)}</pre></details>` : ''}` : ''}
            ${sources.length ? `<details class="pool-small"><summary>Sources searched (${sources.length})</summary><ol class="pool-list">${sources.map(item => `<li><a href="${escape(item.url)}" target="_blank" rel="noopener noreferrer">[${item.number}] ${escape(item.title)}</a></li>`).join('')}</ol></details>` : ''}
            ${attempt?.retryOf ? '<small>New attempt</small>' : ''}
            ${retryable ? `<button type="button" class="pool-button" data-retry-attempt="${escape(attempt.id)}"${usable ? '' : ' disabled'}>Retry response</button><small>Starts a new attempt; keeps this response.</small>` : ''}
            ${message.content ? `<button type="button" class="pool-button btn-ghost pool-icon pool-muted pool-reveal" data-copy-message aria-label="Copy response" title="Copy response">${interfaceIcon('copy')}</button>` : ''}`;
        }
        if (row.parentElement !== stream) stream.append(row);
      }
      for (const child of [...stream.children]) if (!visible.has(`${thread?.id}:${child.dataset.messageId}`)) child.remove();
      if (changed) scrollContainer.scrollTop = positions.get(selected) ?? scrollContainer.scrollHeight;
      else if (nearBottom && !selecting) scrollContainer.scrollTop = scrollContainer.scrollHeight;
    },
    dispose() { if (selected) positions.set(selected, scrollContainer.scrollTop); rows.clear(); }
  };
}
