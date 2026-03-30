# Running REPLOID with Local Models

REPLOID currently supports local-model workflows in two ways:

1. `Proxy-local`: the Reploid proxy talks to a local model server, typically Ollama.
2. `Doppler`: the browser uses WebGPU and the Doppler local inference stack.

Use this document as the current source of truth for local-model setup. Older references to `ApiClient.setProvider()` or `config.json` are obsolete.

---

## Option 1: Proxy-Local Models with Ollama

This is the most stable local-model path today.

### 1. Install and start Ollama

```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Pull a model
ollama pull qwen2.5-coder:7b

# Start the server
ollama serve
```

Default endpoint: `http://localhost:11434`

### 2. Configure the Reploid proxy

Create `.env` in the Reploid repo:

```env
LOCAL_MODEL_ENDPOINT=http://localhost:11434

# Optional cloud providers for hybrid use
GEMINI_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
ANTHROPIC_API_KEY=your_key_here
```

### 3. Start Reploid

```bash
npm install
npm start
```

Open `http://localhost:8000`.

### 4. Choose `Proxy` in the boot wizard

The boot wizard will try to detect:
- the Reploid proxy on `localhost:8000`
- Ollama on `localhost:11434`

If Ollama is selected:
- `serverType` becomes `ollama`
- the selected model is stored in `SELECTED_MODELS`
- Reploid will route chat/inference through the proxy with `hostType: proxy-local`

### 5. Verify the proxy and the model

Useful endpoints:

```bash
curl http://localhost:8000/api/health
curl http://localhost:8000/api/proxy-status
curl http://localhost:8000/api/ollama/models
curl http://localhost:11434/api/tags
```

---

## Option 2: Doppler Local Models

This path keeps inference in the browser and relies on WebGPU plus Doppler assets.

### Requirements

- WebGPU-capable browser
- Reachable Doppler asset base
- A local Doppler model exposed through the current boot-wizard detection path

### 1. Start Reploid

```bash
npm install
npm start
```

### 2. Open the app and choose `Doppler`

The boot wizard will probe Doppler support and any available local models.

If Doppler support is available:
- choose `Doppler`
- select the detected model
- verify and awaken

### 3. Override the Doppler asset base if needed

The app defaults to `/doppler` for Doppler assets. Override it with `dopplerBase`:

```text
http://localhost:8000/?dopplerBase=http://localhost:9000/doppler
```

The selected local model is stored with `hostType: browser-local` and `provider: doppler`.

---

---

## Supported Local Servers

The current proxy implementation is Ollama-first.

Supported today:
- Ollama on `LOCAL_MODEL_ENDPOINT`
- the Reploid proxy serving Ollama-backed model lists and chat

Potentially compatible with adaptation:
- other local servers that expose Ollama-style endpoints such as `/api/tags`, `/api/chat`, and `/api/generate`

This document does not treat generic OpenAI-compatible local servers as first-class supported paths unless the server matches the current proxy expectations.

---

## Troubleshooting

### Ollama not detected

```bash
curl http://localhost:11434/api/tags
```

If that fails:
- start `ollama serve`
- verify `LOCAL_MODEL_ENDPOINT`
- check that the process is listening on the expected port

### Proxy is up but no local models appear

- open `http://localhost:8000/api/health`
- open `http://localhost:8000/api/ollama/models`
- inspect the proxy logs for Ollama connection errors

### Doppler option is disabled

- confirm WebGPU support
- confirm the Doppler asset base is reachable
- try overriding `dopplerBase`
- test in a clean browser profile if service-worker state looks stale

### Model runs but quality is poor

- use a larger Ollama model
- move from Doppler to proxy-local if you need a stronger local model
- use a hybrid setup with cloud models for orchestration and local models for selective tasks

### Storage pressure

- Doppler assets and VFS state compete for browser storage
- export important artifacts before clearing site storage
- disable `REPLOID_PRESERVE_ON_BOOT` if you want a clean reseed

---

## Security Notes

- Proxy-local keeps API keys on the server side
- Doppler keeps inference inside the browser
- VFS mutation remains sandboxed in the browser regardless of model path
- Local models do not bypass Reploid's verification, HITL, or arena gates

---

## Related Docs

- [QUICK-START.md](./QUICK-START.md)
- [CONFIGURATION.md](./CONFIGURATION.md)
- [SECURITY.md](./SECURITY.md)
- [API.md](./API.md)
- [Doppler Architecture](../../doppler/docs/architecture.md)

---

*Last updated: March 2026*
