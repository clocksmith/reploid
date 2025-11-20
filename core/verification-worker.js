/**
 * @fileoverview Verification Worker
 * Runs in a Web Worker sandbox to safely test code.
 * Includes Static Analysis and Security Heuristics.
 */

self.onmessage = async (e) => {
  const { type, snapshot } = e.data;

  if (type === 'VERIFY') {
    try {
      const errors = [];
      const warnings = [];

      // 1. Static Analysis & Security Heuristics
      for (const [path, code] of Object.entries(snapshot)) {
        // Only check JS files that are being modified/added
        if (!path.endsWith('.js')) continue;

        // A. Syntax Check
        try {
          new Function(code);
        } catch (err) {
          errors.push(`Syntax Error in ${path}: ${err.message}`);
          continue; // Skip further checks if syntax is invalid
        }

        // B. Dangerous Pattern Detection
        const dangerousPatterns = [
            { regex: /\beval\s*\(/, message: "Use of 'eval' is forbidden" },
            { regex: /\bnew\s+Function\s*\(/, message: "Use of 'new Function' is forbidden (restricted modules only)" },
            { regex: /localStorage\./, message: "Direct localStorage access forbidden in tools (use StateManager)" },
            { regex: /document\.cookie/, message: "Cookie access is forbidden" },
            { regex: /while\s*\(\s*true\s*\)/, message: "Potential infinite loop 'while(true)' detected" }
        ];

        // Whitelist core system modules that legitimately require dynamic evaluation
        const isPrivileged = path.includes('/core/utils.js') || path.includes('/core/tool-writer.js');

        if (!isPrivileged) {
            for (const pattern of dangerousPatterns) {
                if (pattern.regex.test(code)) {
                    errors.push(`Security Violation in ${path}: ${pattern.message}`);
                }
            }
        }

        // C. Structural Analysis (Heuristics)
        // Tools must export a specific shape
        if (path.startsWith('/tools/')) {
             if (!code.includes('export default') && !code.includes('export const tool')) {
                 errors.push(`Tool ${path} must have a default export or named 'tool' export`);
             }
        }
      }

      if (errors.length > 0) {
        self.postMessage({ passed: false, reason: 'Verification Failed', errors });
        return;
      }

      // 3. Success
      self.postMessage({ passed: true, warnings });
    } catch (err) {
      self.postMessage({ passed: false, reason: `Worker Logic Crash: ${err.message}` });
    }
  }
};
