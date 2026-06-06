/**
 * @fileoverview Promote - Evidence-gated shadow candidate promotion.
 */

const TEXT_LIMIT_BYTES = 8 * 1024 * 1024;
const VFS_PREFIX = 'vfs:';

const ALLOWED_TARGET_ROOTS = Object.freeze([
  '/self/capabilities',
  '/self/capsule',
  '/self/config',
  '/self/core',
  '/self/host',
  '/self/infrastructure',
  '/self/kernel',
  '/self/tools',
  '/self/prompts',
  '/self/blueprints',
  '/self/pool',
  '/self/styles',
  '/self/ui'
]);

const ALLOWED_TARGET_PATHS = Object.freeze([
  '/self/blueprint-index.json',
  '/self/boot-spec.js',
  '/self/bridge.js',
  '/self/environment.js',
  '/self/identity.js',
  '/self/instance.js',
  '/self/manifest.js',
  '/self/receipt.js',
  '/self/reward-policy.js',
  '/self/runtime.js',
  '/self/self.json',
  '/self/swarm.js',
  '/self/tool-runner.js'
]);

const ALLOWED_TARGET_EXTENSIONS = Object.freeze([
  '.js',
  '.json',
  '.md',
  '.css',
  '.html'
]);

const normalizePath = (rawPath) => {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error('Missing path argument');
  }

  let path = rawPath.trim();
  if (path.startsWith(VFS_PREFIX)) {
    path = path.slice(VFS_PREFIX.length);
  }

  path = '/' + path.replace(/^\/+/, '');
  if (path.split('/').includes('..')) {
    throw new Error('Path traversal is not allowed');
  }
  return path;
};

const isWithinRoot = (path, root) => {
  const normalizedRoot = root.endsWith('/') ? root.slice(0, -1) : root;
  return path === normalizedRoot || path.startsWith(`${normalizedRoot}/`);
};

const hasAllowedExtension = (path) => ALLOWED_TARGET_EXTENSIONS.some((extension) => path.endsWith(extension));

const defaultAllowTargetPath = (path) => (
  (ALLOWED_TARGET_PATHS.includes(path) || ALLOWED_TARGET_ROOTS.some((root) => isWithinRoot(path, root)))
    && hasAllowedExtension(path)
);

const textBytes = (content) => {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(String(content)).length;
  }
  return String(content).length;
};

const sha256 = async (content) => {
  if (!globalThis.crypto?.subtle) {
    throw new Error('SHA-256 not available in this environment');
  }
  const bytes = typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(String(content))
    : Uint8Array.from(String(content), (char) => char.charCodeAt(0));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const parseEvidence = (content, evidencePath) => {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Evidence is not valid JSON: ${evidencePath}`);
  }
};

const readRequired = async (VFS, path, label) => {
  const exists = await VFS.exists(path);
  if (!exists) {
    throw new Error(`${label} not found: ${path}`);
  }
  return VFS.read(path);
};

const getEvidencePath = (evidence, key) => {
  const value = evidence?.[key] || evidence?.promotion?.[key];
  return typeof value === 'string' && value.trim() ? normalizePath(value) : '';
};

const getEvidenceBoolean = (evidence, key) => {
  if (typeof evidence?.[key] === 'boolean') return evidence[key];
  if (typeof evidence?.promotion?.[key] === 'boolean') return evidence.promotion[key];
  return false;
};

const getEvidenceHash = (evidence, key) => {
  const value = evidence?.[key] || evidence?.promotion?.[key];
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : '';
};

export async function promoteShadowCandidate(args = {}, deps = {}) {
  const { VFS, EventBus, AuditLogger, logger } = deps;
  if (!VFS) throw new Error('VFS not available');

  const candidatePath = normalizePath(args.candidatePath || args.path);
  const targetPath = normalizePath(args.targetPath || args.target);
  const evidencePath = normalizePath(args.evidencePath || args.tracePath);
  const allowTargetPath = typeof deps.allowTargetPath === 'function'
    ? deps.allowTargetPath
    : defaultAllowTargetPath;

  const reasons = [];
  if (!isWithinRoot(candidatePath, '/shadow')) {
    reasons.push('candidatePath must be under /shadow');
  }
  if (!isWithinRoot(targetPath, '/self')) {
    reasons.push('targetPath must be under /self');
  }
  if (!allowTargetPath(targetPath)) {
    reasons.push('targetPath is not allowlisted for Promote');
  }
  if (!isWithinRoot(evidencePath, '/artifacts')) {
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
  description: 'Promote a /shadow candidate into an allowlisted /self target when evidence JSON says replayPassed is true.',
  inputSchema: {
    type: 'object',
    required: ['candidatePath', 'targetPath', 'evidencePath'],
    properties: {
      candidatePath: { type: 'string', description: 'Candidate VFS path under /shadow.' },
      targetPath: { type: 'string', description: 'Allowlisted target VFS path under /self.' },
      evidencePath: { type: 'string', description: 'Evidence JSON path under /artifacts.' }
    }
  },
  call
};

export default call;
