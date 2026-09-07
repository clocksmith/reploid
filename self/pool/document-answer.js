/** Local reference accounting. Citation presence never establishes semantic support. */
export function inspectDocumentAnswer({ text, passages, abstention }) {
  if (text.trim() === abstention) {
    return { status: 'abstained', citations: [], claims: [], errors: [], support: 'not-evaluated' };
  }
  const references = value => [...new Set([...value.matchAll(/\[(\d+)\]/g)].map(match => Number(match[1])))];
  const citations = references(text);
  const errors = [];
  if (!text.trim() || !citations.length || citations.some(number => !Number.isSafeInteger(number)
    || number < 1 || number > passages.length)) errors.push('Missing or invalid passage references');
  const claims = [];
  for (const segment of new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)) {
    let start = segment.index;
    let value = segment.segment;
    // A reference after a full stop belongs to the preceding sentence.
    const trailing = claims.length && value.match(/^(?:\s*\[\d+\])+\s*/u);
    if (trailing) {
      const previous = claims.at(-1);
      previous.end = start + trailing[0].trimEnd().length;
      previous.text = text.slice(previous.start, previous.end);
      start += trailing[0].length;
      value = value.slice(trailing[0].length);
    }
    if (!value.trim()) continue;
    start += value.length - value.trimStart().length;
    const end = start + value.trim().length;
    claims.push({ start, end, text: text.slice(start, end) });
  }
  for (const claim of claims) {
    claim.citations = references(claim.text);
    claim.passages = claim.citations.filter(number => passages[number - 1])
      .map(number => ({ number, ...passages[number - 1] }));
    claim.support = 'not-evaluated';
    if (!claim.citations.length) errors.push(`Missing passage references for sentence at offset ${claim.start}`);
  }
  return { status: errors.length ? 'invalid' : 'cited', citations, claims, errors, support: 'not-evaluated' };
}
