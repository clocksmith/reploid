// Search provider replies may be JSON, or JSON-RPC framed as server-sent events.
// Count the decoded HTTP body bytes even when Content-Length is absent or compressed.
export const SEARCH_RESPONSE_BYTES = 2_000_000;
const MAX_JSON_DEPTH = 64;

export async function* searchTextChunks(response, limit = SEARCH_RESPONSE_BYTES) {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader(), decoder = new TextDecoder();
  let size = 0, finished = false;
  try {
    if (Number(response.headers.get('content-length')) > limit) throw new RangeError('Search response exceeds the byte limit');
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new RangeError('Search response exceeds the byte limit');
      yield decoder.decode(value, { stream: true });
    }
    finished = true;
    yield decoder.decode();
  } finally {
    if (!finished) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function parseSearchJson(text) {
  let depth = 0, quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '\\') index++;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '[' || char === '{') {
      if (++depth > MAX_JSON_DEPTH) throw new RangeError('Search response exceeds the nesting limit');
    } else if (char === ']' || char === '}') depth--;
  }
  return JSON.parse(text);
}

export async function readSearchJson(response) {
  const chunks = [];
  for await (const chunk of searchTextChunks(response)) chunks.push(chunk);
  return parseSearchJson(chunks.join(''));
}
