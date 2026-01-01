/**
 * @fileoverview Tool Writer
 * Manages creation and validation of dynamic tools.
 */

const ToolWriter = {
  metadata: {
    id: 'ToolWriter',
    version: '1.0.0',
    genesis: { introduced: 'tabula' },
    dependencies: ['Utils', 'VFS', 'SubstrateLoader?'],
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, VFS, SubstrateLoader } = deps;
    const { logger, Errors } = Utils;

    const validateCode = (code) => {
      // Check if code is provided
      if (!code || typeof code !== 'string') {
        throw new Errors.ValidationError('Missing or invalid code parameter. CreateTool requires { name, code } where code is the tool implementation.');
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
      if (typeof name !== 'string') {
        throw new Errors.ValidationError('Tool name must be a string');
      }

      const trimmedName = name.trim();
      if (!/^[A-Z][A-Za-z0-9]*$/.test(trimmedName)) {
        throw new Errors.ValidationError('Invalid tool name. Use CamelCase and start with an uppercase letter (e.g., ReadFile, AnalyzeLogs).');
      }

      validateCode(code);

      const path = `/tools/${trimmedName}.js`;

      // Persist
      await VFS.write(path, code);

      // Auto-load the tool if SubstrateLoader is available
      let loadStatus = '';
      if (SubstrateLoader) {
        try {
          await SubstrateLoader.loadModule(path);
          loadStatus = ' and loaded';
        } catch (err) {
          loadStatus = ` (load failed: ${err.message})`;
        }
      }

      logger.info(`[ToolWriter] Created tool: ${trimmedName}${loadStatus}`);
      return `Tool ${trimmedName} created at ${path}${loadStatus}`;
    };

    return { create };
  }
};

export default ToolWriter;
