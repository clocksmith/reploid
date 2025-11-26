/**
 * @fileoverview Tool Writer
 * Manages creation and validation of dynamic tools.
 */

const ToolWriter = {
  metadata: {
    id: 'ToolWriter',
    version: '2.0.0',
    dependencies: ['Utils', 'VFS'],
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, VFS } = deps;
    const { logger, Errors } = Utils;

    const validateCode = (code) => {
      // Check if code is provided
      if (!code || typeof code !== 'string') {
        throw new Errors.ValidationError('Missing or invalid code parameter. create_tool requires { name, code } where code is the tool implementation.');
      }
      // Structural checks (string-based, ES module compatible)
      if (!code.includes('export default') && !code.includes('export const tool')) {
        throw new Errors.ValidationError('Tool must export default or export const tool');
      }
      // Check for async pattern (multiple valid formats)
      const hasAsync = code.includes('async function') ||
                       code.includes('async (') ||
                       code.includes('call: async');
      if (!hasAsync) {
        throw new Errors.ValidationError('Tool call function must be async');
      }
      // Note: Removed new Function(code) check - incompatible with ES module syntax
      // Actual syntax validation happens when ToolRunner does import(blobUrl)
    };

    const create = async (name, code) => {
      if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
        throw new Errors.ValidationError('Invalid tool name format');
      }

      validateCode(code);

      const path = `/tools/${name}.js`;

      // Persist
      await VFS.write(path, code);

      logger.info(`[ToolWriter] Created tool: ${name}`);
      return `Tool ${name} created at ${path}`;
    };

    return { create };
  }
};

export default ToolWriter;
