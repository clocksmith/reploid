/** Text identity and word tokens shared by retrieval, citation checks and the fixed test provider. */
const encoder = new TextEncoder();

export const SHA256 = /^sha256:[a-f0-9]{64}$/;

export async function sha256Text(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(String(text)));
  return 'sha256:' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

// Function words carry no checkable content. Negations are deliberately absent.
export const STOPWORDS = new Set(('a an and are as at be been being but by can could did do does for from had has have he her his '
  + 'i if in into is it its may me might my of on or our she should so than that the their them then there these they this '
  + 'those to was we were what when where which who whom why will with would you your also about after before over under '
  + 'such per via').split(' '));

/** Lowercase words and numbers; thousands separators are removed so 1,200 and 1200 compare equal. */
export function wordTokens(text) {
  return (String(text).normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+(?:[.,'’][\p{L}\p{N}]+)*/gu) || [])
    .map(token => /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(token) ? token.replace(/,/g, '') : token);
}

export const contentWords = text => [...new Set(wordTokens(text))].filter(token => !STOPWORDS.has(token)
  && (token.length > 1 || /\p{N}/u.test(token)));
