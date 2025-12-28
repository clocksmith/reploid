# Blueprint 0x000089: Proxy Server

**Objective:** Express-based development server with LLM API proxying, static file serving, and WebRTC signaling.

**Target Module:** Proxy Server (`server/proxy.js`)

**Prerequisites:** Node.js, Express, ws

**Affected Artifacts:** `/server/proxy.js`, `/server/signaling-server.js`

---

### 1. The Strategic Imperative

Browser-based agents cannot directly call LLM APIs due to CORS restrictions. The proxy server:

- Routes LLM API requests (Anthropic, OpenAI, Gemini, Ollama, Groq)
- Serves static files for the web application
- Provides WebRTC signaling for P2P communication
- Hosts the AgentBridge for multi-agent coordination

### 2. The Architectural Solution

**Server Stack:**
```javascript
const app = express();
const server = http.createServer(app);

// Components
const signalingServer = new SignalingServer(server);
const agentBridge = new AgentBridge(server);

// API Routes
app.post('/api/llm/:provider', handleLLMProxy);
app.post('/api/gemini', handleGeminiProxy);
app.post('/api/models', handleModelList);
```

### 3. LLM Provider Routing

| Endpoint | Provider | Description |
|----------|----------|-------------|
| `POST /api/llm/anthropic` | Anthropic | Claude models |
| `POST /api/llm/openai` | OpenAI | GPT models |
| `POST /api/llm/groq` | Groq | Fast inference |
| `POST /api/llm/ollama` | Ollama | Local models |
| `POST /api/llm/vllm` | vLLM | Local GPU inference |
| `POST /api/gemini` | Google | Gemini models |

### 4. Configuration

Environment variables or config file:
```
PORT=8000
ANTHROPIC_API_KEY=sk-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
LOCAL_MODEL_ENDPOINT=http://localhost:11434
VLLM_ENDPOINT=http://localhost:8000
```

### 5. Static File Serving

```javascript
app.use(express.static(path.join(__dirname, '..')));
app.use('/doppler', express.static(dopplerDistDir));
app.use('/kernels', express.static(dopplerKernelDir));
```

### 6. Rate Limiting

Simple per-origin rate limiter:
- 5 requests per second per origin
- Returns 429 on limit exceeded
- Prevents API abuse

### 7. Crash Protection

```javascript
process.on('uncaughtException', (err) => {
  console.error('[CRASH PROTECTION] Uncaught exception:', err);
  // Server continues running
});
```

### 8. CORS Configuration

```javascript
app.use(cors({
  origin: true,
  credentials: true
}));
```

---

### 9. Endpoints Summary

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/llm/:provider` | POST | Proxy LLM request |
| `/api/gemini` | POST | Gemini-specific proxy |
| `/api/models` | POST | List available models |
| `/api/run` | GET | Download full VFS export |
| `/health` | GET | Health check |
| `/` | GET | Serve index.html |

### 10. WebSocket Paths

| Path | Service |
|------|---------|
| `/signaling` | WebRTC signaling server |
| `/claude-bridge` | Agent coordination bridge |
