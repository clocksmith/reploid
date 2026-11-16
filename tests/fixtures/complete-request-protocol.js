// Shared owned local JSONL boundary; this is not HTTP/WebRTC timing.
import { createInterface } from 'node:readline';
export const COMPLETE_RESPONSE_PREFIX = '@q4-response ';

export async function serveCompleteRequestProtocol({ invoke, onClose, input = process.stdin, output = process.stdout }) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  let closed = false;
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      let request, response, succeeded = false;
      try {
        request = JSON.parse(line);
        const value = await invoke(request);
        response = { id: request.id, requestOp: request.op, value }; succeeded = true;
      } catch (error) {
        response = { id: request?.id ?? null, requestOp: request?.op ?? null,
          error: { name: error.name, message: error.message, stack: error.stack } };
      }
      const bytes = COMPLETE_RESPONSE_PREFIX + JSON.stringify(response) + '\n';
      await new Promise((resolve, reject) => output.write(bytes, error => error ? reject(error) : resolve()));
      if (succeeded && request.op === 'close') { closed = true; break; }
    }
  } finally {
    lines.close();
    if (!closed) await onClose();
  }
}
