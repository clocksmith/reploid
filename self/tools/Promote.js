/**
 * @fileoverview Promote - Evidence-gated shadow candidate promotion.
 */

import {
  TEXT_LIMIT_BYTES,
  defaultAllowTargetPath,
  getEvidenceBoolean,
  getEvidenceHash,
  getEvidencePath,
  isValidatorMutationTarget,
  isWithinRoot,
  normalizePromotionPath as normalizePath,
  parseEvidence,
  readRequired,
  sha256,
  textBytes
} from '../core/promotion-policy.js';

const pickArg = (args, keys) => {
  for (const key of keys) {
    const value = args?.[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
};

const resolvePromotePath = (args, keys, label, hint) => {
  const rawPath = pickArg(args, keys);
  if (!rawPath) {
    return {
      path: '',
      error: `${label} missing. ${hint}`
    };
  }

  try {
    return { path: normalizePath(rawPath), error: null };
  } catch (error) {
    return {
      path: '',
      error: `${label} invalid: ${error.message}`
    };
  }
};

export async function promoteShadowCandidate(args = {}, deps = {}) {
  const { VFS, EventBus, AuditLogger, logger } = deps;
  if (!VFS) throw new Error('VFS not available');

  const candidate = resolvePromotePath(
    args,
    ['candidatePath', 'source', 'sourcePath', 'from', 'src', 'candidate', 'path'],
    'candidatePath',
    'Use candidatePath: /shadow/tools/MyTool.js.'
  );
  const target = resolvePromotePath(
    args,
    ['targetPath', 'target', 'destination', 'dest', 'to'],
    'targetPath',
    'Use targetPath: /self/tools/MyTool.js.'
  );
  const evidenceArg = resolvePromotePath(
    args,
    ['evidencePath', 'tracePath', 'evidence', 'proofPath'],
    'evidencePath',
    'Write evidence under /artifacts and pass evidencePath: /artifacts/MyTool-evidence.json.'
  );
  const candidatePath = candidate.path;
  const targetPath = target.path;
  const evidencePath = evidenceArg.path;
  const allowTargetPath = typeof deps.allowTargetPath === 'function'
    ? deps.allowTargetPath
    : defaultAllowTargetPath;

  const reasons = [];
  for (const error of [candidate.error, target.error, evidenceArg.error]) {
    if (error) reasons.push(error);
  }
  if (candidatePath && !isWithinRoot(candidatePath, '/shadow')) {
    reasons.push('candidatePath must be under /shadow');
  }
  if (targetPath && !isWithinRoot(targetPath, '/self')) {
    reasons.push('targetPath must be under /self');
  }
  if (targetPath && !allowTargetPath(targetPath)) {
    reasons.push('targetPath is not allowlisted for Promote');
  }
  if (evidencePath && !isWithinRoot(evidencePath, '/artifacts')) {
    reasons.push('evidencePath must be under /artifacts');
  }

  if (reasons.length > 0) {
    return { ok: false, promoted: false, candidatePath, targetPath, evidencePath, reasons };
  }

  let candidateContent = '';
  let evidenceContent = '';
  try {
    candidateContent = await readRequired(VFS, candidatePath, 'candidate');
    evidenceContent = await readRequired(VFS, evidencePath, 'evidence');
  } catch (error) {
    return { ok: false, promoted: false, candidatePath, targetPath, evidencePath, reasons: [error.message] };
  }

  if (textBytes(candidateContent) > TEXT_LIMIT_BYTES) {
    return { ok: false, promoted: false, candidatePath, targetPath, evidencePath, reasons: [`candidate exceeds limit (${TEXT_LIMIT_BYTES} bytes)`] };
  }

  let evidence;
  try {
    evidence = parseEvidence(evidenceContent, evidencePath);
  } catch (error) {
    return { ok: false, promoted: false, candidatePath, targetPath, evidencePath, reasons: [error.message] };
  }

  const evidenceCandidatePath = getEvidencePath(evidence, 'candidatePath');
  const evidenceTargetPath = getEvidencePath(evidence, 'targetPath');
  const evidenceEvidencePath = getEvidencePath(evidence, 'evidencePath');
  const replayPassed = getEvidenceBoolean(evidence, 'replayPassed');

  if (evidenceCandidatePath && evidenceCandidatePath !== candidatePath) {
    reasons.push('evidence candidatePath does not match request');
  }
  if (evidenceTargetPath && evidenceTargetPath !== targetPath) {
    reasons.push('evidence targetPath does not match request');
  }
  if (evidenceEvidencePath && evidenceEvidencePath !== evidencePath) {
    reasons.push('evidence evidencePath does not match request');
  }
  if (replayPassed !== true) {
    reasons.push('evidence replayPassed must be true');
  }

  const expectedCandidateHash = getEvidenceHash(evidence, 'candidateHash') || getEvidenceHash(evidence, 'candidateSha256');
  const expectedTargetHash = getEvidenceHash(evidence, 'targetHash') || getEvidenceHash(evidence, 'targetSha256');
  let nextHash = null;
  if (expectedCandidateHash || expectedTargetHash) {
    try {
      nextHash = await sha256(candidateContent);
    } catch (error) {
      reasons.push(error.message);
    }
    if (nextHash && expectedCandidateHash && expectedCandidateHash !== nextHash) {
      reasons.push('candidate hash does not match evidence');
    }
    if (nextHash && expectedTargetHash && expectedTargetHash !== nextHash) {
      reasons.push('target hash does not match evidence');
    }
  }

  if (reasons.length > 0) {
    return { ok: false, promoted: false, candidatePath, targetPath, evidencePath, reasons };
  }

  if (isValidatorMutationTarget(targetPath)) {
    const quarantineId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const quarantinePath = `/artifacts/quarantine/${quarantineId}.json`;
    const result = {
      ok: false,
      promoted: false,
      quarantined: true,
      candidatePath,
      targetPath,
      evidencePath,
      quarantinePath,
      reasons: ['validator mutation requires external review and cannot be self-approved']
    };

    await VFS.write(quarantinePath, JSON.stringify({
      schema: 'reploid/validator-quarantine/v1',
      timestamp: Date.now(),
      ...result,
      candidateHash: nextHash,
      evidence
    }, null, 2));
    EventBus?.emit?.('promotion:quarantined', result);
    if (AuditLogger?.logEvent) {
      await AuditLogger.logEvent('PROMOTE_QUARANTINED', result, 'WARN');
    }
    logger?.warn?.(`[Promote] Quarantined validator mutation ${candidatePath} -> ${targetPath}`);
    return result;
  }

  let previousHash = null;
  const targetExisted = await VFS.exists(targetPath);
  if (targetExisted) {
    try {
      previousHash = await sha256(await VFS.read(targetPath));
    } catch {
      previousHash = null;
    }
  }
  if (!nextHash) {
    try {
      nextHash = await sha256(candidateContent);
    } catch {
      nextHash = null;
    }
  }

  await VFS.write(targetPath, candidateContent);

  const result = {
    ok: true,
    promoted: true,
    candidatePath,
    targetPath,
    evidencePath,
    bytesWritten: textBytes(candidateContent),
    targetExisted,
    previousHash,
    targetHash: nextHash,
    reasons: []
  };

  EventBus?.emit?.('promotion:accepted', result);
  if (AuditLogger?.logEvent) {
    await AuditLogger.logEvent('PROMOTE_ACCEPTED', result, 'INFO');
  }
  logger?.info?.(`[Promote] Promoted ${candidatePath} to ${targetPath}`);
  return result;
}

async function call(args = {}, deps = {}) {
  return promoteShadowCandidate(args, deps);
}

export const tool = {
  name: 'Promote',
  description: 'Promote a /shadow candidate into an allowlisted /self target when evidence JSON says replayPassed is true. Use candidatePath, targetPath, and evidencePath.',
  inputSchema: {
    type: 'object',
    required: ['candidatePath', 'targetPath', 'evidencePath'],
    properties: {
      candidatePath: { type: 'string', description: 'Candidate VFS path under /shadow.' },
      targetPath: { type: 'string', description: 'Allowlisted target VFS path under /self.' },
      evidencePath: { type: 'string', description: 'Evidence JSON path under /artifacts.' },
      source: { type: 'string', description: 'Alias for candidatePath.' },
      sourcePath: { type: 'string', description: 'Alias for candidatePath.' },
      target: { type: 'string', description: 'Alias for targetPath.' },
      destination: { type: 'string', description: 'Alias for targetPath.' },
      evidence: { type: 'string', description: 'Alias for evidencePath.' },
      proofPath: { type: 'string', description: 'Alias for evidencePath.' }
    }
  },
  call
};

export default call;
