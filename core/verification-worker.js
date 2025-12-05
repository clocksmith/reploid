/**
 * @fileoverview Verification Worker v2.0
 * Runs in a Web Worker sandbox to safely test code.
 * Includes Static Analysis, Security Heuristics, and Capability Checks.
 */

// Capability-based permissions: which paths can access what
const CAPABILITY_RULES = {
  '/tools/': {
    allowed: ['/tools/', '/apps/', '/.logs/'],
    forbidden: ['/core/', '/infrastructure/', '/capabilities/'],
    canNetwork: false,
    canEval: false
  },
  '/apps/': {
    allowed: ['/apps/', '/.logs/'],
    forbidden: ['/core/', '/infrastructure/', '/tools/'],
    canNetwork: false,
    canEval: false
  },
  '/core/': {
    allowed: ['*'],
    forbidden: [],
    canNetwork: true,
    canEval: true
  },
  '/infrastructure/': {
    allowed: ['*'],
    forbidden: [],
    canNetwork: true,
    canEval: true
  }
};

// Get capability rules for a path
const getCapabilities = (path) => {
  for (const [prefix, caps] of Object.entries(CAPABILITY_RULES)) {
    if (path.startsWith(prefix)) return caps;
  }
  return CAPABILITY_RULES['/tools/']; // Default to restricted
};

// Check if a path can write to another path
const canWriteTo = (sourcePath, targetPath) => {
  const caps = getCapabilities(sourcePath);
  if (caps.allowed.includes('*')) return true;
  if (caps.forbidden.some(p => targetPath.startsWith(p))) return false;
  return caps.allowed.some(p => targetPath.startsWith(p));
};

self.onmessage = async (e) => {
  const { type, snapshot, options = {} } = e.data;

  if (type === 'VERIFY') {
    try {
      const errors = [];
      const warnings = [];

      // 1. Static Analysis & Security Heuristics
      for (const [path, code] of Object.entries(snapshot)) {
        if (!path.endsWith('.js')) continue;

        const caps = getCapabilities(path);

        // A. Syntax Check
        try {
          new Function(code);
        } catch (err) {
          errors.push(`Syntax Error in ${path}: ${err.message}`);
          continue;
        }

        // B. Dangerous Pattern Detection (expanded)
        const dangerousPatterns = [
          // Code execution
          { regex: /\beval\s*\(/, message: "eval() is forbidden", requiresCap: 'canEval' },
          { regex: /\bnew\s+Function\s*\(/, message: "new Function() is forbidden", requiresCap: 'canEval' },
          { regex: /setTimeout\s*\(\s*['"`]/, message: "setTimeout with string is forbidden", requiresCap: 'canEval' },
          { regex: /setInterval\s*\(\s*['"`]/, message: "setInterval with string is forbidden", requiresCap: 'canEval' },

          // Storage/state
          { regex: /localStorage\s*\./, message: "Direct localStorage access forbidden (use StateManager)" },
          { regex: /sessionStorage\s*\./, message: "sessionStorage access forbidden" },
          { regex: /indexedDB\s*\./, message: "Direct IndexedDB access forbidden (use VFS)" },
          { regex: /document\.cookie/, message: "Cookie access forbidden" },

          // Network
          { regex: /\bfetch\s*\(/, message: "fetch() requires network capability", requiresCap: 'canNetwork' },
          { regex: /XMLHttpRequest/, message: "XHR requires network capability", requiresCap: 'canNetwork' },
          { regex: /WebSocket\s*\(/, message: "WebSocket requires network capability", requiresCap: 'canNetwork' },

          // DOM manipulation (tools shouldn't touch DOM)
          { regex: /document\.(write|writeln)\s*\(/, message: "document.write is forbidden" },
          { regex: /\.innerHTML\s*=/, message: "innerHTML assignment is risky", warn: true },
          { regex: /\.outerHTML\s*=/, message: "outerHTML assignment is risky", warn: true },

          // Dangerous patterns
          { regex: /while\s*\(\s*true\s*\)/, message: "Potential infinite loop (while true)" },
          { regex: /for\s*\(\s*;\s*;\s*\)/, message: "Potential infinite loop (for ;;)" },
          { regex: /\.call\s*\(\s*this\s*,/, message: "Suspicious .call(this) pattern", warn: true },
          { regex: /__proto__/, message: "Prototype pollution risk (__proto__)" },
          { regex: /Object\.setPrototypeOf/, message: "Prototype manipulation forbidden" },
          { regex: /Reflect\.setPrototypeOf/, message: "Prototype manipulation forbidden" },

          // Import/require restrictions for tools
          { regex: /import\s*\(/, message: "Dynamic import() forbidden in tools", requiresCap: 'canEval' },
          { regex: /require\s*\(/, message: "require() is not available" }
        ];

        // Whitelist privileged paths
        const isPrivileged = path.startsWith('/core/') || path.startsWith('/infrastructure/');

        for (const pattern of dangerousPatterns) {
          if (!pattern.regex.test(code)) continue;

          // Check if this pattern requires a capability
          if (pattern.requiresCap && caps[pattern.requiresCap]) continue;

          // Skip for privileged modules
          if (isPrivileged && !pattern.requiresCap) continue;

          if (pattern.warn) {
            warnings.push(`Warning in ${path}: ${pattern.message}`);
          } else {
            errors.push(`Security Violation in ${path}: ${pattern.message}`);
          }
        }

        // C. Structural Analysis
        if (path.startsWith('/tools/')) {
          if (!code.includes('export default') && !code.includes('export const tool')) {
            errors.push(`Tool ${path} must have a default export or named 'tool' export`);
          }
        }

        // D. Capability Boundary Check - detect writes to forbidden paths
        const writePatterns = [
          /VFS\.write\s*\(\s*['"`]([^'"`]+)['"`]/g,
          /WriteFile.*path['":\s]+['"`]([^'"`]+)['"`]/g
        ];

        for (const wp of writePatterns) {
          let match;
          while ((match = wp.exec(code)) !== null) {
            const targetPath = match[1];
            if (!canWriteTo(path, targetPath)) {
              errors.push(`Capability Violation in ${path}: Cannot write to ${targetPath}`);
            }
          }
        }

        // E. Complexity Heuristics
        const lines = code.split('\n').length;
        const functionCount = (code.match(/function\s+\w+|=>\s*{|\w+\s*\([^)]*\)\s*{/g) || []).length;

        if (lines > 1000 && !isPrivileged) {
          warnings.push(`${path} is very large (${lines} lines) - consider splitting`);
        }
        if (functionCount > 50 && !isPrivileged) {
          warnings.push(`${path} has many functions (${functionCount}) - consider modularizing`);
        }
      }

      if (errors.length > 0) {
        self.postMessage({ passed: false, reason: 'Verification Failed', errors, warnings });
        return;
      }

      self.postMessage({ passed: true, warnings });
    } catch (err) {
      self.postMessage({ passed: false, reason: `Worker Crash: ${err.message}` });
    }
  }
};
