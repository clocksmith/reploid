/**
 * @fileoverview Worker Agent
 * Web Worker agent loop that delegates LLM and tool execution to main thread via RPC.
 */

const RPC_TIMEOUT_MS = 60000;
let _workerId = null;
let _allowedTools = [];
let _maxIterations = 10;
const _pending = new Map();

const _post = (message) => self.postMessage(message);

const _rpc = (op, payload) => {
  const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  _post({
    type: 'rpc',
    workerId: _workerId,
    requestId,
    op,
    payload
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      _pending.delete(requestId);
      reject(new Error(`RPC timeout: ${op}`));
    }, RPC_TIMEOUT_MS);

    _pending.set(requestId, { resolve, reject, timeout });
  });
};

const _log = (message) => _post({ type: 'log', workerId: _workerId, message });

const _progress = (iteration, message) => _post({
  type: 'progress',
  workerId: _workerId,
  iteration,
  maxIterations: _maxIterations,
  message
});

const _executeLoop = async (task) => {
  const startTime = Date.now();
  let iterations = 0;
  const toolResults = [];

  const messages = [
    {
      role: 'system',
      content: `You are a worker agent executing a specific task.
Task: ${task}
Use tools when needed and report results clearly.`
    },
    { role: 'user', content: `Please complete this task: ${task}` }
  ];

  while (iterations < _maxIterations) {
    iterations++;
    _progress(iterations, `Iteration ${iterations}/${_maxIterations}`);

    const response = await _rpc('llm:chat', { messages });
    const content = response?.content || '';

    messages.push({ role: 'assistant', content });

    const nativeToolCalls = Array.isArray(response?.toolCalls) ? response.toolCalls : [];
    let toolCalls = nativeToolCalls;

    if (toolCalls.length === 0 && content) {
      toolCalls = await _rpc('parse:tool_calls', { text: content });
    }

    if (!toolCalls || toolCalls.length === 0) {
      break;
    }

    for (const call of toolCalls) {
      const name = call.name || call.tool || call.function || '';
      const args = call.args || {};
      if (!name) continue;

      const toolResponse = await _rpc('tool:execute', {
        call: { name, args },
        iteration: iterations
      });

      const result = toolResponse?.result || '';
      const error = toolResponse?.error || null;
      toolResults.push({
        tool: name,
        args,
        result,
        success: !error,
        error
      });

      const toolMessage = error
        ? `TOOL_ERROR (${name}): ${error}`
        : `TOOL_RESULT (${name}):\n${result}`;
      messages.push({ role: 'user', content: toolMessage });
    }
  }

  const lastAssistant = messages.filter(m => m.role === 'assistant').pop();
  const output = lastAssistant?.content || 'No output';

  return {
    workerId: _workerId,
    status: 'completed',
    task: task.substring(0, 200),
    iterations,
    duration: Date.now() - startTime,
    output,
    allowedTools: Array.isArray(_allowedTools) ? _allowedTools : 'ALL',
    toolResults
  };
};

self.onmessage = async (event) => {
  const message = event.data || {};

  if (message.type === 'rpc:response') {
    const pending = _pending.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    _pending.delete(message.requestId);

    if (message.ok) {
      pending.resolve(message.payload);
    } else {
      pending.reject(new Error(message.payload?.error || 'RPC error'));
    }
    return;
  }

  if (message.type !== 'start') return;

  _workerId = message.workerId;
  _allowedTools = message.allowedTools || [];
  _maxIterations = message.maxIterations || 10;

  _post({ type: 'started', workerId: _workerId });

  try {
    const result = await _executeLoop(message.task || '');
    _post({ type: 'complete', workerId: _workerId, result });
  } catch (error) {
    _post({ type: 'error', workerId: _workerId, error: error.message, stack: error.stack });
  }
};
