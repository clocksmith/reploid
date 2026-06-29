/**
 * @fileoverview Magnetic particle shooter for the Zero boot-home surface.
 *
 * Canvas is appended to body behind the wizard container. Particles shoot from
 * pointer position and are magnetically pulled back toward the cursor. The
 * effect is pointer-driven and deterministic: no animation when idle, no
 * layout shifts, no DOM dimension queries on every frame.
 */

const MAX_PARTICLES = 150;
const EMIT_PER_MOVE = 3;
const PARTICLE_MAX_LIFE = 80;   // frames
const SHOOT_SPEED = 2.2;        // px/frame initial velocity
const MAGNETIC_RADIUS = 140;    // px — pull zone around cursor
const MAGNETIC_STRENGTH = 0.07; // acceleration toward cursor per frame within zone
const DAMPING = 0.97;           // velocity decay per frame
const MAX_ALPHA = 0.5;          // particle peak opacity

export function startParticleBg() {
  const canvas = document.createElement('canvas');
  canvas.id = 'particle-bg-canvas';
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
  document.body.appendChild(canvas);
  document.body.classList.add('particle-active');

  const ctx = canvas.getContext('2d');
  const fg = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim() || '#000000';

  let particles = [];
  let cx = -9999;
  let cy = -9999;
  let raf = null;
  let running = true;

  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  resize();

  const emit = (x, y) => {
    for (let i = 0; i < EMIT_PER_MOVE; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = SHOOT_SPEED * (0.4 + Math.random() * 0.6);
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: PARTICLE_MAX_LIFE,
        r: 1 + Math.random()
      });
    }
    if (particles.length > MAX_PARTICLES) {
      particles = particles.slice(particles.length - MAX_PARTICLES);
    }
  };

  const onMove = (e) => {
    cx = e.clientX;
    cy = e.clientY;
    emit(cx, cy);
  };

  const frame = () => {
    if (!running) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life--;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }

      // Magnetic pull toward current pointer position
      const dx = cx - p.x;
      const dy = cy - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0 && dist < MAGNETIC_RADIUS) {
        const pull = MAGNETIC_STRENGTH * (1 - dist / MAGNETIC_RADIUS);
        p.vx += (dx / dist) * pull;
        p.vy += (dy / dist) * pull;
      }

      p.vx *= DAMPING;
      p.vy *= DAMPING;
      p.x += p.vx;
      p.y += p.vy;

      const t = p.life / PARTICLE_MAX_LIFE;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * t, 0, Math.PI * 2);
      ctx.fillStyle = fg;
      ctx.globalAlpha = t * MAX_ALPHA;
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  };

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('resize', resize, { passive: true });
  raf = requestAnimationFrame(frame);

  return function stop() {
    running = false;
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('resize', resize);
    canvas.remove();
    document.body.classList.remove('particle-active');
  };
}
