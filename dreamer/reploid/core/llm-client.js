/**
 * @fileoverview LLM Client
 * Unified interface for model inference.
 * Supports Proxy (HTTP), Browser-Native (WebLLM/WebGPU), and Direct Cloud API execution.
 */

const LLMClient = {
  metadata: {
    id: 'LLMClient',
    version: '1.0.0',
    genesis: { introduced: 'tabula' },
    dependencies: ['Utils', 'RateLimiter?', 'StreamParser?', 'TransformersClient?'],
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, RateLimiter, StreamParser, TransformersClient } = deps;
    const { logger, Errors } = Utils;

    // Fallback rate limiter if not provided
    const _limiter = RateLimiter ? RateLimiter.createLimiter(60) : { waitForToken: async () => {} };
    // Streaming requires StreamParser - disable if not available
    const _canStream = !!StreamParser;
    const _activeRequests = new Map();

    // WebLLM State
    let _webLlmEngine = null;
    let _currentWebModelId = null;
    let _webLlmLoaderPromise = null;

    // Cleanup WebLLM engine and release GPU memory
    const cleanupWebLlmEngine = async () => {
      if (_webLlmEngine) {
        try {
          logger.info('[LLM] Cleaning up WebLLM engine...');
          // WebLLM 0.2.x uses unload(), newer versions may use different method
          if (typeof _webLlmEngine.unload === 'function') {
            await _webLlmEngine.unload();
          } else if (typeof _webLlmEngine.resetChat === 'function') {
            await _webLlmEngine.resetChat();
          }
          _webLlmEngine = null;
          _currentWebModelId = null;
          logger.info('[LLM] WebLLM engine cleaned up, GPU memory released');
        } catch (e) {
          logger.warn('[LLM] Error during WebLLM cleanup:', e.message);
          // Force null even on error
          _webLlmEngine = null;
          _currentWebModelId = null;
        }
      }
    };

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
            const jsonStr = clean.substring(6);
            if (!jsonStr.startsWith('{')) continue; // Skip malformed chunks
            const json = JSON.parse(jsonStr);
            const content = json.choices?.[0]?.delta?.content
              || json.message?.content
              || json.response
              || '';
            if (content) updates.push(content);
          } catch (e) {
            // Log malformed chunks at debug level
            logger.debug('[LLM] Malformed stream chunk:', clean.substring(6, 50));
          }
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

    // --- Helper: Check Native Tool Support ---
    // OpenAI models support function calling (gpt-3.5-turbo, gpt-4, gpt-4o, etc.)
    const supportsNativeTools = (modelConfig) => {
      if (!modelConfig?.id) return false;
      const model = modelConfig.id.toLowerCase();
      const provider = modelConfig.provider?.toLowerCase();

      // OpenAI models - all gpt-3.5-turbo and gpt-4 variants support tools
      if (provider === 'openai' || model.startsWith('gpt-')) {
        return true;
      }

      return false;
    };

    // --- Helper: Parse OpenAI Tool Calls ---
    const parseOpenAIToolCalls = (message) => {
      if (!message?.tool_calls?.length) return null;

      return message.tool_calls.map(tc => ({
        id: tc.id,
        name: tc.function?.name,
        args: (() => {
          try {
            return JSON.parse(tc.function?.arguments || '{}');
          } catch {
            return {};
          }
        })()
      }));
    };

    // --- Mode: Browser-Native (WebLLM) ---
    const _chatBrowser = async (messages, modelConfig, onUpdate, requestId) => {
        logger.info(`[LLM] Browser-Native Request to ${modelConfig.id}`);

        await ensureWebLlmReady();

        try {
            // Initialize Engine if needed or model changed
            if (!_webLlmEngine || _currentWebModelId !== modelConfig.id) {
                // Cleanup previous engine before loading new model
                if (_webLlmEngine && _currentWebModelId !== modelConfig.id) {
                  logger.info(`[LLM] Switching model from ${_currentWebModelId} to ${modelConfig.id}`);
                  await cleanupWebLlmEngine();
                }

                logger.info(`[LLM] Initializing WebLLM Engine for ${modelConfig.id}...`);

                let lastReportedProgress = -5; // Track last reported progress for 5% increments
                let lastProgressTime = Date.now();
                const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000; // 10 minute timeout

                const enginePromise = window.webllm.CreateMLCEngine(
                    modelConfig.id,
                    {
                        initProgressCallback: (report) => {
                            lastProgressTime = Date.now(); // Reset timeout on any progress
                            logger.debug(`[WebLLM] Loading: ${report.text}`);

                            if (onUpdate) {
                                // Extract progress percentage if available
                                const progressMatch = report.text.match(/(\d+(?:\.\d+)?)\s*%/);
                                if (progressMatch) {
                                    const progress = Math.floor(parseFloat(progressMatch[1]));
                                    // Only update at 5% increments
                                    if (progress >= lastReportedProgress + 5) {
                                        lastReportedProgress = Math.floor(progress / 5) * 5;
                                        onUpdate(`[System: Downloading model... ${lastReportedProgress}%]\n`);
                                    }
                                } else if (report.text.toLowerCase().includes('download')) {
                                    onUpdate(`[System: Downloading model...]\n`);
                                } else if (report.text.toLowerCase().includes('loading')) {
                                    onUpdate(`[System: Loading model into GPU...]\n`);
                                }
                            }
                        },
                        // Use larger context window to prevent context overflow errors
                        context_window_size: modelConfig.contextSize || 32768
                    }
                );

                // Add timeout that resets on progress
                const timeoutPromise = new Promise((_, reject) => {
                    const checkTimeout = setInterval(() => {
                        if (Date.now() - lastProgressTime > DOWNLOAD_TIMEOUT_MS) {
                            clearInterval(checkTimeout);
                            reject(new Error('Model download stalled - no progress for 10 minutes'));
                        }
                    }, 30000); // Check every 30s

                    // Clean up interval when engine loads
                    enginePromise.then(() => clearInterval(checkTimeout)).catch(() => clearInterval(checkTimeout));
                });

                try {
                    _webLlmEngine = await Promise.race([enginePromise, timeoutPromise]);
                } catch (timeoutErr) {
                    _webLlmEngine = null;
                    _currentWebModelId = null;
                    throw new Errors.ApiError(`Model download failed: ${timeoutErr.message}. Check your internet connection.`, 504);
                }

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

        if (onUpdate && response.body && StreamParser) {
          const rawReader = response.body.getReader();
          const reader = StreamParser.withStreamTimeout(rawReader, StreamParser.DEFAULT_STREAM_TIMEOUT_MS, controller);
          const decoder = new TextDecoder();
          let buffer = '';

          try {
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

            // Process remaining buffer on stream end
            if (buffer.trim()) {
              const { updates } = parseProxyStreamChunk(buffer + '\n', '');
              for (const text of updates) {
                fullContent += text;
                onUpdate(text);
              }
            }
          } finally {
            reader.releaseLock();
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

    // --- Mode: Direct Cloud API (browser-cloud) ---
    const CLOUD_API_ENDPOINTS = {
      gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
      openai: 'https://api.openai.com/v1/chat/completions',
      anthropic: 'https://api.anthropic.com/v1/messages'
    };

    const _chatCloudDirect = async (messages, modelConfig, onUpdate, requestId) => {
      const provider = modelConfig.provider;
      const storageKey = `${provider.toUpperCase()}_API_KEY`;
      let apiKey = modelConfig.apiKey || localStorage.getItem(storageKey);

      if (!apiKey) {
        throw new Errors.ConfigError(`API key required for ${provider}. Please add your API key in model settings.`);
      }

      // Validate API key format - detect corrupted localStorage
      if (apiKey.includes('[INFO]') || apiKey.includes('[Boot]') || apiKey.includes(' ') || apiKey.length > 200) {
        logger.error(`[LLM] Corrupted API key detected in localStorage (${storageKey}). Clearing invalid value.`);
        localStorage.removeItem(storageKey);
        throw new Errors.ConfigError(`API key for ${provider} was corrupted. Please re-enter your API key in model settings.`);
      }

      const controller = new AbortController();
      _activeRequests.set(requestId, controller);

      try {
        let response;
        let fullContent = '';

        if (provider === 'gemini') {
          // Google Gemini API (latest format with system_instruction support)
          const action = onUpdate ? 'streamGenerateContent' : 'generateContent';
          const queryParams = onUpdate ? `?alt=sse&key=${apiKey}` : `?key=${apiKey}`;
          const endpoint = `${CLOUD_API_ENDPOINTS.gemini}/${modelConfig.id}:${action}${queryParams}`;

          // Extract system message for system_instruction
          const systemMsg = messages.find(m => m.role === 'system');
          const nonSystemMsgs = messages.filter(m => m.role !== 'system');

          // Convert to Gemini format (user/model roles)
          const geminiMessages = nonSystemMsgs.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          }));

          const requestBody = {
            contents: geminiMessages,
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 8192,
              topP: 0.95
            }
          };

          // Add system instruction if present (supported in Gemini 1.5+)
          if (systemMsg?.content) {
            requestBody.system_instruction = {
              parts: [{ text: systemMsg.content }]
            };
          }

          response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: controller.signal
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Errors.ApiError(`Gemini API Error: ${errData.error?.message || response.status}`, response.status);
          }

          if (onUpdate && response.body && StreamParser) {
            fullContent = await StreamParser.parseForProvider(response, 'gemini', onUpdate, { abortController: controller });
          } else {
            const data = await response.json();
            fullContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          }

        } else if (provider === 'openai') {
          // OpenAI API with native tool calling support
          const requestBody = {
            model: modelConfig.id,
            messages: messages,
            stream: !!onUpdate,
            temperature: 0.7
          };

          // Add tools if provided and model supports them
          if (modelConfig.tools?.length > 0) {
            requestBody.tools = modelConfig.tools;
            requestBody.tool_choice = 'auto';
          }

          response = await fetch(CLOUD_API_ENDPOINTS.openai, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Errors.ApiError(`OpenAI API Error: ${errData.error?.message || response.status}`, response.status);
          }

          let toolCalls = null;

          if (onUpdate && response.body && StreamParser) {
            // Streaming mode with tool call support
            if (StreamParser.parseOpenAIStreamWithTools) {
              const streamResult = await StreamParser.parseOpenAIStreamWithTools(response, onUpdate, { abortController: controller });
              fullContent = streamResult.content;
              toolCalls = streamResult.toolCalls;
            } else {
              // Fallback to text-only parsing
              fullContent = await StreamParser.parseForProvider(response, 'openai', onUpdate, { abortController: controller });
            }
          } else {
            const data = await response.json();
            const message = data.choices?.[0]?.message;
            fullContent = message?.content || '';
            toolCalls = parseOpenAIToolCalls(message);
          }

          // Return early with tool calls if present
          if (toolCalls?.length > 0) {
            return {
              requestId,
              content: fullContent,
              raw: fullContent,
              model: modelConfig.id,
              timestamp: Date.now(),
              provider: provider,
              toolCalls // Native tool calls!
            };
          }

        } else if (provider === 'anthropic') {
          // Anthropic Claude API (latest version)
          const systemMsg = messages.find(m => m.role === 'system');
          const nonSystemMsgs = messages.filter(m => m.role !== 'system');

          response = await fetch(CLOUD_API_ENDPOINTS.anthropic, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
              model: modelConfig.id,
              max_tokens: 8192,
              ...(systemMsg?.content ? { system: systemMsg.content } : {}),
              messages: nonSystemMsgs.map(m => ({
                role: m.role,
                content: m.content
              })),
              stream: !!onUpdate
            }),
            signal: controller.signal
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Errors.ApiError(`Anthropic API Error: ${errData.error?.message || response.status}`, response.status);
          }

          if (onUpdate && response.body && StreamParser) {
            fullContent = await StreamParser.parseForProvider(response, 'anthropic', onUpdate, { abortController: controller });
          } else {
            const data = await response.json();
            fullContent = data.content?.[0]?.text || '';
          }

        } else {
          throw new Errors.ConfigError(`Unsupported cloud provider: ${provider}`);
        }

        return {
          requestId,
          content: stripThoughts(fullContent),
          raw: fullContent,
          model: modelConfig.id,
          timestamp: Date.now(),
          provider: provider
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

    // --- Mode: DOPPLER (Local WebGPU) ---
    let _dopplerProvider = null;
    const _chatDoppler = async (messages, modelConfig, onUpdate, requestId) => {
      logger.info(`[LLM] DOPPLER Request to ${modelConfig.modelId || modelConfig.id}`);

      // Lazy load DOPPLER provider
      if (!_dopplerProvider) {
        const { DopplerProvider } = await import('./doppler/doppler-provider.js');
        _dopplerProvider = DopplerProvider;
      }

      // Initialize if needed
      if (!_dopplerProvider.getCapabilities().initialized) {
        await _dopplerProvider.init();
      }

      if (!_dopplerProvider.getCapabilities().available) {
        throw new Errors.ConfigError('DOPPLER not available - WebGPU may not be supported');
      }

      // Load model if different
      const modelId = modelConfig.modelId || modelConfig.id;
      const currentModel = _dopplerProvider.getCapabilities().currentModelId;
      if (currentModel !== modelId) {
        await _dopplerProvider.loadModel(modelId, modelConfig.modelUrl, onUpdate, modelConfig.localPath);
      }

      // Stream or sync based on callback
      if (onUpdate) {
        let fullContent = '';
        for await (const token of _dopplerProvider.stream(messages, modelConfig)) {
          fullContent += token;
          onUpdate(token);
        }
        return {
          requestId,
          content: stripThoughts(fullContent),
          raw: fullContent,
          model: modelId,
          timestamp: Date.now(),
          provider: 'doppler'
        };
      } else {
        const result = await _dopplerProvider.chat(messages, modelConfig);
        return {
          requestId,
          content: stripThoughts(result.content),
          raw: result.content,
          model: modelId,
          timestamp: Date.now(),
          provider: 'doppler'
        };
      }
    };

    /**
     * @param {Array} messages - Chat messages
     * @param {Object} modelConfig - Model configuration
     * @param {Function} onUpdate - Streaming callback
     * @param {Object} options - Additional options
     * @param {Array} options.tools - Tool schemas for native tool calling
     */
    const chat = async (messages, modelConfig, onUpdate = null, options = {}) => {
      await _limiter.waitForToken();

      const requestId = Utils.generateId('req');
      const isCloudProvider = ['gemini', 'openai', 'anthropic'].includes(modelConfig.provider);

      // Merge tools into modelConfig if native tools supported
      const configWithTools = { ...modelConfig };
      if (options.tools?.length > 0 && supportsNativeTools(modelConfig)) {
        configWithTools.tools = options.tools;
        logger.info(`[LLM] Native tool calling enabled with ${options.tools.length} tools`);
      }

      // Route to appropriate backend
      if (modelConfig.provider === 'doppler') {
          // Local WebGPU inference via DOPPLER
          return await _chatDoppler(messages, configWithTools, onUpdate, requestId);
      } else if (modelConfig.provider === 'transformers' ||
          (TransformersClient && TransformersClient.isTransformersModel && TransformersClient.isTransformersModel(modelConfig.id))) {
          return await _chatTransformers(messages, configWithTools, onUpdate, requestId);
      } else if (modelConfig.hostType === 'browser-cloud' && isCloudProvider) {
          // Direct browser-to-cloud API call (no proxy)
          logger.info(`[LLM] Direct API call to ${modelConfig.provider}/${modelConfig.id}`);
          return await _chatCloudDirect(messages, configWithTools, onUpdate, requestId);
      } else if (modelConfig.queryMethod === 'browser' || modelConfig.provider === 'webllm') {
          return await _chatBrowser(messages, configWithTools, onUpdate, requestId);
      } else {
          return await _chatProxy(messages, configWithTools, onUpdate, requestId);
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

    const getDopplerStatus = () => {
        if (!_dopplerProvider) return { available: false, initialized: false };
        return _dopplerProvider.getCapabilities();
    };

    // Release GPU memory (useful when switching providers or on error)
    const releaseGPUMemory = async () => {
      await cleanupWebLlmEngine();
      if (TransformersClient?.cleanup) {
        await TransformersClient.cleanup();
      }
      if (_dopplerProvider?.destroy) {
        await _dopplerProvider.destroy();
        _dopplerProvider = null;
      }
      logger.info('[LLM] All GPU memory released');
    };

    return { chat, abortRequest, getWebLLMStatus, getTransformersStatus, getDopplerStatus, releaseGPUMemory, supportsNativeTools };
  }
};

export default LLMClient;
