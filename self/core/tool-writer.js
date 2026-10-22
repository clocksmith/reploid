/**
 * @fileoverview Tool Writer
 * Manages creation and validation of dynamic tools.
 */

import { sha256 } from './promotion-policy.js';

const ToolWriter = {
  metadata: {
    id: 'ToolWriter',
    version: '1.0.0',
    genesis: { introduced: 'spark' },
    dependencies: ['Utils', 'VFS', 'SubstrateLoader?', 'VerificationManager?'],
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, VFS, SubstrateLoader, VerificationManager } = deps;
    const approvals = new WeakMap();
    const { logger, Errors } = Utils;

    const normalizeCode = (code) => {
      const text = String(code || '');
      return text.replace(/^\s*\|[+-]?\s*\r?\n/, '');
    };

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
      // The required Worker parses syntax before any candidate import.
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

    // Receipts are scoped to this trusted writer instance, not caller-authored
    // booleans. This binds static approval to bytes; it is not a JS sandbox.
    const assertVerified = async (result, code) => {
      const approval = approvals.get(result?.verification);
      if (!approval || approval.path !== result.path || approval.hash !== await sha256(code)) {
        throw new Errors.ValidationError('Verification approval missing or candidate bytes changed');
      }
      return result.verification;
    };

    const create = async (name, code, options = {}) => {
      if (typeof name !== 'string') {
        throw new Errors.ValidationError('Tool name must be a string');
      }

      const trimmedName = name.trim();
      if (!/^[A-Z][A-Za-z0-9]*$/.test(trimmedName)) {
        throw new Errors.ValidationError('Invalid tool name. Use CamelCase and start with an uppercase letter (e.g., ReadFile, AnalyzeLogs).');
      }

      const normalizedCode = normalizeCode(code);
      validateCode(normalizedCode);

      const root = normalizeRoot(options.root);
      const path = `${root}/${trimmedName}.js`;

      if (typeof VerificationManager?.verifyProposal !== 'function') {
        throw new Errors.ValidationError('Verification Worker is required before creating tools');
      }
      // Always analyze as a restricted tool, not as a privileged staging path.
      const verificationPath = `/tools/${trimmedName}.js`;
      const hash = await sha256(normalizedCode);
      const checked = await VerificationManager.verifyProposal(
        { [verificationPath]: normalizedCode },
        { quickMode: true, requireVerification: true, toolCreation: true }
      );
      if (checked?.passed !== true || checked.skipped !== false
          || checked.verification?.kind !== 'static-worker'
          || checked.verification?.fileHashes?.[verificationPath] !== hash) {
        throw new Errors.ValidationError(`Verification Worker refused tool: ${checked?.reason || 'missing, skipped, failed, or mismatched approval'}${checked?.errors?.length ? `: ${checked.errors.join('; ')}` : ''}`);
      }
      const verification = Object.freeze({ kind: 'static-worker', passed: true, skipped: false, hash });
      approvals.set(verification, { path, hash });
      const candidate = { path, verification };
      await VFS.write(path, normalizedCode);
      await assertVerified(candidate, await VFS.read(path));

      let toolLoaded = false;
      let toolLoadError = null;
      if (options.load === true && SubstrateLoader) {
        try {
          await SubstrateLoader.loadModule(path, { expectedSha256: hash });
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
        verification,
        toolLoaded,
        toolLoadError,
        message: `Tool candidate ${trimmedName} staged at ${path}`
      };
    };

    return { create, assertVerified };
  }
};

export default ToolWriter;
