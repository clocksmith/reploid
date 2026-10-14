import { renderPermissionSummary, updatePermissionSummary } from '../components/permission-card.js';
import { projectExecutionRibbon } from './execution-ribbon.js';

/** Review of the selected thread's pending remote disclosure. The workspace verified the preview and
 * records the decision; this view only shows it and reports which recipients it displayed. */
export function renderRequestApproval() {
  return `<section class="chat-approval" data-chat-approval hidden aria-labelledby="chat-approval-title">
    <div class="chat-approval-body"><h2 id="chat-approval-title">Review before sending</h2>${renderPermissionSummary()}</div>
    <div class="chat-network-actions"><button class="btn pool-button btn-ghost" type="button" data-approval-decline>Decline</button>
      <button class="btn pool-button btn-primary" type="button" data-approval-approve>Approve</button></div>
  </section>`;
}

const counted = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const joined = items => items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

export function projectRequestApproval(state) {
  const view = projectExecutionRibbon(state), approval = view.proposed ? view.attempt.approval : null;
  if (!approval) return null;
  const input = Array.isArray(approval.input) ? approval.input : Array.isArray(approval.input?.messages) ? approval.input.messages : [];
  const context = input.filter(message => message.role === 'system').length, earlier = Math.max(0, input.length - context - 1);
  const nodes = view.executors, count = nodes.length;
  const role = (node, index) => view.ordered ? `stage ${index + 1} of ${count}` : view.split ? index === 0 ? 'initial layers' : 'final layers' : 'whole model';
  // Roles carry the route order, so the list needs no arrow glyphs.
  const recipients = `${count === 1 ? 'Recipient' : 'Recipients'}: ${nodes.map((node, index) => `${node.label} (${role(node, index)})`).join(', ')} · ${view.model}`;
  const [first, ...rest] = nodes, others = rest.map(node => node.label);
  const sent = ['this message', earlier && counted(earlier, 'earlier message'), context && 'the context prompt'].filter(Boolean);
  const scope = `Sends ${joined(sent)}. ${first.id === view.requester ? 'The text stays on this device' : `${first.label} receives the text`}`
    + (others.length ? `; ${joined(others)} ${others.length === 1 ? 'receives' : 'receive'} it as model tokens and intermediate results.` : '.')
    + ' Approval applies to this request only.';
  return { threadId: view.thread.id, attemptId: view.attempt.id, previewId: approval.id, recipientIds: nodes.map(node => node.id),
    recipients, scope, input,
    technical: { model: approval.modelId ?? view.thread.model.id, modelIdentity: approval.modelIdentity ?? null, planId: approval.planId ?? null,
      disclosure: typeof approval.disclosure === 'string' ? approval.disclosure : approval.disclosure?.kind ?? null,
      recipients: nodes.map(node => node.id), expiresAt: Number.isFinite(approval.expiresAt) ? new Date(approval.expiresAt).toISOString() : null,
      approvalId: approval.id } };
}

/** Shows or hides the review. The dataset carries exactly what is displayed for the decision handler. */
export function updateRequestApproval(root, state, { getSources } = {}) {
  const section = root.querySelector('[data-chat-approval]'), view = projectRequestApproval(state);
  section.hidden = !view;
  if (!view) { for (const key of ['key', 'threadId', 'attemptId', 'previewId', 'recipients']) delete section.dataset[key]; return null; }
  const key = JSON.stringify([view.threadId, view.attemptId, view.previewId, view.recipientIds, view.recipients, view.scope]);
  if (section.dataset.key !== key) {
    Object.assign(section.dataset, { key, threadId: view.threadId, attemptId: view.attemptId, previewId: view.previewId,
      recipients: JSON.stringify(view.recipientIds) });
    for (const button of section.querySelectorAll('button')) button.disabled = false;
  }
  updatePermissionSummary(section, { recipient: view.recipients, scope: view.scope, input: view.input, technical: view.technical, getSources });
  return view;
}
