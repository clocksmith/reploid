/**
 * @fileoverview LLM Client
 * Unified interface for model inference with rate limiting and streaming.
 */

const LLMClient = {
  metadata: {
    id: 'LLMClient',
    version: '2.0.1',
    dependencies: ['Utils', 'RateLimiter'],
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, RateLimiter } = deps;
    const { logger, Errors } = Utils;

    // Create a default limiter (60 requests/min)
    const _limiter = RateLimiter.createLimiter(60);
    const _activeRequests = new Map();

    const parseStreamChunk = (chunk, buffer) => {
      const text = buffer + chunk;
      const lines = text.split('\n');
      const remaining = lines.pop() || '';

      const updates = [];
      for (const line of lines) {
        const clean = line.trim();
        if (!clean || clean === 'data: [DONE]') continue;
        if (clean.startsWith('data: ')) {
          try {
            const json = JSON.parse(clean.substring(6));
            const content = json.choices?.[0]?.delta?.content || json.content || '';
            if (content) updates.push(content);
          } catch (e) { /* ignore */ }
        }
      }
      return { updates, remaining };
    };

    const chat = async (messages, modelConfig, onUpdate = null) => {
      await _limiter.waitForToken();

      const requestId = Utils.generateId('req');
      const endpoint = modelConfig.endpoint || '/api/chat';

      const controller = new AbortController();
      _activeRequests.set(requestId, controller);

      logger.info(`[LLM] Request ${requestId} to ${modelConfig.id}`);

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelConfig.id,
            provider: modelConfig.provider,
            messages: messages,
            stream: !!onUpdate,
            apiKey: modelConfig.apiKey
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Errors.ApiError(`API Error ${response.status}`, response.status);
        }

        let fullContent = '';

        if (onUpdate && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const { updates, remaining } = parseStreamChunk(chunk, buffer);
            buffer = remaining;

            for (const text of updates) {
              fullContent += text;
              onUpdate(text);
            }
          }
        } else {
          const data = await response.json();
          fullContent = data.content || data.choices?.[0]?.message?.content || '';
        }

        // Extract "Thinking" blocks
        let content = fullContent;
        let thoughts = null;
        const thinkMatch = fullContent.match(/<thinking>([\s\S]*?)<\/thinking>/);
        if (thinkMatch) {
          thoughts = thinkMatch[1].trim();
          content = fullContent.replace(/<thinking>[\s\S]*?<\/thinking>/, '').trim();
        }

        return {
          requestId,
          content,
          thoughts,
          model: modelConfig.id,
          timestamp: Date.now()
        };

      } catch (error) {
        if (error.name === 'AbortError') {
          throw new Errors.AbortError('Request cancelled');
        }
        throw error;
      } finally {
        _activeRequests.delete(requestId);
      }
    };

    const abortRequest = (requestId) => {
      const controller = _activeRequests.get(requestId);
      if (controller) {
        controller.abort();
        return true;
      }
      return false;
    };

    return { chat, abortRequest };
  }
};

export default LLMClient;
