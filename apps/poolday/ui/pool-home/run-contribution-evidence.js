/**
 * @fileoverview A run's proof layer: which contributor tabs were selected, matched, flagged or
 * excluded, under which verification policy.
 */
import { escapeHtml } from '../../../../shared/ui/components/html.js';
import { compactHash } from './view-markup.js';

const receiptTokenTotal = (record = {}) => {
  const receipt = record.receipt || record.body?.receipt || record;
  const counts = receipt.tokenCounts || record.tokenCounts || {};
  const input = Number(counts.input || 0);
  const output = Number(counts.output || 0);
  const tokenIds = record.tokenIds || record.body?.tokenIds || receipt.tokenIds || [];
  return (Number.isFinite(input) ? input : 0)
    + (Number.isFinite(output) && output > 0 ? output : Array.isArray(tokenIds) ? tokenIds.length : 0);
};

const formatContributionPolicy = (policyId) => ({
  fastest_receipt: 'One peer',
  canary_audited: 'One peer with audit',
  redundant_agreement: 'Two matching peers',
  ring_quorum_receipt: 'Peer quorum'
}[policyId] || String(policyId || 'default').replace(/_/g, ' '));

export const renderRunContributionLayer = (value = {}) => {
  if (value.transport === 'local_capsule') return `
    <div class="pool-contributor-layer">
      <div class="pool-contributor-summary pool-small pool-muted"><span><b>Execution</b>This device</span><span><b>Sharing</b>Unchanged</span></div>
      <p class="pool-caption">Signed model and local execution receipt verified. No independent contributor comparison.</p>
    </div>
  `;
  const payloads = Array.isArray(value.receiptPayloads) ? value.receiptPayloads : [];
  const assignments = Array.isArray(value.assignments) ? value.assignments : [];
  const agreement = value.agreement || {};
  const acceptedHashes = new Set(agreement.receiptHashes || []);
  const validHashes = new Set((agreement.validRecords || []).map((record) => record.receiptHash).filter(Boolean));
  const rejectedByHash = new Map((agreement.rejectedRecords || []).map((record) => [
    record.receiptHash || record.receiptPayload?.body?.receiptHash || record.receiptPayload?.fromPeerId || 'unknown',
    record.reasons || []
  ]));
  const rows = payloads.map((payload) => {
    const body = payload.body || payload;
    const receipt = body.receipt || {};
    const hash = body.receiptHash || receipt.receiptHash || '';
    const providerId = body.providerId || receipt.providerId || payload.fromPeerId || 'unknown';
    const status = acceptedHashes.has(hash)
      ? 'matched'
      : validHashes.has(hash)
        ? 'returned'
        : 'flagged';
    const reason = rejectedByHash.get(hash)?.join('; ') || null;
    return {
      providerId,
      status,
      hash,
      tokens: receiptTokenTotal(body),
      outputHash: receipt.outputHash || body.outputHash || null,
      reason
    };
  });
  const assignmentRows = rows.length ? rows : assignments.map((assignment) => ({
    providerId: assignment.providerId || 'unknown',
    status: 'selected',
    hash: assignment.assignmentId || assignment.jobId || '—',
    tokens: '—',
    outputHash: null,
    reason: null
  }));
  const policyId = value.policyId || agreement.policyId || value.assignment?.policyId || 'default';
  const checkStatus = agreement.accepted
    ? `${agreement.acceptedProviderCount || acceptedHashes.size || 1}/${agreement.requiredAgreement || 1} matched`
    : value.status === 'finding_peer_provider'
      ? 'waiting for matching tabs'
      : 'not accepted';
  const sharedCount = assignments.length || value.acceptedSessionCount || rows.length || 0;
  const routeDecision = value.plan?.routeDecision || value.routeDecision || null;
  const routeCandidates = Array.isArray(routeDecision?.candidates) ? routeDecision.candidates : [];
  const selectedRoute = routeCandidates.find((candidate) => (
    routeDecision.selectedProviderIds?.includes(candidate.providerId)
  ));
  const rejectedRoutes = routeCandidates.filter((candidate) => !candidate.eligible);
  return `
    <div class="pool-contributor-layer">
      <div class="pool-contributor-summary pool-small pool-muted">
        <span><b>Shared</b>${escapeHtml(sharedCount)} contributor tab${sharedCount === 1 ? '' : 's'}</span>
        <span><b>Match</b>${escapeHtml(checkStatus)}</span>
        <span><b>Policy</b>${escapeHtml(formatContributionPolicy(policyId))}</span>
      </div>
      ${routeDecision ? `
        <div class="pool-contributor-summary pool-small pool-muted pool-route-summary pool-edge-top">
          <span><b>Artifact</b>${escapeHtml(String(selectedRoute?.artifactSourcePlan || 'provider_loaded_model').replace(/_/g, ' '))}</span>
          <span><b>Eligible</b>${escapeHtml(routeCandidates.filter((candidate) => candidate.eligible).length)}</span>
          <span><b>Excluded</b>${escapeHtml(rejectedRoutes.length)}</span>
        </div>
        ${rejectedRoutes.length ? `
          <details class="pool-route-rejections">
            <summary>Why other contributors were excluded</summary>
            <ul>
              ${rejectedRoutes.map((candidate) => `
                <li><b>${escapeHtml(compactHash(candidate.providerId || 'unknown'))}</b>: ${escapeHtml((candidate.rejectionReasons || []).join(', ') || 'not eligible')}</li>
              `).join('')}
            </ul>
          </details>
        ` : ''}
      ` : ''}
      ${assignmentRows.length ? `
        <div class="pool-ledger pool-table pool-contributor-table" role="table" aria-label="Answer contributors">
          <table>
            <thead>
              <tr>
                <th>Contributor</th>
                <th>Status</th>
                <th>Tokens</th>
                <th>Output</th>
              </tr>
            </thead>
            <tbody>
              ${assignmentRows.map((row) => `
                <tr>
                  <td title="${escapeHtml(compactHash(row.providerId))}">${escapeHtml(compactHash(row.providerId))}</td>
                  <td title="${escapeHtml(row.reason || row.status)}">${escapeHtml(row.status)}</td>
                  <td>${escapeHtml(row.tokens || '—')}</td>
                  <td title="${escapeHtml(row.outputHash || row.hash || '—')}">${escapeHtml(compactHash(row.outputHash || row.hash || '—'))}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : '<p class="pool-caption pool-receipt-empty">Contributor evidence appears after matching tabs answer.</p>'}
    </div>
  `;
};

export const renderContributionDetails = (id, label = 'Contributors') => `
  <details class="pool-raw-details pool-disclosure pool-contributor-details">
    <summary>${escapeHtml(label)}</summary>
    <div class="pool-contributor-content" id="${id}-evidence" aria-live="polite">
      ${renderRunContributionLayer({ status: 'finding_peer_provider' })}
    </div>
  </details>
`;
