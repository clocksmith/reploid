/** Sealed Mesa shader cache for native GPU contribution.
 *
 * Mesa Vulkan drivers persist compiled pipelines under MESA_SHADER_CACHE_DIR. Mesa ANV 24.2.8 stores a
 * shader's NIR before its backend compile and the binary after it, so a process stopped mid-compile leaves
 * NIR without a binary; every later process that needs that pipeline reloads the NIR and can crash
 * (artifacts/native-crash-20261014). This protocol never lets a process inherit what an unfinished
 * preparation wrote:
 *
 * - The cache is keyed by everything that determines the compiled pipelines: the installed Doppler runtime
 *   and its archive pin, the WebGPU provider, the Vulkan driver files, render devices and driver environment,
 *   and the model, Capsule, catalog entry, policy and stage.
 * - Without a sealed cache for its key, a process compiles into its own new staging directory.
 * - After the stage reports complete pipeline preparation, and once Mesa's cache writer threads are idle and
 *   the directory has stopped changing, a hashed snapshot of the staging directory is made read-only and
 *   renamed atomically to sealed/<key>. The process keeps its open handles on its own staging directory.
 * - With a sealed cache, a process verifies every file against the seal record and works on a private copy.
 *   Mesa is never pointed at a sealed directory.
 * - Every start removes sessions and promotions whose process has exited (an interrupted, killed or crashed
 *   preparation), so their contents are never reused.
 *
 * Linux only: process liveness and writer idleness come from /proc. The variable is set before the Vulkan
 * driver initializes; the caller binds this before loading any native module that starts threads.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const NATIVE_SHADER_CACHE_SCHEMA = 'reploid.native-shader-cache/v1';
const SEAL_SCHEMA = 'reploid.native-shader-cache-seal/v1';
/** Sealing requires `samples` consecutive idle-writer, unchanged-directory observations `intervalMs` apart. */
export const SHADER_CACHE_QUIESCENCE = Object.freeze({ intervalMs: 250, samples: 4, timeoutMs: 120000 });
const MANAGED = 'MESA_SHADER_CACHE_DIR';
const CONFLICTING = [MANAGED, 'MESA_SHADER_CACHE_DISABLE', 'MESA_GLSL_CACHE_DISABLE'];
const DRIVER_ENVIRONMENT = /^(MESA|INTEL|ANV|RADV|ACO|NIR|LP|GALLIUM|VK)_/;
const SESSION = /^([0-9a-f]{12})-(\d+)-(\d+)-([0-9a-f]{8})(?:\.rejected)?$/;
const PROMOTION = /^\.promote-([0-9a-f]{12}-\d+-\d+-[0-9a-f]{8})$/;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const missing = error => error?.code === 'ENOENT' || error?.code === 'ENOTDIR';
const present = target => fs.lstat(target).then(() => true, error => { if (missing(error)) return false; throw error; });

export function canonicalJson(value) {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(key => value[key] !== undefined)
    .map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

/** Sorted relative paths of regular files (and symbolic links when `links` is true) below `root`. */
async function listTree(root, { links = false } = {}, relative = '') {
  const rows = [];
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const entry of entries) {
    const name = relative ? relative + '/' + entry.name : entry.name;
    if (entry.isDirectory()) rows.push(...await listTree(root, { links }, name));
    else if (entry.isFile() || links && entry.isSymbolicLink()) rows.push(name);
    else throw new Error(`Unexpected non-regular entry in ${root}: ${name}`);
  }
  return rows;
}

/** Content digest of an installed package tree: every file's path and bytes, links by target. */
export async function digestTree(root) {
  const lines = [];
  for (const name of await listTree(root, { links: true })) {
    const file = path.join(root, name), stat = await fs.lstat(file);
    lines.push(name + '\0' + (stat.isSymbolicLink() ? 'link:' + await fs.readlink(file) : sha256(await fs.readFile(file))));
  }
  return sha256(lines.join('\n'));
}

/** Nearest ancestor directory of `start` holding a package.json, optionally with the given package name. */
export async function installedPackageDirectory(start, name = null) {
  let directory = path.resolve(start);
  for (;;) {
    const manifest = await fs.readFile(path.join(directory, 'package.json'), 'utf8').catch(error => {
      if (missing(error)) return null; throw error;
    });
    if (manifest !== null && (name === null || JSON.parse(manifest).name === name)) return directory;
    const parent = path.dirname(directory);
    requireValue(parent !== directory, `No installed package${name ? ' ' + name : ''} contains ${start}`);
    directory = parent;
  }
}

/** The Vulkan loader's driver manifest search on Linux, including its override variables. */
function driverSearchPaths(env, home) {
  const list = value => (value || '').split(':').filter(Boolean);
  const explicit = env.VK_DRIVER_FILES || env.VK_ICD_FILENAMES;
  if (explicit) return [...list(explicit), ...list(env.VK_ADD_DRIVER_FILES)];
  const config = env.XDG_CONFIG_HOME || path.join(home, '.config'), data = env.XDG_DATA_HOME || path.join(home, '.local/share');
  return [config, ...list(env.XDG_CONFIG_DIRS || '/etc/xdg'), '/etc', data, ...list(env.XDG_DATA_DIRS || '/usr/local/share:/usr/share')]
    .map(base => path.join(base, 'vulkan/icd.d')).concat(list(env.VK_ADD_DRIVER_FILES));
}

async function vulkanDrivers(env, home) {
  const manifests = [];
  for (const entry of driverSearchPaths(env, home)) {
    const stat = await fs.stat(entry).catch(error => { if (missing(error)) return null; throw error; });
    if (stat?.isDirectory()) {
      for (const name of (await fs.readdir(entry)).sort()) if (name.endsWith('.json')) manifests.push(path.join(entry, name));
    } else if (stat?.isFile()) manifests.push(entry);
  }
  return Promise.all([...new Set(manifests)].map(async manifest => {
    const bytes = await fs.readFile(manifest);
    let library = null;
    try { library = JSON.parse(bytes).ICD?.library_path ?? null; } catch { library = null; }
    // Bare library names are resolved by the dynamic linker, not by a path the protocol can hash.
    const file = typeof library === 'string' && library.includes('/') ? path.resolve(path.dirname(manifest), library) : null;
    const contents = file && await fs.readFile(file).catch(error => { if (missing(error)) return null; throw error; });
    return { manifest, manifestSha256: sha256(bytes), library, librarySha256: contents ? sha256(contents) : null };
  }));
}

async function renderDevices(drmRoot) {
  const names = await fs.readdir(drmRoot).catch(error => { if (missing(error)) return []; throw error; });
  return Promise.all(names.filter(name => /^renderD\d+$/.test(name)).sort().map(async node => {
    const read = file => fs.readFile(path.join(drmRoot, node, 'device', file), 'utf8').then(text => text.trim(), () => null);
    const driver = await fs.readlink(path.join(drmRoot, node, 'device/driver')).then(link => path.basename(link), () => null);
    return { node, vendor: await read('vendor'), device: await read('device'), revision: await read('revision'), driver };
  }));
}

/** The cache key: runtime, provider, driver and program identity. Any change selects a different sealed cache. */
export async function nativeShaderCacheIdentity({ runtime, provider, program, env = process.env, home = os.homedir(),
  drmRoot = '/sys/class/drm' }) {
  requireValue(typeof runtime?.directory === 'string' && typeof runtime.archiveIntegrity === 'string' && runtime.archiveIntegrity,
    'Shader cache identity requires the installed Doppler runtime directory and its pinned archive integrity');
  requireValue(typeof provider?.directory === 'string' && typeof provider.module === 'string',
    'Shader cache identity requires the selected WebGPU provider module and its installed directory');
  const { model, policy, stage = null, canonical = false } = program || {};
  requireValue(typeof model?.id === 'string' && typeof model.identity === 'string' && policy && typeof policy === 'object'
    && (stage === null || Number.isSafeInteger(stage) && stage >= 0) && typeof canonical === 'boolean',
  'Shader cache identity requires the catalog model, partition policy, stage index or null, and canonical flag');
  const manifest = async directory => JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  const [runtimePackage, providerPackage] = await Promise.all([manifest(runtime.directory), manifest(provider.directory)]);
  const environment = Object.fromEntries(Object.keys(env).filter(name => DRIVER_ENVIRONMENT.test(name) && name !== MANAGED)
    .sort().map(name => [name, env[name]]));
  const identity = { schema: NATIVE_SHADER_CACHE_SCHEMA,
    runtime: { name: runtimePackage.name, version: runtimePackage.version, archiveIntegrity: runtime.archiveIntegrity,
      installedSha256: await digestTree(runtime.directory) },
    provider: { module: provider.module, name: providerPackage.name, version: providerPackage.version,
      installedSha256: await digestTree(provider.directory) },
    driver: { icds: await vulkanDrivers(env, home), devices: await renderDevices(drmRoot), environment },
    program: { modelId: model.id, modelIdentity: model.identity,
      capsule: model.capsule ? model.capsule.semanticRoot ?? model.capsule.capsuleId ?? null : null,
      catalogEntrySha256: sha256(canonicalJson(model)), policySha256: sha256(canonicalJson(policy)), stage, canonical } };
  return { key: sha256(canonicalJson(identity)), identity };
}

const processStart = async (proc, pid) => {
  const stat = await fs.readFile(path.join(proc, String(pid), 'stat'), 'utf8');
  return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
};

/** Mesa names its disk cache writer threads `<process>:disk$<n>`; an idle writer sleeps on its queue. */
export async function observeMesaCacheWriters(proc = '/proc') {
  const tasks = path.join(proc, 'self/task');
  let writers = 0, busy = 0;
  for (const tid of await fs.readdir(tasks)) {
    const comm = await fs.readFile(path.join(tasks, tid, 'comm'), 'utf8').then(text => text.trim(), () => '');
    if (!/disk\$\d*$/.test(comm)) continue;
    const stat = await fs.readFile(path.join(tasks, tid, 'stat'), 'utf8').catch(() => null);
    if (stat === null) continue;
    writers++;
    if (stat[stat.lastIndexOf(')') + 2] !== 'S') busy++;
  }
  return { writers, busy };
}

async function treeSignature(root) {
  const rows = [];
  for (const name of await listTree(root)) {
    const stat = await fs.stat(path.join(root, name));
    rows.push([name, stat.size, stat.mtimeMs]);
  }
  return canonicalJson(rows);
}

async function writePrivate(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}

async function syncDirectory(directory) {
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

/** Removes a tree, including sealed read-only directories. */
async function removeTree(target) {
  const open = async directory => {
    await fs.chmod(directory, 0o700);
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) await open(path.join(directory, entry.name));
    }
  };
  try { await open(target); } catch (error) { if (missing(error)) return; throw error; }
  await fs.rm(target, { recursive: true, force: true });
}

async function sealReadOnly(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await sealReadOnly(target); else await fs.chmod(target, 0o444);
  }
  await fs.chmod(directory, 0o555);
}

/** Verifies a sealed cache against its record and copies it into a private writable directory. */
async function copySealed(sealed, key, identity, target) {
  const record = JSON.parse(await fs.readFile(path.join(sealed, 'seal.json'), 'utf8'));
  requireValue(record.schema === SEAL_SCHEMA && record.key === key && canonicalJson(record.identity) === canonicalJson(identity),
    'seal record does not match this identity');
  const names = await listTree(path.join(sealed, 'cache'));
  requireValue(Array.isArray(record.files) && canonicalJson(names) === canonicalJson(record.files.map(file => file.path))
    && sha256(canonicalJson(record.files)) === record.contentSha256, 'sealed files differ from the seal record');
  for (const file of record.files) {
    const bytes = await fs.readFile(path.join(sealed, 'cache', file.path));
    requireValue(bytes.length === file.bytes && sha256(bytes) === file.sha256, `sealed file changed: ${file.path}`);
    await writePrivate(path.join(target, file.path), bytes);
  }
  return { files: record.files.length, bytes: record.files.reduce((total, file) => total + file.bytes, 0), sealedAt: record.sealedAt };
}

/** Binds this process to its sealed cache, or to a new staging directory, and sets MESA_SHADER_CACHE_DIR. */
export async function openNativeShaderCache({ root, key, identity, env = process.env, platform = process.platform, proc = '/proc',
  pid = process.pid, observeWriters = () => observeMesaCacheWriters(proc), quiescence = SHADER_CACHE_QUIESCENCE,
  now = () => performance.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), clock = () => new Date(),
  onEvent = () => {} }) {
  requireValue(platform === 'linux', `The sealed shader cache protocol requires Linux (process liveness and Mesa writer state come from /proc); this host is ${platform}. Native GPU contribution is qualified on Linux/Vulkan only.`);
  requireValue(typeof root === 'string' && path.isAbsolute(root), 'The shader cache root must be an absolute directory (--shader-cache-root)');
  for (const name of CONFLICTING) {
    requireValue(env[name] === undefined, `${name} is set to ${JSON.stringify(env[name])}, but the native participant manages the Mesa shader cache under ${root} with the sealed-cache protocol. Unset ${name}` + (name === MANAGED ? '; choose the location with --shader-cache-root.' : '.'));
  }
  requireValue(/^[0-9a-f]{64}$/.test(key) && identity && typeof identity === 'object', 'Shader cache binding requires an identity and its key');
  const base = path.join(root, 'v1'), sealedRoot = path.join(base, 'sealed'), sessionsRoot = path.join(base, 'sessions');
  let boot, start;
  try {
    await fs.mkdir(sealedRoot, { recursive: true, mode: 0o700 }); await fs.mkdir(sessionsRoot, { recursive: true, mode: 0o700 });
    await fs.access(base, fs.constants.W_OK);
  } catch (error) { throw new Error(`Shader cache root ${root} is not a writable directory (${error.code || error.message}); choose a private directory with --shader-cache-root`); }
  try {
    boot = (await fs.readFile(path.join(proc, 'sys/kernel/random/boot_id'), 'utf8')).trim().replaceAll('-', '').slice(0, 12);
    start = await processStart(proc, pid);
    requireValue(/^[0-9a-f]{12}$/.test(boot) && /^\d+$/.test(start), 'unrecognized /proc identity');
  } catch (error) { throw new Error(`The sealed shader cache protocol could not read this process's identity from ${proc}: ${error.message}`); }
  const alive = async owner => owner[1] === boot && await processStart(proc, owner[2]).then(value => value === owner[3], () => false);
  // Sweep: anything a dead process left behind is discarded, never inherited.
  const discarded = [];
  for (const name of await fs.readdir(sessionsRoot)) {
    const owner = SESSION.exec(name);
    if (owner && await alive(owner)) continue;
    await removeTree(path.join(sessionsRoot, name));
    discarded.push({ name, reason: owner ? 'owner process exited before sealing' : 'unrecognized session entry' });
  }
  for (const name of await fs.readdir(sealedRoot)) {
    const promotion = PROMOTION.exec(name), owner = promotion && SESSION.exec(promotion[1]);
    if (!promotion || owner && await alive(owner)) continue;
    await removeTree(path.join(sealedRoot, name));
    discarded.push({ name, reason: 'promotion interrupted' });
  }
  const session = `${boot}-${pid}-${start}-${randomUUID().replaceAll('-', '').slice(0, 8)}`;
  const sessionDirectory = path.join(sessionsRoot, session), directory = path.join(sessionDirectory, 'cache');
  const sealed = path.join(sealedRoot, key);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  let mode = 'cold', loaded = null, rejected = null;
  if (await present(sealed)) {
    try { loaded = await copySealed(sealed, key, identity, directory); mode = 'warm'; }
    catch (error) {
      rejected = error.message;
      // Move the rejected seal out of lookup atomically (a directory needs write permission to change
      // parent), then remove it; this start compiles cold.
      const aside = path.join(sessionsRoot, session + '.rejected');
      await fs.chmod(sealed, 0o700).then(() => fs.rename(sealed, aside)).then(() => removeTree(aside),
        cause => { if (!missing(cause)) throw cause; });
      await removeTree(directory); await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    }
  }
  env[MANAGED] = directory;
  let seal = null, sealing = null, closing = null, cancelled = false;
  const status = () => ({ schema: NATIVE_SHADER_CACHE_SCHEMA, root, key, mode, session, directory,
    sealed: mode === 'warm' || seal?.status === 'sealed' || seal?.status === 'already-sealed', loaded, discarded: structuredClone(discarded), rejected, seal: structuredClone(seal) });
  onEvent({ phase: 'bound', ...status() });

  async function waitForQuiescence(started) {
    let previous = null, stable = 0;
    while (!cancelled && now() - started <= quiescence.timeoutMs) {
      const writers = await observeWriters(), signature = await treeSignature(directory);
      if (writers.writers === 0) return { quiescent: false, reason: 'no Mesa shader cache writer threads in this process; the driver does not use MESA_SHADER_CACHE_DIR' };
      stable = writers.busy === 0 && signature === previous ? stable + 1 : 0;
      previous = signature;
      if (stable >= quiescence.samples) return { quiescent: true, signature };
      await sleep(quiescence.intervalMs);
    }
    return { quiescent: false, reason: cancelled ? 'cancelled by shutdown'
      : `Mesa shader cache writers were not idle with an unchanged directory for ${quiescence.samples} samples within ${quiescence.timeoutMs} ms` };
  }

  async function promote(preparation) {
    const started = now();
    if (!(preparation?.complete === true && Number.isSafeInteger(preparation.count) && preparation.count > 0)) {
      return { status: 'refused', reason: 'stage did not report complete pipeline preparation' };
    }
    const program = { count: preparation.count, durationMs: preparation.durationMs ?? null, planId: preparation.planId ?? null,
      index: preparation.index ?? null, modelIdentity: preparation.modelIdentity ?? null,
      pipelinesSha256: sha256(canonicalJson((preparation.pipelines || []).map(row => row?.key ?? row))) };
    const promotion = path.join(sealedRoot, '.promote-' + session);
    for (;;) {
      const idle = await waitForQuiescence(started);
      if (!idle.quiescent) return { status: 'refused', reason: idle.reason };
      if ((await listTree(directory)).length === 0) return { status: 'refused', reason: 'the driver wrote nothing to MESA_SHADER_CACHE_DIR' };
      await removeTree(promotion);
      const files = [];
      for (const name of await listTree(directory)) {
        const bytes = await fs.readFile(path.join(directory, name));
        await writePrivate(path.join(promotion, 'cache', name), bytes);
        files.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) });
      }
      // A write during the copy invalidates this snapshot; wait for quiescence again.
      const after = await observeWriters();
      if (cancelled || after.busy !== 0 || await treeSignature(directory) !== idle.signature) {
        await removeTree(promotion);
        if (cancelled) return { status: 'refused', reason: 'cancelled by shutdown' };
        continue;
      }
      const record = { schema: SEAL_SCHEMA, key, identity, sealedAt: clock().toISOString(), session, program, files,
        contentSha256: sha256(canonicalJson(files)) };
      await writePrivate(path.join(promotion, 'seal.json'), JSON.stringify(record, null, 1) + '\n');
      await sealReadOnly(promotion); await syncDirectory(promotion);
      // rename(2) never replaces a non-empty directory, so a seal another process completed first stays.
      const raced = { status: 'already-sealed', reason: 'another process sealed this identity first' };
      if (await present(sealed)) { await removeTree(promotion); return raced; }
      try { await fs.rename(promotion, sealed); }
      catch (error) {
        await removeTree(promotion);
        if (await present(sealed)) return raced;
        throw error;
      }
      await syncDirectory(sealedRoot);
      return { status: 'sealed', files: files.length, bytes: files.reduce((total, file) => total + file.bytes, 0),
        waitedMs: Math.round(now() - started), program };
    }
  }

  return Object.freeze({
    status,
    /** Seals at most once, after a complete stage preparation; a refused or failed attempt leaves a later
     * preparation free to try. Never rejects; every outcome is reported. */
    seal(preparation) {
      if (mode === 'warm') return Promise.resolve({ status: 'sealed-before-start' });
      if (closing) return Promise.resolve({ status: 'refused', reason: 'closed' });
      if (sealing) return sealing;
      return sealing = promote(preparation).catch(error => ({ status: 'failed', reason: error.message })).then(outcome => {
        seal = outcome; onEvent({ phase: 'seal', key, session, ...outcome });
        if (outcome.status !== 'sealed' && outcome.status !== 'already-sealed') sealing = null;
        return outcome;
      });
    },
    /** Removes this process's private cache after its GPU provider is released; a pending seal is cancelled.
     * Never rejects: a directory left behind belongs to an exited process and the next start removes it. */
    close() {
      return closing ||= (async () => {
        cancelled = true; await sealing;
        try { await removeTree(sessionDirectory); onEvent({ phase: 'closed', key, session }); }
        catch (error) { onEvent({ phase: 'close-failed', key, session, reason: error.message }); }
      })();
    },
  });
}
