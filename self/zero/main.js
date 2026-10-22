import { createZeroTools } from './tools.js';
import { createZeroProvider } from './provider.js';
import { exportZeroImage } from './image.js';

export function selectZeroConfig(config, hostname = globalThis.location?.hostname) {
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
  const settings = { ...config, ...(local ? config.localProvider : {}) };
  delete settings.localProvider;
  return settings;
}

/** Saved configuration selects the two capsules; no DI graph or background seed. */
export async function main({ store, mount, source, config, query = '' }) {
  const [agentModule, uiModule] = await Promise.all([
    import('/' + config.agent + query), import('/' + config.ui + query)
  ]);
  const settings = selectZeroConfig(config);
  const tools = await createZeroTools({ VFS: store, source });
  let agent, ui;
  try {
    const restored = await tools.restore();
    agent = await agentModule.createZeroAgent({ store, tools, config: settings,
      provider: createZeroProvider(), onChange: state => ui?.render(state) });
    ui = uiModule.mountZero(mount, {
      agent, config: settings, source, restored,
      exportSource: () => exportZeroImage(store, { includeTools: true })
    });
    ui.render(agent.snapshot());
    return { agent, tools, dispose: async () => { await agent.dispose(); ui.dispose(); store.close(); } };
  } catch (error) {
    await agent?.dispose();
    await tools.dispose();
    ui?.dispose();
    throw error;
  }
}
