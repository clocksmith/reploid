import fetch from 'node-fetch';
import { SSE_DONE, setupSse, streamBufferedText, streamOpenAIResponse, streamAnthropicResponse, parseJsonResponse } from './proxy-streams.js';

/** Mount existing provider protocols; authorization remains supplied by the server host. */
export function mountProviderProxyRoutes(app, { ANTHROPIC_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, HUGGINGFACE_API_KEY, LOCAL_MODEL_ENDPOINT, OPENAI_API_KEY, VLLM_ENDPOINT, admitAnonymousInference, getGeminiHeaders, requireServerAccess }) {
app.post('/api/gemini/*', requireServerAccess, async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({
      error: 'Server is not configured with Gemini API key'
    });
  }

  // Extract the Gemini API path
  const geminiPath = req.params[0];
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/${geminiPath}?key=${GEMINI_API_KEY}`;

  try {
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: getGeminiHeaders(),
      body: JSON.stringify(req.body)
    });

    const { json, raw } = await parseJsonResponse(response);

    if (!json) {
      return res.status(response.status || 500).json({
        error: 'Invalid response from Gemini API',
        status: response.status,
        statusText: response.statusText,
        details: raw.substring(0, 500)
      });
    }

    if (!response.ok) {
      console.error('Gemini API error:', json);
      return res.status(response.status).json(json);
    }

    res.json(json);
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({
      error: 'Failed to proxy request to Gemini API',
      details: error.message
    });
  }
});

// Zero / X compatibility endpoint (matches hosted Cloud Function contract)
app.get('/zero/gemini', (req, res) => {
  res.status(200).json({
    ok: true,
    functionBacked: true,
    zeroOnly: true,
    providers: ['gemini'],
    configuredProviders: ['gemini'],
    primaryProvider: 'gemini',
    primaryModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    hasApiKey: !!GEMINI_API_KEY,
    limits: {
      maxMessages: 64,
      maxInputChars: 120000,
      maxOutputTokens: 8192,
      clientRequestsPerMinute: 60,
      globalRequestsPerMinute: 300
    }
  });
});

app.post('/zero/gemini', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Server is not configured with Gemini API key' });
  }

  const model = String(req.body?.model || process.env.GEMINI_MODEL || 'gemini-3.8-flash').trim();
  const maxOutputTokens = Number(req.body?.max_tokens || req.body?.maxOutputTokens || 8192);

  const geminiMessages = (req.body?.messages || [])
    .filter(m => String(m.content || '').trim())
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
    }));

  const systemMsg = (req.body?.messages || []).find(m => m.role === 'system');

  const payload = {
    contents: geminiMessages,
    generationConfig: {
      maxOutputTokens: Math.max(1, Math.min(8192, maxOutputTokens))
    }
  };
  if (systemMsg?.content) {
    payload.system_instruction = {
      parts: [{ text: typeof systemMsg.content === 'string' ? systemMsg.content : JSON.stringify(systemMsg.content) }]
    };
  }

  const callGemini = async (targetModel) => {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent?key=${GEMINI_API_KEY}`;
    return fetch(endpoint, {
      method: 'POST',
      headers: getGeminiHeaders(),
      body: JSON.stringify(payload)
    });
  };

  try {
    let response = await callGemini(model);
    if (response.status === 404 && model !== 'gemini-2.5-flash' && model !== 'gemini-2.0-flash') {
      console.warn(`[Proxy /zero/gemini] Model ${model} returned 404, falling back to gemini-2.5-flash`);
      response = await callGemini('gemini-2.5-flash');
    }

    if (!response.ok) {
      const errText = await response.text();
      let errJson;
      try { errJson = JSON.parse(errText); } catch { errJson = { error: errText }; }
      return res.status(response.status).json(errJson);
    }

    const data = await response.json();
    const content = (data.candidates?.[0]?.content?.parts || [])
      .map(part => part.text || '')
      .join('\n');

    res.status(200).json({
      content,
      raw: content,
      provider: 'gemini',
      model,
      timestamp: Date.now(),
      usage: data.usageMetadata || null
    });
  } catch (error) {
    console.error('[Proxy /zero/gemini] Request failed:', error);
    res.status(502).json({ error: error?.message || 'Gemini request failed.' });
  }
});

// Proxy endpoint for local models (Ollama, LM Studio, etc.)
app.post('/api/local/*', requireServerAccess, async (req, res) => {
  const requestId = Math.random().toString(36).substring(7);
  const localPath = req.params[0];
  const localUrl = `${LOCAL_MODEL_ENDPOINT}/${localPath}`;

  console.log(`[API Local ${requestId}] Proxying request to ${localPath}`);

  try {
    const response = await fetch(localUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body)
    });

    console.log(`[API Local ${requestId}] Response status: ${response.status}`);
    const { json, raw } = await parseJsonResponse(response);

    if (!json) {
      console.error(`[API Local ${requestId}] ERROR: Failed to parse response`);
      return res.status(response.status || 500).json({
        error: 'Invalid response from local model',
        status: response.status,
        statusText: response.statusText,
        details: raw.substring(0, 500),
        requestId
      });
    }

    if (!response.ok) {
      console.error(`[API Local ${requestId}] ERROR: Local model error:`, json);
      return res.status(response.status).json(json);
    }

    console.log(`[API Local ${requestId}] SUCCESS: Returning response`);
    res.json(json);
  } catch (error) {
    console.error(`[API Local ${requestId}] ERROR: Proxy error:`, error);
    console.error(`[API Local ${requestId}] Stack trace:`, error.stack);
    res.status(500).json({
      error: 'Failed to proxy request to local model',
      details: error.message,
      endpoint: localUrl,
      requestId: requestId
    });
  }
});

// Proxy endpoint for OpenAI API
app.post('/api/openai/*', requireServerAccess, async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(500).json({
      error: 'Server is not configured with OpenAI API key'
    });
  }

  const openaiPath = req.params[0];
  const openaiUrl = `https://api.openai.com/v1/${openaiPath}`;

  try {
    const response = await fetch(openaiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify(req.body)
    });
    const { json, raw } = await parseJsonResponse(response);

    if (!json) {
      return res.status(response.status || 500).json({
        error: 'Invalid response from OpenAI API',
        status: response.status,
        statusText: response.statusText,
        details: raw.substring(0, 500)
      });
    }

    if (!response.ok) {
      console.error('OpenAI API error:', json);
      return res.status(response.status).json(json);
    }

    res.json(json);
  } catch (error) {
    console.error('OpenAI proxy error:', error);
    res.status(500).json({
      error: 'Failed to proxy request to OpenAI API',
      details: error.message
    });
  }
});

// Proxy endpoint for Anthropic API
app.post('/api/anthropic/*', requireServerAccess, async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'Server is not configured with Anthropic API key'
    });
  }

  const anthropicPath = req.params[0];
  const anthropicUrl = `https://api.anthropic.com/v1/${anthropicPath}`;

  try {
    const response = await fetch(anthropicUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });

    const { json, raw } = await parseJsonResponse(response);

    if (!json) {
      return res.status(response.status || 500).json({
        error: 'Invalid response from Anthropic API',
        status: response.status,
        statusText: response.statusText,
        details: raw.substring(0, 500)
      });
    }

    if (!response.ok) {
      console.error('Anthropic API error:', json);
      return res.status(response.status).json(json);
    }

    res.json(json);
  } catch (error) {
    console.error('Anthropic proxy error:', error);
    res.status(500).json({
      error: 'Failed to proxy request to Anthropic API',
      details: error.message
    });
  }
});

// Proxy endpoint for HuggingFace Inference API
app.post('/api/huggingface/models/:model(*)', requireServerAccess, async (req, res) => {
  if (!HUGGINGFACE_API_KEY) {
    return res.status(500).json({
      error: 'Server is not configured with HuggingFace API key'
    });
  }

  const modelId = req.params.model;
  const huggingfaceUrl = `https://api-inference.huggingface.co/models/${modelId}`;

  try {
    const response = await fetch(huggingfaceUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`
      },
      body: JSON.stringify(req.body)
    });

    const { json, raw } = await parseJsonResponse(response);

    if (!json) {
      return res.status(response.status || 500).json({
        error: 'Invalid response from HuggingFace API',
        status: response.status,
        statusText: response.statusText,
        details: raw.substring(0, 500)
      });
    }

    if (!response.ok) {
      console.error('HuggingFace API error:', json);
      return res.status(response.status).json(json);
    }

    res.json(json);
  } catch (error) {
    console.error('HuggingFace proxy error:', error);
    res.status(500).json({
      error: 'Failed to proxy request to HuggingFace API',
      details: error.message
    });
  }
});

// Unified chat endpoint (routes to appropriate provider)
app.post('/api/chat', admitAnonymousInference, async (req, res) => {
  const requestId = Math.random().toString(36).substring(7);
  const admission = req.publicInferenceAdmission;
  console.log(`[API Chat ${requestId}] Accepted anonymous ${admission.policy.provider}/${admission.policy.model} request (${admission.inputTokens} input tokens, ${admission.outputTokens} output-token cap)`);

  try {
    const { provider, model, messages } = req.body;
    const shouldStream = !!req.body.stream;

    if (!provider || !model || !messages) {
      console.log(`[API Chat ${requestId}] ERROR: Missing required fields`);
      return res.status(400).json({
        error: 'Missing required fields: provider, model, messages'
      });
    }

    console.log(`[API Chat ${requestId}] Routing to provider: ${provider}, model: ${model}`);
    let response, data;

    switch (provider) {
      case 'gemini':
        console.log(`[API Chat ${requestId}] Handling Gemini request`);
        if (!GEMINI_API_KEY) {
          console.log(`[API Chat ${requestId}] ERROR: Gemini API key not configured`);
          return res.status(500).json({ error: 'Gemini API key not configured' });
        }
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
        console.log(`[API Chat ${requestId}] Calling Gemini API: ${geminiUrl.split('?')[0]}`);
        response = await fetch(geminiUrl, {
          method: 'POST',
          headers: getGeminiHeaders(),
          body: JSON.stringify({
            contents: messages.map(m => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }]
            })),
            generationConfig: {
              maxOutputTokens: admission.outputTokens
            }
          })
        });
        data = await response.json();
        console.log(`[API Chat ${requestId}] Gemini response status: ${response.status}`);
        if (!response.ok) {
          console.log(`[API Chat ${requestId}] ERROR: Gemini API error:`, data);
          return res.status(response.status).json(data);
        }
        console.log(`[API Chat ${requestId}] SUCCESS: Returning Gemini response`);
        const text = (data.candidates?.[0]?.content?.parts || [])
          .map(part => part.text || '')
          .join('\n');

        if (shouldStream) {
          streamBufferedText(res, text);
          return;
        }

        return res.json({
          content: text,
          usage: data.usageMetadata
        });

      case 'openai':
        console.log(`[API Chat ${requestId}] Handling OpenAI request`);
        if (!OPENAI_API_KEY) {
          console.log(`[API Chat ${requestId}] ERROR: OpenAI API key not configured`);
          return res.status(500).json({ error: 'OpenAI API key not configured' });
        }
        console.log(`[API Chat ${requestId}] Calling OpenAI API`);
        const openAiBody = { model, messages, max_tokens: admission.outputTokens };
        if (shouldStream) openAiBody.stream = true;
        response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`
          },
          body: JSON.stringify(openAiBody)
        });
        console.log(`[API Chat ${requestId}] OpenAI response status: ${response.status}`);
        if (!response.ok) {
          const responseText = await response.text();
          try {
            data = JSON.parse(responseText);
          } catch {
            data = { error: responseText };
          }
          console.log(`[API Chat ${requestId}] ERROR: OpenAI API error:`, data);
          return res.status(response.status).json(data);
        }

        if (shouldStream) {
          await streamOpenAIResponse(response, res);
          return;
        }

        data = await response.json();
        console.log(`[API Chat ${requestId}] SUCCESS: Returning OpenAI response`);
        return res.json({
          content: data.choices[0].message.content,
          usage: data.usage
        });

      case 'anthropic':
        console.log(`[API Chat ${requestId}] Handling Anthropic request`);
        if (!ANTHROPIC_API_KEY) {
          console.log(`[API Chat ${requestId}] ERROR: Anthropic API key not configured`);
          return res.status(500).json({ error: 'Anthropic API key not configured' });
        }
        console.log(`[API Chat ${requestId}] Calling Anthropic API`);
        const anthropicBody = {
          model,
          messages,
          max_tokens: admission.outputTokens
        };
        if (shouldStream) anthropicBody.stream = true;

        response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify(anthropicBody)
        });
        console.log(`[API Chat ${requestId}] Anthropic response status: ${response.status}`);
        if (!response.ok) {
          const responseText = await response.text();
          try {
            data = JSON.parse(responseText);
          } catch {
            data = { error: responseText };
          }
          console.log(`[API Chat ${requestId}] ERROR: Anthropic API error:`, data);
          return res.status(response.status).json(data);
        }

        if (shouldStream) {
          await streamAnthropicResponse(response, res);
          return;
        }

        data = await response.json();
        console.log(`[API Chat ${requestId}] SUCCESS: Returning Anthropic response`);
        return res.json({
          content: data.content[0].text,
          usage: data.usage
        });

      case 'groq':
        console.log(`[API Chat ${requestId}] Handling Groq request`);
        if (!GROQ_API_KEY) {
          console.log(`[API Chat ${requestId}] ERROR: Groq API key not configured`);
          return res.status(500).json({ error: 'Groq API key not configured' });
        }
        console.log(`[API Chat ${requestId}] Calling Groq API`);
        const groqBody = { model, messages, max_tokens: admission.outputTokens };
        if (shouldStream) groqBody.stream = true;
        response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GROQ_API_KEY}`
          },
          body: JSON.stringify(groqBody)
        });
        console.log(`[API Chat ${requestId}] Groq response status: ${response.status}`);
        if (!response.ok) {
          const responseText = await response.text();
          try {
            data = JSON.parse(responseText);
          } catch {
            data = { error: responseText };
          }
          console.log(`[API Chat ${requestId}] ERROR: Groq API error:`, data);
          return res.status(response.status).json(data);
        }

        if (shouldStream) {
          await streamOpenAIResponse(response, res);
          return;
        }

        data = await response.json();
        console.log(`[API Chat ${requestId}] SUCCESS: Returning Groq response`);
        return res.json({
          content: data.choices[0].message.content,
          usage: data.usage
        });

      case 'vllm':
        console.log(`[API Chat ${requestId}] Handling vLLM request`);
        const vllmUrl = `${VLLM_ENDPOINT}/v1/chat/completions`;
        console.log(`[API Chat ${requestId}] Calling vLLM at: ${vllmUrl} with model: ${model}`);
        const vllmBody = { model, messages, max_tokens: admission.outputTokens };
        if (shouldStream) vllmBody.stream = true;
        response = await fetch(vllmUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(vllmBody)
        });
        console.log(`[API Chat ${requestId}] vLLM response status: ${response.status}`);
        if (!response.ok) {
          const responseText = await response.text();
          try {
            data = JSON.parse(responseText);
          } catch {
            data = { error: responseText };
          }
          console.log(`[API Chat ${requestId}] ERROR: vLLM API error:`, data);
          return res.status(response.status).json(data);
        }

        if (shouldStream) {
          await streamOpenAIResponse(response, res);
          return;
        }

        data = await response.json();
        console.log(`[API Chat ${requestId}] SUCCESS: Returning vLLM response`);
        return res.json({
          content: data.choices[0].message.content,
          usage: data.usage
        });

      case 'ollama':
        console.log(`[API Chat ${requestId}] Handling Ollama request`);
        const ollamaUrl = `${LOCAL_MODEL_ENDPOINT}/api/chat`;
        console.log(`[API Chat ${requestId}] Calling Ollama at: ${ollamaUrl} with model: ${model}`);
        console.log(`[API Chat ${requestId}] Ollama request payload:`, JSON.stringify({ model, messages: messages.length + ' messages', stream: shouldStream }));

        // Unload any running models that aren't the requested one
        try {
          const psResponse = await fetch(`${LOCAL_MODEL_ENDPOINT}/api/ps`);
          if (psResponse.ok) {
            const psData = await psResponse.json();
            if (psData.models && psData.models.length > 0) {
              for (const runningModel of psData.models) {
                if (runningModel.name !== model) {
                  console.log(`[API Chat ${requestId}] Unloading ${runningModel.name} to make room for ${model}`);
                  // Unload by sending empty generate with keep_alive: 0
                  await fetch(`${LOCAL_MODEL_ENDPOINT}/api/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      model: runningModel.name,
                      keep_alive: 0  // Immediately unload
                    })
                  });
                }
              }
            }
          }
        } catch (unloadError) {
          console.warn(`[API Chat ${requestId}] Failed to unload models:`, unloadError.message);
          // Continue anyway - the model swap will happen automatically
        }

        try {
          // Use a longer timeout for Ollama (large models can take time)
          const controller = new AbortController();
          const timeout = setTimeout(() => {
            controller.abort();
            console.log(`[API Chat ${requestId}] ERROR: Ollama request timed out after 120 seconds`);
          }, 120000); // 120 second timeout for large models

          try {
            response = await fetch(ollamaUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model,
                messages,
                stream: shouldStream,
                options: { num_predict: admission.outputTokens }
              }),
              signal: controller.signal
            });
            clearTimeout(timeout);
          } catch (fetchError) {
            clearTimeout(timeout);
            if (fetchError.name === 'AbortError') {
              throw new Error(`Ollama request timed out after 120 seconds. Large models like ${model} may take longer than expected. Try a smaller model or check Ollama server logs.`);
            }
            throw fetchError;
          }

          console.log(`[API Chat ${requestId}] Ollama response status: ${response.status}`);

          if (!response.ok) {
            const responseText = await response.text();
            try {
              data = JSON.parse(responseText);
            } catch {
              data = { error: responseText };
            }
            console.log(`[API Chat ${requestId}] ERROR: Ollama API error:`, data);
            // Add more helpful error messages
            if (response.status === 404) {
              data.helpfulMessage = `Model '${model}' not found in Ollama. Run 'ollama pull ${model}' to download it, or check 'ollama list' for available models.`;
            } else if (response.status === 503) {
              data.helpfulMessage = `Ollama service unavailable. Make sure Ollama is running at ${LOCAL_MODEL_ENDPOINT}`;
            }
            return res.status(response.status).json(data);
          }

          if (!shouldStream) {
            const ollamaData = await response.json();
            const content = ollamaData.message?.content || ollamaData.response || '';
            return res.json({ content, usage: ollamaData.eval_count });
          }

          setupSse(res);
          const reader = response.body;
          let buffer = '';

          for await (const chunk of reader) {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const parsed = JSON.parse(line);
                res.write(`data: ${line}\n\n`);
                if (parsed.done) {
                  console.log(`[API Chat ${requestId}] Stream completed`);
                  res.write(`${SSE_DONE}\n\n`);
                  res.end();
                  return;
                }
              } catch (e) {
                console.error(`[API Chat ${requestId}] Failed to parse chunk:`, line);
              }
            }
          }

          res.write(`${SSE_DONE}\n\n`);
          res.end();
          return;
        } catch (ollamaError) {
          console.log(`[API Chat ${requestId}] ERROR: Ollama request failed:`, ollamaError.message);
          throw ollamaError;
        }

      default:
        console.log(`[API Chat ${requestId}] ERROR: Unsupported provider: ${provider}`);
        return res.status(400).json({ error: `Unsupported provider: ${provider}` });
    }
  } catch (error) {
    console.error(`[API Chat ${requestId}] EXCEPTION:`, error);
    console.error(`[API Chat ${requestId}] Stack trace:`, error.stack);
    res.status(500).json({
      error: 'Failed to process chat request',
      details: error.message,
      requestId: requestId
    });
  }
});
}
