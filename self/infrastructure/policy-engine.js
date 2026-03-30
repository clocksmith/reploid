/**
 * @fileoverview Policy Engine
 * Declarative policy enforcement system for tool execution.
 * Supports allow/deny rules with conditions, configurable enforcement modes,
 * and integration with ToolRunner pre-execution hooks.
 *
 * Policy DSL supports rules like:
 *   deny { tool.name == "fetch" && !tool.args.url.startsWith("https://api.internal/") }
 *   allow { tool.name == "ReadFile" && tool.args.path.startsWith("/safe/") }
 *
 * @module PolicyEngine
 */

const PolicyEngine = {
  metadata: {
    id: 'PolicyEngine',
    version: '1.0.0',
    genesis: { introduced: 'substrate' },
    dependencies: ['Utils', 'VFS', 'EventBus'],
    optional: ['AuditLogger', 'RuleEngine'],
    async: true,
    type: 'infrastructure'
  },

  factory: (deps) => {
    const { Utils, VFS, EventBus } = deps;
    const AuditLogger = deps.AuditLogger || null;
    const RuleEngine = deps.RuleEngine || null;
    const { logger, generateId } = Utils;

    const POLICIES_DIR = '/policies';
    const STORE_PATH = '/.config/policies.json';

    // Policy storage
    let _policies = [];
    let _enforcementMode = 'block'; // 'block' | 'warn' | 'audit'
    let _initialized = false;

    // --- DSL Parser ---

    /**
     * Token types for DSL lexer
     * @enum {string}
     */
    const TokenType = {
      ALLOW: 'ALLOW',
      DENY: 'DENY',
      LBRACE: 'LBRACE',
      RBRACE: 'RBRACE',
      LPAREN: 'LPAREN',
      RPAREN: 'RPAREN',
      AND: 'AND',
      OR: 'OR',
      NOT: 'NOT',
      EQ: 'EQ',
      NEQ: 'NEQ',
      GT: 'GT',
      GTE: 'GTE',
      LT: 'LT',
      LTE: 'LTE',
      DOT: 'DOT',
      COMMA: 'COMMA',
      STRING: 'STRING',
      NUMBER: 'NUMBER',
      BOOLEAN: 'BOOLEAN',
      IDENTIFIER: 'IDENTIFIER',
      CONTAINS: 'CONTAINS',
      STARTS_WITH: 'STARTS_WITH',
      ENDS_WITH: 'ENDS_WITH',
      MATCHES: 'MATCHES',
      IN: 'IN',
      EOF: 'EOF'
    };

    /**
     * Tokenize a policy DSL string.
     * @param {string} input - Policy DSL string
     * @returns {Array<{type: string, value: any, pos: number}>} Array of tokens
     */
    const tokenize = (input) => {
      const tokens = [];
      let pos = 0;

      const peek = () => input[pos] || '';
      const advance = () => input[pos++];
      const skipWhitespace = () => {
        while (/\s/.test(peek())) pos++;
      };

      while (pos < input.length) {
        skipWhitespace();
        if (pos >= input.length) break;

        const startPos = pos;
        const char = peek();

        // Single character tokens
        if (char === '{') { advance(); tokens.push({ type: TokenType.LBRACE, value: '{', pos: startPos }); continue; }
        if (char === '}') { advance(); tokens.push({ type: TokenType.RBRACE, value: '}', pos: startPos }); continue; }
        if (char === '(') { advance(); tokens.push({ type: TokenType.LPAREN, value: '(', pos: startPos }); continue; }
        if (char === ')') { advance(); tokens.push({ type: TokenType.RPAREN, value: ')', pos: startPos }); continue; }
        if (char === '.') { advance(); tokens.push({ type: TokenType.DOT, value: '.', pos: startPos }); continue; }
        if (char === ',') { advance(); tokens.push({ type: TokenType.COMMA, value: ',', pos: startPos }); continue; }

        // Multi-character operators
        if (char === '&' && input[pos + 1] === '&') {
          pos += 2;
          tokens.push({ type: TokenType.AND, value: '&&', pos: startPos });
          continue;
        }
        if (char === '|' && input[pos + 1] === '|') {
          pos += 2;
          tokens.push({ type: TokenType.OR, value: '||', pos: startPos });
          continue;
        }
        if (char === '!' && input[pos + 1] === '=') {
          pos += 2;
          tokens.push({ type: TokenType.NEQ, value: '!=', pos: startPos });
          continue;
        }
        if (char === '!' && input[pos + 1] !== '=') {
          advance();
          tokens.push({ type: TokenType.NOT, value: '!', pos: startPos });
          continue;
        }
        if (char === '=' && input[pos + 1] === '=') {
          pos += 2;
          tokens.push({ type: TokenType.EQ, value: '==', pos: startPos });
          continue;
        }
        if (char === '>' && input[pos + 1] === '=') {
          pos += 2;
          tokens.push({ type: TokenType.GTE, value: '>=', pos: startPos });
          continue;
        }
        if (char === '>' && input[pos + 1] !== '=') {
          advance();
          tokens.push({ type: TokenType.GT, value: '>', pos: startPos });
          continue;
        }
        if (char === '<' && input[pos + 1] === '=') {
          pos += 2;
          tokens.push({ type: TokenType.LTE, value: '<=', pos: startPos });
          continue;
        }
        if (char === '<' && input[pos + 1] !== '=') {
          advance();
          tokens.push({ type: TokenType.LT, value: '<', pos: startPos });
          continue;
        }

        // String literals
        if (char === '"' || char === "'") {
          const quote = advance();
          let value = '';
          while (peek() && peek() !== quote) {
            if (peek() === '\\') {
              advance();
              const escaped = advance();
              if (escaped === 'n') value += '\n';
              else if (escaped === 't') value += '\t';
              else value += escaped;
            } else {
              value += advance();
            }
          }
          if (peek() === quote) advance();
          tokens.push({ type: TokenType.STRING, value, pos: startPos });
          continue;
        }

        // Numbers
        if (/\d/.test(char)) {
          let value = '';
          while (/[\d.]/.test(peek())) {
            value += advance();
          }
          tokens.push({ type: TokenType.NUMBER, value: parseFloat(value), pos: startPos });
          continue;
        }

        // Identifiers and keywords
        if (/[a-zA-Z_]/.test(char)) {
          let value = '';
          while (/[a-zA-Z0-9_]/.test(peek())) {
            value += advance();
          }

          // Check for keywords
          const lower = value.toLowerCase();
          if (lower === 'allow') {
            tokens.push({ type: TokenType.ALLOW, value, pos: startPos });
          } else if (lower === 'deny') {
            tokens.push({ type: TokenType.DENY, value, pos: startPos });
          } else if (lower === 'true' || lower === 'false') {
            tokens.push({ type: TokenType.BOOLEAN, value: lower === 'true', pos: startPos });
          } else if (lower === 'contains') {
            tokens.push({ type: TokenType.CONTAINS, value, pos: startPos });
          } else if (lower === 'startswith') {
            tokens.push({ type: TokenType.STARTS_WITH, value, pos: startPos });
          } else if (lower === 'endswith') {
            tokens.push({ type: TokenType.ENDS_WITH, value, pos: startPos });
          } else if (lower === 'matches') {
            tokens.push({ type: TokenType.MATCHES, value, pos: startPos });
          } else if (lower === 'in') {
            tokens.push({ type: TokenType.IN, value, pos: startPos });
          } else if (lower === 'and') {
            tokens.push({ type: TokenType.AND, value: '&&', pos: startPos });
          } else if (lower === 'or') {
            tokens.push({ type: TokenType.OR, value: '||', pos: startPos });
          } else if (lower === 'not') {
            tokens.push({ type: TokenType.NOT, value: '!', pos: startPos });
          } else {
            tokens.push({ type: TokenType.IDENTIFIER, value, pos: startPos });
          }
          continue;
        }

        // Unknown character - skip
        advance();
      }

      tokens.push({ type: TokenType.EOF, value: null, pos: pos });
      return tokens;
    };

    /**
     * Parse a policy DSL string into a policy object.
     * @param {string} input - Policy DSL string
     * @param {string} [id] - Optional policy ID
     * @returns {Object} Parsed policy object
     */
    const parsePolicyDSL = (input, id = null) => {
      const tokens = tokenize(input);
      let current = 0;

      const peek = () => tokens[current] || { type: TokenType.EOF };
      const advance = () => tokens[current++];
      const expect = (type) => {
        const token = advance();
        if (token.type !== type) {
          throw new Error(`Expected ${type} but got ${token.type} at position ${token.pos}`);
        }
        return token;
      };

      // Parse expression
      const parseOr = () => {
        let left = parseAnd();
        while (peek().type === TokenType.OR) {
          advance();
          const right = parseAnd();
          left = { type: 'or', left, right };
        }
        return left;
      };

      const parseAnd = () => {
        let left = parseNot();
        while (peek().type === TokenType.AND) {
          advance();
          const right = parseNot();
          left = { type: 'and', left, right };
        }
        return left;
      };

      const parseNot = () => {
        if (peek().type === TokenType.NOT) {
          advance();
          const expr = parseNot();
          return { type: 'not', expr };
        }
        return parseComparison();
      };

      const parseComparison = () => {
        const left = parsePrimary();

        // Check for method calls like .startsWith(), .contains(), .endsWith()
        if (peek().type === TokenType.DOT) {
          advance();
          const method = peek();
          if (method.type === TokenType.STARTS_WITH) {
            advance();
            expect(TokenType.LPAREN);
            const arg = parsePrimary();
            expect(TokenType.RPAREN);
            return { type: 'comparison', op: 'startsWith', left, right: arg };
          }
          if (method.type === TokenType.ENDS_WITH) {
            advance();
            expect(TokenType.LPAREN);
            const arg = parsePrimary();
            expect(TokenType.RPAREN);
            return { type: 'comparison', op: 'endsWith', left, right: arg };
          }
          if (method.type === TokenType.CONTAINS) {
            advance();
            expect(TokenType.LPAREN);
            const arg = parsePrimary();
            expect(TokenType.RPAREN);
            return { type: 'comparison', op: 'contains', left, right: arg };
          }
          if (method.type === TokenType.MATCHES) {
            advance();
            expect(TokenType.LPAREN);
            const arg = parsePrimary();
            expect(TokenType.RPAREN);
            return { type: 'comparison', op: 'matches', left, right: arg };
          }
          // Regular property access - backtrack
          current--;
        }

        // Check for comparison operators
        const opToken = peek();
        if ([TokenType.EQ, TokenType.NEQ, TokenType.GT, TokenType.GTE, TokenType.LT, TokenType.LTE, TokenType.IN].includes(opToken.type)) {
          advance();
          const right = parsePrimary();
          const opMap = {
            [TokenType.EQ]: 'eq',
            [TokenType.NEQ]: 'neq',
            [TokenType.GT]: 'gt',
            [TokenType.GTE]: 'gte',
            [TokenType.LT]: 'lt',
            [TokenType.LTE]: 'lte',
            [TokenType.IN]: 'in'
          };
          return { type: 'comparison', op: opMap[opToken.type], left, right };
        }

        return left;
      };

      const parsePrimary = () => {
        const token = peek();

        // Parenthesized expression
        if (token.type === TokenType.LPAREN) {
          advance();
          const expr = parseOr();
          expect(TokenType.RPAREN);
          return expr;
        }

        // String literal
        if (token.type === TokenType.STRING) {
          advance();
          return { type: 'literal', value: token.value };
        }

        // Number literal
        if (token.type === TokenType.NUMBER) {
          advance();
          return { type: 'literal', value: token.value };
        }

        // Boolean literal
        if (token.type === TokenType.BOOLEAN) {
          advance();
          return { type: 'literal', value: token.value };
        }

        // Identifier (property path)
        if (token.type === TokenType.IDENTIFIER) {
          let path = [advance().value];
          while (peek().type === TokenType.DOT) {
            advance();
            if (peek().type === TokenType.IDENTIFIER) {
              path.push(advance().value);
            } else {
              // Method call follows - backtrack the dot
              current--;
              break;
            }
          }
          return { type: 'path', path };
        }

        // Array literal [...]
        if (token.type === TokenType.LBRACE) {
          // Check if this looks like an array (starts with '[')
          // Actually in our DSL, we can use () for arrays or explicit syntax
        }

        throw new Error(`Unexpected token: ${token.type} at position ${token.pos}`);
      };

      // Parse top-level policy
      const ruleType = peek();
      if (ruleType.type !== TokenType.ALLOW && ruleType.type !== TokenType.DENY) {
        throw new Error(`Policy must start with 'allow' or 'deny', got ${ruleType.type}`);
      }
      advance();

      expect(TokenType.LBRACE);
      const condition = parseOr();
      expect(TokenType.RBRACE);

      return {
        id: id || generateId('policy'),
        type: ruleType.type === TokenType.ALLOW ? 'allow' : 'deny',
        condition,
        source: 'dsl',
        dsl: input,
        enabled: true,
        createdAt: Date.now()
      };
    };

    /**
     * Compile a parsed policy condition to a runtime check function.
     * @param {Object} condition - Parsed condition AST
     * @returns {Function} Check function (context) => boolean
     */
    const compileCondition = (condition) => {
      if (!condition) return () => true;

      switch (condition.type) {
        case 'literal':
          return () => condition.value;

        case 'path':
          return (ctx) => {
            let value = ctx;
            for (const key of condition.path) {
              if (value === null || value === undefined) return undefined;
              value = value[key];
            }
            return value;
          };

        case 'comparison': {
          const leftFn = compileCondition(condition.left);
          const rightFn = compileCondition(condition.right);

          switch (condition.op) {
            case 'eq':
              return (ctx) => leftFn(ctx) === rightFn(ctx);
            case 'neq':
              return (ctx) => leftFn(ctx) !== rightFn(ctx);
            case 'gt':
              return (ctx) => leftFn(ctx) > rightFn(ctx);
            case 'gte':
              return (ctx) => leftFn(ctx) >= rightFn(ctx);
            case 'lt':
              return (ctx) => leftFn(ctx) < rightFn(ctx);
            case 'lte':
              return (ctx) => leftFn(ctx) <= rightFn(ctx);
            case 'in':
              return (ctx) => {
                const right = rightFn(ctx);
                return Array.isArray(right) && right.includes(leftFn(ctx));
              };
            case 'startsWith':
              return (ctx) => {
                const left = leftFn(ctx);
                const right = rightFn(ctx);
                return typeof left === 'string' && left.startsWith(right);
              };
            case 'endsWith':
              return (ctx) => {
                const left = leftFn(ctx);
                const right = rightFn(ctx);
                return typeof left === 'string' && left.endsWith(right);
              };
            case 'contains':
              return (ctx) => {
                const left = leftFn(ctx);
                const right = rightFn(ctx);
                if (typeof left === 'string') return left.includes(right);
                if (Array.isArray(left)) return left.includes(right);
                return false;
              };
            case 'matches':
              return (ctx) => {
                const left = leftFn(ctx);
                const right = rightFn(ctx);
                try {
                  const regex = right instanceof RegExp ? right : new RegExp(right);
                  return regex.test(String(left));
                } catch {
                  return false;
                }
              };
            default:
              return () => false;
          }
        }

        case 'and': {
          const leftFn = compileCondition(condition.left);
          const rightFn = compileCondition(condition.right);
          return (ctx) => leftFn(ctx) && rightFn(ctx);
        }

        case 'or': {
          const leftFn = compileCondition(condition.left);
          const rightFn = compileCondition(condition.right);
          return (ctx) => leftFn(ctx) || rightFn(ctx);
        }

        case 'not': {
          const exprFn = compileCondition(condition.expr);
          return (ctx) => !exprFn(ctx);
        }

        default:
          return () => false;
      }
    };

    // --- Policy Management ---

    /**
     * Initialize the policy engine.
     * Loads policies from VFS and sets up enforcement.
     * @returns {Promise<boolean>} Success
     */
    const init = async () => {
      if (_initialized) return true;

      // Load saved configuration
      try {
        if (await VFS.exists(STORE_PATH)) {
          const content = await VFS.read(STORE_PATH);
          const config = JSON.parse(content);
          _enforcementMode = config.enforcementMode || 'block';
        }
      } catch (e) {
        logger.warn('[PolicyEngine] Failed to load config:', e.message);
      }

      // Load policies from VFS
      await loadPoliciesFromVFS();

      _initialized = true;
      EventBus.emit('policy:loaded', {
        count: _policies.length,
        enforcementMode: _enforcementMode
      });

      logger.info(`[PolicyEngine] Initialized with ${_policies.length} policies (mode: ${_enforcementMode})`);
      return true;
    };

    /**
     * Load policies from VFS /policies/ directory.
     * @returns {Promise<number>} Number of policies loaded
     */
    const loadPoliciesFromVFS = async () => {
      let loaded = 0;

      // Ensure directory exists
      if (!await VFS.exists(POLICIES_DIR)) {
        try {
          await VFS.mkdir(POLICIES_DIR);
        } catch (e) {
          logger.warn('[PolicyEngine] Failed to create policies directory:', e.message);
        }
      }

      try {
        const files = await VFS.list(POLICIES_DIR);

        for (const file of files) {
          if (!file.endsWith('.json')) continue;

          try {
            const content = await VFS.read(file);
            const data = JSON.parse(content);

            if (Array.isArray(data.policies)) {
              for (const policy of data.policies) {
                const entry = normalizePolicy(policy);
                entry.source = `vfs:${file}`;
                if (!_policies.find(p => p.id === entry.id)) {
                  _policies.push(entry);
                  loaded++;
                }
              }
            } else if (data.dsl) {
              // Single policy in DSL format
              const parsed = parsePolicyDSL(data.dsl, data.id);
              parsed.name = data.name || parsed.id;
              parsed.description = data.description || '';
              parsed.source = `vfs:${file}`;
              if (!_policies.find(p => p.id === parsed.id)) {
                _policies.push(parsed);
                loaded++;
              }
            }
          } catch (e) {
            logger.warn(`[PolicyEngine] Failed to load policy file ${file}:`, e.message);
          }
        }
      } catch (e) {
        logger.debug('[PolicyEngine] No policies directory or listing failed');
      }

      if (loaded > 0) {
        logger.info(`[PolicyEngine] Loaded ${loaded} policies from VFS`);
      }

      return loaded;
    };

    /**
     * Normalize a policy object to standard format.
     * @param {Object} policy - Policy in various formats
     * @returns {Object} Normalized policy
     */
    const normalizePolicy = (policy) => {
      // If it has DSL string, parse it
      if (policy.dsl && typeof policy.dsl === 'string') {
        const parsed = parsePolicyDSL(policy.dsl, policy.id);
        return {
          ...parsed,
          name: policy.name || parsed.id,
          description: policy.description || '',
          priority: policy.priority ?? 50,
          enabled: policy.enabled !== false
        };
      }

      // If it has condition object, normalize it
      if (policy.condition) {
        return {
          id: policy.id || generateId('policy'),
          type: policy.type || 'deny',
          condition: policy.condition,
          name: policy.name || policy.id || 'Unnamed Policy',
          description: policy.description || '',
          priority: policy.priority ?? 50,
          enabled: policy.enabled !== false,
          source: policy.source || 'manual',
          createdAt: policy.createdAt || Date.now()
        };
      }

      // Legacy format with tool/args patterns
      if (policy.tool || policy.toolPattern) {
        const condition = buildLegacyCondition(policy);
        return {
          id: policy.id || generateId('policy'),
          type: policy.type || 'deny',
          condition,
          name: policy.name || policy.id || 'Unnamed Policy',
          description: policy.description || '',
          priority: policy.priority ?? 50,
          enabled: policy.enabled !== false,
          source: policy.source || 'legacy',
          createdAt: policy.createdAt || Date.now()
        };
      }

      throw new Error('Invalid policy format');
    };

    /**
     * Build condition from legacy policy format.
     * @param {Object} policy - Legacy policy
     * @returns {Object} Condition AST
     */
    const buildLegacyCondition = (policy) => {
      const conditions = [];

      if (policy.tool) {
        conditions.push({
          type: 'comparison',
          op: 'eq',
          left: { type: 'path', path: ['tool', 'name'] },
          right: { type: 'literal', value: policy.tool }
        });
      }

      if (policy.toolPattern) {
        conditions.push({
          type: 'comparison',
          op: 'matches',
          left: { type: 'path', path: ['tool', 'name'] },
          right: { type: 'literal', value: policy.toolPattern }
        });
      }

      if (policy.argsPattern) {
        for (const [key, pattern] of Object.entries(policy.argsPattern)) {
          if (pattern.eq !== undefined) {
            conditions.push({
              type: 'comparison',
              op: 'eq',
              left: { type: 'path', path: ['tool', 'args', key] },
              right: { type: 'literal', value: pattern.eq }
            });
          }
          if (pattern.startsWith !== undefined) {
            conditions.push({
              type: 'comparison',
              op: 'startsWith',
              left: { type: 'path', path: ['tool', 'args', key] },
              right: { type: 'literal', value: pattern.startsWith }
            });
          }
          if (pattern.contains !== undefined) {
            conditions.push({
              type: 'comparison',
              op: 'contains',
              left: { type: 'path', path: ['tool', 'args', key] },
              right: { type: 'literal', value: pattern.contains }
            });
          }
          if (pattern.matches !== undefined) {
            conditions.push({
              type: 'comparison',
              op: 'matches',
              left: { type: 'path', path: ['tool', 'args', key] },
              right: { type: 'literal', value: pattern.matches }
            });
          }
        }
      }

      // Combine with AND
      if (conditions.length === 0) {
        return { type: 'literal', value: true };
      }
      if (conditions.length === 1) {
        return conditions[0];
      }

      let result = conditions[0];
      for (let i = 1; i < conditions.length; i++) {
        result = { type: 'and', left: result, right: conditions[i] };
      }
      return result;
    };

    /**
     * Add a policy from DSL string.
     * @param {string} dsl - Policy DSL string
     * @param {Object} [options] - Additional options
     * @param {string} [options.id] - Custom ID
     * @param {string} [options.name] - Policy name
     * @param {string} [options.description] - Description
     * @param {number} [options.priority] - Priority (higher = checked first)
     * @returns {Promise<string>} Policy ID
     */
    const addPolicyFromDSL = async (dsl, options = {}) => {
      const policy = parsePolicyDSL(dsl, options.id);
      policy.name = options.name || policy.id;
      policy.description = options.description || '';
      policy.priority = options.priority ?? 50;

      const existing = _policies.findIndex(p => p.id === policy.id);
      if (existing >= 0) {
        _policies[existing] = policy;
      } else {
        _policies.push(policy);
      }

      // Sort by priority (descending)
      _policies.sort((a, b) => (b.priority || 0) - (a.priority || 0));

      await saveConfig();

      EventBus.emit('policy:added', { id: policy.id, name: policy.name });
      logger.info(`[PolicyEngine] Added policy: ${policy.id} (${policy.type})`);

      return policy.id;
    };

    /**
     * Add a policy from object definition.
     * @param {Object} policy - Policy definition
     * @returns {Promise<string>} Policy ID
     */
    const addPolicy = async (policy) => {
      const normalized = normalizePolicy(policy);

      const existing = _policies.findIndex(p => p.id === normalized.id);
      if (existing >= 0) {
        _policies[existing] = normalized;
      } else {
        _policies.push(normalized);
      }

      _policies.sort((a, b) => (b.priority || 0) - (a.priority || 0));

      await saveConfig();

      EventBus.emit('policy:added', { id: normalized.id, name: normalized.name });
      logger.info(`[PolicyEngine] Added policy: ${normalized.id}`);

      return normalized.id;
    };

    /**
     * Remove a policy by ID.
     * @param {string} id - Policy ID
     * @returns {Promise<boolean>} Success
     */
    const removePolicy = async (id) => {
      const idx = _policies.findIndex(p => p.id === id);
      if (idx === -1) return false;

      _policies.splice(idx, 1);
      await saveConfig();

      EventBus.emit('policy:removed', { id });
      return true;
    };

    /**
     * Get all enabled policies.
     * @returns {Object[]} Array of policies
     */
    const getPolicies = () => _policies.filter(p => p.enabled);

    /**
     * Get a policy by ID.
     * @param {string} id - Policy ID
     * @returns {Object|null} Policy or null
     */
    const getPolicy = (id) => _policies.find(p => p.id === id) || null;

    /**
     * Enable or disable a policy.
     * @param {string} id - Policy ID
     * @param {boolean} enabled - Enable state
     * @returns {Promise<boolean>} Success
     */
    const setPolicyEnabled = async (id, enabled) => {
      const policy = _policies.find(p => p.id === id);
      if (!policy) return false;
      policy.enabled = enabled;
      await saveConfig();
      return true;
    };

    /**
     * Set the enforcement mode.
     * @param {'block'|'warn'|'audit'} mode - Enforcement mode
     * @returns {Promise<void>}
     */
    const setEnforcementMode = async (mode) => {
      if (!['block', 'warn', 'audit'].includes(mode)) {
        throw new Error(`Invalid enforcement mode: ${mode}`);
      }
      _enforcementMode = mode;
      await saveConfig();

      EventBus.emit('policy:mode_changed', { mode });
      logger.info(`[PolicyEngine] Enforcement mode set to: ${mode}`);
    };

    /**
     * Get current enforcement mode.
     * @returns {'block'|'warn'|'audit'} Current mode
     */
    const getEnforcementMode = () => _enforcementMode;

    /**
     * Save configuration to VFS.
     * @returns {Promise<void>}
     */
    const saveConfig = async () => {
      try {
        if (!await VFS.exists('/.config')) {
          await VFS.mkdir('/.config');
        }

        await VFS.write(STORE_PATH, JSON.stringify({
          enforcementMode: _enforcementMode,
          savedAt: Date.now()
        }, null, 2));
      } catch (e) {
        logger.warn('[PolicyEngine] Failed to save config:', e.message);
      }
    };

    /**
     * Save policies to a VFS file.
     * @param {string} filename - File name (in /policies/)
     * @param {Object[]} policies - Policies to save
     * @returns {Promise<string>} File path
     */
    const savePoliciesToVFS = async (filename, policies = null) => {
      if (!await VFS.exists(POLICIES_DIR)) {
        await VFS.mkdir(POLICIES_DIR);
      }

      const path = `${POLICIES_DIR}/${filename}`;
      const data = {
        policies: policies || _policies.filter(p => p.source !== 'builtin'),
        savedAt: Date.now()
      };

      await VFS.write(path, JSON.stringify(data, null, 2));
      logger.info(`[PolicyEngine] Saved ${data.policies.length} policies to ${path}`);

      return path;
    };

    // --- Policy Checking ---

    /**
     * Check if a tool execution is allowed by policies.
     * This is the main entry point for ToolRunner integration.
     * @param {string} toolName - Tool name
     * @param {Object} args - Tool arguments
     * @param {Object} [context] - Additional context
     * @returns {Promise<Object>} Check result
     */
    const check = async (toolName, args, context = {}) => {
      const checkContext = {
        tool: {
          name: toolName,
          args: args || {}
        },
        ...context,
        timestamp: Date.now()
      };

      const result = {
        allowed: true,
        violations: [],
        warnings: [],
        matchedPolicies: [],
        enforcementMode: _enforcementMode
      };

      const enabledPolicies = getPolicies();

      for (const policy of enabledPolicies) {
        try {
          const checkFn = compileCondition(policy.condition);
          const matches = checkFn(checkContext);

          if (matches) {
            result.matchedPolicies.push({
              id: policy.id,
              name: policy.name,
              type: policy.type
            });

            if (policy.type === 'deny') {
              const violation = {
                policyId: policy.id,
                policyName: policy.name,
                message: policy.description || `Denied by policy: ${policy.name}`,
                tool: toolName,
                args: _sanitizeArgs(args)
              };

              result.violations.push(violation);

              // Emit violation event
              EventBus.emit('policy:violation', {
                ...violation,
                enforcementMode: _enforcementMode,
                timestamp: Date.now()
              });

              // Log to audit
              if (AuditLogger) {
                await AuditLogger.logEvent('POLICY_VIOLATION', violation, 'WARN');
              }
            } else if (policy.type === 'allow') {
              // Explicit allow - short circuit
              result.allowed = true;
              result.explicitAllow = {
                policyId: policy.id,
                policyName: policy.name
              };

              // First allow wins
              break;
            }
          }
        } catch (e) {
          logger.error(`[PolicyEngine] Error evaluating policy ${policy.id}:`, e.message);
        }
      }

      // Determine final result based on violations and enforcement mode
      if (result.violations.length > 0) {
        switch (_enforcementMode) {
          case 'block':
            result.allowed = false;
            break;
          case 'warn':
            result.allowed = true;
            result.warnings = result.violations.map(v => v.message);
            break;
          case 'audit':
            result.allowed = true;
            // Just log, already done above
            break;
        }
      }

      // Emit enforced event if blocked
      if (!result.allowed) {
        EventBus.emit('policy:enforced', {
          tool: toolName,
          args: _sanitizeArgs(args),
          violations: result.violations,
          blocked: true
        });
      }

      return result;
    };

    /**
     * Sanitize arguments for logging (remove sensitive data, truncate).
     * @param {Object} args - Arguments to sanitize
     * @returns {Object} Sanitized arguments
     */
    const _sanitizeArgs = (args) => {
      const sensitiveKeys = ['password', 'secret', 'token', 'key', 'apikey', 'api_key', 'credential', 'auth'];
      const sanitized = {};
      for (const [key, value] of Object.entries(args || {})) {
        const keyLower = key.toLowerCase();
        const isSensitive = sensitiveKeys.some(s => keyLower.includes(s));
        if (isSensitive) {
          sanitized[key] = '[REDACTED]';
        } else if (typeof value === 'string' && value.length > 200) {
          sanitized[key] = value.substring(0, 200) + `... (${value.length} chars)`;
        } else {
          sanitized[key] = value;
        }
      }
      return sanitized;
    };

    // --- Utilities ---

    /**
     * Get engine statistics.
     * @returns {Object} Statistics
     */
    const getStats = () => ({
      policyCount: _policies.length,
      enabledCount: _policies.filter(p => p.enabled).length,
      denyPolicies: _policies.filter(p => p.type === 'deny').length,
      allowPolicies: _policies.filter(p => p.type === 'allow').length,
      enforcementMode: _enforcementMode,
      initialized: _initialized
    });

    /**
     * Clear all policies.
     * @returns {Promise<void>}
     */
    const clear = async () => {
      _policies = [];
      await saveConfig();
      EventBus.emit('policy:cleared', {});
      logger.info('[PolicyEngine] Cleared all policies');
    };

    /**
     * Export policies for backup.
     * @returns {Object} Exportable data
     */
    const exportPolicies = () => ({
      policies: _policies,
      enforcementMode: _enforcementMode,
      exportedAt: Date.now()
    });

    /**
     * Import policies from exported data.
     * @param {Object} data - Exported data
     * @param {boolean} [merge=true] - Merge or replace
     * @returns {Promise<Object>} Import stats
     */
    const importPolicies = async (data, merge = true) => {
      const stats = { imported: 0, skipped: 0 };

      if (!merge) {
        _policies = [];
      }

      if (Array.isArray(data.policies)) {
        for (const policy of data.policies) {
          try {
            const normalized = normalizePolicy(policy);
            if (!_policies.find(p => p.id === normalized.id)) {
              _policies.push(normalized);
              stats.imported++;
            } else {
              stats.skipped++;
            }
          } catch (e) {
            logger.warn('[PolicyEngine] Failed to import policy:', e.message);
            stats.skipped++;
          }
        }
      }

      if (data.enforcementMode) {
        _enforcementMode = data.enforcementMode;
      }

      _policies.sort((a, b) => (b.priority || 0) - (a.priority || 0));
      await saveConfig();

      logger.info(`[PolicyEngine] Imported ${stats.imported} policies, skipped ${stats.skipped}`);
      return stats;
    };

    /**
     * Validate a policy DSL string without adding it.
     * @param {string} dsl - DSL string to validate
     * @returns {{valid: boolean, error?: string, parsed?: Object}} Validation result
     */
    const validateDSL = (dsl) => {
      try {
        const parsed = parsePolicyDSL(dsl);
        // Try to compile to catch any compilation errors
        compileCondition(parsed.condition);
        return { valid: true, parsed };
      } catch (e) {
        return { valid: false, error: e.message };
      }
    };

    return {
      // Lifecycle
      init,

      // Policy management
      addPolicy,
      addPolicyFromDSL,
      removePolicy,
      getPolicies,
      getPolicy,
      setPolicyEnabled,
      savePoliciesToVFS,

      // Enforcement
      check,
      setEnforcementMode,
      getEnforcementMode,

      // DSL
      parsePolicyDSL,
      validateDSL,
      compileCondition,

      // Utilities
      getStats,
      clear,
      exportPolicies,
      importPolicies,

      // Reload from VFS
      reload: loadPoliciesFromVFS
    };
  }
};

export default PolicyEngine;
