/**
 * @fileoverview Runtime-neutral Poolday request policy validation.
 */

export const POOLDAY_POLICY_CLASSES = Object.freeze({
  publicText: 'public_text',
  codeHelp: 'code_help',
  benchmarkEval: 'benchmark_eval',
  pii: 'pii',
  secrets: 'secrets',
  medicalPrivate: 'medical_private',
  illegalContent: 'illegal_content'
});

const BLOCKED_PUBLIC_PROVIDER_CLASSES = new Set([
  POOLDAY_POLICY_CLASSES.pii,
  POOLDAY_POLICY_CLASSES.secrets,
  POOLDAY_POLICY_CLASSES.medicalPrivate,
  POOLDAY_POLICY_CLASSES.illegalContent
]);

export function classifyPooldayPrompt(prompt = '') {
  const text = String(prompt || '');
  const classes = new Set([POOLDAY_POLICY_CLASSES.publicText]);
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)) classes.add(POOLDAY_POLICY_CLASSES.pii);
  if (/\b(api[_-]?key|secret|password|private[_-]?key|token)\b\s*[:=]/i.test(text)) classes.add(POOLDAY_POLICY_CLASSES.secrets);
  if (/\b(sk-[a-z0-9]{12,}|AIza[0-9A-Za-z_-]{20,})\b/.test(text)) classes.add(POOLDAY_POLICY_CLASSES.secrets);
  if (/\b(patient|diagnosis|medical record|prescription)\b/i.test(text)) classes.add(POOLDAY_POLICY_CLASSES.medicalPrivate);
  if (/\b(malware|credential theft|phishing kit|exploit chain)\b/i.test(text)) classes.add(POOLDAY_POLICY_CLASSES.illegalContent);
  return Object.freeze({
    classes: [...classes],
    blockedClasses: [...classes].filter((policyClass) => BLOCKED_PUBLIC_PROVIDER_CLASSES.has(policyClass)),
    publicProviderSafe: [...classes].every((policyClass) => !BLOCKED_PUBLIC_PROVIDER_CLASSES.has(policyClass))
  });
}

export function validatePooldayPolicyClasses(request = {}) {
  const reasons = [];
  const classification = classifyPooldayPrompt(request.prompt || '');
  const explicitTags = Array.isArray(request.policyTags) ? request.policyTags.map(String) : [];
  const blockedTags = explicitTags.filter((tag) => BLOCKED_PUBLIC_PROVIDER_CLASSES.has(tag));
  if (classification.blockedClasses.length > 0) {
    reasons.push(`prompt policy classes are not allowed for public browser providers: ${classification.blockedClasses.join(', ')}`);
  }
  if (blockedTags.length > 0) {
    reasons.push(`policyTags are not allowed for public browser providers: ${blockedTags.join(', ')}`);
  }
  return {
    ok: reasons.length === 0,
    reasons,
    classification: {
      ...classification,
      explicitTags
    }
  };
}

export function validateGenerationConfig(config = {}, expectedConfig = {}) {
  const reasons = [];
  const allowedKeys = new Set(Object.keys(expectedConfig));
  for (const [key, expected] of Object.entries(expectedConfig)) {
    if (config[key] !== expected) reasons.push(`generationConfig.${key} must be ${expected}`);
  }
  for (const key of Object.keys(config || {})) {
    if (!allowedKeys.has(key)) reasons.push(`generationConfig.${key} is not allowed`);
  }
  return reasons;
}
