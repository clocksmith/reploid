import { readFile } from 'node:fs/promises';

/** Test-owned signaling faults; direct RTC channels and model execution stay untouched. */
export async function controlSignaling(context) {
  const bootstrap = JSON.parse(await readFile('self/config/swarm-bootstrap.json', 'utf8'));
  const configuredPath = new URL(bootstrap.signalingUrl).pathname;
  const sockets = [];
  const events = [];
  let blocked = false;
  await context.routeWebSocket(url => url.pathname === '/signaling' || url.pathname === configuredPath, route => {
    if (blocked) {
      events.push({ kind: 'retry-blocked', at: Date.now() });
      void route.close({ code: 1013, reason: 'Test signaling unavailable' });
      return;
    }
    sockets.push({ route, server: route.connectToServer() });
    events.push({ kind: 'connected-route', at: Date.now() });
  });
  return {
    events,
    async interrupt() {
      if (!sockets.length) throw new Error('No signaling route was established before interruption');
      blocked = true;
      events.push({ kind: 'interrupted', at: Date.now(), routes: sockets.length });
      await Promise.all(sockets.splice(0).flatMap(({ route, server }) => [
        route.close({ code: 1013, reason: 'Test signaling unavailable' }),
        server.close({ code: 1013, reason: 'Test signaling unavailable' }),
      ]));
    },
  };
}
