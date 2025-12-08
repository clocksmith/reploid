/**
 * @fileoverview Find - Locate files by name pattern
 */

async function call(args = {}, deps = {}) {
  const { VFS } = deps;
  if (!VFS) throw new Error('VFS not available');

  const { path = '/', name } = args;

  const files = await VFS.list(path);

  if (!name) {
    return files.join('\n');
  }

  // Convert glob pattern to regex
  // Supports * (any chars) and ? (single char)
  const regexPattern = name
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape special regex chars
    .replace(/\*/g, '.*')                   // * -> .*
    .replace(/\?/g, '.');                   // ? -> .

  const regex = new RegExp(regexPattern, 'i');

  const matches = files.filter(filePath => {
    const fileName = filePath.split('/').pop();
    return regex.test(fileName);
  });

  return matches.join('\n');
}

export const tool = {
  name: "Find",
  description: "Find files matching a name pattern (find)",
  readOnly: true,
  call
};

export default call;
