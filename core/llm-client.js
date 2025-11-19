// FORCE RELOAD: 1763406544
// browser-cloud, proxy-cloud, browser-local (WebLLM), proxy-local (Ollama)

const LLMClient = {
  metadata: {
    name: 'LLMClient',
    version: '2.0.0-thinking-fix'
  },

  factory: (deps) => {
    console.log('[LLMClient] Version 2.0.0-thinking-fix loaded');

    // Use the same origin as the current page, or fallback to localhost for local dev
    const PROXY_URL = window.location.origin.includes('file://')
      ? 'http://localhost:8000'
      : window.location.origin;
    let webllmEngine = null;

    // Request queue system to prevent overwhelming the system
    const MAX_CONCURRENT_PROXY_REQUESTS = parseInt(localStorage.getItem('MAX_CONCURRENT_PROXY_REQUESTS')) || 1;
    let activeProxyRequests = 0;
    const requestQueue = [];
    const abortControllers = new Map(); // Track abort controllers per request ID

    // Provider API endpoints
    const PROVIDER_ENDPOINTS = {
      gemini: 'https://generativelanguage.googleapis.com/v1beta/models/',
      openai: 'https://api.openai.com/v1/chat/completions',
      anthropic: 'https://api.anthropic.com/v1/messages'
    };

    // Initialize WebLLM engine (lazy load) with maximum GPU buffer allocation
    const initWebLLM = async () => {
      if (webllmEngine) return webllmEngine;

      if (!navigator.gpu) {
        throw new Error('WebGPU not supported in this browser');
      }

      // Request GPU adapter with maximum buffer limits
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        throw new Error('Failed to get GPU adapter');
      }

      console.log(`[WebLLM] GPU adapter limits:`, {
        maxBufferSize: `${(adapter.limits.maxBufferSize / 1024 / 1024 / 1024).toFixed(2)} GB`,
        maxStorageBufferBindingSize: `${(adapter.limits.maxStorageBufferBindingSize / 1024 / 1024 / 1024).toFixed(2)} GB`
      });

      // Request device with maximum available limits
      const device = await adapter.requestDevice({
        requiredLimits: {
          maxBufferSize: adapter.limits.maxBufferSize,
          maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize
        }
      });

      console.log(`[WebLLM] GPU device acquired with max buffer limits enabled`);

      // Dynamically import WebLLM
      const { CreateMLCEngine } = await import('https://esm.run/@mlc-ai/web-llm');
      webllmEngine = await CreateMLCEngine({
        initProgressCallback: (progress) => {
          console.log(`[WebLLM] Loading: ${progress.text}`);
        },
        // Pass the device with maxed out limits
        device: device
      });

      return webllmEngine;
    };

    // Call browser-cloud (direct API call with user's key)
    const callBrowserCloud = async (messages, modelConfig) => {
      const provider = modelConfig.provider;
      const apiKey = modelConfig.apiKey || localStorage.getItem(`${provider.toUpperCase()}_API_KEY`);

      if (!apiKey) {
        throw new Error(`No API key found for ${provider}. Please add one in model settings.`);
      }

      if (provider === 'gemini') {
        const endpoint = `${PROVIDER_ENDPOINTS.gemini}${modelConfig.id}:generateContent?key=${apiKey}`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: messages.map(m => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }]
            }))
          })
        });

        if (!response.ok) {
          throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return {
          content: data.candidates[0].content.parts[0].text,
          usage: data.usageMetadata
        };
      }

      if (provider === 'openai') {
        const response = await fetch(PROVIDER_ENDPOINTS.openai, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({ model: modelConfig.id, messages })
        });

        if (!response.ok) {
          throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return {
          content: data.choices[0].message.content,
          usage: data.usage
        };
      }

      if (provider === 'anthropic') {
        const response = await fetch(PROVIDER_ENDPOINTS.anthropic, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: modelConfig.id,
            messages,
            max_tokens: 4096
          })
        });

        if (!response.ok) {
          throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return {
          content: data.content[0].text,
          usage: data.usage
        };
      }

      throw new Error(`Unsupported provider: ${provider}`);
    };

    // Queue management - process next request when slot available
    const processNextRequest = () => {
      if (requestQueue.length > 0 && activeProxyRequests < MAX_CONCURRENT_PROXY_REQUESTS) {
        const nextRequest = requestQueue.shift();
        nextRequest.execute();
      }
    };

    // Call proxy-cloud or proxy-local (via server proxy) with streaming
    const callProxy = async (messages, modelConfig, onStreamUpdate) => {
      const requestId = `${Date.now()}_${Math.random()}`;

      // Queue the request if at capacity
      if (activeProxyRequests >= MAX_CONCURRENT_PROXY_REQUESTS) {
        console.log(`[LLMClient] Request queued (${requestQueue.length + 1} in queue, ${activeProxyRequests}/${MAX_CONCURRENT_PROXY_REQUESTS} active)`);

        return new Promise((resolve, reject) => {
          requestQueue.push({
            execute: async () => {
              try {
                const result = await executeProxyRequest(requestId, messages, modelConfig, onStreamUpdate);
                resolve(result);
              } catch (error) {
                reject(error);
              }
            }
          });
        });
      }

      // Execute immediately if under capacity
      return executeProxyRequest(requestId, messages, modelConfig, onStreamUpdate);
    };

    // Actual proxy request execution
    const executeProxyRequest = async (requestId, messages, modelConfig, onStreamUpdate) => {
      activeProxyRequests++;
      console.log(`[LLMClient] Starting proxy request (${activeProxyRequests}/${MAX_CONCURRENT_PROXY_REQUESTS} active)`);

      // Create abort controller for this specific request
      const abortController = new AbortController();
      abortControllers.set(requestId, abortController);

      try {
        const response = await fetch(`${PROXY_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: modelConfig.provider,
            model: modelConfig.id,
            messages
          }),
          signal: abortController.signal
        });

        if (!response.ok) {
          throw new Error(`Proxy error: ${response.status} ${response.statusText}`);
        }

        // Check if response is streaming (SSE)
        const contentType = response.headers.get('content-type');
        console.log('[LLMClient] Response content-type:', contentType);

        let result;
        if (contentType && contentType.includes('text/event-stream')) {
          result = await handleStreamingResponse(response, onStreamUpdate);
        } else {
          // Non-streaming response (fallback for other providers)
          const data = await response.json();
          result = {
            content: data.response || data.content,
            usage: data.usage
          };
        }

        return result;
      } catch (error) {
        if (error.name === 'AbortError') {
          console.log('[LLMClient] Request aborted:', requestId);
          throw new Error('Request was aborted');
        }

        // Enhanced error handling for common issues
        if (error.message.includes('Failed to fetch')) {
          throw new Error('Cannot connect to proxy server. Make sure it is running (npm start).');
        }

        if (error.message.includes('out of memory') || error.message.includes('OOM')) {
          throw new Error('System out of memory. Try reducing concurrent requests or using a smaller model.');
        }

        if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
          throw new Error('Request timed out. The model may be overloaded or unavailable.');
        }

        if (error.message.includes('429') || error.message.includes('rate limit')) {
          throw new Error('Rate limit exceeded. Please wait before making more requests.');
        }

        if (error.message.includes('503') || error.message.includes('Service Unavailable')) {
          throw new Error('Service temporarily unavailable. The model server may be overloaded.');
        }

        throw error;
      } finally {
        // Cleanup
        abortControllers.delete(requestId);
        activeProxyRequests--;
        console.log(`[LLMClient] Proxy request complete (${activeProxyRequests}/${MAX_CONCURRENT_PROXY_REQUESTS} active, ${requestQueue.length} queued)`);

        // Process next queued request
        processNextRequest();
      }
    };

    // Handle streaming response (extracted for reuse)
    const handleStreamingResponse = async (response, onStreamUpdate) => {
      // Handle streaming response
      const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';
        let fullThinking = ''; // Track thinking separately
        let tokenCount = 0;
        let tokensInCurrentWindow = 0; // Track tokens in last second for rate calculation
        let lastWindowTime = null;
        const requestStartTime = Date.now();
        let firstTokenTime = null;

        // Helper to estimate token count from text
        const estimateTokens = (text) => {
          if (!text || text.trim().length === 0) return 0;
          // Rough estimation: ~0.7 words per token (i.e., 1 token ≈ 0.7 words)
          // So tokens = words / 0.7 = words * 1.43
          const words = text.split(/\s+/).filter(w => w.length > 0).length;
          return Math.ceil(words / 0.7);
        };

        // Send periodic updates while waiting for first token
        let waitingInterval = null;
        if (onStreamUpdate) {
          waitingInterval = setInterval(() => {
            if (firstTokenTime === null) {
              const waitTime = ((Date.now() - requestStartTime) / 1000).toFixed(1);
              onStreamUpdate({
                content: '',
                thinking: '',
                tokens: 0,
                ttft: waitTime,
                tokensPerSecond: '0',
                elapsedSeconds: waitTime,
                waiting: true
              });
            } else {
              clearInterval(waitingInterval);
            }
          }, 500); // Update every 500ms while waiting
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop(); // Keep incomplete line

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.substring(6);
              try {
                const data = JSON.parse(dataStr);

                // Handle both thinking and content tokens
                if (data.message && (data.message.content || data.message.thinking)) {
                  const now = Date.now();

                  // Record first token time (for either thinking or content)
                  if (firstTokenTime === null) {
                    firstTokenTime = now;
                    lastWindowTime = now;
                  }

                  // Accumulate content and thinking SEPARATELY
                  const previousContentLength = fullContent.length;
                  const previousThinkingLength = fullThinking.length;

                  if (data.message.content) {
                    fullContent += data.message.content;
                  }
                  if (data.message.thinking) {
                    fullThinking += data.message.thinking;
                  }

                  // Calculate new tokens in this chunk (count BOTH thinking and content)
                  const previousTokenCount = tokenCount;
                  tokenCount = estimateTokens(fullThinking + fullContent);
                  const newTokensInChunk = tokenCount - previousTokenCount;

                  // Track tokens in current window for rate calculation
                  tokensInCurrentWindow += newTokensInChunk;

                  // Reset window every second
                  const timeSinceLastWindow = (now - lastWindowTime) / 1000;
                  if (timeSinceLastWindow >= 1.0) {
                    lastWindowTime = now;
                    tokensInCurrentWindow = newTokensInChunk; // Reset to current chunk
                  }

                  const ttft = ((firstTokenTime - requestStartTime) / 1000).toFixed(2);
                  const streamingElapsed = (now - firstTokenTime) / 1000;
                  // Use windowed rate for more accurate tok/s, fallback to average if window too small
                  const windowedRate = timeSinceLastWindow > 0 ? (tokensInCurrentWindow / timeSinceLastWindow) : 0;
                  const averageRate = streamingElapsed > 0 ? (tokenCount / streamingElapsed) : 0;
                  const streamingRate = (windowedRate > 0 ? windowedRate : averageRate).toFixed(2);
                  const totalElapsed = ((now - requestStartTime) / 1000).toFixed(1);

                  // Call update callback for any token activity
                  if (onStreamUpdate) {
                    onStreamUpdate({
                      content: fullContent,
                      thinking: fullThinking, // Include thinking separately
                      tokens: tokenCount,
                      ttft: ttft,
                      tokensPerSecond: streamingRate,
                      elapsedSeconds: totalElapsed
                    });
                  }
                }

                if (data.done) {
                  // For reasoning models, combine thinking + content
                  let finalContent;
                  if (fullThinking.length > 0 && fullContent.length > 0) {
                    // Both thinking and answer present (reasoning model)
                    finalContent = `<thinking>\n${fullThinking}\n</thinking>\n\n${fullContent}`;
                  } else if (fullThinking.length > 0) {
                    // Only thinking, no final answer (use thinking as content)
                    finalContent = fullThinking;
                  } else {
                    // Normal model (no thinking)
                    finalContent = fullContent;
                  }

                  console.log(`[LLMClient] Stream complete. Thinking: ${fullThinking.length} chars, Content: ${fullContent.length} chars, Combined: ${finalContent.length} chars, Tokens: ${tokenCount}`);

                  if (finalContent.length === 0) {
                    console.error('[LLMClient] ERROR: Final content is empty after stream!');
                  }

                  return {
                    content: finalContent,
                    thinking: fullThinking,
                    usage: { tokens: tokenCount }
                  };
                }
              } catch (e) {
                console.error('[LLMClient] Failed to parse SSE data:', dataStr);
              }
            }
          }
        }

        // Cleanup waiting interval if still running
        if (waitingInterval) {
          clearInterval(waitingInterval);
        }

        // Fallback if stream ends without 'done' flag
        let finalContent;
        if (fullThinking.length > 0 && fullContent.length > 0) {
          finalContent = `<thinking>\n${fullThinking}\n</thinking>\n\n${fullContent}`;
        } else if (fullThinking.length > 0) {
          finalContent = fullThinking;
        } else {
          finalContent = fullContent;
        }

        console.log(`[LLMClient] Stream ended without 'done' flag. Thinking: ${fullThinking.length} chars, Content: ${fullContent.length} chars, Combined: ${finalContent.length} chars`);

        return {
          content: finalContent,
          thinking: fullThinking,
          usage: { tokens: tokenCount }
        };
    };

    // Call browser-local (WebLLM)
    const callBrowserLocal = async (messages, modelConfig) => {
      // Extract model ID string (handle both string and object formats)
      console.log('[WebLLM] DEBUG - modelConfig.id type:', typeof modelConfig.id, 'value:', modelConfig.id);
      const modelId = typeof modelConfig.id === 'string' ? modelConfig.id : String(modelConfig.id);
      console.log('[WebLLM] Requested model:', modelId);

      // VALIDATE FIRST - before initializing engine or loading model
      const { prebuiltAppConfig } = await import('https://esm.run/@mlc-ai/web-llm');
      const availableModels = prebuiltAppConfig?.model_list?.map(m => m.model_id) || [];

      if (!availableModels.includes(modelId)) {
        console.error('[WebLLM] ❌ Model not found in catalog:', modelId);
        console.log('[WebLLM] Available models count:', availableModels.length);

        // Suggest alternatives (smaller models that are likely to work)
        const suggestions = availableModels
          .filter(id => {
            const lower = id.toLowerCase();
            return (lower.includes('llama') || lower.includes('phi') || lower.includes('gemma') || lower.includes('qwen')) &&
                   (lower.includes('1b') || lower.includes('2b') || lower.includes('3b'));
          })
          .slice(0, 5);

        throw new Error(
          `Model "${modelId}" not found in WebLLM catalog.\n\n` +
          `This model is not available in your WebLLM version.\n\n` +
          `Please remove this model and add one of these working alternatives:\n` +
          `${suggestions.map(s => `  • ${s}`).join('\n')}\n\n` +
          `Total available models: ${availableModels.length}`
        );
      }

      console.log('[WebLLM] ✓ Model validated, initializing engine...');

      // Now safe to initialize engine and load model
      const engine = await initWebLLM();
      await engine.reload(modelId);

      const response = await engine.chat.completions.create({
        messages,
        temperature: 0.7,
        max_tokens: 2048
      });

      return {
        content: response.choices[0].message.content,
        usage: response.usage
      };
    };

    // Main chat interface
    const chat = async (messages, modelConfig, onStreamUpdate) => {
      console.log(`[LLMClient] Calling ${modelConfig.hostType} - ${modelConfig.provider}/${modelConfig.id}`);

      try {
        let result;

        switch (modelConfig.hostType) {
          case 'browser-cloud':
            result = await callBrowserCloud(messages, modelConfig);
            break;

          case 'proxy-cloud':
          case 'proxy-local':
            result = await callProxy(messages, modelConfig, onStreamUpdate);
            break;

          case 'browser-local':
            result = await callBrowserLocal(messages, modelConfig);
            break;

          default:
            throw new Error(`Unknown hostType: ${modelConfig.hostType}`);
        }

        console.log(`[LLMClient] Response received (${result.content.length} chars)`);
        return result;

      } catch (error) {
        console.error(`[LLMClient] Error:`, error);
        throw error;
      }
    };

    // Streaming interface (for future enhancement)
    const stream = async (messages, modelConfig, onToken) => {
      // TODO: Implement streaming for each provider
      // For now, fall back to regular chat
      const result = await chat(messages, modelConfig);
      onToken(result.content);
      return result;
    };

    // Abort ongoing requests (all or specific request ID)
    const abort = (requestId = null) => {
      if (requestId && abortControllers.has(requestId)) {
        console.log('[LLMClient] Aborting request:', requestId);
        abortControllers.get(requestId).abort();
        abortControllers.delete(requestId);
      } else if (!requestId) {
        // Abort all active requests
        console.log('[LLMClient] Aborting all requests:', abortControllers.size);
        for (const [id, controller] of abortControllers.entries()) {
          controller.abort();
        }
        abortControllers.clear();

        // Clear the queue
        requestQueue.length = 0;
      }
    };

    // Get concurrency stats
    const getStats = () => ({
      maxConcurrent: MAX_CONCURRENT_PROXY_REQUESTS,
      active: activeProxyRequests,
      queued: requestQueue.length,
      abortable: abortControllers.size
    });

    return {
      chat,
      stream,
      abort,
      getStats
    };
  }
};

export default LLMClient;
// Cache buster: 1737155400
