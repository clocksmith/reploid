/**
 * The executor's `generate` port over a loopback OpenAI-compatible `/v1/chat/completions` inside the same
 * confidential VM: Reploid's own native host with Doppler, or a CUDA runtime (llama.cpp server, vLLM) when the
 * GPU's Vulkan path is unavailable in confidential-computing mode. The runtime must listen on loopback only and
 * must not log prompts; both are properties of the measured image, not of this adapter.
 */
/**
 * `tokenPerChunk: true` is for runtimes that stream exactly one token per chunk and send no usage chunk
 * (doppler-serve 0.1.7): output tokens are then the chunk count and input tokens are reported as 0, with
 * `usageSource: 'stream-chunks'` on the answer.
 */
export function createOpenAiRuntime({ baseUrl, model, temperature = 0, fetchImpl = fetch, timeoutMs = 30 * 60 * 1000, tokenPerChunk = false }) {
  const url = new URL('/v1/chat/completions', baseUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('The attested runtime must be on loopback inside the VM');
  return async function generate({ messages, generation = {}, onDelta, signal }) {
    const response = await fetchImpl(url, {
      method: 'POST', signal: signal ?? AbortSignal.timeout(timeoutMs), headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true, stream_options: { include_usage: true }, temperature,
        ...(Number.isSafeInteger(generation.maxOutputTokens) ? { max_tokens: generation.maxOutputTokens } : {}) })
    });
    if (!response.ok || !response.body) throw Object.assign(new Error(`Runtime answered ${response.status}`), { code: 'RUNTIME_HTTP' });
    let text = '', finishReason = 'unknown', usage = null, chunks = 0, buffer = '';
    const decoder = new TextDecoder();
    for await (const part of response.body) {
      buffer += decoder.decode(part, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        const event = JSON.parse(data);
        const choice = event.choices?.[0];
        const delta = choice?.delta?.content;
        if (typeof delta === 'string' && delta) { text += delta; chunks += 1; onDelta(delta); }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (event.usage) usage = { inputTokens: event.usage.prompt_tokens, outputTokens: event.usage.completion_tokens };
      }
    }
    if (!usage && tokenPerChunk) usage = { inputTokens: 0, outputTokens: chunks, usageSource: 'stream-chunks' };
    if (!usage || !Number.isSafeInteger(usage.inputTokens) || !Number.isSafeInteger(usage.outputTokens)) {
      throw Object.assign(new Error('The runtime reported no token usage'), { code: 'RUNTIME_USAGE' });
    }
    return { text, finishReason: finishReason === 'length' ? 'length' : finishReason === 'stop' ? 'stop' : 'unknown',
      stopReason: finishReason === 'length' ? 'max-tokens' : finishReason === 'stop' ? 'stop' : null, usage, chunks };
  };
}
