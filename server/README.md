# Server Directory

**Purpose**: Server-side components for proxy services and WebRTC signaling.

## Contents

| File | Purpose |
|------|---------|
| `proxy.js` | HTTP proxy server for API requests and CORS handling |
| `signaling-server.js` | WebRTC signaling server for peer-to-peer swarm communication |
| `agent-bridge.js` | Simple agent coordination |

## Usage

```bash
npm start
# Starts proxy + signaling + bridge on port 8000
```

## CORS Configuration

The proxy automatically whitelists `http://localhost:8080` and `https://replo.id` so the hosted UI can talk to a local proxy. To allow additional origins (for example a custom domain), either:

1. **Set an environment variable**

```bash
export CORS_ORIGINS="https://replo.id,https://your-domain.example"
npm start
```

2. **Or add a `server.corsOrigins` array to your config file**

```json
{
  "server": {
    "corsOrigins": [
      "http://localhost:8080",
      "https://replo.id",
      "https://your-domain.example"
    ]
  }
}
```

Restart the proxy after changing the configuration.
