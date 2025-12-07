/**
 * @fileoverview Sed - Stream editor for text substitution
 */

async function call(args = {}, deps = {}) {
  const { VFS } = deps;
  if (!VFS) throw new Error('VFS not available');

  const { script, path, inPlace = false } = args;
  if (!script) throw new Error('Missing "script" argument');
  if (!path) throw new Error('Missing "path" argument');

  // Parse sed-like script: s/pattern/replacement/flags
  const match = script.match(/^s\/(.+?)\/(.*)\/([gi]*)$/);
  if (!match) {
    throw new Error('Invalid sed script. Use format: s/pattern/replacement/flags');
  }

  const [, searchPattern, replacement, flags] = match;
  const regex = new RegExp(searchPattern, flags || 'g');

  const content = await VFS.read(path);
  const result = content.replace(regex, replacement);

  if (inPlace) {
    await VFS.write(path, result);
    return `Modified: ${path}`;
  }

  return result;
}

export const tool = {
  name: "Sed",
  description: "Stream editor for text substitution (sed s/pattern/replacement/)",
  call
};

export default call;
