/**
 * @fileoverview Verification Worker v3.0
 * Runs in a Web Worker sandbox to safely test code.
 * Includes Static Analysis, AST-based Pattern Matching, Security Heuristics,
 * Capability Checks, and Complexity Analysis.
 *
 * @version 3.0.0
 * Features:
 * - 25+ categorized dangerous patterns
 * - AST-based structural analysis (no runtime execution)
 * - Path-based capability permissions
 * - Complexity heuristics (lines, functions, nesting depth)
 * - Event emission for violations
 */

// ============================================================================
// CAPABILITY-BASED PERMISSIONS
// ============================================================================

const CAPABILITY_RULES = {
  '/tools/': {
    allowed: ['/tools/', '/apps/', '/.logs/'],
    forbidden: ['/core/', '/infrastructure/', '/capabilities/'],
    canNetwork: false,
    canEval: false,
    canFS: false,
    canProcess: false
  },
  '/apps/': {
    allowed: ['/apps/', '/.logs/'],
    forbidden: ['/core/', '/infrastructure/', '/tools/'],
    canNetwork: false,
    canEval: false,
    canFS: false,
    canProcess: false
  },
  '/core/': {
    allowed: ['*'],
    forbidden: [],
    canNetwork: true,
    canEval: true,
    canFS: true,
    canProcess: false
  },
  '/infrastructure/': {
    allowed: ['*'],
    forbidden: [],
    canNetwork: true,
    canEval: true,
    canFS: true,
    canProcess: false
  },
  '/.logs/': {
    allowed: ['/.logs/'],
    forbidden: ['/core/', '/infrastructure/', '/tools/', '/apps/'],
    canNetwork: false,
    canEval: false,
    canFS: false,
    canProcess: false
  }
};

const getCapabilities = (path) => {
  for (const [prefix, caps] of Object.entries(CAPABILITY_RULES)) {
    if (path.startsWith(prefix)) return { ...caps, prefix };
  }
  return { ...CAPABILITY_RULES['/tools/'], prefix: '/tools/' }; // Default to restricted
};

const canWriteTo = (sourcePath, targetPath) => {
  const caps = getCapabilities(sourcePath);
  if (caps.allowed.includes('*')) return true;
  if (caps.forbidden.some(p => targetPath.startsWith(p))) return false;
  return caps.allowed.some(p => targetPath.startsWith(p));
};

// ============================================================================
// DANGEROUS PATTERNS (25+ categorized)
// ============================================================================

const PATTERN_CATEGORIES = {
  INJECTION: 'injection',
  PROTOTYPE: 'prototype',
  EXECUTION: 'execution',
  FILESYSTEM: 'filesystem',
  NETWORK: 'network',
  STORAGE: 'storage',
  DOM: 'dom',
  PROCESS: 'process',
  LOOP: 'loop'
};

const DANGEROUS_PATTERNS = [
  // === INJECTION PATTERNS ===
  {
    id: 'eval',
    category: PATTERN_CATEGORIES.INJECTION,
    regex: /\beval\s*\(/,
    message: "eval() is forbidden - potential code injection",
    requiresCap: 'canEval',
    severity: 'error'
  },
  {
    id: 'function_constructor',
    category: PATTERN_CATEGORIES.INJECTION,
    regex: /\bnew\s+Function\s*\(/,
    message: "new Function() is forbidden - potential code injection",
    requiresCap: 'canEval',
    severity: 'error'
  },
  {
    id: 'settimeout_string',
    category: PATTERN_CATEGORIES.INJECTION,
    regex: /setTimeout\s*\(\s*['"`]/,
    message: "setTimeout with string is forbidden - use function reference",
    requiresCap: 'canEval',
    severity: 'error'
  },
  {
    id: 'setinterval_string',
    category: PATTERN_CATEGORIES.INJECTION,
    regex: /setInterval\s*\(\s*['"`]/,
    message: "setInterval with string is forbidden - use function reference",
    requiresCap: 'canEval',
    severity: 'error'
  },
  {
    id: 'indirect_eval',
    category: PATTERN_CATEGORIES.INJECTION,
    regex: /\(0,\s*eval\)|window\s*\[\s*['"]eval['"]\s*\]|globalThis\s*\[\s*['"]eval['"]\s*\]/,
    message: "Indirect eval detected - forbidden",
    requiresCap: 'canEval',
    severity: 'error'
  },
  {
    id: 'script_element',
    category: PATTERN_CATEGORIES.INJECTION,
    regex: /document\.createElement\s*\(\s*['"`]script['"`]\s*\)/,
    message: "Dynamic script creation is forbidden",
    requiresCap: 'canEval',
    severity: 'error'
  },

  // === PROTOTYPE POLLUTION PATTERNS ===
  {
    id: 'proto_access',
    category: PATTERN_CATEGORIES.PROTOTYPE,
    regex: /__proto__/,
    message: "Prototype pollution risk via __proto__",
    severity: 'error'
  },
  {
    id: 'object_setprototypeof',
    category: PATTERN_CATEGORIES.PROTOTYPE,
    regex: /Object\.setPrototypeOf/,
    message: "Object.setPrototypeOf is forbidden",
    severity: 'error'
  },
  {
    id: 'reflect_setprototypeof',
    category: PATTERN_CATEGORIES.PROTOTYPE,
    regex: /Reflect\.setPrototypeOf/,
    message: "Reflect.setPrototypeOf is forbidden",
    severity: 'error'
  },
  {
    id: 'constructor_prototype',
    category: PATTERN_CATEGORIES.PROTOTYPE,
    regex: /constructor\s*\[\s*['"]prototype['"]\s*\]|\.constructor\.prototype/,
    message: "constructor.prototype access is forbidden - prototype pollution risk",
    severity: 'error'
  },
  {
    id: 'object_prototype_direct',
    category: PATTERN_CATEGORIES.PROTOTYPE,
    regex: /Object\.prototype\s*\[|Object\.prototype\.\w+\s*=/,
    message: "Direct Object.prototype modification is forbidden",
    severity: 'error'
  },
  {
    id: 'array_prototype_direct',
    category: PATTERN_CATEGORIES.PROTOTYPE,
    regex: /Array\.prototype\s*\[|Array\.prototype\.\w+\s*=/,
    message: "Direct Array.prototype modification is forbidden",
    severity: 'error'
  },

  // === EXECUTION/DYNAMIC CODE PATTERNS ===
  {
    id: 'dynamic_import',
    category: PATTERN_CATEGORIES.EXECUTION,
    regex: /\bimport\s*\(/,
    message: "Dynamic import() is forbidden in tools",
    requiresCap: 'canEval',
    severity: 'error'
  },
  {
    id: 'require',
    category: PATTERN_CATEGORIES.EXECUTION,
    regex: /\brequire\s*\(/,
    message: "require() is not available in browser context",
    severity: 'error'
  },
  {
    id: 'with_statement',
    category: PATTERN_CATEGORIES.EXECUTION,
    regex: /\bwith\s*\(/,
    message: "with statement is forbidden - scope manipulation",
    severity: 'error'
  },

  // === FILESYSTEM PATTERNS ===
  {
    id: 'fs_operations',
    category: PATTERN_CATEGORIES.FILESYSTEM,
    regex: /\bfs\.(readFile|writeFile|unlink|rmdir|mkdir|readdir|stat|access)/,
    message: "Direct fs operations are forbidden - use VFS",
    requiresCap: 'canFS',
    severity: 'error'
  },
  {
    id: 'fs_sync_operations',
    category: PATTERN_CATEGORIES.FILESYSTEM,
    regex: /\bfs\.(readFileSync|writeFileSync|unlinkSync|rmdirSync|mkdirSync)/,
    message: "Synchronous fs operations are forbidden",
    requiresCap: 'canFS',
    severity: 'error'
  },
  {
    id: 'path_traversal',
    category: PATTERN_CATEGORIES.FILESYSTEM,
    regex: /\.\.\//,
    message: "Path traversal pattern detected (../) - potential security risk",
    severity: 'warning'
  },

  // === NETWORK PATTERNS ===
  {
    id: 'fetch',
    category: PATTERN_CATEGORIES.NETWORK,
    regex: /\bfetch\s*\(/,
    message: "fetch() requires network capability",
    requiresCap: 'canNetwork',
    severity: 'error'
  },
  {
    id: 'xhr',
    category: PATTERN_CATEGORIES.NETWORK,
    regex: /\bXMLHttpRequest\b/,
    message: "XMLHttpRequest requires network capability",
    requiresCap: 'canNetwork',
    severity: 'error'
  },
  {
    id: 'websocket',
    category: PATTERN_CATEGORIES.NETWORK,
    regex: /\bnew\s+WebSocket\s*\(/,
    message: "WebSocket requires network capability",
    requiresCap: 'canNetwork',
    severity: 'error'
  },
  {
    id: 'eventsource',
    category: PATTERN_CATEGORIES.NETWORK,
    regex: /\bnew\s+EventSource\s*\(/,
    message: "EventSource requires network capability",
    requiresCap: 'canNetwork',
    severity: 'error'
  },
  {
    id: 'beacon',
    category: PATTERN_CATEGORIES.NETWORK,
    regex: /navigator\.sendBeacon\s*\(/,
    message: "sendBeacon requires network capability",
    requiresCap: 'canNetwork',
    severity: 'error'
  },

  // === STORAGE PATTERNS ===
  {
    id: 'localstorage',
    category: PATTERN_CATEGORIES.STORAGE,
    regex: /\blocalStorage\s*[\.\[]/,
    message: "Direct localStorage access forbidden - use StateManager",
    severity: 'error'
  },
  {
    id: 'sessionstorage',
    category: PATTERN_CATEGORIES.STORAGE,
    regex: /\bsessionStorage\s*[\.\[]/,
    message: "sessionStorage access forbidden",
    severity: 'error'
  },
  {
    id: 'indexeddb',
    category: PATTERN_CATEGORIES.STORAGE,
    regex: /\bindexedDB\s*[\.\[]/,
    message: "Direct IndexedDB access forbidden - use VFS",
    severity: 'error'
  },
  {
    id: 'cookie',
    category: PATTERN_CATEGORIES.STORAGE,
    regex: /document\.cookie/,
    message: "Cookie access forbidden",
    severity: 'error'
  },

  // === DOM PATTERNS ===
  {
    id: 'document_write',
    category: PATTERN_CATEGORIES.DOM,
    regex: /document\.(write|writeln)\s*\(/,
    message: "document.write is forbidden - XSS risk",
    severity: 'error'
  },
  {
    id: 'innerhtml_assign',
    category: PATTERN_CATEGORIES.DOM,
    regex: /\.innerHTML\s*=/,
    message: "innerHTML assignment is risky - consider textContent",
    severity: 'warning'
  },
  {
    id: 'outerhtml_assign',
    category: PATTERN_CATEGORIES.DOM,
    regex: /\.outerHTML\s*=/,
    message: "outerHTML assignment is risky",
    severity: 'warning'
  },
  {
    id: 'insertadjacenthtml',
    category: PATTERN_CATEGORIES.DOM,
    regex: /\.insertAdjacentHTML\s*\(/,
    message: "insertAdjacentHTML is risky - potential XSS",
    severity: 'warning'
  },

  // === PROCESS/SYSTEM PATTERNS ===
  {
    id: 'process_env',
    category: PATTERN_CATEGORIES.PROCESS,
    regex: /process\.env/,
    message: "process.env access is forbidden - environment leakage risk",
    requiresCap: 'canProcess',
    severity: 'error'
  },
  {
    id: 'child_process',
    category: PATTERN_CATEGORIES.PROCESS,
    regex: /child_process|spawn\s*\(|exec\s*\(|execSync|spawnSync/,
    message: "child_process operations are forbidden",
    requiresCap: 'canProcess',
    severity: 'error'
  },
  {
    id: 'process_exit',
    category: PATTERN_CATEGORIES.PROCESS,
    regex: /process\.exit/,
    message: "process.exit is forbidden",
    requiresCap: 'canProcess',
    severity: 'error'
  },

  // === INFINITE LOOP PATTERNS ===
  {
    id: 'while_true',
    category: PATTERN_CATEGORIES.LOOP,
    regex: /while\s*\(\s*true\s*\)/,
    message: "Potential infinite loop (while true)",
    severity: 'error'
  },
  {
    id: 'for_infinite',
    category: PATTERN_CATEGORIES.LOOP,
    regex: /for\s*\(\s*;\s*;\s*\)/,
    message: "Potential infinite loop (for ;;)",
    severity: 'error'
  },
  {
    id: 'while_one',
    category: PATTERN_CATEGORIES.LOOP,
    regex: /while\s*\(\s*1\s*\)/,
    message: "Potential infinite loop (while 1)",
    severity: 'error'
  }
];

// ============================================================================
// URL ALLOWLIST FOR NETWORK REQUESTS
// ============================================================================

const NETWORK_ALLOWLIST = [
  /^https:\/\/api\.anthropic\.com/,
  /^https:\/\/api\.openai\.com/,
  /^https:\/\/generativelanguage\.googleapis\.com/,
  /^https:\/\/localhost:/,
  /^https:\/\/127\.0\.0\.1:/
];

const isUrlAllowed = (url) => {
  return NETWORK_ALLOWLIST.some(pattern => pattern.test(url));
};

// ============================================================================
// COMPLEXITY THRESHOLDS
// ============================================================================

const COMPLEXITY_THRESHOLDS = {
  MAX_LINES: 500,
  MAX_FUNCTIONS: 20,
  MAX_NESTING_DEPTH: 5,
  MAX_CYCLOMATIC: 15,
  MAX_LINE_LENGTH: 200
};

// ============================================================================
// SIMPLE AST-LIKE PARSER (no external dependencies)
// Parses JS structure without executing it
// ============================================================================

const SimpleAST = {
  /**
   * Tokenize code into structural elements
   */
  tokenize(code) {
    const tokens = [];
    const lines = code.split('\n');

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];

      // Function declarations
      const funcMatch = line.match(/(?:async\s+)?function\s+(\w+)\s*\(/);
      if (funcMatch) {
        tokens.push({ type: 'function_decl', name: funcMatch[1], line: lineNum + 1 });
      }

      // Arrow functions (const/let/var name = ...)
      const arrowMatch = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/);
      if (arrowMatch) {
        tokens.push({ type: 'arrow_function', name: arrowMatch[1], line: lineNum + 1 });
      }

      // Method definitions in objects/classes
      const methodMatch = line.match(/^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/);
      if (methodMatch && !funcMatch) {
        tokens.push({ type: 'method', name: methodMatch[1], line: lineNum + 1 });
      }

      // Class declarations
      const classMatch = line.match(/class\s+(\w+)/);
      if (classMatch) {
        tokens.push({ type: 'class', name: classMatch[1], line: lineNum + 1 });
      }

      // Import statements
      const importMatch = line.match(/import\s+.*\s+from\s+['"]([^'"]+)['"]/);
      if (importMatch) {
        tokens.push({ type: 'import', source: importMatch[1], line: lineNum + 1 });
      }

      // Export statements
      if (line.match(/export\s+(default|const|let|var|function|class)/)) {
        tokens.push({ type: 'export', line: lineNum + 1 });
      }
    }

    return tokens;
  },

  /**
   * Calculate nesting depth using brace counting
   */
  calculateNestingDepth(code) {
    let maxDepth = 0;
    let currentDepth = 0;
    let inString = false;
    let stringChar = null;
    let inComment = false;
    let inLineComment = false;

    for (let i = 0; i < code.length; i++) {
      const char = code[i];
      const nextChar = code[i + 1];
      const prevChar = code[i - 1];

      // Handle line comments
      if (!inString && !inComment && char === '/' && nextChar === '/') {
        inLineComment = true;
        continue;
      }
      if (inLineComment && char === '\n') {
        inLineComment = false;
        continue;
      }
      if (inLineComment) continue;

      // Handle block comments
      if (!inString && char === '/' && nextChar === '*') {
        inComment = true;
        continue;
      }
      if (inComment && char === '*' && nextChar === '/') {
        inComment = false;
        i++; // Skip the '/'
        continue;
      }
      if (inComment) continue;

      // Handle strings
      if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
          stringChar = null;
        }
        continue;
      }
      if (inString) continue;

      // Count braces
      if (char === '{') {
        currentDepth++;
        maxDepth = Math.max(maxDepth, currentDepth);
      } else if (char === '}') {
        currentDepth = Math.max(0, currentDepth - 1);
      }
    }

    return maxDepth;
  },

  /**
   * Count functions in the code
   */
  countFunctions(code) {
    const patterns = [
      /function\s+\w+\s*\(/g,                    // function declarations
      /function\s*\(/g,                           // anonymous functions
      /(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,  // arrow functions assigned
      /(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\w+\s*=>/g,        // single param arrow
      /:\s*(?:async\s*)?\([^)]*\)\s*=>/g,        // arrow in object
      /:\s*(?:async\s*)?function\s*\(/g,          // function in object
      /^\s*(?:async\s+)?\w+\s*\([^)]*\)\s*\{/gm  // method shorthand
    ];

    let count = 0;
    const seen = new Set();

    for (const pattern of patterns) {
      const matches = code.match(pattern) || [];
      for (const match of matches) {
        // Deduplicate by creating a signature
        const sig = match.trim().substring(0, 50);
        if (!seen.has(sig)) {
          seen.add(sig);
          count++;
        }
      }
    }

    return count;
  },

  /**
   * Detect potentially dangerous AST patterns structurally
   */
  detectStructuralPatterns(code, path) {
    const issues = [];
    const tokens = this.tokenize(code);

    // Check for dynamic property access patterns that could be prototype pollution
    const dynamicPropPattern = /\[([^\]]+)\]\s*=/g;
    let match;
    while ((match = dynamicPropPattern.exec(code)) !== null) {
      const prop = match[1].trim();
      // Check if the property could be user-controlled
      if (!prop.startsWith("'") && !prop.startsWith('"') && !prop.match(/^\d+$/)) {
        issues.push({
          type: 'structural',
          pattern: 'dynamic_property_write',
          message: `Dynamic property write detected: [${prop}] - verify input sanitization`,
          line: code.substring(0, match.index).split('\n').length,
          severity: 'warning'
        });
      }
    }

    // Check for eval-like patterns in variable names
    const evalVarPattern = /(?:const|let|var)\s+(\w*eval\w*|\w*exec\w*)\s*=/gi;
    while ((match = evalVarPattern.exec(code)) !== null) {
      issues.push({
        type: 'structural',
        pattern: 'suspicious_variable_name',
        message: `Suspicious variable name: ${match[1]} - may indicate code execution`,
        line: code.substring(0, match.index).split('\n').length,
        severity: 'warning'
      });
    }

    // Check for Function constructor via bracket notation
    const funcBracketPattern = /\[\s*['"]Function['"]\s*\]/g;
    while ((match = funcBracketPattern.exec(code)) !== null) {
      issues.push({
        type: 'structural',
        pattern: 'bracket_function_access',
        message: 'Bracket notation Function access detected - potential eval bypass',
        line: code.substring(0, match.index).split('\n').length,
        severity: 'error'
      });
    }

    // Check for network URLs in fetch/XHR that aren't allowlisted
    const urlPattern = /(?:fetch|XMLHttpRequest.*open)\s*\(\s*['"`](https?:\/\/[^'"`]+)['"`]/g;
    while ((match = urlPattern.exec(code)) !== null) {
      const url = match[1];
      if (!isUrlAllowed(url)) {
        issues.push({
          type: 'structural',
          pattern: 'non_allowlisted_url',
          message: `Network request to non-allowlisted URL: ${url}`,
          line: code.substring(0, match.index).split('\n').length,
          severity: 'error'
        });
      }
    }

    return issues;
  }
};

// ============================================================================
// COMPLEXITY ANALYZER
// ============================================================================

const ComplexityAnalyzer = {
  analyze(code, path, thresholds = COMPLEXITY_THRESHOLDS) {
    const warnings = [];
    const metrics = {};

    // Line count
    const lines = code.split('\n');
    metrics.lines = lines.length;
    if (metrics.lines > thresholds.MAX_LINES) {
      warnings.push({
        type: 'complexity',
        metric: 'lines',
        value: metrics.lines,
        threshold: thresholds.MAX_LINES,
        message: `File exceeds ${thresholds.MAX_LINES} lines (${metrics.lines}) - consider splitting`,
        path
      });
    }

    // Function count
    metrics.functions = SimpleAST.countFunctions(code);
    if (metrics.functions > thresholds.MAX_FUNCTIONS) {
      warnings.push({
        type: 'complexity',
        metric: 'functions',
        value: metrics.functions,
        threshold: thresholds.MAX_FUNCTIONS,
        message: `File has ${metrics.functions} functions (max ${thresholds.MAX_FUNCTIONS}) - consider modularizing`,
        path
      });
    }

    // Nesting depth
    metrics.maxNestingDepth = SimpleAST.calculateNestingDepth(code);
    if (metrics.maxNestingDepth > thresholds.MAX_NESTING_DEPTH) {
      warnings.push({
        type: 'complexity',
        metric: 'nesting',
        value: metrics.maxNestingDepth,
        threshold: thresholds.MAX_NESTING_DEPTH,
        message: `Nesting depth of ${metrics.maxNestingDepth} exceeds ${thresholds.MAX_NESTING_DEPTH} - refactor nested code`,
        path
      });
    }

    // Long lines
    const longLines = lines.filter(l => l.length > thresholds.MAX_LINE_LENGTH);
    metrics.longLines = longLines.length;
    if (longLines.length > 5) {
      warnings.push({
        type: 'complexity',
        metric: 'line_length',
        value: longLines.length,
        threshold: 5,
        message: `${longLines.length} lines exceed ${thresholds.MAX_LINE_LENGTH} characters`,
        path
      });
    }

    return { metrics, warnings };
  }
};

// ============================================================================
// EVENT EMISSION HELPERS
// ============================================================================

const createEvent = (type, data) => ({
  type,
  timestamp: Date.now(),
  ...data
});

// ============================================================================
// MAIN VERIFICATION LOGIC
// ============================================================================

self.onmessage = async (e) => {
  const { type, snapshot, options = {} } = e.data;

  if (type === 'VERIFY') {
    try {
      const errors = [];
      const warnings = [];
      const events = [];
      const patternViolations = [];
      const complexityWarnings = [];

      // Process each file
      for (const [path, code] of Object.entries(snapshot)) {
        if (!path.endsWith('.js')) continue;

        const caps = getCapabilities(path);
        const isPrivileged = path.startsWith('/core/') || path.startsWith('/infrastructure/');

        // ----------------------------------------------------------------
        // A. SYNTAX CHECK (without execution)
        // ----------------------------------------------------------------
        try {
          // Use Function constructor just for syntax check - never called
          new Function(code);
        } catch (err) {
          errors.push(`Syntax Error in ${path}: ${err.message}`);
          events.push(createEvent('verification:syntax_error', { path, error: err.message }));
          continue;
        }

        // ----------------------------------------------------------------
        // B. DANGEROUS PATTERN DETECTION (regex-based)
        // ----------------------------------------------------------------
        for (const pattern of DANGEROUS_PATTERNS) {
          if (!pattern.regex.test(code)) continue;

          // Check if this pattern requires a capability that the path has
          if (pattern.requiresCap && caps[pattern.requiresCap]) continue;

          // Skip certain patterns for privileged modules
          if (isPrivileged && !pattern.requiresCap) continue;

          const violation = {
            path,
            patternId: pattern.id,
            category: pattern.category,
            message: pattern.message,
            severity: pattern.severity
          };

          patternViolations.push(violation);
          events.push(createEvent('verification:pattern_detected', violation));

          if (pattern.severity === 'error') {
            errors.push(`Security Violation in ${path}: ${pattern.message}`);
          } else {
            warnings.push(`Warning in ${path}: ${pattern.message}`);
          }
        }

        // ----------------------------------------------------------------
        // C. STRUCTURAL/AST-BASED ANALYSIS
        // ----------------------------------------------------------------
        const structuralIssues = SimpleAST.detectStructuralPatterns(code, path);
        for (const issue of structuralIssues) {
          events.push(createEvent('verification:pattern_detected', {
            path,
            patternId: issue.pattern,
            category: 'structural',
            message: issue.message,
            line: issue.line,
            severity: issue.severity
          }));

          if (issue.severity === 'error') {
            errors.push(`Structural Issue in ${path}:${issue.line}: ${issue.message}`);
          } else {
            warnings.push(`Warning in ${path}:${issue.line}: ${issue.message}`);
          }
        }

        // ----------------------------------------------------------------
        // D. TOOL STRUCTURE VALIDATION
        // ----------------------------------------------------------------
        if (path.startsWith('/tools/')) {
          if (!code.includes('export default') && !code.includes('export const tool')) {
            errors.push(`Tool ${path} must have a default export or named 'tool' export`);
          }
        }

        // ----------------------------------------------------------------
        // E. CAPABILITY BOUNDARY CHECK
        // ----------------------------------------------------------------
        const writePatterns = [
          /VFS\.write\s*\(\s*['"`]([^'"`]+)['"`]/g,
          /VFS\.delete\s*\(\s*['"`]([^'"`]+)['"`]/g,
          /WriteFile.*path['":\s]+['"`]([^'"`]+)['"`]/g,
          /DeleteFile.*path['":\s]+['"`]([^'"`]+)['"`]/g
        ];

        for (const wp of writePatterns) {
          wp.lastIndex = 0; // Reset regex state
          let match;
          while ((match = wp.exec(code)) !== null) {
            const targetPath = match[1];
            if (!canWriteTo(path, targetPath)) {
              const violation = {
                path,
                targetPath,
                message: `Cannot write to ${targetPath} from ${path}`
              };
              errors.push(`Capability Violation in ${path}: Cannot write to ${targetPath}`);
              events.push(createEvent('verification:capability_violation', violation));
            }
          }
        }

        // ----------------------------------------------------------------
        // F. COMPLEXITY HEURISTICS
        // ----------------------------------------------------------------
        if (!isPrivileged) {
          const complexityResult = ComplexityAnalyzer.analyze(code, path);

          for (const warning of complexityResult.warnings) {
            complexityWarnings.push(warning);
            warnings.push(warning.message);
            events.push(createEvent('verification:complexity_warning', warning));
          }
        }
      }

      // ----------------------------------------------------------------
      // EMIT RESULTS
      // ----------------------------------------------------------------
      const result = {
        passed: errors.length === 0,
        errors,
        warnings,
        events,
        details: {
          patternViolations,
          complexityWarnings,
          filesAnalyzed: Object.keys(snapshot).filter(p => p.endsWith('.js')).length
        }
      };

      if (!result.passed) {
        result.reason = 'Verification Failed';
      }

      self.postMessage(result);

    } catch (err) {
      self.postMessage({
        passed: false,
        reason: `Worker Crash: ${err.message}`,
        errors: [`Worker crashed: ${err.message}`],
        warnings: [],
        events: [createEvent('verification:worker_crash', { error: err.message })]
      });
    }
  }
};
