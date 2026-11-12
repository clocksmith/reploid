import { expect } from '@playwright/test';

/**
 * Mesh discovery checked by protocol, as scripts/verify-cloudflare-swarm.js does (9de19ac09).
 * No element has rendered [data-mesh-peers] since f24bfcdeb, so the specs observe the
 * signaling `joined` frame, connected RTCPeerConnections with an open data channel, and
 * then require the participants rail digest to agree ("<n> connected").
 * Instrumentation lives in the page, so it also sees signaling routed by the test.
 */
export async function observeMeshProtocol(page) {
  await page.addInitScript(() => {
    window.__meshJoins = []; window.__meshConnections = [];
    const Peer = window.RTCPeerConnection, Socket = window.WebSocket;
    window.RTCPeerConnection = class extends Peer {
      constructor(...args) {
        super(...args); this.__meshChannels = []; window.__meshConnections.push(this);
        this.addEventListener('datachannel', event => this.__meshChannels.push(event.channel));
      }
      createDataChannel(...args) {
        const channel = super.createDataChannel(...args); this.__meshChannels.push(channel); return channel;
      }
    };
    window.WebSocket = class extends Socket {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => {
          if (typeof event.data !== 'string') return;
          try { const message = JSON.parse(event.data); if (message?.type === 'joined') window.__meshJoins.push(message); } catch {}
        });
      }
    };
  });
}

/** Wait until `page` has joined signaling and holds at least `minimum` open peer links. */
export async function expectMeshDiscovery(page, { minimum = 1, timeout = 60000 } = {}) {
  await page.waitForFunction(() => window.__meshJoins?.length > 0, null, { timeout });
  await page.waitForFunction(min => window.__meshConnections.filter(pc => pc.connectionState === 'connected'
    && pc.__meshChannels.some(channel => channel.readyState === 'open')).length >= min, minimum, { timeout });
  await expect.poll(async () => Number(/^(\d+) connected/.exec(
    await page.locator('[data-rail-digest="participants"]').textContent() || '')?.[1] ?? Number.NaN),
  { timeout: 30000, message: 'participants rail digest "<n> connected"' }).toBeGreaterThanOrEqual(minimum);
}
