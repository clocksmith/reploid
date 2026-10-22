import { ensureReploidWindowInstance } from '../instance.js';
import { openZeroStore } from './store.js';
import { validateZeroSource, hashZeroSource } from './image.js';

const SOURCE = '/zero/source.json';
const encoder = new TextEncoder();

async function readNetwork(path) {
  const response = await fetch(path, { cache: 'no-store', headers: { 'x-reploid-vfs-bypass': '1' } });
  if (!response.ok) throw new Error(`Missing Zero source: ${path} (${response.status})`);
  return response.text();
}

export async function prepareZero(store, read = readNetwork) {
  const saved = await store.read(SOURCE);
  if (saved === null && (await store.list('/')).length) return { legacy: true };
  const text = saved ?? await read(SOURCE);
  const source = validateZeroSource(JSON.parse(text));
  const files = {};
  for (const entry of source.files) {
    const path = '/' + entry.path;
    const content = saved === null ? await read(path) : await store.read(path);
    if (typeof content !== 'string' || encoder.encode(content).length !== entry.bytes
      || await hashZeroSource(content) !== entry.sha256) throw new Error(`Zero source changed or missing: ${path}`);
    files[path] = content;
  }
  const config = JSON.parse(files['/' + source.boot.config]);
  if (config?.schema !== 'reploid.zero.boot/v1'
    || ['main', 'agent', 'ui'].some(key => config[key] !== source.boot[key])) throw new Error('Zero boot configuration does not match its source');
  if (saved === null) await store.seed({ ...files, [SOURCE]: text });
  return { source, config, version: await hashZeroSource(text), legacy: false };
}

export async function connectZeroWorker(instance, serviceWorker = navigator.serviceWorker) {
  if (!serviceWorker) throw new Error('A Service Worker is required for verified tools');
  const registration = await serviceWorker.register('/sw.js?v=zero-capsule-v1', { scope: '/zero', updateViaCache: 'none' });
  await new Promise((resolve, reject) => {
    const check = () => {
      if (registration.active && serviceWorker.controller === registration.active) {
        clearTimeout(timer);
        serviceWorker.removeEventListener('controllerchange', check);
        resolve();
      }
    };
    const timer = setTimeout(() => {
      serviceWorker.removeEventListener('controllerchange', check);
      reject(new Error('Zero Service Worker did not take control; reload to retry'));
    }, 10000);
    serviceWorker.addEventListener('controllerchange', check);
    check();
  });
  await new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('Zero instance registration timed out')); }, 2000);
    channel.port1.onmessage = ({ data }) => {
      clearTimeout(timer); channel.port1.close();
      data?.success === true ? resolve() : reject(new Error('Zero instance registration failed'));
    };
    try {
      serviceWorker.controller.postMessage({ type: 'REGISTER_INSTANCE', data: { instanceId: instance, surfaceId: 'zero' } }, [channel.port2]);
    } catch (error) {
      clearTimeout(timer); channel.port1.close(); channel.port2.close(); reject(error);
    }
  });
}

/** The network nucleus selects saved code; it never upgrades or clears an instance. */
export async function bootZero({ win = window, openStore = openZeroStore, read = readNetwork,
  connect = connectZeroWorker, load = url => import(url) } = {}) {
  const mount = win.document.getElementById('app');
  let store;
  try {
    if (mount) mount.textContent = 'Opening Zero…';
    const instance = ensureReploidWindowInstance(win);
    store = await openStore();
    const prepared = await prepareZero(store, read);
    if (prepared.legacy) {
      store.close();
      await load(`/kernel/boot.js?v=${win.REPLOID_BUILD_VERSION || ''}`);
      return { legacy: true };
    }
    win.getReploidMode = () => 'zero';
    await connect(instance, win.navigator.serviceWorker);
    const query = `?instance=${encodeURIComponent(instance)}&v=${prepared.version}`;
    const { main } = await load('/' + prepared.source.boot.main + query);
    return await main({ store, mount, ...prepared, query });
  } catch (error) {
    store?.close();
    if (mount) { mount.textContent = `Zero could not start: ${error.message}`; mount.setAttribute('role', 'alert'); }
    throw error;
  }
}
