# Blueprint 0x000072: Agent Bridge

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/server/agent-bridge.js`, `/server/proxy-app.js`

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000072-agent-bridge.md`, `self/blueprints/0x000088-agent-bridge.md`
**Objective:** Define the authenticated JSON-RPC WebSocket coordination server used by browser and agent processes for discovery, direct messaging, task delegation, shared context, and liveness.

**Target Module:** `AgentBridge`

**Affected Artifacts:** `/server/agent-bridge.js`, `/server/proxy-app.js`

This blueprint covers the server-side bridge only. `self/boot-helpers/iframe-bridge.js` is an unrelated browser helper that passes a `PARENT_GOAL` message from a parent window into an embedded instance; it is not part of this protocol and is not owned here.

---

## 1. Intent

The Agent Bridge is a coordination service, not an inference authority. It lets registered agents discover peers, exchange bounded messages, delegate work, publish task status, and share explicitly named context through one WebSocket endpoint. The bridge must keep transport identity, origin policy, and liveness visible rather than silently accepting arbitrary remote clients.

## 2. Runtime boundary

`server/agent-bridge.js` owns a `WebSocketServer` in `noServer` mode. `server/proxy-app.js` creates the HTTP server, constructs the bridge at `/agent-bridge` with a 30 s heartbeat interval and a 120 s agent timeout (`proxy-app.js:620-627`), and routes matching upgrade requests to it (`proxy-app.js:644-659`). The bridge is not started when the proxy runs in pool-backend-only mode. `server/proxy.js` is only the process entry that calls `createProxy()` and listens.

Local-only mode is the default; `REPLOID_AGENT_BRIDGE_LOCAL_ONLY=false` enables remote mode, which also requires `REPLOID_AGENT_BRIDGE_ACCESS_TOKEN` (`proxy-app.js:624-626`, `agent-bridge.js:104-111`).

The bridge maintains three in-memory projections:

```text
agents         agentId -> socket, name, capabilities, metadata, timestamps
tasks          taskId  -> assignment, delegator, assignee, status, result/error
sharedContext  key     -> value, author, timestamp
```

These projections are operational state. They are not durable room memory, Poolday evidence, or permission to mutate another agent.

## 3. Access and upgrade contract

A connection is accepted only when all applicable checks pass:

1. The request path matches the configured bridge path.
2. In local-only mode, the remote address and any supplied origin are loopback.
3. In remote mode, the origin matches the configured allowlist.
4. Remote mode has an explicit access token and the request supplies the same token.
5. Token comparison is timing-safe.

Rejected upgrades close with an explicit HTTP status. Remote operation without a configured token fails closed.

## 4. JSON-RPC contract

Every inbound message is JSON-RPC 2.0 and names a method. Requests with an `id` receive a result or error response; notifications may omit the `id`.

| Method | Registration required | Result |
| --- | --- | --- |
| `register` | No | Creates a unique agent identity and returns the active roster. |
| `broadcast` | Yes | Sends `broadcast_received` to every other connected agent. |
| `send_to` | Yes | Sends `message_received` to one named connected agent. |
| `query_agents` | No | Returns agents, optionally filtered by capability. |
| `delegate_task` | Yes | Assigns a task to a named or capability-compatible agent. |
| `update_task_status` | Yes, assignee only | Updates the task and notifies the delegator. |
| `get_shared_context` | No | Returns one key or the complete context projection. |
| `set_shared_context` | Yes | Writes a value and broadcasts `context_updated`. |
| `heartbeat` | Yes | Refreshes the agent liveness timestamp. |

The earlier summary shell used `get-agents`, `assign-task`, `update-task`, `/claude-bridge`, and ad-hoc message types. Those names do not match the implementation and are intentionally not preserved.

## 5. Task and context invariants

- Only a registered agent may broadcast, send direct messages, delegate work, change context, or heartbeat.
- Only the assigned agent may update a task.
- Capability-based assignment must require every declared capability.
- Task status changes preserve delegator and assignee identity.
- Shared-context changes name the author and timestamp and notify other agents.
- The bridge does not treat shared context as verified knowledge.

## 6. Liveness and shutdown

A periodic monitor closes agents whose `lastSeen` exceeds `agentTimeout`, removes them from the roster, and emits `agent-timeout`. Explicit disconnect emits `agent-left`. Shutdown stops the monitor, clears operational projections, closes open sockets, and closes the WebSocket server.

## 7. Observable surface

`getStats()` returns active-agent, active-task, and shared-context counts plus bounded agent and task projections. `server/proxy-app.js:577-583` exposes that projection at `GET /api/agent-bridge/stats` and returns 503 when the bridge is not initialized.

## 8. Verification requirements

- [x] Upgrade routing is owned by the shared HTTP server.
- [x] Local-only, origin, and remote-token checks fail closed.
- [x] JSON-RPC version and method are validated.
- [x] Registration, broadcast, direct messaging, capability queries, task delegation, task updates, shared context, and heartbeats are implemented.
- [x] Task updates are assignee-bound.
- [x] Stale agents time out and shutdown clears timers and sockets.
- Add focused unit coverage for access policy, JSON-RPC errors, task authorization, and timeout cleanup.

*Last updated: August 2026*
