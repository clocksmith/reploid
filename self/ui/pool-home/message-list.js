import { interfaceIcon } from '../components/interface-icons.js';
import { projectExecutionActivity, updateExecutionActivity } from './execution-activity.js';
import { escapeHtml as escape } from '../components/attachments.js';

import { updateMessageMarkdown } from '../components/message-markdown.js';
let nextPopover = 0;

function failureLabel(attempt) {
  if (attempt.error === 'Disclosure declined') return 'Not sent. You declined sharing this request.';
  if (attempt.status === 'cancelled') return 'Stopped. Your partial answer is saved.';
  if (/disconnect|peer.*lost|contributor.*lost/i.test(attempt.error || '')) return 'A computer disconnected. Retry this answer.';
  if (/memory|allocation|resource.*exhaust|budget/i.test(attempt.error || '')) return 'This answer exceeded the available resources.';
  if (/quoted terms were not accepted/i.test(attempt.error || '')) return 'Not sent. The quote is above your spending limit, or no limit is set (Settings, Credits).';
  if (/Community Access (is not available|refused)/i.test(attempt.error || '')) return 'Not sent. Community Access cannot take this answer now.';
  if (/acknowledgments are overdue/i.test(attempt.error || '')) return 'Stopped. This device did not confirm the received output in time; only confirmed output is charged.';
  if (/quoted (first-output )?deadline passed/i.test(attempt.error || '')) return 'Stopped at the quoted deadline.';
  if (attempt.status === 'interrupted') return 'This answer was interrupted.';
  return 'This answer could not finish.';
}

function updateMessageMeta(root, thread, attempt, state) {
  const execution = attempt?.execution;
  const timing = execution?.timing;
  const tokens = timing?.generatedTokenCount ?? execution?.completion?.generatedTokenCount;
  const item = (icon, text, title = text) => `<span class="chat-message-metric pool-row pool-gap-xs" tabindex="0" aria-label="${escape(title)}" title="${escape(title)}">${interfaceIcon(icon)}${text ? `<span>${escape(text)}</span>` : ''}</span>`;
  const parts = [];
  if (thread.model?.name) parts.push(item('model', '', 'Model: ' + thread.model.name));
  const view = projectExecutionActivity({ ...state, activeThread: { ...thread, attempts: attempt ? [attempt] : [] } });
  if (view.averageSpeed !== null) parts.push(item('activity', `${view.averageSpeed.toFixed(1)} tok/s`, 'Generation average including prompt processing; excludes queue and model loading'));
  if (Number.isSafeInteger(tokens) && tokens >= 0) parts.push(item('tokens', `${tokens}`, `${tokens} generated tokens`));
  if (Number.isFinite(timing?.totalMs) && timing.totalMs > 0) {
    parts.push(item('clock', `${(timing.totalMs / 1000).toFixed(1)} s`, 'Generation time including prompt processing'));
  }
  const markup = parts.join('');
  root.hidden = !markup;
  if (root.dataset.markup !== markup) { root.innerHTML = markup; root.dataset.markup = markup; }
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
          row.className = message.role === 'user' ? 'chat-message-row is-user' : 'chat-message-row is-assistant';
          const popover = `chat-execution-${++nextPopover}`;
          row.innerHTML = `<span class="chat-message-author pool-small pool-muted"></span><div class="chat-message-content pool-body pool-prose"></div><div class="chat-message-footer pool-row pool-gap-xs pool-small pool-muted"><div class="chat-message-meta pool-row pool-gap-sm" hidden></div><div class="chat-execution-activity" data-execution-activity hidden><button class="pool-button btn-ghost pool-icon" type="button" data-execution-trigger popovertarget="${popover}"></button><div class="chat-execution-popover pool-card pool-small" id="${popover}" popover data-activity-detail></div></div><div class="chat-message-actions"></div></div>`;
          if (message.role === 'user') row.querySelector('.chat-message-content').classList.add('pool-well');
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
        }
        const attempt = thread.attempts.find(item => item.id === message.attemptId);
        if (message.role === 'assistant') updateMessageMeta(row.querySelector('.chat-message-meta'), thread, attempt, state);
        const sources = message.role === 'assistant' && attempt?.retrieval?.outcome === 'retrieved' ? attempt.retrieval.sources : [];
        const anchor = number => `source-${message.id}-${number}`;
        // A search-backed answer's [n] markers link to its numbered sources below it.
        if (!source) updateMessageMarkdown(body, message.content, sources.length
          ? new Map(sources.map(item => [String(item.number), anchor(item.number)])) : targets);
        if (message.role === 'assistant') updateExecutionActivity(row.querySelector('[data-execution-activity]'), { ...state, activeThread: { ...thread, attempts: attempt ? [attempt] : [] } });
        const author = row.querySelector('.chat-message-author');
        author.hidden = message.role === 'user' || !!message.content || !row.querySelector('[data-execution-activity]').hidden;
        if (!author.hidden) author.textContent = ({ queued: 'Waiting…', loading: 'Preparing…', executing: 'Thinking…', cancelling: 'Stopping…' })[attempt?.status] || '';
        const failed = message.role === 'assistant' && attempt && ['failed', 'cancelled', 'interrupted'].includes(attempt.status);
        const retryable = failed && attempt.id === thread.attempts.at(-1)?.id && !busy;
        const actions = row.querySelector('.chat-message-actions');
        const actionKey = JSON.stringify([failed && attempt.status, attempt?.error, attempt?.retryOf, retryable, usable, !!message.content, sources.map(item => item.url)]);
        if (actions.dataset.key !== actionKey) {
          actions.dataset.key = actionKey;
          actions.innerHTML = `${failed ? `<p role="status">${escape(failureLabel(attempt))}</p>` : ''}
            ${sources.length ? `<details class="pool-small"><summary>Sources searched (${sources.length})</summary><ol class="pool-list">${sources.map(item => `<li id="${escape(anchor(item.number))}" tabindex="-1"><a href="${escape(item.url)}" target="_blank" rel="noopener noreferrer">[${item.number}] ${escape(item.title)}</a></li>`).join('')}</ol></details>` : ''}
            ${attempt?.retryOf ? '<small>New attempt</small>' : ''}
            ${retryable ? `<button type="button" class="pool-button btn-ghost pool-icon" data-retry-attempt="${escape(attempt.id)}" aria-label="Retry response" title="Retry response. Starts a new attempt; keeps this response."${usable ? '' : ' disabled'}>${interfaceIcon('retry')}</button>` : ''}
            ${message.content ? `<button type="button" class="pool-button btn-ghost pool-icon pool-muted" data-copy-message aria-label="${message.role === 'user' ? 'Copy message' : 'Copy response'}" title="${message.role === 'user' ? 'Copy message' : 'Copy response'}">${interfaceIcon('copy')}</button>` : ''}`;
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
