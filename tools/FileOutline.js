/**
 * @fileoverview File Outline Tool
 * Reads file structure (imports, exports, functions) without loading full content.
 * Saves tokens during RSI analysis phases.
 */

const inputSchema = {
  type: 'object',
  required: ['path'],
  properties: {
    path: {
      type: 'string',
      description: 'The VFS path to analyze (e.g. /core/agent-loop.js)'
    }
  }
};

const validateInput = (input) => {
  if (!input || typeof input.path !== 'string') {
    return 'Parameter "path" is required';
  }
  if (!input.path.trim()) {
    return 'Parameter "path" cannot be empty';
  }
  return null;
};

async function call(input = {}, deps = {}) {
  const validationError = validateInput(input);
  if (validationError) {
    return { success: false, error: validationError };
  }

  const path = input.path.trim();
  const { VFS } = deps;
  if (!VFS) {
    return { success: false, error: 'VFS unavailable in this environment' };
  }

  if (!(await VFS.exists(path))) {
    return { success: false, error: `File not found: ${path}` };
  }

  const content = await VFS.read(path);
  const lines = content.split('\n');

  const structure = {
    imports: [],
    exports: [],
    functions: [],
    classes: [],
    todos: [],
    loc: lines.length
  };

  // Lightweight Regex Analysis (Fast, low token cost output)
  lines.forEach((line, index) => {
    const i = index + 1;
    const trim = line.trim();

    // Imports
    if (trim.startsWith('import ')) {
        structure.imports.push({ line: i, sig: trim });
    }

    // Exports
    if (trim.startsWith('export ')) {
        structure.exports.push({ line: i, sig: trim.split('{')[0].split('(')[0] });
    }

    // Functions (simple heuristic)
    const funcMatch = line.match(/(async\s+)?function\s+([a-zA-Z0-9_]+)|const\s+([a-zA-Z0-9_]+)\s*=\s*(async\s*)?(\([^)]*\)|[a-z])\s*=>/);
    if (funcMatch) {
        const name = funcMatch[2] || funcMatch[3];
        // Ignore common noise
        if (name && !['if', 'for', 'while', 'switch', 'catch'].includes(name)) {
            structure.functions.push({ line: i, name });
        }
    }

    // Classes
    const classMatch = line.match(/class\s+([a-zA-Z0-9_]+)/);
    if (classMatch) {
        structure.classes.push({ line: i, name: classMatch[1] });
    }

    // TODOs
    if (trim.includes('TODO') || trim.includes('FIXME')) {
        structure.todos.push({ line: i, comment: trim });
    }
  });

  return {
    success: true,
    path,
    summary: `Analyzed ${path} (${structure.loc} lines). Found ${structure.functions.length} functions, ${structure.classes.length} classes.`,
    structure
  };
}

export const tool = {
  name: "FileOutline",
  description: "Analyzes a file's structure (functions, exports, imports) without reading the full content. Use this first to save tokens when exploring code.",
  readOnly: true,
  inputSchema,
  call
};

export default call; // Support both export styles
