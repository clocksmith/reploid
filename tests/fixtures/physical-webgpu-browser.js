/** Physical test hosts only; never fall back to a software GPU. */
export function physicalWebGpuBrowserOptions(platform, channel = 'chrome') {
  const backends = {
    darwin: ['--use-angle=metal'],
    linux: ['--enable-features=Vulkan', '--use-angle=vulkan', '--disable-gpu-sandbox'],
  };
  if (!Object.hasOwn(backends, platform)) throw new Error(`Unsupported physical test host: ${platform}`);
  return { channel, headless: true, args: ['--enable-unsafe-webgpu', ...backends[platform]] };
}

/** Ordinary remote profiles expose CDP; older external launch servers remain supported. */
export function connectPhysicalBrowser(chromium, endpoint) {
  return process.env.REPLOID_EXECUTOR_CDP === '1'
    ? chromium.connectOverCDP(endpoint) : chromium.connect(endpoint);
}

/** Run in an isolated page before opening the signed physical mesh. */
export async function requirePhysicalMeshCrypto() {
  try {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const verifier = await crypto.subtle.importKey('jwk', publicJwk, 'Ed25519', false, ['verify']);
    const message = new TextEncoder().encode('reploid.physical-mesh-preflight/v1');
    const signature = await crypto.subtle.sign('Ed25519', pair.privateKey, message);
    if (!await crypto.subtle.verify('Ed25519', verifier, signature, message)) throw new Error('Signature verification failed');
    return { algorithm: 'Ed25519', verified: true };
  } catch (cause) {
    throw new Error('This physical mesh browser cannot verify Ed25519 identities. Select a compatible browser; signature verification cannot be bypassed.', { cause });
  }
}
