/**
 * @fileoverview Tool Writer
 * Manages creation and validation of dynamic tools.
 */

const ToolWriter = {
  metadata: {
    id: 'ToolWriter',
    version: '1.0.0',
    genesis: { introduced: 'spark' },
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

    const normalizeRoot = (root) => {
      const value = String(root || '/shadow/tools').trim();
      const path = value.startsWith('/') ? value : `/${value}`;
      if (path.split('/').includes('..')) {
        throw new Errors.ValidationError('Path traversal is not allowed');
      }
      if (path !== '/shadow/tools' && !path.startsWith('/shadow/tools/')) {
        throw new Errors.ValidationError('Tool candidates must be staged under /shadow/tools');
      }
      return path.replace(/\/+$/, '');
    };

    const create = async (name, code, options = {}) => {
      if (typeof name !== 'string') {
        throw new Errors.ValidationError('Tool name must be a string');
      }

      const trimmedName = name.trim();
      if (!/^[A-Z][A-Za-z0-9]*$/.test(trimmedName)) {
        throw new Errors.ValidationError('Invalid tool name. Use CamelCase and start with an uppercase letter (e.g., ReadFile, AnalyzeLogs).');
      }

      validateCode(code);

      const root = normalizeRoot(options.root);
      const path = `${root}/${trimmedName}.js`;

      await VFS.write(path, code);

      let toolLoaded = false;
      let toolLoadError = null;
      if (options.load === true && SubstrateLoader) {
        try {
          await SubstrateLoader.loadModule(path);
          toolLoaded = true;
        } catch (err) {
          toolLoadError = err.message;
        }
      }

      logger.info(`[ToolWriter] Staged tool candidate: ${trimmedName} at ${path}`);
      return {
        success: true,
        name: trimmedName,
        path,
        staged: true,
        toolLoaded,
        toolLoadError,
        message: `Tool candidate ${trimmedName} staged at ${path}`
      };
    };

    return { create };
  }
};

export default ToolWriter;
