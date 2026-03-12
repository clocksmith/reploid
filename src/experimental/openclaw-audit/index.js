import { AuditMesh } from './audit-mesh.js';
import {
  buildAuditSnapshot,
  collectBrowserAuditInputs,
  normalizeAuditSnapshot,
  runLocalSelfAudit,
  slugifyRoomId
} from './self-audit.js';

const mesh = new AuditMesh({ onEvent: handleMeshEvent });

const state = {
  localReport: null,
  peerReports: new Map(),
  connected: false,
  feed: []
};

const elements = {
  consent: document.querySelector('#audit-consent'),
  room: document.querySelector('#audit-room'),
  alias: document.querySelector('#audit-alias'),
  connect: document.querySelector('#connect-button'),
  disconnect: document.querySelector('#disconnect-button'),
  requestAudit: document.querySelector('#request-audit-button'),
  copyPrompt: document.querySelector('#copy-prompt-button'),
  copyLink: document.querySelector('#copy-link-button'),
  publishSnapshot: document.querySelector('#publish-snapshot-button'),
  runAudit: document.querySelector('#run-audit-button'),
  autoShare: document.querySelector('#auto-share-toggle'),
  signalingState: document.querySelector('#signaling-state'),
  peerCount: document.querySelector('#peer-count'),
  localSummary: document.querySelector('#local-summary'),
  peerSummary: document.querySelector('#peer-summary'),
  localFindings: document.querySelector('#local-findings'),
  peerFindings: document.querySelector('#peer-findings'),
  peerList: document.querySelector('#peer-list'),
  roomFeed: document.querySelector('#room-feed'),
  activityLog: document.querySelector('#activity-log'),
  lastAudit: document.querySelector('#last-audit'),
  manualFlags: Array.from(document.querySelectorAll('[data-manual-flag]')),
  chatInput: document.querySelector('#chat-input'),
  sendChat: document.querySelector('#send-chat-button'),
  specLink: document.querySelector('#spec-link'),
  runnerPrompt: document.querySelector('#runner-prompt'),
  snapshotInput: document.querySelector('#snapshot-input')
};

function buildRunnerPrompt() {
  return [
    'Run the OpenClaw cooperative security self-audit now.',
    '',
    'Follow /SECURITY_AUDIT.md and skills/security-audit/SKILL.md.',
    'Rules:',
    '- Inspect only metadata and explicitly volunteered local state.',
    '- Do not read or reveal any secret values.',
    '- Keep all raw inspection local.',
    '- Publish only a sanitized JSON snapshot with actor, generatedAt, summary, and findings.',
    '',
    `Room: ${elements.room.value || 'openclaw'}`,
    `Requested by: ${elements.alias.value || 'runner'}`,
    '',
    'After the audit, paste the sanitized snapshot into the room orchestrator and publish it.'
  ].join('\n');
}

function getManualFlags() {
  return elements.manualFlags.reduce((flags, checkbox) => {
    flags[checkbox.dataset.manualFlag] = checkbox.checked;
    return flags;
  }, {});
}

function appendLog(message, tone = 'info') {
  const row = document.createElement('li');
  row.className = `audit-log__item audit-log__item--${tone}`;
  row.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
  elements.activityLog.prepend(row);

  while (elements.activityLog.children.length > 10) {
    elements.activityLog.removeChild(elements.activityLog.lastElementChild);
  }
}

function appendFeedEntry(entry) {
  const normalized = {
    alias: String(entry.alias || 'system'),
    body: String(entry.body || ''),
    kind: entry.kind || 'system',
    sentAt: entry.sentAt || new Date().toISOString()
  };

  state.feed.unshift(normalized);
  state.feed = state.feed.slice(0, 40);
  renderFeed();
}

function renderFeed() {
  elements.roomFeed.innerHTML = '';
  if (!state.feed.length) {
    const item = document.createElement('li');
    item.className = 'feed-item feed-item--empty';
    item.textContent = 'The room feed is quiet. Join a room or request the first audit.';
    elements.roomFeed.appendChild(item);
    return;
  }

  for (const entry of state.feed) {
    const item = document.createElement('li');
    item.className = `feed-item feed-item--${entry.kind}`;

    const header = document.createElement('div');
    header.className = 'feed-item__header';

    const alias = document.createElement('span');
    alias.className = 'feed-item__alias';
    alias.textContent = entry.alias;

    const time = document.createElement('span');
    time.className = 'feed-item__time';
    time.textContent = new Date(entry.sentAt).toLocaleTimeString();

    const body = document.createElement('p');
    body.className = 'feed-item__body';
    body.textContent = entry.body;

    header.append(alias, time);
    item.append(header, body);
    elements.roomFeed.appendChild(item);
  }
}

function renderFindings(target, findings, emptyMessage) {
  target.innerHTML = '';
  if (!findings.length) {
    const item = document.createElement('li');
    item.className = 'finding finding--empty';
    item.textContent = emptyMessage;
    target.appendChild(item);
    return;
  }

  for (const finding of findings) {
    const item = document.createElement('li');
    item.className = `finding finding--${finding.severity}`;

    const header = document.createElement('div');
    header.className = 'finding__header';

    const severity = document.createElement('span');
    severity.className = 'finding__severity';
    severity.textContent = finding.severity;

    const code = document.createElement('span');
    code.className = 'finding__code';
    code.textContent = finding.code;

    const summary = document.createElement('p');
    summary.className = 'finding__summary';
    summary.textContent = finding.summary;

    const meta = document.createElement('p');
    meta.className = 'finding__meta';
    meta.textContent = `${finding.surface} :: ${finding.subject}`;

    const remediation = document.createElement('p');
    remediation.className = 'finding__remediation';
    remediation.textContent = finding.remediation || 'Inspect locally and rotate credentials if exposure is confirmed.';

    header.append(severity, code);
    item.append(header, summary, meta, remediation);
    target.appendChild(item);
  }
}

function renderPeerList(peers = []) {
  elements.peerCount.textContent = String(peers.length);
  elements.peerList.innerHTML = '';

  if (!peers.length) {
    const item = document.createElement('li');
    item.className = 'peer peer--empty';
    item.textContent = 'No peers connected yet.';
    elements.peerList.appendChild(item);
    return;
  }

  for (const peer of peers) {
    const item = document.createElement('li');
    item.className = 'peer';
    const summary = peer.snapshot?.summary || { critical: 0, warning: 0 };

    const title = document.createElement('div');
    title.className = 'peer__title';
    title.textContent = peer.alias || peer.peerId;

    const meta = document.createElement('div');
    meta.className = 'peer__meta';
    meta.textContent = `${peer.state} | critical ${summary.critical || 0} | warning ${summary.warning || 0}`;

    item.append(title, meta);
    elements.peerList.appendChild(item);
  }
}

function renderPeerFindings() {
  const peerFindings = [];
  for (const report of state.peerReports.values()) {
    const findings = report.snapshot?.findings || [];
    for (const finding of findings) {
      peerFindings.push({
        ...finding,
        summary: `${report.alias}: ${finding.summary}`,
        surface: `${report.alias} :: ${finding.surface}`
      });
    }
  }

  elements.peerSummary.textContent = String(peerFindings.length);
  renderFindings(
    elements.peerFindings,
    peerFindings,
    'Runner warnings will appear here once connected peers publish sanitized snapshots.'
  );
}

function updateButtons() {
  const consented = elements.consent.checked;
  elements.connect.disabled = !consented || state.connected;
  elements.disconnect.disabled = !state.connected;
  elements.requestAudit.disabled = !consented || !state.connected;
  elements.copyPrompt.disabled = !consented;
  elements.copyLink.disabled = !consented;
  elements.publishSnapshot.disabled = !consented;
  elements.runAudit.disabled = !consented;
}

async function runBrowserFallbackAudit() {
  if (!elements.consent.checked) {
    appendLog('Consent is required before running the browser fallback audit.', 'warning');
    return;
  }

  const browserInputs = await collectBrowserAuditInputs(window);
  const report = runLocalSelfAudit({
    ...browserInputs,
    manualFlags: getManualFlags()
  });

  state.localReport = report;
  elements.lastAudit.textContent = new Date().toLocaleTimeString();
  elements.localSummary.textContent = `${report.summary.total} findings`;
  renderFindings(
    elements.localFindings,
    report.findings,
    'No browser fallback warnings. The current origin metadata looks clean.'
  );

  const actor = {
    alias: elements.alias.value.trim() || 'runner',
    peerId: mesh.peerId
  };
  const snapshot = buildAuditSnapshot(report, actor);

  appendLog(
    `Browser fallback audit complete: ${report.summary.critical} critical, ${report.summary.warning} warning.`,
    report.summary.critical ? 'warning' : 'info'
  );
  appendFeedEntry({
    alias: 'system',
    kind: report.summary.critical ? 'warning' : 'system',
    body: `Browser fallback audit finished with ${report.summary.critical} critical and ${report.summary.warning} warning findings.`,
    sentAt: new Date().toISOString()
  });

  if (state.connected && elements.autoShare.checked) {
    mesh.broadcastSnapshot(snapshot);
    appendLog('Published the browser fallback snapshot to connected peers.', 'info');
    appendFeedEntry({
      alias: elements.alias.value.trim() || 'runner',
      kind: report.summary.critical ? 'warning' : 'chat',
      body: `Shared a browser fallback snapshot: ${report.summary.critical} critical, ${report.summary.warning} warning.`,
      sentAt: new Date().toISOString()
    });
  }
}

async function connectMesh() {
  if (!elements.consent.checked) {
    appendLog('Consent is required before joining the audit mesh.', 'warning');
    return;
  }

  const roomId = slugifyRoomId(elements.room.value || 'openclaw');
  if (!roomId) {
    appendLog('Enter a valid room name first.', 'warning');
    return;
  }

  const alias = elements.alias.value.trim() || 'runner';
  elements.room.value = roomId;
  localStorage.setItem('REPLOID_AUDIT_ROOM', roomId);
  localStorage.setItem('REPLOID_AUDIT_ALIAS', alias);

  try {
    await mesh.connect({ roomId, alias });
    state.connected = true;
    updateButtons();
    appendLog(`Connected to audit room ${roomId}.`, 'info');
    appendFeedEntry({
      alias: 'system',
      kind: 'system',
      body: `Joined room ${roomId}. Request runner audits here. Browser fallback audit remains optional.`,
      sentAt: new Date().toISOString()
    });

    if (state.localReport && elements.autoShare.checked) {
      mesh.broadcastSnapshot(
        buildAuditSnapshot(state.localReport, { alias, peerId: mesh.peerId })
      );
    }
  } catch (error) {
    appendLog(`Failed to connect: ${error.message}`, 'error');
  }
}

function disconnectMesh() {
  mesh.disconnect();
  state.connected = false;
  updateButtons();
  appendLog('Disconnected from the audit mesh.', 'info');
  appendFeedEntry({
    alias: 'system',
    kind: 'system',
    body: 'Disconnected from the room.',
    sentAt: new Date().toISOString()
  });
}

function requestRunnerAudit() {
  if (!state.connected) {
    appendLog('Connect the room before requesting an audit.', 'warning');
    return;
  }

  const request = {
    requestedBy: elements.alias.value.trim() || 'runner',
    roomId: elements.room.value.trim() || 'openclaw',
    note: 'Run SECURITY_AUDIT.md locally and publish only a sanitized snapshot.',
    sentAt: new Date().toISOString()
  };

  mesh.broadcastAuditRequest(request);
  appendLog('Broadcast an audit request to the room.', 'info');
  appendFeedEntry({
    alias: request.requestedBy,
    kind: 'system',
    body: 'Requested a runner-driven self-audit. Follow SECURITY_AUDIT.md and publish only a sanitized snapshot.',
    sentAt: request.sentAt
  });
}

async function copyRunnerPrompt() {
  const prompt = buildRunnerPrompt();
  try {
    await navigator.clipboard.writeText(prompt);
    appendLog('Copied the runner audit prompt to the clipboard.', 'info');
  } catch {
    appendLog('Copy failed. Use the prompt box directly.', 'warning');
  }
}

async function copyShareLink() {
  const roomId = slugifyRoomId(elements.room.value || 'openclaw');
  if (!roomId) return;

  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  url.searchParams.set('consent', '1');

  try {
    await navigator.clipboard.writeText(url.toString());
    appendLog('Copied the room link to the clipboard.', 'info');
  } catch {
    appendLog(`Copy failed. Share this URL manually: ${url.toString()}`, 'warning');
  }
}

function publishRunnerSnapshot() {
  const raw = elements.snapshotInput.value.trim();
  if (!raw) {
    appendLog('Paste a sanitized runner snapshot JSON first.', 'warning');
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    appendLog('Snapshot JSON is invalid.', 'error');
    return;
  }

  const snapshot = normalizeAuditSnapshot(parsed, {
    alias: elements.alias.value.trim() || 'runner',
    peerId: mesh.peerId
  });

  state.peerReports.set(`local-publish:${Date.now()}`, {
    peerId: snapshot.actor.peerId,
    alias: snapshot.actor.alias,
    snapshot
  });
  renderPeerFindings();
  mesh.broadcastSnapshot(snapshot);
  appendLog('Published a sanitized runner snapshot to the room.', 'info');
  appendFeedEntry({
    alias: snapshot.actor.alias,
    kind: snapshot.summary.critical ? 'warning' : 'chat',
    body: `Published a runner snapshot: ${snapshot.summary.critical} critical, ${snapshot.summary.warning} warning.`,
    sentAt: snapshot.generatedAt
  });
}

function handleMeshEvent(type, detail) {
  if (type === 'signaling-state') {
    elements.signalingState.textContent = detail.state;
    if (detail.state === 'disconnected') {
      state.connected = false;
      updateButtons();
    }
    return;
  }

  if (type === 'peer-state') {
    renderPeerList(detail.peers || []);
    return;
  }

  if (type === 'peer-report') {
    state.peerReports.set(detail.peerId, detail);
    renderPeerFindings();
    appendLog(`Received audit snapshot from ${detail.alias}.`, detail.snapshot?.summary?.critical ? 'warning' : 'info');
    appendFeedEntry({
      alias: detail.alias,
      kind: detail.snapshot?.summary?.critical ? 'warning' : 'chat',
      body: `Published a runner snapshot: ${detail.snapshot?.summary?.critical || 0} critical, ${detail.snapshot?.summary?.warning || 0} warning.`,
      sentAt: detail.snapshot?.generatedAt || new Date().toISOString()
    });
    return;
  }

  if (type === 'audit-request') {
    appendLog(`Received an audit request from ${detail.alias}.`, 'info');
    appendFeedEntry({
      alias: detail.alias,
      kind: 'system',
      body: detail.request?.note || 'Requested a runner-driven self-audit.',
      sentAt: detail.request?.sentAt || new Date().toISOString()
    });
    return;
  }

  if (type === 'chat-message') {
    appendFeedEntry({
      alias: detail.alias,
      kind: detail.message.kind,
      body: detail.message.body,
      sentAt: detail.message.sentAt
    });
    return;
  }

  if (type === 'log') {
    appendLog(detail.message, detail.level === 'error' ? 'error' : detail.level === 'warning' ? 'warning' : 'info');
  }
}

function sendChatMessage() {
  const body = elements.chatInput.value.trim();
  if (!body) return;

  const entry = {
    alias: elements.alias.value.trim() || 'runner',
    kind: /^warn:/i.test(body) ? 'warning' : 'chat',
    body: body.slice(0, 280),
    sentAt: new Date().toISOString()
  };

  appendFeedEntry(entry);
  if (state.connected) {
    mesh.broadcastChatMessage(entry);
  } else {
    appendLog('Message stayed local because the room is not connected.', 'warning');
  }

  elements.chatInput.value = '';
}

function bootstrap() {
  const params = new URLSearchParams(window.location.search);
  const storedRoom = localStorage.getItem('REPLOID_AUDIT_ROOM');
  const storedAlias = localStorage.getItem('REPLOID_AUDIT_ALIAS');

  elements.room.value = slugifyRoomId(params.get('room') || storedRoom || 'openclaw');
  elements.alias.value = storedAlias || `runner-${mesh.peerId.slice(-4)}`;
  elements.consent.checked = params.get('consent') === '1';
  elements.signalingState.textContent = 'disconnected';
  elements.peerCount.textContent = '0';
  elements.localSummary.textContent = 'not run';
  elements.peerSummary.textContent = '0';
  elements.lastAudit.textContent = 'never';
  elements.specLink.href = '/SECURITY_AUDIT.md';
  elements.runnerPrompt.value = buildRunnerPrompt();

  renderFindings(elements.localFindings, [], 'No browser fallback audit has run yet.');
  renderFindings(elements.peerFindings, [], 'Runner warnings will appear here once connected peers publish sanitized snapshots.');
  renderPeerList([]);
  renderFeed();
  updateButtons();

  elements.consent.addEventListener('change', () => {
    updateButtons();
    elements.runnerPrompt.value = buildRunnerPrompt();
  });
  elements.room.addEventListener('input', () => {
    elements.runnerPrompt.value = buildRunnerPrompt();
  });
  elements.alias.addEventListener('input', () => {
    elements.runnerPrompt.value = buildRunnerPrompt();
  });
  elements.connect.addEventListener('click', connectMesh);
  elements.disconnect.addEventListener('click', disconnectMesh);
  elements.requestAudit.addEventListener('click', requestRunnerAudit);
  elements.copyPrompt.addEventListener('click', copyRunnerPrompt);
  elements.copyLink.addEventListener('click', copyShareLink);
  elements.publishSnapshot.addEventListener('click', publishRunnerSnapshot);
  elements.runAudit.addEventListener('click', runBrowserFallbackAudit);
  elements.sendChat.addEventListener('click', sendChatMessage);
  elements.chatInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      sendChatMessage();
    }
  });

  appendLog('Audit room ready. Runner-driven self-audit is the primary path. Browser fallback remains available.', 'info');
  appendFeedEntry({
    alias: 'system',
    kind: 'system',
    body: 'Audit room online. Request runner audits, publish sanitized snapshots, and use browser fallback only when needed.',
    sentAt: new Date().toISOString()
  });
}

bootstrap();
