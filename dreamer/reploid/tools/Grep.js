/**
 * @fileoverview Grep - Search file contents for a pattern
 */

async function call(args = {}, deps = {}) {
  const { VFS } = deps;
  if (!VFS) throw new Error('VFS not available');

  const { pattern, path = '/', recursive = true, ignoreCase = false } = args;
  if (!pattern) throw new Error('Missing "pattern" argument');

  const flags = ignoreCase ? 'gi' : 'g';
  const regex = new RegExp(pattern, flags);

  const results = [];

  // Get files to search
  const files = await VFS.list(path);

  for (const filePath of files) {
    try {
      const content = await VFS.read(filePath);
      const lines = content.split('\n');

      lines.forEach((line, idx) => {
        if (regex.test(line)) {
          results.push(`${filePath}:${idx + 1}:${line}`);
        }
        // Reset regex lastIndex for next test
        regex.lastIndex = 0;
      });
    } catch (e) {
      // Skip files that can't be read
    }
  }

  return results.length > 0 ? results.join('\n') : 'No matches found';
}

export const tool = {
  name: "Grep",
  description: "Search file contents for text or regex patterns (grep)",
  call
};

export default call;
