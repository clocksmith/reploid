import { snapshotJson } from '../config/index.js';

/** Configuration and host authorization are independent gates on every tool invocation.
 * @param {import('./engine-contracts.js').ToolRequest & {signal: AbortSignal}} request
 */
export async function dispatchTool({ call, policy, listToolNames = () => [], authorize, execute, signal, instanceId }) {
  signal.throwIfAborted();
  if (!policy.tools.allowed.includes(call.name)
    && !(policy.tools.allowDynamic && listToolNames().includes(call.name))) {
    throw new Error(`Tool is not permitted by configuration: ${call.name}`);
  }
  const args = snapshotJson(call.args || {});
  if (typeof authorize !== 'function' || await authorize({ action: 'tool.execute', name: call.name, args,
    ...(instanceId ? { instanceId } : {}) }) !== true) throw new Error(`Host denied tool: ${call.name}`);
  signal.throwIfAborted();
  const result = await execute(call.name, args, { signal });
  signal.throwIfAborted();
  return result;
}
