/**
 * Application composition for the public Reploid browser library.
 * Seed content, selected credentials, route storage and UI remain application-owned.
 */
import { createReploid } from './vendor/reploid/agent/index.js';
import { resolveConfig } from './vendor/reploid/config/index.js';
import profile from './config/reploid-library.json' with { type: 'json' };
import Utils from './core/utils.js';
import ResponseParser from './core/response-parser.js';
import { createSelfBridge } from './bridge.js';
import { getCurrentReploidInstanceId } from './instance.js';
import { SELF_BLUEPRINT_PATHS, SELF_PROMPT_PATHS } from './manifest.js';

export function createSelfRuntime(options = {}) {
  const goal = String(options.goal || '').trim();
  const environment = String(options.environment || '').trim();
  const instanceId = String(options.instanceId || getCurrentReploidInstanceId() || 'default');
  const swarmEnabled = !!options.swarmEnabled;
  const bridge = createSelfBridge({ ...options, instanceId, swarmEnabled });
  const config = resolveConfig({ profile: profile.profile, overrides: {
    mesh: { enabled: swarmEnabled, roomId: swarmEnabled ? 'application-managed' : null }
  } });
  const responseParser = ResponseParser.factory({ Utils: Utils.factory() });
  const instance = createReploid({
    config, ports: {
      instanceId, responseParser, owned: [bridge],
      authorize: () => true,
      agent: {
        ...bridge,
        async initialContext() {
          const files = await bridge.seedSystemFiles({ goal, environment, swarmEnabled });
          const context = await bridge.readBootstrapFiles([
            '/self/blueprint-index.json', ...SELF_PROMPT_PATHS, ...SELF_BLUEPRINT_PATHS
          ]);
          const rendered = Object.entries(context).map(([path, content]) => `${path}:\n${content}`).join('\n\n');
          return [{ role: 'user', origin: 'bootstrap', content: [
            `Self:\n${files['/self/self.json']}`,
            rendered ? `Bootstrap context:\n${rendered}` : ''
          ].filter(Boolean).join('\n\n') }];
        }
      }
    }
  });
  if (goal) instance.prepare({ goal, environment });
  return {
    ...instance,
    start: () => instance.execute({ goal, environment }),
    stop: () => instance.cancel(),
    isRunning: () => instance.getSnapshot().running,
    rotateIdentity: bridge.rotateIdentity
  };
}
