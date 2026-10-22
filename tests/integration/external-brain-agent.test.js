// @vitest-environment node
// Real HTTP/provider/X loop and file tools, with in-memory host storage (not browser qualification).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createExternalBrainRouter } from '../../server/external-brain.js';
import { createExternalBrainProvider } from '../../self/providers/external-brain.js';
import Registry from '../../self/core/provider-registry.js';
import LLMClient from '../../self/core/llm-client.js';
import AgentLoop from '../../self/core/agent-loop.js';
import ToolExecutor from '../../self/infrastructure/tool-executor.js';
import ResponseParser from '../../self/core/response-parser.js';
import WriteFile, { tool as writeSchema } from '../../self/tools/WriteFile.js';
import ReadFile, { tool as readSchema } from '../../self/tools/ReadFile.js';

const quiet = () => {};
const headers = { 'Content-Type': 'application/json', 'X-Reploid-External-Brain': '1' };
const schemas = [writeSchema, readSchema].map(tool => ({ type: 'function', function: {
  name: tool.name, description: tool.description, parameters: tool.inputSchema
} }));
let server, mailbox, base, agent, files, events, allowed;

async function pendingRequest() {
  let pending;
  await vi.waitFor(async () => {
    pending = (await (await fetch(`${base}/requests`, { headers })).json()).pending[0];
    expect(pending).toBeDefined();
  }, { timeout: 3000, interval: 10 });
  return pending;
}
async function respond(request, content, toolCalls) {
  return fetch(`${base}/requests/${request.requestId}/respond`, { method: 'POST', headers,
    body: JSON.stringify({ schema: 'reploid.external-brain.response/v1',
      requestId: request.requestId, sessionId: request.sessionId, content, ...(toolCalls ? { toolCalls } : {}) }) });
}

beforeEach(async () => {
  files = new Map(); events = []; allowed = new Set(['WriteFile', 'ReadFile']);
  mailbox = createExternalBrainRouter({ timeoutMs: 4000 });
  const app = express(); app.use('/api/external-brain', mailbox.router);
  server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  base = `${origin}/api/external-brain`;
  vi.stubGlobal('window', { getReploidMode: () => 'x' });
  const Utils = { logger: { debug: quiet, info: quiet, warn: quiet, error: quiet },
    trunc: (value, max) => String(value).slice(0, max), generateId: () => `req_${randomUUID()}`,
    sanitizeLlmJsonRespPure: text => ({ json: text }),
    Errors: { StateError: Error, ConfigError: Error, ValidationError: Error, AbortError: class AbortError extends Error {} } };
  const VFS = { exists: async path => files.has(path),
    stat: async path => ({ type: 'file', size: Buffer.byteLength(files.get(path) || '') }), read: async path => {
    if (!files.has(path)) throw new Error(`Not found: ${path}`);
    return files.get(path);
  }, write: async (path, content) => files.set(path, content), list: async () => [...files.keys()] };
  const EventBus = { on: () => quiet, emit: quiet };
  const provider = createExternalBrainProvider({
    fetch: (path, options) => fetch(new URL(path, origin), options),
    getLocation: () => new URL(origin), getSessionId: () => 'x:actual-loop'
  });
  const registry = Registry.factory({ Utils }); registry.registerProvider('external', provider);
  const runner = { list: () => [...allowed], has: name => allowed.has(name), getToolSchemas: () => schemas,
    execute: (name, args) => ({ WriteFile, ReadFile })[name](args, { VFS, EventBus }) };
  agent = AgentLoop.factory({ Utils, EventBus, VFS,
    LLMClient: LLMClient.factory({ Utils, ProviderRegistry: registry }), ToolRunner: runner,
    ToolExecutor: ToolExecutor.factory({ Utils, ToolRunner: runner, EventBus }),
    ResponseParser: ResponseParser.factory({ Utils }),
    ContextManager: { manage: async context => ({ context }), emitTokens: quiet, countTokens: () => 1 },
    StateManager: { setGoal: quiet, incrementCycle: quiet, getState: () => ({ config: { agentCycleThrottle: { cycleIntervalMs: 0 } } }) },
    PersonaManager: { getSystemPrompt: async () => 'Use the provided local file tools.' },
    CircuitBreaker: { create: () => ({ reset: quiet, isOpen: () => false, recordSuccess: quiet, recordFailure: quiet }) },
    SchemaRegistry: { getToolSchemas: () => schemas }, onExecutionEvent: event => events.push(event) });
  agent.setModel({ id: 'external-brain', provider: 'external', hostType: 'direct', maxIterations: 3 });
});
afterEach(async () => {
  agent?.stop(); mailbox?.close(); await agent?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  vi.unstubAllGlobals();
});

describe('external reasoning through the real X loop', () => {
  it('round-trips typed decisions through actual WriteFile/ReadFile and returns observations', async () => {
    const running = agent.run('Write and inspect a local acceptance artifact.');
    const first = await pendingRequest();
    expect(first.tools.map(tool => tool.function.name)).toEqual(['WriteFile', 'ReadFile']);
    expect(first.messages.some(message => String(message.content).includes('local acceptance artifact'))).toBe(true);
    expect((await respond(first, '', [{ name: 'WriteFile', args: { path: '/artifacts/external-brain.txt', content: 'external-brain-roundtrip' } }])).status).toBe(200);
    const second = await pendingRequest();
    expect(JSON.stringify(second.messages)).toContain('bytesWritten');
    expect(files.get('/artifacts/external-brain.txt')).toBe('external-brain-roundtrip');
    await respond(second, '', [{ name: 'ReadFile', args: { path: '/artifacts/external-brain.txt' } }]);
    const third = await pendingRequest();
    expect(JSON.stringify(third.messages)).toContain('external-brain-roundtrip');
    await respond(third, 'DONE: The local artifact was read back.');
    await running;
    expect(events.filter(event => event.type === 'tool.completed')).toHaveLength(2);
    expect((await respond(first, 'Duplicate')).status).toBe(409);
  });

  it('rechecks host authority after a decision is queued and returns denial as observation', async () => {
    const running = agent.run('Inspect a local file.');
    const request = await pendingRequest();
    allowed.delete('WriteFile');
    await respond(request, '', [{ name: 'WriteFile', args: { path: '/artifacts/denied.txt', content: 'must not execute' } }]);
    const observation = await pendingRequest();
    expect(files.has('/artifacts/denied.txt')).toBe(false);
    expect(JSON.stringify(observation.messages)).toContain('Host denied tool');
    expect(events.some(event => event.type === 'tool.denied')).toBe(true);
    agent.stop(); await running;
  });

  it('settles cancellation, rejects the late decision, and starts a fresh request', async () => {
    const running = agent.run('Inspect cancellation.');
    const request = await pendingRequest();
    agent.stop(); await running;
    await vi.waitFor(async () => {
      expect((await (await fetch(`${base}/requests`, { headers })).json()).pending).toHaveLength(0);
    });
    expect((await respond(request, '', [{ name: 'WriteFile', args: { path: '/artifacts/late.txt', content: 'late' } }])).status).toBe(409);
    expect(files.has('/artifacts/late.txt')).toBe(false);
    const next = agent.run('Inspect a fresh request.');
    const replacement = await pendingRequest();
    expect(replacement.requestId).not.toBe(request.requestId);
    await respond(replacement, 'DONE: Fresh request completed.');
    agent.stop(); await next;
  });
});
