/** Preserve strict JSONL parsing: a malformed nonblank row rejects the document. */
export function parseJsonl(content) {
  if (!content) return [];
  return content.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
}

export function toJsonl(rows) {
  return rows.map(item => JSON.stringify(item)).join('\n');
}
