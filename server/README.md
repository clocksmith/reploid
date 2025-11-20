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
