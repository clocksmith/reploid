export const ARTIFACT_ORIGIN_PROVIDERS = Object.freeze([
  'huggingface',
  'gcs',
  'https-preservation'
]);

const HF_REVISION_PATTERN = /^[a-f0-9]{40,64}$/;
const GCS_GENERATION_PATTERN = /^[1-9][0-9]*$/;
const GCS_BUCKET_PATTERN = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;
const HF_REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const FORBIDDEN_ARTIFACT_PATH_PATTERN = /[\\?#\u0000-\u001f\u007f]/;

const text = (value) => String(value || '').trim();
const hasTraversal = (value) => text(value).split('/').includes('..');

const validateRelativePath = (reasons, value, field) => {
  const path = text(value);
  if (!path) reasons.push(`${field} is required`);
  if (path.startsWith('/') || hasTraversal(path)) reasons.push(`${field} must be artifact-relative`);
  if (FORBIDDEN_ARTIFACT_PATH_PATTERN.test(path)) reasons.push(`${field} contains a forbidden URL delimiter`);
};

const encodeArtifactPath = (value) => text(value).split('/').map(encodeURIComponent).join('/');

export function validateArtifactOrigin(origin = {}, { allowPreservation = false } = {}) {
  const reasons = [];
  if (!origin || typeof origin !== 'object' || Array.isArray(origin)) {
    return { ok: false, reasons: ['artifact origin must be an object'] };
  }
  if (!ARTIFACT_ORIGIN_PROVIDERS.includes(origin.provider)) {
    reasons.push('artifact origin provider is unsupported');
  } else if (origin.provider === 'huggingface') {
    if (!HF_REPO_PATTERN.test(text(origin.repoId))) {
      reasons.push('Hugging Face origin repoId must be an owner/repository identifier');
    }
    if (!HF_REVISION_PATTERN.test(text(origin.revision))) {
      reasons.push('Hugging Face origin revision must be a full immutable commit hash');
    }
    validateRelativePath(reasons, origin.path, 'Hugging Face origin path');
  } else if (origin.provider === 'gcs') {
    if (!GCS_BUCKET_PATTERN.test(text(origin.bucket))) reasons.push('GCS origin bucket is invalid');
    validateRelativePath(reasons, origin.object, 'GCS origin object');
    if (!GCS_GENERATION_PATTERN.test(text(origin.generation))) {
      reasons.push('GCS origin generation must pin an immutable object generation');
    }
  } else if (origin.provider === 'https-preservation') {
    if (!allowPreservation) reasons.push('HTTPS preservation origins are mirrors only');
    let url = null;
    try {
      url = new URL(text(origin.url));
    } catch {
      reasons.push('HTTPS preservation origin URL is invalid');
    }
    if (url && (url.protocol !== 'https:' || url.username || url.password || url.search)) {
      reasons.push('HTTPS preservation origin must be credential-free and query-free');
    }
    if (!HF_REVISION_PATTERN.test(text(origin.revision))) {
      reasons.push('HTTPS preservation origin revision must be immutable');
    }
  }
  return { ok: reasons.length === 0, reasons };
}

export function artifactOriginIdentity(origin = {}) {
  const validation = validateArtifactOrigin(origin, {
    allowPreservation: origin.provider === 'https-preservation'
  });
  if (!validation.ok) throw new Error(validation.reasons.join('; '));
  if (origin.provider === 'huggingface') {
    return Object.freeze({
      provider: origin.provider,
      repoId: origin.repoId,
      revision: origin.revision,
      path: origin.path
    });
  }
  if (origin.provider === 'gcs') {
    return Object.freeze({
      provider: origin.provider,
      bucket: origin.bucket,
      object: origin.object,
      generation: String(origin.generation)
    });
  }
  return Object.freeze({
    provider: origin.provider,
    url: origin.url,
    revision: origin.revision
  });
}

export function buildImmutableArtifactOriginUrl(origin = {}) {
  const validation = validateArtifactOrigin(origin);
  if (!validation.ok) throw new Error(validation.reasons.join('; '));
  if (origin.provider === 'huggingface') {
    return `https://huggingface.co/${origin.repoId}/resolve/${origin.revision}/${encodeArtifactPath(origin.path)}`;
  }
  return `https://storage.googleapis.com/${origin.bucket}/${encodeArtifactPath(origin.object)}?generation=${origin.generation}`;
}

export async function resolveArtifactDelivery(origin = {}, {
  visibility = 'private',
  resolvePrivateOrigin = null
} = {}) {
  const identity = artifactOriginIdentity(origin);
  if (visibility === 'public') {
    return { identity, url: buildImmutableArtifactOriginUrl(origin), privateDelivery: false };
  }
  if (typeof resolvePrivateOrigin !== 'function') {
    throw new Error('private artifact origin requires an authorized delivery URL resolver');
  }
  const resolved = await resolvePrivateOrigin(identity);
  const urlValue = typeof resolved === 'string' ? resolved : resolved?.url;
  let url = null;
  try {
    url = new URL(text(urlValue));
  } catch {
    throw new Error('private artifact delivery resolver returned an invalid URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('private artifact delivery URL must use credential-free HTTPS authority');
  }
  return { identity, url: url.toString(), privateDelivery: true };
}

export default {
  ARTIFACT_ORIGIN_PROVIDERS,
  validateArtifactOrigin,
  artifactOriginIdentity,
  buildImmutableArtifactOriginUrl,
  resolveArtifactDelivery
};
