/**
 * @fileoverview ListTools - List all available tools
 */

async function call(args = {}, deps = {}) {
  const { ToolRunner } = deps;
  if (!ToolRunner) throw new Error('ToolRunner not available');

  return ToolRunner.list();
}

export const tool = {
  name: "ListTools",
  description: "List all available tools (both built-in and dynamic)",
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {}
  },
  call
};

export default call;
