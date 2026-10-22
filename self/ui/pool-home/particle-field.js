/** Ambient particle field behind every Poolday surface. Colors come from the
 * --pool-particle-* tokens; energy comes only from observed execution: the active
 * attempt (projectExecutionRibbon) and this device's contribution state. */
import { projectExecutionRibbon } from './execution-ribbon.js';
import { subscribeContributionState } from './contribution-state.js';

const FRAME_MS = 1000 / 30;
const MAX_PIXEL_RATIO = 1.5;
const AREA_PER_PARTICLE = 16000;
const MIN_PARTICLES = 24;
const MAX_PARTICLES = 90;
const LINK_DISTANCE = 110;
const ENERGY_BY_STATUS = { executing: 0.45, loading: 0.25, queued: 0.15, recovering: 0.25, cancelling: 0.1 };
const PULSE_STATUSES = new Set(['executing', 'completed']);

function readPalette(home) {
  const style = getComputedStyle(home);
  const read = (name, fallback) => {
    const value = Number.parseFloat(style.getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    hueStart: read('--pool-particle-hue-start', 195),
    hueSpan: read('--pool-particle-hue-span', 120),
    saturation: read('--pool-particle-saturation', 90),
    lightness: read('--pool-particle-lightness', 65),
    alpha: read('--pool-particle-alpha', 0.6),
    link: style.getPropertyValue('--pool-particle-link').trim() || '128 128 128',
    linkAlpha: read('--pool-particle-link-alpha', 0.2)
  };
}

export function bindParticleField(home, { chat = null } = {}) {
  if (!home || typeof window === 'undefined') return () => {};
  const canvas = document.createElement('canvas');
  canvas.className = 'pool-particle-field';
  canvas.setAttribute('aria-hidden', 'true');
  const context = canvas.getContext('2d');
  if (!context) return () => {};
  home.prepend(canvas);

  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let palette = readPalette(home);
  let width = 0, height = 0, particles = [];
  let frame = 0, lastFrame = 0, energy = 0, pulse = 0;
  let attemptEnergy = 0, contributionEnergy = 0, lastStatus = 'idle';

  const spawn = () => {
    const count = Math.max(MIN_PARTICLES, Math.min(MAX_PARTICLES, Math.round((width * height) / AREA_PER_PARTICLE)));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.3) * 1.6,
      vy: (Math.random() - 0.5) * 0.9,
      radius: Math.random() * 2.2 + 1,
      phase: Math.random() * Math.PI * 2,
      hue: Math.random()
    }));
  };
  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    width = window.innerWidth; height = window.innerHeight;
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    spawn();
  };

  const draw = (step) => {
    context.clearRect(0, 0, width, height);
    const speed = (1 + energy * 3.8) * step;
    const glow = Math.min(1, energy + pulse);
    const linkDistance = LINK_DISTANCE + glow * 60;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.phase += 0.02 * speed;
      p.x += (Math.abs(p.vx) + 0.6) * 0.6 * speed;
      p.y += Math.sin(p.phase) * 0.45 * step;
      if (p.x > width + 20) p.x = -20;
      if (p.y > height + 20) p.y = -20;
      if (p.y < -20) p.y = height + 20;
      const hue = (palette.hueStart + p.hue * palette.hueSpan + glow * 90) % 360;
      context.beginPath();
      context.arc(p.x, p.y, p.radius + glow * 1.4, 0, Math.PI * 2);
      context.fillStyle = `hsl(${hue} ${palette.saturation}% ${palette.lightness}% / ${Math.min(1, palette.alpha + glow * 0.25)})`;
      context.fill();
    }
    context.lineWidth = 0.8 + glow * 0.8;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      for (let j = i + 1; j < particles.length; j++) {
        const q = particles[j];
        const distance = Math.hypot(p.x - q.x, p.y - q.y);
        if (distance >= linkDistance) continue;
        const alpha = (1 - distance / linkDistance) * (palette.linkAlpha + glow * 0.35);
        context.beginPath();
        context.moveTo(p.x, p.y);
        context.lineTo(q.x, q.y);
        context.strokeStyle = `rgb(${palette.link} / ${alpha})`;
        context.stroke();
      }
    }
  };

  const still = () => motion?.matches || document.hidden;
  const tick = (now) => {
    frame = 0;
    if (still()) return;
    frame = requestAnimationFrame(tick);
    if (now - lastFrame < FRAME_MS) return;
    const step = lastFrame ? Math.min((now - lastFrame) / FRAME_MS, 3) : 1;
    lastFrame = now;
    const target = Math.max(attemptEnergy, contributionEnergy);
    energy += (target - energy) * 0.06 * step;
    pulse *= 0.96 ** step;
    draw(step);
  };
  const start = () => {
    if (still()) { draw(0); return; }
    if (!frame) { lastFrame = 0; frame = requestAnimationFrame(tick); }
  };

  const onResize = () => { resize(); start(); };
  const onVisibility = () => start();
  const themeObserver = new MutationObserver(() => { palette = readPalette(home); start(); });
  themeObserver.observe(home, { attributes: true, attributeFilter: ['data-pool-theme'] });
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);
  motion?.addEventListener?.('change', onVisibility);
  const unsubscribeChat = chat?.subscribe?.(state => {
    const view = projectExecutionRibbon(state);
    attemptEnergy = view.active ? ENERGY_BY_STATUS[view.status] || 0 : 0;
    if (view.status !== lastStatus && PULSE_STATUSES.has(view.status)) pulse = 1;
    lastStatus = view.status;
  }) || (() => {});
  const unsubscribeContribution = subscribeContributionState(state => {
    contributionEnergy = state.state === 'working' ? 0.3 : state.state === 'starting' ? 0.15 : 0;
  });

  resize();
  start();
  return () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    themeObserver.disconnect();
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibility);
    motion?.removeEventListener?.('change', onVisibility);
    unsubscribeChat();
    unsubscribeContribution();
    canvas.remove();
  };
}
