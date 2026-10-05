/** Physical test hosts only; never fall back to a software GPU. */
export function physicalWebGpuBrowserOptions(platform, channel = 'chrome') {
  const backends = {
    darwin: ['--use-angle=metal'],
    linux: ['--enable-features=Vulkan', '--use-angle=vulkan', '--disable-gpu-sandbox'],
  };
  if (!Object.hasOwn(backends, platform)) throw new Error(`Unsupported physical test host: ${platform}`);
  return { channel, headless: true, args: ['--enable-unsafe-webgpu', ...backends[platform]] };
}
