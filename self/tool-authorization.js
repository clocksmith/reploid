/** The application permits bounded file inspection/candidates by default.
 * Loading executable modules and promotion require an explicit host decision;
 * the bridge still enforces writable roots and the promotion verifier.
 */
export function resolveSelfAuthorization(authorize, execution = {}) {
  if (authorize !== undefined && typeof authorize !== 'function') {
    throw new TypeError('Self authorization must be a function');
  }
  return authorize ?? (request => {
    if (request?.action === 'agent.execute') {
      return !!execution.goal && request.goal === execution.goal
        && request.instanceId === execution.instanceId;
    }
    return request?.action === 'tool.execute'
      && (request.name === 'ReadFile' || request.name === 'WriteFile');
  });
}
