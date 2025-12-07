/**
 * @fileoverview Core Utilities Module
 * The foundational pure functions, error classes, and protocol parsers.
 */

const Utils = {
  metadata: {
    id: 'Utils',
    version: '1.0.0', // Merged ParserUtils
    genesis: { introduced: 'tabula' },
    dependencies: [],
    type: 'pure'
  },

  factory: () => {
    // --- Internal State ---
    const _logStats = { debug: 0, info: 0, warn: 0, error: 0 };
    const _recentLogs = [];
    const MAX_LOG_HISTORY = 100;

    // --- Error Handling System ---
    class ApplicationError extends Error {
      constructor(message, details = {}) {
        super(message);
        this.name = this.constructor.name;
        this.details = details;
        this.timestamp = Date.now();
      }
    }

    class ApiError extends ApplicationError {
      constructor(message, status, details) {
        super(message, details);
        this.status = status;
      }
    }

    class StateError extends ApplicationError {}
    class ArtifactError extends ApplicationError {}
    class ValidationError extends ApplicationError {}
    class AbortError extends ApplicationError {}
    class ToolError extends ApplicationError {}
    class ConfigError extends ApplicationError {}

    const Errors = {
      ApplicationError,
      ApiError,
      StateError,
      ArtifactError,
      ValidationError,
      AbortError,
      ToolError,
      ConfigError
    };

    // --- Logging System ---
    const logger = {
      _write: (level, message, details) => {
        _logStats[level]++;

        const entry = {
          ts: new Date().toISOString(),
          level: level.toUpperCase(),
          msg: message,
          data: details
        };

        const method = console[level] || console.log;
        const prefix = `[${entry.level}]`;
        details ? method(prefix, message, details) : method(prefix, message);

        _recentLogs.push(entry);
        if (_recentLogs.length > MAX_LOG_HISTORY) _recentLogs.shift();
      },

      debug: (msg, data) => logger._write('debug', msg, data),
      info: (msg, data) => logger._write('info', msg, data),
      warn: (msg, data) => logger._write('warn', msg, data),
      error: (msg, data) => logger._write('error', msg, data),

      getStats: () => ({ ..._logStats }),
      getHistory: () => [..._recentLogs],
      clearHistory: () => { _recentLogs.length = 0; }
    };

    // --- Pure Helpers ---

    const generateId = (prefix = 'id') => {
      const random = Math.random().toString(36).substring(2, 10);
      const ts = Date.now().toString(36);
      return `${prefix}_${ts}_${random}`;
    };

    const trunc = (str, len) => {
      if (!str) return '';
      return str.length > len ? str.substring(0, len - 3) + '...' : str;
    };

    const kabobToCamel = (s) => s.replace(/-([a-z0-9])/gi, (_, c) => c.toUpperCase());

    const escapeHtml = (unsafe) => {
      if (!unsafe) return '';
      return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    };

    /**
     * Convert backtick template literals to valid JSON strings.
     * Handles: `content with "quotes" and newlines` -> "content with \"quotes\" and newlines"
     */
    const convertBacktickStrings = (text) => {
      let result = '';
      let i = 0;
      while (i < text.length) {
        // Check if we're entering a JSON string (double quote)
        if (text[i] === '"') {
          result += '"';
          i++;
          // Skip through the JSON string
          while (i < text.length) {
            if (text[i] === '\\' && i + 1 < text.length) {
              result += text[i] + text[i + 1];
              i += 2;
            } else if (text[i] === '"') {
              result += '"';
              i++;
              break;
            } else {
              result += text[i];
              i++;
            }
          }
        }
        // Check if we're entering a backtick string (needs conversion)
        else if (text[i] === '`') {
          result += '"'; // Start JSON string
          i++;
          // Process backtick string content
          while (i < text.length && text[i] !== '`') {
            const char = text[i];
            if (char === '\\' && i + 1 < text.length) {
              // Preserve escapes
              result += text[i] + text[i + 1];
              i += 2;
            } else if (char === '"') {
              // Escape double quotes inside backtick strings
              result += '\\"';
              i++;
            } else if (char === '\n') {
              // Convert literal newlines to \n
              result += '\\n';
              i++;
            } else if (char === '\r') {
              // Convert carriage returns
              result += '\\r';
              i++;
            } else if (char === '\t') {
              // Convert tabs
              result += '\\t';
              i++;
            } else {
              result += char;
              i++;
            }
          }
          result += '"'; // End JSON string
          if (i < text.length) i++; // Skip closing backtick
        }
        else {
          result += text[i];
          i++;
        }
      }
      return result;
    };

    const sanitizeLlmJsonRespPure = (text) => {
      if (!text || typeof text !== 'string') return { json: "{}", method: "empty" };

      // First try direct parse
      try {
        JSON.parse(text);
        return { json: text, method: "direct" };
      } catch (e) { /* continue */ }

      // Try converting backtick strings to JSON strings
      if (text.includes('`')) {
        try {
          const converted = convertBacktickStrings(text);
          JSON.parse(converted);
          return { json: converted, method: "backtick" };
        } catch (e) { /* continue */ }
      }

      const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlock) {
        try {
          JSON.parse(codeBlock[1]);
          return { json: codeBlock[1], method: "block" };
        } catch (e) { /* continue */ }
      }

      const firstOpen = text.indexOf('{');
      const lastClose = text.lastIndexOf('}');
      if (firstOpen > -1 && lastClose > firstOpen) {
        const candidate = text.substring(firstOpen, lastClose + 1);
        try {
          JSON.parse(candidate);
          return { json: candidate, method: "heuristic" };
        } catch (e) { /* continue */ }

        // Try backtick conversion on the candidate
        if (candidate.includes('`')) {
          try {
            const converted = convertBacktickStrings(candidate);
            JSON.parse(converted);
            return { json: converted, method: "heuristic+backtick" };
          } catch (e) { /* continue */ }
        }
      }

      return { json: "{}", method: "failed" };
    };

    /**
     * Tracker to prevent EventBus memory leaks
     */
    const createSubscriptionTracker = () => {
      const subs = new Map();
      return {
        track: (id, unsubFn) => {
          if (!subs.has(id)) subs.set(id, []);
          subs.get(id).push(unsubFn);
        },
        unsubscribeAll: (id) => {
          const list = subs.get(id);
          if (list) {
            list.forEach(fn => fn());
            subs.delete(id);
          }
        }
      };
    };

    // --- PAWS Protocol Parsers (Merged from ParserUtils) ---

    const parseCatsBundle = (content) => {
      const files = [];
      if (!content) return { reason: 'Empty content', files: [] };

      const blocks = content.split(/```vfs-file\s*\n/);
      const reasonMatch = content.match(/\*\*Reason:\*\*\s*(.+)/);
      const reason = reasonMatch ? reasonMatch[1].trim() : 'Context bundle';

      for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];
        const pathMatch = block.match(/^path:\s*(.+?)\s*\n```/);
        if (!pathMatch) continue;

        const filePath = pathMatch[1].trim();
        const contentStartRegex = /```\n([\s\S]*?)\n```/;
        const contentMatch = block.substring(pathMatch[0].length).match(contentStartRegex);

        if (contentMatch) {
          files.push({
            path: filePath,
            content: contentMatch[1]
          });
        }
      }
      return { reason, files };
    };

    const generateCatsBundle = (files, reason = 'Context Export') => {
      const date = new Date().toISOString();
      let out = `## PAWS Context Bundle (cats.md)\n**Generated:** ${date}\n**Reason:** ${reason}\n**Files:** ${files.length}\n\n---\n\n`;
      for (const f of files) {
        out += `\`\`\`vfs-file\npath: ${f.path}\n\`\`\`\n`;
        out += `\`\`\`\n${f.content}\n\`\`\`\n\n---\n\n`;
      }
      return out;
    };

    const parseDogsBundle = (content) => {
      const changes = [];
      if (!content) return changes;

      const blocks = content.split(/```paws-change\s*\n/);

      for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];
        const metaEndIdx = block.indexOf('```');
        if (metaEndIdx === -1) continue;

        const metaSection = block.substring(0, metaEndIdx);
        const opMatch = metaSection.match(/operation:\s*(CREATE|MODIFY|DELETE)/i);
        const pathMatch = metaSection.match(/file_path:\s*(.+)/);

        if (!opMatch || !pathMatch) continue;

        const operation = opMatch[1].toUpperCase();
        const filePath = pathMatch[1].trim();
        let newContent = null;

        if (operation !== 'DELETE') {
          const contentSection = block.substring(metaEndIdx + 3);
          const contentMatch = contentSection.match(/```\n([\s\S]*?)\n```/);
          newContent = contentMatch ? contentMatch[1] : '';
        }

        changes.push({ operation, file_path: filePath, new_content: newContent });
      }
      return changes;
    };

    const generateDogsBundle = (changes, summary = 'Code Modification') => {
      let out = `## PAWS Change Proposal (dogs.md)\n**Summary:** ${summary}\n**Changes:** ${changes.length}\n\n---\n\n`;
      for (const c of changes) {
        out += `\`\`\`paws-change\noperation: ${c.operation}\nfile_path: ${c.file_path}\n\`\`\`\n`;
        if (c.operation !== 'DELETE') {
          out += `\`\`\`\n${c.new_content || ''}\n\`\`\`\n\n`;
        }
      }
      return out;
    };

    return {
      Errors,
      logger,
      generateId,
      trunc,
      kabobToCamel,
      escapeHtml,
      sanitizeLlmJsonRespPure,
      createSubscriptionTracker,
      // Protocol Parsers
      parseCatsBundle,
      generateCatsBundle,
      parseDogsBundle,
      generateDogsBundle
    };
  }
};

export default Utils;
