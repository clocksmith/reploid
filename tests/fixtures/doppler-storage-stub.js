/** The Doppler storage tooling the host's model-file cache imports (hashing only); Doppler's own store holds nothing. */
import { createHash } from 'node:crypto';

export const computeHash = async (bytes, algorithm) => createHash(algorithm).update(bytes).digest('hex');
export const listModels = async () => [];
export const openModelReadSession = async () => { throw Object.assign(new Error('No Doppler store'), { name: 'NotFoundError' }); };
