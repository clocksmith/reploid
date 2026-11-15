import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** An explicit configuration path is mandatory when supplied. A missing default
 * file means environment-only configuration; malformed files never fall back.
 * Values are never logged, including when interpolation or validation fails.
 */
export async function loadProxyConfig({ env = process.env, cwd = process.cwd(), filePath = env.REPLOID_CONFIG_PATH } = {}) {
  const explicit = filePath !== undefined;
  if (explicit && (typeof filePath !== 'string' || !filePath.trim())) {
    throw new Error('REPLOID_CONFIG_PATH must name a configuration file');
  }
  const filename = path.resolve(cwd, filePath ?? '.reploidrc.json');
  let bytes;
  try { bytes = await readFile(filename, 'utf8'); }
  catch (error) {
    if (!explicit && error.code === 'ENOENT') return { config: {}, path: null };
    throw new Error(`Cannot read proxy configuration: ${filename}`, { cause: error });
  }
  let config;
  try { config = JSON.parse(bytes); }
  catch { throw new Error(`Invalid JSON in proxy configuration: ${filename}`); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Proxy configuration must be an object');
  }
  const expand = value => {
    if (typeof value === 'string') return value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_match, name) => {
      if (typeof env[name] !== 'string') throw new Error(`Missing configuration environment variable: ${name}`);
      return env[name];
    });
    if (Array.isArray(value)) return value.map(expand);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item)]));
    return value;
  };
  config = expand(config);
  for (const section of ['server', 'api', 'ollama']) {
    if (config[section] !== undefined && (!config[section] || typeof config[section] !== 'object' || Array.isArray(config[section]))) {
      throw new Error(`Proxy configuration ${section} must be an object`);
    }
  }
  const server = config.server ?? {};
  if (server.port !== undefined && (!Number.isInteger(server.port) || server.port < 0 || server.port > 65535)) {
    throw new Error('Proxy configuration server.port must be an integer from 0 to 65535');
  }
  if (server.corsOrigins !== undefined && (!Array.isArray(server.corsOrigins)
    || !server.corsOrigins.every(origin => typeof origin === 'string' && origin.trim()))) {
    throw new Error('Proxy configuration server.corsOrigins must be an array of origins');
  }
  for (const name of ['geminiKey', 'geminiReferer', 'localEndpoint', 'openaiKey', 'anthropicKey', 'huggingfaceKey', 'groqKey', 'vllmEndpoint']) {
    if (config.api?.[name] !== undefined && typeof config.api[name] !== 'string') {
      throw new Error(`Proxy configuration api.${name} must be a string`);
    }
  }
  if (config.ollama?.autoStart !== undefined && typeof config.ollama.autoStart !== 'boolean') {
    throw new Error('Proxy configuration ollama.autoStart must be a boolean');
  }
  return { config, path: filename };
}
