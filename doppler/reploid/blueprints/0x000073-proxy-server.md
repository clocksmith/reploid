# Blueprint 0x00008A-PRXY: Proxy Server

**Objective:** Multi-provider LLM API proxy server with SSE streaming, GPU monitoring, VFS backup, and integrated WebSocket services.

**Target Module:** `proxy.js`

**Implementation:** `/server/proxy.js`

**Prerequisites:** `0x000089-ABRG` (Agent Bridge), `0x00008A` (Signaling Server)

**Category:** Server

---

## 1. The Strategic Imperative

Browser-based agents cannot directly call LLM APIs due to CORS restrictions and the need to protect API keys. The Proxy Server acts as a unified gateway that:

- **Routes LLM Requests**: Proxies to Gemini, OpenAI, Anthropic, Groq, HuggingFace, Ollama, and vLLM
- **Streams Responses**: Translates provider-specific streaming to unified SSE format
- **Manages Local Models**: Auto-starts and monitors Ollama for local inference
- **Provides Coordination**: Hosts WebSocket services for multi-agent coordination
- **Persists State**: Backup/restore VFS state to disk for persistence across sessions

## 2. The Architectural Solution

The `/server/proxy.js` implements an Express.js server that serves as the backend for all REPLOID browser clients.

### High-Level Architecture

```
Browser Client
      |
      v
  [Proxy Server]
      |
      +---> /api/chat ---------> [Provider Router] ---> Gemini/OpenAI/Anthropic/...
      |
      +---> /api/gemini/* -----> [Gemini Direct Proxy]
      +---> /api/openai/* -----> [OpenAI Direct Proxy]
      +---> /api/anthropic/* --> [Anthropic Direct Proxy]
      +---> /api/local/* ------> [Ollama/LM Studio Proxy]
      |
      +---> /api/gpu/status ---> [GPU Monitor]
      +---> /api/vfs/* --------> [VFS Persistence]
      +---> /api/console ------> [Console Logging]
      |
      +---> /agent-bridge -----> [WebSocket: Agent Coordination]
      +---> /signaling --------> [WebSocket: WebRTC Signaling]
```

## 3. API Routes

### Chat Routes (Unified Interface)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat` | POST | Unified chat endpoint (routes by provider) |
| `/api/health` | GET | Server and provider health status |

### Provider-Specific Routes

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/gemini/*` | POST | Direct Gemini API proxy |
| `/api/openai/*` | POST | Direct OpenAI API proxy |
| `/api/anthropic/*` | POST | Direct Anthropic API proxy |
| `/api/local/*` | POST | Ollama/LM Studio proxy |
| `/api/groq/*` | POST | Groq API proxy |
| `/api/huggingface/*` | POST | HuggingFace Inference API proxy |
| `/api/vllm/*` | POST | vLLM server proxy |

### System Routes

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/gpu/status` | GET | GPU and Ollama status |
| `/api/ollama/models` | GET | List available Ollama models |
| `/api/ollama/unload` | POST | Unload model from GPU memory |
| `/api/vfs/backup` | POST | Save VFS state to disk |
| `/api/vfs/restore` | GET | Load VFS state from disk |
| `/api/console` | POST | Server-side console logging |
| `/api/agent-bridge/stats` | GET | Agent Bridge statistics |

## 4. Chat Request Format

The unified `/api/chat` endpoint accepts requests in a standard format:

```javascript
// POST /api/chat
{
  provider: 'openai',              // gemini|openai|anthropic|groq|ollama|vllm|huggingface
  model: 'gpt-4',                  // Provider-specific model ID
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello!' }
  ],
  stream: true,                    // Enable SSE streaming (optional)
  temperature: 0.7,                // Optional parameters
  max_tokens: 4096
}
```

## 5. SSE Streaming Support

All providers support Server-Sent Events for real-time token streaming:

### Streaming Response Format

```
data: {"choices":[{"delta":{"content":"Hello"}}]}

data: {"choices":[{"delta":{"content":" world"}}]}

data: {"choices":[{"delta":{"content":"!"}}]}

data: [DONE]
```

### Streaming Implementation

```javascript
app.post('/api/chat', async (req, res) => {
  const { provider, model, messages, stream } = req.body;

  if (stream) {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Stream from provider
    const providerStream = await getProviderStream(provider, model, messages);

    for await (const chunk of providerStream) {
      // Normalize to unified format
      const normalized = normalizeChunk(provider, chunk);
      res.write(`data: ${JSON.stringify(normalized)}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } else {
    // Non-streaming response
    const response = await callProvider(provider, model, messages);
    res.json(response);
  }
});
```

## 6. Provider Configuration

### Environment Variables

```bash
# API Keys
GEMINI_API_KEY=your-gemini-key
OPENAI_API_KEY=your-openai-key
ANTHROPIC_API_KEY=your-anthropic-key
GROQ_API_KEY=your-groq-key
HUGGINGFACE_API_KEY=your-hf-key

# Local Model Endpoints
LOCAL_MODEL_ENDPOINT=http://localhost:11434    # Ollama default
VLLM_ENDPOINT=http://localhost:8000            # vLLM default
LM_STUDIO_ENDPOINT=http://localhost:1234       # LM Studio default

# Server Configuration
PORT=3000
AUTO_START_OLLAMA=true                         # Auto-launch Ollama on startup
```

### Provider Routing Logic

```javascript
const routeToProvider = async (provider, model, messages, options) => {
  switch (provider) {
    case 'gemini':
      return await callGemini(model, messages, options);
    case 'openai':
      return await callOpenAI(model, messages, options);
    case 'anthropic':
      return await callAnthropic(model, messages, options);
    case 'groq':
      return await callGroq(model, messages, options);
    case 'ollama':
    case 'local':
      return await callOllama(model, messages, options);
    case 'vllm':
      return await callVLLM(model, messages, options);
    case 'huggingface':
      return await callHuggingFace(model, messages, options);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
};
```

## 7. GPU Monitoring

For systems with AMD GPUs (ROCm) or NVIDIA GPUs, the proxy provides GPU status:

```javascript
// GET /api/gpu/status
{
  gpu: {
    available: true,
    type: 'AMD',                   // or 'NVIDIA'
    memory: {
      total: 16384,                // MB
      used: 8192,
      free: 8192
    }
  },
  ollama: {
    running: true,
    models: ['llama3.2:3b', 'qwen2.5:7b'],
    loadedModel: 'llama3.2:3b'
  }
}
```

## 8. VFS Persistence

The proxy provides backup/restore for browser VFS state:

### Backup VFS

```javascript
// POST /api/vfs/backup
// Request body: VFS state JSON
{
  artifacts: { ... },
  checkpoints: [ ... ],
  metadata: { ... }
}

// Response
{ success: true, path: './data/vfs-backup.json' }
```

### Restore VFS

```javascript
// GET /api/vfs/restore
// Response: VFS state JSON (or empty if no backup exists)
{
  artifacts: { ... },
  checkpoints: [ ... ],
  metadata: { ... }
}
```

## 9. Console Logging Endpoint

Browser clients can log to the server console for debugging:

```javascript
// POST /api/console
{
  level: 'info',                   // debug|info|warn|error
  message: 'Agent cycle completed',
  data: { iteration: 42, duration: 1500 }
}
```

## 10. WebRTC Signaling Integration

The proxy initializes the Signaling Server for WebRTC peer coordination:

```javascript
const SignalingServer = require('./signaling-server');

const server = app.listen(PORT);
const signalingServer = new SignalingServer(server, {
  path: '/signaling'
});
```

## 11. Agent Bridge Integration

The proxy initializes the Agent Bridge for multi-agent coordination:

```javascript
const AgentBridge = require('./agent-bridge');

const agentBridge = new AgentBridge(server, {
  path: '/agent-bridge'
});

app.get('/api/agent-bridge/stats', (req, res) => {
  res.json(agentBridge.getStats());
});
```

## 12. Static File Serving

The proxy serves the REPLOID frontend:

```javascript
app.use(express.static('public'));
app.use('/dist', express.static('dist'));
```

## 13. CORS Configuration

```javascript
const cors = require('cors');

app.use(cors({
  origin: true,                    // Allow all origins (development)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

## 14. Error Handling

```javascript
// Global error handler
app.use((err, req, res, next) => {
  console.error('[Proxy] Error:', err);

  res.status(err.status || 500).json({
    error: {
      message: err.message,
      code: err.code || 'INTERNAL_ERROR'
    }
  });
});

// Provider-specific error normalization
const normalizeProviderError = (provider, error) => {
  switch (provider) {
    case 'openai':
      return { message: error.error?.message, code: error.error?.code };
    case 'anthropic':
      return { message: error.error?.message, code: error.error?.type };
    case 'gemini':
      return { message: error.error?.message, code: error.error?.status };
    default:
      return { message: error.message, code: 'PROVIDER_ERROR' };
  }
};
```

## 15. Startup Sequence

```javascript
const startServer = async () => {
  // 1. Load configuration
  loadConfig();

  // 2. Auto-start Ollama if configured
  if (process.env.AUTO_START_OLLAMA === 'true') {
    await startOllama();
  }

  // 3. Start HTTP server
  const server = app.listen(PORT, () => {
    console.log(`[Proxy] Server running on port ${PORT}`);
  });

  // 4. Initialize WebSocket services
  new SignalingServer(server, { path: '/signaling' });
  const bridge = new AgentBridge(server, { path: '/agent-bridge' });

  // 5. Register stats endpoint
  app.get('/api/agent-bridge/stats', (req, res) => {
    res.json(bridge.getStats());
  });

  return server;
};

startServer();
```

## 16. Operational Safeguards

| Concern | Mitigation |
|---------|------------|
| API key exposure | Keys stored server-side only |
| CORS attacks | Configurable origin whitelist |
| Rate limiting | Per-client request throttling |
| Large payloads | Request body size limits |
| Timeouts | Provider-specific timeout handling |
| Memory leaks | Stream cleanup on client disconnect |

---

**Status:** Implemented
