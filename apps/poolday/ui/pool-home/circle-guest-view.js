import { escapeHtml as escape } from '../components/attachments.js';
import { describeCircleHost } from '../../host/circle-invites.js';

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function describeGuestAvailability({
  hostLabel,
  hostPeerId = '',
  hostState = 'offline',
  inviteStatus = 'active',
  queuePosition = null,
  expectedWaitMs = 0,
  maxExpectedWaitMs = 20_000
}) {
  const disclosure = describeCircleHost(hostLabel, hostPeerId);
  const longWait = expectedWaitMs > maxExpectedWaitMs;
  const blockedByInvite = inviteStatus !== 'active';

  let canSend = false;
  let stateLabel = 'Offline';
  let summary = `${disclosure.hostLabel} is offline. Your prompt will not be sent to any other computer.`;
  let showFallback = true;

  if (blockedByInvite) {
    if (inviteStatus === 'revoked') {
      stateLabel = 'Revoked';
      summary = `This invite for ${disclosure.hostLabel} was revoked. No prompt will be sent.`;
    } else if (inviteStatus === 'expired') {
      stateLabel = 'Expired';
      summary = `This invite for ${disclosure.hostLabel} has expired. No prompt will be sent.`;
    } else {
      stateLabel = 'Invite required';
      summary = 'A valid invite is required before sending a prompt. You can watch the recorded replay or host on your own GPU.';
    }
  } else if (hostState === 'ready' && !longWait) {
    canSend = true;
    stateLabel = 'Ready';
    summary = `${disclosure.hostLabel} is ready to answer.`;
    showFallback = false;
  } else if (hostState === 'queued' && !longWait) {
    canSend = true;
    stateLabel = 'Queued';
    const pos = Number.isSafeInteger(queuePosition) && queuePosition > 0 ? `position ${queuePosition}` : 'in queue';
    const wait = expectedWaitMs > 0 ? `, estimated wait ${Math.ceil(expectedWaitMs / 1000)}s` : '';
    summary = `Queued for ${disclosure.hostLabel} (${pos}${wait}). Your prompt stays on your device until admitted.`;
    showFallback = false;
  } else if (hostState === 'full' || longWait) {
    stateLabel = 'Full';
    summary = longWait
      ? `${disclosure.hostLabel} has an expected wait over ${Math.round(maxExpectedWaitMs / 1000)}s. Your prompt stays off other computers.`
      : `${disclosure.hostLabel} is full right now. Your prompt stays off other computers.`;
  }

  return Object.freeze({
    disclosure,
    canSend,
    stateLabel,
    summary,
    showFallback
  });
}

export const renderCircleGuestBanner = () => `
  <section class="pool-stack pool-gap-sm" data-circle-guest hidden>
    <p class="pool-small" data-circle-guest-readable></p>
    <p class="pool-caption" data-circle-guest-notice></p>
    <p class="pool-caption" role="status" data-circle-guest-state></p>
    <div class="pool-stack pool-gap-sm" data-circle-guest-fallback hidden>
      <button class="pool-button btn-ghost" type="button" data-circle-guest-replay>Watch recorded replay</button>
      <button class="pool-button btn-ghost" type="button" data-circle-guest-host-own>Host on your own GPU</button>
    </div>
    <p class="pool-caption" data-circle-guest-receipt hidden></p>
  </section>`;

export function formatCircleReceiptSummary(receipt) {
  if (!receipt) return '';
  const host = receipt.hostLabel || receipt.hostPeerId || 'authorized computer';
  const model = receipt.modelIdentity || 'unknown model';
  const bytes = formatBytes(receipt.modelWeightBytes ?? 0);
  return `Answered by ${host} · model ${model} · ${bytes} model weights downloaded`;
}

export function bindCircleGuestBanner(root, { onReplay = () => {}, onHostOwn = () => {} } = {}) {
  const section = root.querySelector('[data-circle-guest]');
  const find = selector => section.querySelector(selector);
  const readable = find('[data-circle-guest-readable]');
  const notice = find('[data-circle-guest-notice]');
  const stateNode = find('[data-circle-guest-state]');
  const fallback = find('[data-circle-guest-fallback]');
  const receiptNode = find('[data-circle-guest-receipt]');
  const controller = new AbortController();
  const options = { signal: controller.signal };

  find('[data-circle-guest-replay]').addEventListener('click', () => onReplay(), options);
  find('[data-circle-guest-host-own]').addEventListener('click', () => onHostOwn(), options);

  function update(viewState) {
    if (!viewState) {
      section.hidden = true;
      return { canSend: false };
    }
    const described = describeGuestAvailability(viewState);
    section.hidden = false;
    section.dataset.circleGuestState = described.stateLabel.toLowerCase();
    readable.textContent = described.disclosure.readableBy;
    notice.textContent = described.disclosure.notice;
    stateNode.textContent = `${described.stateLabel}: ${described.summary}`;
    fallback.hidden = !described.showFallback;
    if (viewState.receipt) {
      receiptNode.hidden = false;
      receiptNode.innerHTML = escape(formatCircleReceiptSummary(viewState.receipt));
    } else {
      receiptNode.hidden = true;
      receiptNode.textContent = '';
    }
    return described;
  }

  return Object.freeze({
    update,
    dispose: () => controller.abort()
  });
}
