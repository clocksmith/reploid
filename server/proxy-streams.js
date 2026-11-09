/** Response framing for the legacy provider proxies. */
export const SSE_DONE = 'data: [DONE]';
export const setupSse = (res) => {
  if (res.headersSent) return;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
};

export const streamBufferedText = (res, text = '') => {
  setupSse(res);
  const chunkSize = 256;
  if (!text) {
    res.write('data: {"response":""}\n\n');
    res.write(`${SSE_DONE}\n\n`);
    return res.end();
  }
  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.slice(i, i + chunkSize);
    res.write(`data: ${JSON.stringify({ response: chunk })}\n\n`);
  }
  res.write(`${SSE_DONE}\n\n`);
  res.end();
};

export const streamOpenAIResponse = async (response, res) => {
  setupSse(res);
  if (!response.body) {
    res.write(`${SSE_DONE}\n\n`);
    return res.end();
  }

  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith(':')) continue;
      if (line === 'data: [DONE]') {
        res.write(`${SSE_DONE}\n\n`);
        return res.end();
      }
      if (line.startsWith('data:')) {
        res.write(`${line}\n\n`);
      }
    }
  }
  res.write(`${SSE_DONE}\n\n`);
  res.end();
};

export const streamAnthropicResponse = async (response, res) => {
  setupSse(res);
  if (!response.body) {
    res.write(`${SSE_DONE}\n\n`);
    return res.end();
  }

  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith(':')) continue;
      if (line === 'data: [DONE]') {
        res.write(`${SSE_DONE}\n\n`);
        return res.end();
      }
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(6).trim();
      if (!payload) continue;

      try {
        const parsed = JSON.parse(payload);
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          const message = JSON.stringify({
            choices: [{ delta: { content: parsed.delta.text } }]
          });
          res.write(`data: ${message}\n\n`);
        }
        if (parsed.type === 'message_stop') {
          res.write(`${SSE_DONE}\n\n`);
          return res.end();
        }
      } catch (err) {
        res.write(`data: ${payload}\n\n`);
      }
    }
  }
  res.write(`${SSE_DONE}\n\n`);
  res.end();
};

export const parseJsonResponse = async (response) => {
  const text = await response.text();
  try {
    return { json: JSON.parse(text), raw: text };
  } catch {
    return { json: null, raw: text };
  }
};
