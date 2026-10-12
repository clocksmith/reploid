import policy from '../config/chat-context-policy.json' with { type: 'json' };

const words = text => text.trim() ? text.trim().split(/\s+/u).length : 0;

/** Build application context from the host's identity-bound catalog, never discovery labels. */
export function createChatContext(selection = {}, model = null, catalog = []) {
  const enabled = selection.enabled ?? policy.defaultEnabled;
  const maxWords = selection.maxWords ?? policy.defaultMaxWords;
  if (typeof enabled !== 'boolean' || !policy.wordLimits.includes(maxWords)) {
    throw new Error('Context must use an on/off choice and a 16, 32, or 64 word cap.');
  }
  const known = catalog.find(item => item.id === model?.id && item.identity === model?.identity);
  let content = enabled ? policy.base : '';
  const append = clause => {
    const proposed = `${content} ${clause}`;
    if (words(proposed) <= maxWords) content = proposed;
  };
  if (enabled && maxWords >= 32) append(policy.details);
  if (enabled && known) {
    if (typeof known.name === 'string' && known.name.length <= 80 && !/[\r\n]/u.test(known.name)) {
      append(`Model: ${known.name}.`);
    }
    if (maxWords >= 32) append(`Model ID: ${known.id}.`);
    if (maxWords >= 64) append(`Model identity: ${known.identity}.`);
  }
  return {
    content,
    metadata: { policyId: policy.id, enabled, maxWords, wordCount: words(content),
      modelIdentity: known?.identity || null, mode: null }
  };
}
