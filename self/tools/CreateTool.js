/**
 * @fileoverview CreateTool - Stage a new tool candidate for gated promotion.
 */

async function call(args = {}, deps = {}) {
  const { ToolWriter, EventBus, AuditLogger } = deps;
  if (!ToolWriter) throw new Error('ToolWriter not available');

  const { name, code } = args;
  if (!name) throw new Error('Missing name argument');
  if (!code) throw new Error('Missing code argument');

  const cleanName = typeof name === 'string' ? name.trim() : name;
  const normalizedCode = typeof code === 'string'
    ? code.replace(/\bToolRunner\.run\b/g, 'ToolRunner.execute')
    : code;

  const result = await ToolWriter.create(cleanName, normalizedCode, {
    root: args.root || '/shadow/tools',
    load: false
  });

  EventBus?.emit?.('tool:candidate_created', result);
  if (AuditLogger?.logEvent) {
    await AuditLogger.logEvent('TOOL_CANDIDATE_CREATED', {
      name: result.name,
      path: result.path,
      staged: true
    }, 'INFO');
  }

  return result;
}

export const tool = {
  name: "CreateTool",
  description: "Stage a new tool candidate under /shadow/tools for later evidence-gated Promote and LoadModule.",
  inputSchema: {
    type: 'object',
    required: ['name', 'code'],
    properties: {
      name: { type: 'string', description: 'Tool name (CamelCase, start with uppercase letter)' },
      code: { type: 'string', description: 'JavaScript code with export default async function(args, deps)' },
      root: { type: 'string', description: 'Optional staging root. Must be /shadow/tools or a child path.' }
    }
  },
  call
};

export default call;
