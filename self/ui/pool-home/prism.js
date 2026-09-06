/**
 * @fileoverview Decorative spectral light study. Never represents network evidence.
 * Compute traces three wavelengths through a lens and accumulates receiver energy
 * with storage-buffer atomics. The render pass reads that field without CPU readback.
 */
import { POOLDAY_RUN_VISUAL_EVENT } from './constants.js';
import { subscribeContributionState } from './contribution-state.js';

const FIELD_SIZE = 192;
const PHOTON_SIDE = 96;
const MAX_CANVAS_SIDE = 560;
const FRAME_INTERVAL_MS = 1000 / 30;
const ACTIVE_WINDOW_MS = 900;

const SHADER = /* wgsl */ `
struct Scene { size: vec2f, pointer: vec2f, time: f32, padding: f32, padding2: vec2f }
@group(0) @binding(0) var<uniform> scene: Scene;
@group(0) @binding(1) var<storage, read_write> energy: array<atomic<u32>>;

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

// Spectral photon accumulation uses atomics rather than a CPU particle loop.
@compute @workgroup_size(64)
fn photons(@builtin(global_invocation_id) gid: vec3u) {
  let index = gid.x;
  if (index >= 9216u) { return; }
  let sample = vec2f(f32(index % 96u), f32(index / 96u));
  let jitter = vec2f(hash(sample), hash(sample + 19.7)) - 0.5;
  let uv = ((sample + 0.5 + jitter * 0.6) / 96.0 * 2.0 - 1.0) * 0.94;
  if (dot(uv, uv) >= 0.88) { return; }
  let entry = vec3f(uv, sqrt(1.0 - dot(uv, uv)));
  let light = normalize(vec3f(0.10 + scene.pointer.x * 0.05, -0.15, -1.0));
  for (var channel = 0u; channel < 3u; channel++) {
    let ior = 1.44 + f32(channel) * 0.035;
    let internal = refract(light, entry, 1.0 / ior);
    let exit = entry + internal * (-2.0 * dot(entry, internal));
    let transmitted = refract(internal, -normalize(exit), ior);
    if (transmitted.z >= -0.001) { continue; }
    let receiver = exit + transmitted * ((-2.6 - exit.z) / transmitted.z);
    let spot = receiver.xy * 0.29 + vec2f(0.5, 0.5);
    let pixel = vec2i(spot * 192.0);
    if (any(pixel < vec2i(0)) || any(pixel >= vec2i(192))) { continue; }
    let offset = (u32(pixel.y) * 192u + u32(pixel.x)) * 3u + channel;
    atomicAdd(&energy[offset], 80u);
  }
}

// A separate read-only binding lets the fragment stage consume the computed field.
@group(1) @binding(0) var<storage, read> lightField: array<u32>;
fn energyAt(p: vec2i) -> vec3f {
  let pixel = clamp(p, vec2i(0), vec2i(191));
  let i = (u32(pixel.y) * 192u + u32(pixel.x)) * 3u;
  return vec3f(f32(lightField[i]), f32(lightField[i + 1u]), f32(lightField[i + 2u]));
}
fn caustic(uv: vec2f) -> vec3f {
  let at = clamp(uv, vec2f(0.0), vec2f(1.0)) * 191.0;
  let p = vec2i(floor(at));
  let f = fract(at);
  return mix(mix(energyAt(p), energyAt(p + vec2i(1, 0)), f.x),
    mix(energyAt(p + vec2i(0, 1)), energyAt(p + vec2i(1)), f.x), f.y) / 1100.0;
}
fn rotate(p: vec3f) -> vec3f {
  let ay = -0.42 + scene.pointer.x * 0.18 + sin(scene.time * 0.18) * 0.06;
  let ax = 0.34 + scene.pointer.y * 0.10;
  let az = -0.19;
  let a = vec3f(p.x * cos(ay) + p.z * sin(ay), p.y, -p.x * sin(ay) + p.z * cos(ay));
  let b = vec3f(a.x, a.y * cos(ax) - a.z * sin(ax), a.y * sin(ax) + a.z * cos(ax));
  return vec3f(b.x * cos(az) - b.y * sin(az), b.x * sin(az) + b.y * cos(az), b.z);
}
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vertex(@builtin(vertex_index) index: u32) -> Vertex {
  let p = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  var out: Vertex;
  out.position = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(p.x, 1.0 - p.y);
  return out;
}
@fragment fn fragment(in: Vertex) -> @location(0) vec4f {
  let uv = in.uv;
  let xy = (uv - 0.5) * vec2f(2.5, -2.2);
  let ro = rotate(vec3f(xy.x, xy.y + 0.08, 3.0));
  let rd = rotate(vec3f(0.0, 0.0, -1.0));
  var near = -100.0;
  var far = 100.0;
  var normal = vec3f(0.0);
  // Exact intersection with a cut octahedron. Eight planes, no ray march.
  for (var face = 0u; face < 8u; face++) {
    let n = vec3f(select(-1.0, 1.0, (face & 1u) != 0u),
      select(-1.0, 1.0, (face & 2u) != 0u), select(-1.0, 1.0, (face & 4u) != 0u));
    let denom = dot(n, rd);
    let t = (0.94 - dot(n, ro)) / denom;
    if (denom < 0.0 && t > near) { near = t; normal = normalize(n); }
    if (denom > 0.0) { far = min(far, t); }
  }
  let ground = vec2f((uv.x - 0.5) * 1.5 + 0.5, (uv.y - 0.79) * 4.8 + 0.5);
  let falloff = exp(-dot((uv - vec2f(0.51, 0.79)) * vec2f(4.0, 12.0), (uv - vec2f(0.51, 0.79)) * vec2f(4.0, 12.0)));
  let light = clamp(caustic(ground), vec3f(0.0), vec3f(1.0));
  var alpha = falloff * 0.15;
  var color = mix(vec3f(0.68, 0.68, 0.71), vec3f(0.75, 0.80, 0.77) + light * 0.25, 0.7);
  color = mix(color, vec3f(0.91, 0.86, 0.98) + light * 0.09, light.b * 0.4);
  if (near < far && near > 0.0) {
    let hit = ro + rd * near;
    let depth = far - near;
    let facing = abs(dot(normal, rd));
    let fresnel = pow(1.0 - facing, 3.0);
    let spectrum = 0.5 + 0.5 * cos(6.28318 * (vec3f(0.0, 0.33, 0.67) + dot(hit, vec3f(0.22, -0.28, 0.30)) + facing * 0.4));
    let illumination = max(0.0, dot(normal, normalize(vec3f(-0.45, 0.7, 1.3))));
    let reflection = pow(max(0.0, dot(reflect(rd, normal), normalize(vec3f(-0.3, 0.8, 1.4)))), 24.0);
    let transmitted = caustic(uv + normal.xy * 0.08);
    color = mix(vec3f(0.80, 0.83, 0.85), vec3f(0.97, 0.98, 0.97), illumination);
    color = mix(color, spectrum * 0.40 + 0.59, 0.45 + fresnel * 0.35);
    color += reflection * 0.23 + min(transmitted, vec3f(1.0)) * 0.035;
    // Narrow spectral bevels and sparse facet glints, contained inside the object.
    let sorted = sort3(abs(hit));
    let edge = 1.0 - smoothstep(0.0, 0.026, sorted.x);
    color = mix(color, mix(vec3f(1.0), spectrum * 0.30 + 0.70, 0.5), edge * 0.7);
    let cell = floor(hit.xy * 180.0);
    let sparkle = pow(max(0.0, sin(hash(cell) * 90.0 + scene.time * 0.5)), 80.0);
    color += select(0.0, sparkle * 0.28, hash(cell + 42.0) > 0.987);
    alpha = smoothstep(0.0, 0.016, depth) * 0.99;
  }
  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)) * alpha, alpha);
}
fn sort3(p: vec3f) -> vec3f {
  return vec3f(min(p.x, min(p.y, p.z)), max(min(p.x, p.y), min(max(p.x, p.y), p.z)), max(p.x, max(p.y, p.z)));
}
`;

/** Returns cleanup synchronously, including while adapter/pipeline creation is pending. */
export function bindPoolPrism(mount) {
  const shell = mount.querySelector('[data-pool-prism]');
  const canvas = shell?.querySelector('[data-pool-prism-canvas]');
  if (!canvas) return () => {};
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const contrast = matchMedia('(forced-colors: active)');
  const stats = { backend: 'static', frames: 0, suspended: true, frameIntervalMs: FRAME_INTERVAL_MS, width: 0, height: 0 };
  window.REPLOID_POOL_PRISM_STATS = stats;
  if (!navigator.gpu || navigator.connection?.saveData || contrast.matches) return () => {};

  let disposed = false;
  let device;
  let context;
  let pipeline;
  let compute;
  let computeBindings;
  let renderBindings;
  let uniforms;
  let field;
  let frameId = 0;
  let idleId;
  let inFlight = false;
  let inViewport = true;
  let requestBusy = ['running', 'submitting'].includes(window.REPLOID_POOL_RUN_VISUAL_STATE?.state);
  let providerBusy = false;
  let lastFrame = -Infinity;
  let awakeUntil = performance.now() + 4000;
  let clock = 0;
  let rect;
  const pointer = [0, 0];
  const target = [0, 0];
  const values = new Float32Array(8);
  const canDraw = () => !disposed && device && pipeline && renderBindings && inViewport && !document.hidden && !requestBusy && !providerBusy && !contrast.matches;
  const pause = () => { cancelAnimationFrame(frameId); frameId = 0; stats.suspended = true; };
  const schedule = () => {
    if (canDraw() && !frameId && !inFlight) frameId = requestAnimationFrame(draw);
  };
  const wake = () => { awakeUntil = performance.now() + ACTIVE_WINDOW_MS; schedule(); };
  const resize = () => {
    rect = shell.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 1.25, MAX_CANVAS_SIDE / Math.max(rect.width, rect.height, 1));
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width; canvas.height = height;
      stats.width = width; stats.height = height;
      wake();
    }
  };
  const fallback = (reason, error) => {
    pause();
    shell.dataset.prismState = 'static';
    stats.backend = 'static';
    stats.reason ||= reason;
    if (error) stats.error ||= String(error.message || error);
    device?.destroy();
    device = null;
  };
  function draw(now) {
    frameId = 0;
    if (!canDraw() || inFlight) return;
    if (!motion.matches && now - lastFrame < FRAME_INTERVAL_MS) { schedule(); return; }
    const delta = Math.min(50, Number.isFinite(lastFrame) ? now - lastFrame : 0);
    lastFrame = now;
    if (!motion.matches) clock += delta / 1000;
    pointer[0] += (target[0] - pointer[0]) * 0.18;
    pointer[1] += (target[1] - pointer[1]) * 0.18;
    values.set([canvas.width, canvas.height, motion.matches ? 0 : pointer[0], motion.matches ? 0 : pointer[1], clock, 0, 0, 0]);
    try {
      device.queue.writeBuffer(uniforms, 0, values);
      const encoder = device.createCommandEncoder({ label: 'Poolday prism frame' });
      encoder.clearBuffer(field);
      const photons = encoder.beginComputePass();
      photons.setPipeline(compute);
      photons.setBindGroup(0, computeBindings);
      photons.dispatchWorkgroups(PHOTON_SIDE * PHOTON_SIDE / 64);
      photons.end();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, renderBindings[0]);
      pass.setBindGroup(1, renderBindings[1]);
      pass.draw(3);
      pass.end();
      stats.phase = 'submit';
      device.queue.submit([encoder.finish()]);
      inFlight = true;
      stats.suspended = false;
      const started = performance.now();
      // Backpressure: at most one submitted frame. Slow GPUs never build a queue.
      device.queue.onSubmittedWorkDone().then(() => {
        inFlight = false;
        if (disposed || !device) return;
        stats.frames += 1;
        stats.lastCompletionMs = performance.now() - started;
        stats.backend = 'webgpu';
        shell.dataset.prismState = 'ready';
        if (!motion.matches && performance.now() < awakeUntil) schedule();
        else stats.suspended = true;
      }).catch((error) => { inFlight = false; if (!disposed) fallback('submission', error); });
    } catch (error) { fallback('render', error); }
  }
  const onPointer = (event) => {
    if (motion.matches || !rect) return;
    target[0] = Math.max(-1, Math.min(1, event.offsetX / rect.width * 2 - 1));
    target[1] = Math.max(-1, Math.min(1, event.offsetY / rect.height * 2 - 1));
    wake();
  };
  const onLeave = () => { if (motion.matches) return; target.fill(0); wake(); };
  const onVisibility = () => { if (document.hidden) pause(); else { resize(); wake(); } };
  const onRun = (event) => { requestBusy = ['running', 'submitting'].includes(event.detail?.state); if (requestBusy) pause(); else wake(); };
  const onPreference = () => { pause(); wake(); };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(shell);
  const intersection = new IntersectionObserver(([entry]) => {
    inViewport = entry.isIntersecting;
    if (inViewport) { resize(); wake(); } else pause();
  });
  intersection.observe(shell);
  shell.addEventListener('pointermove', onPointer, { passive: true });
  shell.addEventListener('pointerleave', onLeave, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener(POOLDAY_RUN_VISUAL_EVENT, onRun);
  motion.addEventListener('change', onPreference);
  contrast.addEventListener('change', onPreference);
  const unsubscribe = subscribeContributionState((state) => {
    providerBusy = state.state === 'working' || state.state === 'starting';
    if (providerBusy) pause(); else wake();
  });

  const initialize = async () => {
    if (disposed) return;
    try {
      stats.phase = 'adapter';
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
      if (!adapter || disposed) return;
      const acquired = await adapter.requestDevice({ label: 'Poolday decorative prism' });
      if (disposed) { acquired.destroy(); return; }
      device = acquired;
      device.lost.then((info) => { if (!disposed) fallback('device-lost', info.message); });
      device.addEventListener('uncapturederror', (event) => { if (!disposed) fallback('validation', event.error); });
      context = canvas.getContext('webgpu');
      if (!context) { fallback('context'); return; }
      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: 'premultiplied' });
      stats.phase = 'shader';
      device.pushErrorScope('validation');
      const module = device.createShaderModule({ label: 'Spectral photon study', code: SHADER });
      const info = await module.getCompilationInfo();
      if (disposed || !device) return;
      if (info.messages.some((message) => message.type === 'error')) {
        stats.shaderErrors = info.messages.filter((message) => message.type === 'error').map((message) => message.message);
        await device.popErrorScope();
        fallback('shader'); return;
      }
      stats.phase = 'pipelines';
      const acquiredDevice = device;
      [compute, pipeline] = await Promise.all([
        acquiredDevice.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'photons' } }),
        acquiredDevice.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertex' }, fragment: { module, entryPoint: 'fragment', targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
      ]);
      const validation = await acquiredDevice.popErrorScope();
      if (disposed || !device) return;
      if (validation) { fallback('pipeline'); return; }
      stats.phase = 'buffers';
      uniforms = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      field = device.createBuffer({ size: FIELD_SIZE * FIELD_SIZE * 3 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      computeBindings = device.createBindGroup({ layout: compute.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: { buffer: field } }] });
      renderBindings = [
        device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }] }),
        device.createBindGroup({ layout: pipeline.getBindGroupLayout(1), entries: [{ binding: 0, resource: { buffer: field } }] })
      ];
      resize();
      schedule();
    } catch (error) { if (!disposed) fallback('unavailable', error); }
  };
  // Let the useful interface paint before asking for a GPU device.
  if ('requestIdleCallback' in window) idleId = requestIdleCallback(initialize, { timeout: 1200 });
  else idleId = setTimeout(initialize, 150);
  return () => {
    disposed = true;
    pause();
    if ('cancelIdleCallback' in window) cancelIdleCallback(idleId); else clearTimeout(idleId);
    resizeObserver.disconnect();
    intersection.disconnect();
    shell.removeEventListener('pointermove', onPointer);
    shell.removeEventListener('pointerleave', onLeave);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener(POOLDAY_RUN_VISUAL_EVENT, onRun);
    motion.removeEventListener('change', onPreference);
    contrast.removeEventListener('change', onPreference);
    unsubscribe();
    context?.unconfigure();
    uniforms?.destroy();
    field?.destroy();
    device?.destroy();
    device = null;
  };
}
