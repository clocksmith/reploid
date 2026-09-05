import { readFile, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

/** A registry's generation timestamp changes only when its content changes. */
export async function writeGeneratedRegistry(path, content) {
  try {
    const { generatedAt, ...previous } = JSON.parse(await readFile(path, 'utf8'));
    if (typeof generatedAt === 'string' && isDeepStrictEqual(previous, content)) return false;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const { version, ...fields } = content;
  const output = { version, generatedAt: new Date().toISOString(), ...fields };
  await writeFile(path, JSON.stringify(output, null, 2) + '\n', 'utf8');
  return true;
}
