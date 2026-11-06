/** Operator-composed HTTP inference, disabled without an explicit external module.
 * The composition owns real sign-in, ledger policy, trial limits and its requester. */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTextApi, TEXT_API_PATHS } from './text-api.js';

export async function mountTextApi(app, { env = process.env, importModule = specifier => import(specifier) } = {}) {
  const modulePath = env.REPLOID_TEXT_API_COMPOSITION;
  if (!modulePath) return { mounted: false, close: async () => {} };
  const root = fileURLToPath(new URL('..', import.meta.url));
  if (!path.isAbsolute(modulePath) || !path.relative(root, modulePath).startsWith('..' + path.sep)) {
    throw Error('Text API composition must be an absolute module outside the repository');
  }
  const production = env.NODE_ENV === 'production' || !!env.K_SERVICE;
  const loaded = await importModule(pathToFileURL(modulePath).href);
  if (typeof loaded.createTextApiComposition !== 'function') throw Error('Text API module must export createTextApiComposition');
  const composition = await loaded.createTextApiComposition({ env, production });
  let api;
  try {
    if (production && composition?.testOnly) throw Error('Production text API refuses a test composition');
    api = createTextApi({ ...composition, production });
  }
  catch (error) { await composition?.close?.(); throw error; }
  app.all(TEXT_API_PATHS, (req, res) => api.handle(req, res));
  return { mounted: true, async close() { await api.close(); await composition.close?.(); } };
}
