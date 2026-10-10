import { escapeHtml as escape } from '../components/attachments.js';

function setText(node, value) {
  const text = String(value ?? '');
  if (!node.firstChild || node.firstChild.nodeType !== 3) node.replaceChildren(node.ownerDocument.createTextNode(text));
  updateText(node.firstChild, text);
}

function updateText(child, text) {
  const previous = child.data;
  if (previous === text) return;
  let start = 0, end = 0;
  while (start < previous.length && start < text.length && previous[start] === text[start]) start++;
  while (end < previous.length - start && end < text.length - start && previous.at(-1 - end) === text.at(-1 - end)) end++;
  child.replaceData(start, previous.length - start - end, text.slice(start, text.length - end));
}

function updateProse(node, content, targets) {
  const parts = content.split(/(\[D\d+:P\d+\])/g);
  parts.forEach((part, index) => {
    const reference = index % 2 ? part.slice(1, -1) : null;
    const target = targets.get(reference);
    const tag = reference ? target ? 'A' : 'SPAN' : null;
    let child = node.childNodes[index];
    if (!child || (tag ? child.nodeName !== tag : child.nodeType !== 3)) {
      const replacement = tag ? node.ownerDocument.createElement(tag) : node.ownerDocument.createTextNode('');
      if (child) child.replaceWith(replacement); else node.append(replacement);
      child = replacement;
    }
    if (!tag) updateText(child, part);
    else {
      if (target) { child.setAttribute('href', '#' + target); child.dataset.sourceReference = ''; }
      else child.title = 'No supplied passage has this reference';
      setText(child, part);
    }
  });
  while (node.childNodes.length > parts.length) node.lastChild.remove();
}

function updateContent(body, text, targets) {
  // Keep each prose/code node alive while output grows. Generated HTML is always text.
  const blocks = String(text || '').split(/```[^\n]*\n|```/g);
  blocks.forEach((content, index) => {
    let block = body.children[index];
    if (!block) {
      block = body.ownerDocument.createElement(index % 2 ? 'pre' : 'div');
      block.dataset.textBlock = '';
      const textNode = body.ownerDocument.createElement(index % 2 ? 'code' : 'span');
      block.append(textNode);
      if (index % 2) {
        const copy = body.ownerDocument.createElement('button'); copy.type = 'button';
        copy.className = 'pool-button'; copy.dataset.copyCode = ''; copy.textContent = 'Copy code'; block.append(copy);
      }
      body.append(block);
    }
    const node = block.firstElementChild;
    if (index % 2) setText(node, content);
    else updateProse(node, content, targets);
  });
  while (body.children.length > blocks.length) body.lastElementChild.remove();
}

function failureLabel(attempt) {
  if (attempt.status === 'cancelled') return 'Stopped. Your partial answer is saved.';
  if (/disconnect|peer.*lost|contributor.*lost/i.test(attempt.error || '')) return 'A computer disconnected. Retry this answer.';
  if (/memory|allocation|resource.*exhaust|budget/i.test(attempt.error || '')) return 'This answer exceeded the available resources.';
  if (attempt.status === 'interrupted') return 'This answer was interrupted.';
  return 'This answer could not finish.';
}

export function createMessageList(stream, { getSources, positions = new Map() } = {}) {
  const rows = new Map();
  let selected;
  return {
    update(thread, { usable, busy }) {
      const changed = selected !== thread?.id;
      if (changed) {
        if (selected) positions.set(selected, stream.scrollTop);
        selected = thread?.id; stream.replaceChildren();
      }
      const nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 80;
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
          row.className = `chat-message-row is-${message.role === 'user' ? 'user' : 'assistant'}`;
          row.innerHTML = '<span class="chat-message-author"></span><div class="chat-message-content"></div><div class="chat-message-actions"></div>';
          row.firstElementChild.textContent = message.role === 'user' ? 'You' : 'Assistant'; rows.set(id, row);
        }
        const body = row.querySelector('.chat-message-content');
        const source = message.role === 'user' && getSources?.(message.content);
        if (source) {
          targets = new Map();
          const markup = escape(source.question.split('\n')[0]) + source.documents.map(document => `<details><summary>${escape(document.name)}</summary>`
            + document.passages.map(passage => {
              const anchor = `source-${message.id}-${passage.id.replace(':', '-')}`; targets.set(passage.id, anchor);
              return `<p id="${escape(anchor)}" tabindex="-1"><strong>[${escape(passage.id)}]</strong> ${escape(passage.text)}</p>`;
            }).join('') + '</details>').join('');
          if (body.dataset.source !== markup) { body.innerHTML = markup; body.dataset.source = markup; }
        } else updateContent(body, message.content, targets);
        const attempt = thread.attempts.find(item => item.id === message.attemptId);
        const failed = message.role === 'assistant' && attempt && ['failed', 'cancelled', 'interrupted'].includes(attempt.status);
        const retryable = failed && attempt.id === thread.attempts.at(-1)?.id && !busy;
        const actions = row.querySelector('.chat-message-actions');
        const actionKey = JSON.stringify([failed && attempt.status, attempt?.error, attempt?.retryOf, retryable, usable, !!message.content]);
        if (actions.dataset.key !== actionKey) {
          actions.dataset.key = actionKey;
          actions.innerHTML = `${failed ? `<p role="status">${escape(failureLabel(attempt))}</p>${attempt.error ? `<details><summary>Technical details</summary><pre>${escape(attempt.error)}</pre></details>` : ''}` : ''}
            ${attempt?.retryOf ? '<small>New attempt</small>' : ''}
            ${retryable ? `<button type="button" class="pool-button" data-retry-attempt="${escape(attempt.id)}"${usable ? '' : ' disabled'}>Retry response</button><small>Starts a new attempt; keeps this response.</small>` : ''}
            ${message.content ? '<button type="button" class="pool-button" data-copy-message>Copy</button>' : ''}`;
        }
        if (row.parentElement !== stream) stream.append(row);
      }
      for (const child of [...stream.children]) if (!visible.has(`${thread?.id}:${child.dataset.messageId}`)) child.remove();
      if (changed) stream.scrollTop = positions.get(selected) ?? stream.scrollHeight;
      else if (nearBottom && !selecting) stream.scrollTop = stream.scrollHeight;
    },
    dispose() { if (selected) positions.set(selected, stream.scrollTop); rows.clear(); }
  };
}
