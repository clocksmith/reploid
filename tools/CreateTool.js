/**
 * @fileoverview CreateTool - Create a new tool at runtime (Level 1 RSI)
 */

async function call(args = {}, deps = {}) {
  const { ToolWriter } = deps;
  if (!ToolWriter) throw new Error('ToolWriter not available');

  const { name, code } = args;
  if (!name) throw new Error('Missing name argument');
  if (!code) throw new Error('Missing code argument');

  const cleanName = typeof name === 'string' ? name.trim() : name;
  return await ToolWriter.create(cleanName, code);
}

export const tool = {
  name: "CreateTool",
  description: "Create a new tool at runtime (Level 1 RSI). The tool will be written to /tools/ and loaded.",
  inputSchema: {
    type: 'object',
    required: ['name', 'code'],
    properties: {
      name: { type: 'string', description: 'Tool name (CamelCase, start with uppercase letter)' },
      code: { type: 'string', description: 'JavaScript code with export default async function(args, deps)' }
    }
  },
  call
};

export default call;
