import { afterEach, describe, expect, it, vi } from 'vitest';
import LabAgent from '../../self/core/agent-loop.js';
import ToolExecutor from '../../self/infrastructure/tool-executor.js';
import ResponseParser from '../../packages/reploid/src/agent/response-parser.js';
import { createReploid } from '../../packages/reploid/src/agent/index.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { requireSurfaceIntent, authorizeSurfaceOperation } from '../../self/config/surface-intents.js';

const quiet = () => {};
const utils = { logger: { debug: quiet, info: quiet, warn: quiet, error: quiet },
  trunc: (value, max) => String(value).slice(0, max), generateId: () => 'fixture',
  sanitizeLlmJsonRespPure: text => ({ json: text }),
  Errors: { StateError: Error, ConfigError: Error, AbortError: class AbortError extends Error {} } };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
const owners = [];
afterEach(async () => { await Promise.all(owners.splice(0).map(agent => agent.close())); vi.unstubAllGlobals(); });

function surfaceAgent(surface, { tools = {}, generate, authorize = () => true, extension = null } = {}) {
  const events = [];
  let agent;
  if (surface === 'work') {
    agent = createReploid({ config: resolveConfig({ overrides: { agent: { maxCycles: 5 },
      models: { providerId: 'fixture' }, tools: { allowed: [], allowDynamic: true } } }),
    ports: { instanceId: 'surface-contract', authorize, tools, providers: { fixture: { generate } },
      onExecutionEvent: event => events.push(event) } });
    owners.push(agent);
    return { events, run: goal => agent.execute({ goal }), stop: agent.cancel,
      close: agent.close, checkpoint: agent.checkpoint, context: () => agent.getSnapshot().context };
  }
  vi.stubGlobal('window', { getReploidMode: () => surface });
  const runner = { list: () => Object.keys(tools), has: name => Object.hasOwn(tools, name) && authorize({ action: 'tool.execute', name }),
    execute: (name, args, control) => tools[name](args, control) };
  const eventBus = { on: () => quiet, emit: quiet };
  agent = LabAgent.factory({ Utils: utils, EventBus: eventBus,
    LLMClient: { chat: (messages, model, onChunk, control) => generate(messages, onChunk, control) },
    ToolRunner: runner, ToolExecutor: ToolExecutor.factory({ Utils: utils, ToolRunner: runner, EventBus: eventBus }),
    ResponseParser: ResponseParser.factory({ Utils: utils }),
    ContextManager: { manage: async context => ({ context }), emitTokens: quiet, countTokens: () => 1 },
    StateManager: { setGoal: quiet, incrementCycle: quiet, getState: () => ({ config: { agentCycleThrottle: { cycleIntervalMs: 0 } } }) },
    PersonaManager: { getSystemPrompt: async () => 'A bounded agent' },
    CircuitBreaker: { create: () => ({ reset: quiet, isOpen: () => false, recordSuccess: quiet, recordFailure: quiet }) },
    SchemaRegistry: { getToolSchemas: () => [] }, onExecutionEvent: event => events.push(event),
    ...(extension ? { MultiModelCoordinator: extension } : {}) });
  agent.setModel({ id: 'fixture', provider: 'fixture', maxIterations: 5 });
  if (extension) agent.setModels([{ id: 'a' }, { id: 'b' }]);
  owners.push(agent);
  return { events, run: agent.run, stop: agent.stop, close: agent.close,
    checkpoint: agent.checkpoint, context: agent.getContext };
}

for (const surface of ['zero', 'x', 'work']) describe(`${surface} execution contract`, () => {
  const terminal = surface === 'work' ? 'IDLE: review the result' : 'DONE';
  it('interprets native calls, grows a tool, records its result and detaches checkpoint state', async () => {
    let turn = 0;
    const ReadCreated = vi.fn(async () => 'created tool result');
    const tools = { CreateTool: async () => { tools.ReadCreated = ReadCreated; return { created: 'ReadCreated' }; } };
    const agent = surfaceAgent(surface, { tools, generate: async () => [
      { content: '', toolCalls: [{ name: 'CreateTool', args: {} }] },
      { content: '', toolCalls: [{ name: 'ReadCreated', args: {} }] },
      { content: terminal }
    ][turn++] });
    await agent.run('Inspect the created reader');
    expect(ReadCreated).toHaveBeenCalledOnce();
    expect(agent.context().some(message => String(message.content).includes('created tool result'))).toBe(true);
    expect(agent.events.filter(event => event.type.startsWith('tool.')).map(event => event.type))
      .toEqual(['tool.started', 'tool.completed', 'tool.started', 'tool.completed']);
    const checkpoint = await agent.checkpoint();
    const context = surface === 'work' ? checkpoint.state.messages : checkpoint.context;
    context[0].content = 'external mutation';
    expect(agent.context()[0].content).not.toBe('external mutation');
  });
  it('denies a tool without invoking it and retains the denial observation', async () => {
    let turn = 0;
    const ReadFile = vi.fn();
    const agent = surfaceAgent(surface, { tools: { ReadFile }, authorize: request => request.action !== 'tool.execute',
      generate: async () => turn++ ? { content: terminal } : { content: '', toolCalls: [{ name: 'ReadFile', args: {} }] } });
    await agent.run('Inspect the input');
    expect(ReadFile).not.toHaveBeenCalled();
    expect(agent.events.some(event => event.type === 'tool.denied')).toBe(true);
    expect(agent.context().some(message => String(message.content).includes('Host denied tool'))).toBe(true);
  });
  it('cancels provider observation, suppresses late results and waits for borrowed work on close', async () => {
    const started = deferred(), borrowed = deferred();
    const WriteFile = vi.fn();
    const agent = surfaceAgent(surface, { tools: { WriteFile }, generate: async () => { started.resolve(); return borrowed.promise; } });
    const active = agent.run('Inspect the bounded goal').catch(error => error);
    await started.promise; agent.stop(); await active;
    let closed = false;
    const closing = agent.close().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
    borrowed.resolve({ content: '', toolCalls: [{ name: 'WriteFile', args: { content: 'late' } }] });
    await closing;
    expect(WriteFile).not.toHaveBeenCalled();
    expect(agent.events.some(event => event.type === 'provider.cancelled')).toBe(true);
  });
});

it('X can compose a coordinator while preserving cancellation and inherited authority ceilings', async () => {
  const started = deferred(), borrowed = deferred(), fallback = vi.fn();
  const agent = surfaceAgent('x', { generate: fallback, extension: { execute: async () => { started.resolve(); return borrowed.promise; } } });
  const active = agent.run('Inspect the bounded experiment');
  await started.promise; agent.stop(); await active;
  const closing = agent.close();
  borrowed.resolve({ result: { content: 'DONE' } });
  await closing;
  expect(fallback).not.toHaveBeenCalled();
  expect(requireSurfaceIntent('x').extends).toBe('zero');
  expect(await authorizeSurfaceOperation(requireSurfaceIntent('x'), { action: 'candidate.selfApprove' }, () => true)).toBe(false);
});
