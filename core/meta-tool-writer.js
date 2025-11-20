/**
 * @fileoverview Meta Tool Writer
 * Safe core module modification using VerificationManager.
 */

const MetaToolWriter = {
  metadata: {
    id: 'MetaToolWriter',
    version: '2.0.0',
    dependencies: ['Utils', 'VFS', 'VerificationManager'],
    async: true,
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, VFS, VerificationManager } = deps;
    const { logger, Errors } = Utils;

    const improveCore = async (moduleName, newCode) => {
      const path = `/core/${moduleName}.js`;

      if (!(await VFS.exists(path))) {
        throw new Errors.ArtifactError(`Module not found: ${path}`);
      }

      logger.info(`[Meta] Proposing update to ${moduleName}...`);

      // 1. Verify
      const change = {
        operation: 'MODIFY',
        file_path: path,
        new_content: newCode
      };

      const verifyResult = await VerificationManager.verifyProposal([change]);

      if (!verifyResult.passed) {
        throw new Errors.ValidationError(`Verification Failed: ${verifyResult.reason}`);
      }

      // 2. Backup
      const oldCode = await VFS.read(path);
      await VFS.write(`${path}.bak`, oldCode);

      // 3. Apply
      await VFS.write(path, newCode);
      logger.warn(`[Meta] UPDATED CORE MODULE: ${moduleName}`);

      return `Successfully updated ${moduleName}. Backup saved to .bak`;
    };

    return { improveCore };
  }
};

export default MetaToolWriter;
