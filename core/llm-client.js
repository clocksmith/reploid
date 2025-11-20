/**
 * @fileoverview LLM Client
 * Unified interface for model inference.
 * Supports both Proxy (HTTP) and Browser-Native (WebLLM/WebGPU) execution.
 */

const LLMClient = {
  metadata: {
    id: 'LLMClient',
    version: '3.1.0',
    dependencies: ['Utils', 'RateLimiter', 'TransformersClient?'],
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, RateLimiter, TransformersClient } = deps;
    const { logger, Errors } = Utils;

    const _limiter = RateLimiter.createLimiter(60);
    const _activeRequests = new Map();

    // WebLLM State
    let _webLlmEngine = null;
    let _currentWebModelId = null;
    let _webLlmLoaderPromise = null;

    const ensureWebLlmReady = async () => {
      if (typeof window === 'undefined') {
        throw new Errors.ConfigError('WebLLM is only available in browser environments');
      }

      if (window.webllm) return window.webllm;
      if (_webLlmLoaderPromise) return _webLlmLoaderPromise;

      _webLlmLoaderPromise = import('https://esm.run/@mlc-ai/web-llm')
        .then(mod => {
          window.webllm = window.webllm || mod;
          return window.webllm;
        })
        .catch((err) => {
          _webLlmLoaderPromise = null;
          logger.error('[LLM] Failed to load WebLLM runtime', err);
          throw new Errors.ConfigError('Failed to load WebLLM runtime');
        });

      return _webLlmLoaderPromise;
    };

    // --- Helper: Stream Parser (Proxy Mode) ---
    const parseProxyStreamChunk = (chunk, buffer) => {
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
            const content = json.choices?.[0]?.delta?.content
              || json.message?.content
              || json.response
              || '';
            if (content) updates.push(content);
          } catch (e) { /* ignore */ }
        }
      }
      return { updates, remaining };
    };

    // --- Helper: Clean Thoughts ---
    const stripThoughts = (text) => {
        return text
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
            .trim();
    };

    // --- Mode: Browser-Native (WebLLM) ---
    const _chatBrowser = async (messages, modelConfig, onUpdate, requestId) => {
        logger.info(`[LLM] Browser-Native Request to ${modelConfig.id}`);

        await ensureWebLlmReady();

        try {
            // Initialize Engine if needed or model changed
            if (!_webLlmEngine || _currentWebModelId !== modelConfig.id) {
                logger.info(`[LLM] Initializing WebLLM Engine for ${modelConfig.id}...`);
                if (onUpdate) onUpdate("[System: Loading WebGPU Model...]\n");

                _webLlmEngine = await window.webllm.CreateMLCEngine(
                    modelConfig.id,
                    {
                        initProgressCallback: (report) => {
                            logger.debug(`[WebLLM] Loading: ${report.text}`);
                        }
                    }
                );
                _currentWebModelId = modelConfig.id;
            }

            const chatMessages = messages.map(m => ({
                role: m.role,
                content: m.content
            }));

            if (chatMessages[0]?.role !== 'system') {
                logger.warn('[LLM] Missing system prompt at context start. Repairing context for WebLLM.');
                chatMessages.unshift({
                    role: 'system',
                    content: 'You are REPLOID, a careful browser-based AI agent.'
                });
            }

            let fullContent = "";

            if (onUpdate) {
                const chunks = await _webLlmEngine.chat.completions.create({
                    messages: chatMessages,
                    stream: true,
                    temperature: 0.7
                });

                for await (const chunk of chunks) {
                    const delta = chunk.choices[0]?.delta?.content || "";
                    if (delta) {
                        fullContent += delta;
                        onUpdate(delta);
                    }
                }
            } else {
                const reply = await _webLlmEngine.chat.completions.create({
                    messages: chatMessages,
                    stream: false,
                    temperature: 0.7
                });
                fullContent = reply.choices[0].message.content;
            }

            return {
                requestId,
                content: stripThoughts(fullContent),
                raw: fullContent,
                model: modelConfig.id,
                timestamp: Date.now(),
                provider: 'webllm'
            };

        } catch (err) {
            logger.error('[LLM] WebLLM Error', err);
            if (err.message.includes('device') || err.message.includes('memory')) {
                _webLlmEngine = null;
                _currentWebModelId = null;
            }
            throw new Errors.ApiError(`WebLLM Execution Failed: ${err.message}`, 500);
        }
    };

    // --- Mode: Proxy (HTTP) ---
    const _chatProxy = async (messages, modelConfig, onUpdate, requestId) => {
      const endpoint = modelConfig.endpoint || '/api/chat';
      const controller = new AbortController();
      _activeRequests.set(requestId, controller);

      try {
        const requestBody = {
            model: modelConfig.id,
            provider: modelConfig.provider,
            messages: messages,
            stream: !!onUpdate,
            apiKey: modelConfig.apiKey
        };

        if (modelConfig.provider === 'ollama') {
            requestBody.options = { temperature: 0.7 };
        }

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
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
            const { updates, remaining } = parseProxyStreamChunk(chunk, buffer);
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

        return {
          requestId,
          content: stripThoughts(fullContent),
          raw: fullContent,
          model: modelConfig.id,
          timestamp: Date.now(),
          provider: modelConfig.provider
        };

      } finally {
        _activeRequests.delete(requestId);
      }
    };

    // --- Mode: Transformers.js ---
    const _chatTransformers = async (messages, modelConfig, onUpdate, requestId) => {
      if (!TransformersClient) {
        throw new Errors.ConfigError('TransformersClient not available');
      }

      logger.info(`[LLM] Transformers.js Request to ${modelConfig.id}`);

      const response = await TransformersClient.chat(messages, modelConfig, onUpdate);
      return {
        ...response,
        requestId
      };
    };

    const chat = async (messages, modelConfig, onUpdate = null) => {
      await _limiter.waitForToken();

      const requestId = Utils.generateId('req');

      // Route to appropriate backend
      if (modelConfig.provider === 'transformers' ||
          (TransformersClient && TransformersClient.isTransformersModel && TransformersClient.isTransformersModel(modelConfig.id))) {
          return await _chatTransformers(messages, modelConfig, onUpdate, requestId);
      } else if (modelConfig.queryMethod === 'browser' || modelConfig.provider === 'webllm') {
          return await _chatBrowser(messages, modelConfig, onUpdate, requestId);
      } else {
          return await _chatProxy(messages, modelConfig, onUpdate, requestId);
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

    const getWebLLMStatus = () => {
        return {
            loaded: !!_webLlmEngine,
            model: _currentWebModelId
        };
    };

    const getTransformersStatus = () => {
        if (!TransformersClient) return { available: false };
        return TransformersClient.getStatus();
    };

    return { chat, abortRequest, getWebLLMStatus, getTransformersStatus };
  }
};

export default LLMClient;
