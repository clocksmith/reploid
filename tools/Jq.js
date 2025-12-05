/**
 * @fileoverview Jq - JSON querying and transformation
 */

async function call(args = {}, deps = {}) {
  const { VFS } = deps;
  if (!VFS) throw new Error('VFS not available');

  const { filter, path } = args;
  if (!filter) throw new Error('Missing "filter" argument');
  if (!path) throw new Error('Missing "path" argument');

  const content = await VFS.read(path);
  const json = JSON.parse(content);

  // Simple jq-like filter implementation
  // Supports: ., .key, .key.nested, .[0], .[], .key[]
  const result = applyFilter(json, filter);

  return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
}

function applyFilter(data, filter) {
  if (filter === '.') {
    return data;
  }

  // Parse filter into parts
  const parts = [];
  let current = '';
  let inBracket = false;

  for (let i = 0; i < filter.length; i++) {
    const char = filter[i];
    if (char === '[') {
      if (current) parts.push(current);
      current = '';
      inBracket = true;
    } else if (char === ']') {
      if (current) parts.push(`[${current}]`);
      current = '';
      inBracket = false;
    } else if (char === '.' && !inBracket) {
      if (current) parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);

  // Apply each part
  let result = data;
  for (const part of parts) {
    if (result === undefined || result === null) break;

    if (part === '[]') {
      // Array iterator - flatten
      if (!Array.isArray(result)) throw new Error('Cannot iterate non-array');
      continue;
    } else if (part.startsWith('[') && part.endsWith(']')) {
      // Array index
      const idx = parseInt(part.slice(1, -1), 10);
      result = result[idx];
    } else {
      // Object key
      result = result[part];
    }
  }

  return result;
}

export const tool = {
  name: "Jq",
  description: "Query and transform JSON files (jq)",
  call
};

export default call;
