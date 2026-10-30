/** Deterministic mathematical art. These marks never represent network activity. */
export function primeSieve(limit) {
  const primes = new Uint8Array(limit + 1).fill(1);
  primes[0] = primes[1] = 0;
  for (let p = 2; p * p <= limit; p++) if (primes[p]) {
    for (let n = p * p; n <= limit; n += p) primes[n] = 0;
  }
  return primes;
}

export function mathematicalFields(size = 151) {
  if (size < 3 || size % 2 !== 1) throw new RangeError('Use an odd grid size of at least three');
  const half = (size - 1) / 2, primes = primeSieve(size * size);
  const ulam = new Uint8Array(size * size), gaussian = new Uint8Array(size * size);
  const residueModuli = [163, 167, 173];
  const residueVariants = residueModuli.map(() => new Uint8Array(size * size));
  const squares = new Uint8Array(size * size);
  const quadratic = residueModuli.map(modulus => new Set(Array.from({ length: modulus }, (_, n) => n * n % modulus)));
  let x = 0, y = 0, value = 1, length = 1, direction = 0;
  const mark = () => {
    if (Math.abs(x) <= half && Math.abs(y) <= half) {
      const index = (y + half) * size + x + half;
      ulam[index] = primes[value] || 0;
      squares[index] = Number.isInteger(Math.sqrt(value)) ? 1 : 0;
    }
  };
  mark();
  const directions = [[1, 0], [0, -1], [-1, 0], [0, 1]];
  while (value < size * size) {
    for (let twice = 0; twice < 2; twice++) {
      const [dx, dy] = directions[direction++ % 4];
      for (let step = 0; step < length && value < size * size; step++) { x += dx; y += dy; value++; mark(); }
    }
    length++;
  }
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const a = col - half, b = row - half, index = row * size + col;
    const axis = Math.abs(a || b);
    gaussian[index] = a && b ? primes[a * a + b * b] : primes[axis] && axis % 4 === 3 ? 1 : 0;
    // Each variant uses nonzero quadratic residues of the squared distance.
    residueModuli.forEach((modulus, variant) => {
      const norm = (a * a + b * b) % modulus;
      residueVariants[variant][index] = norm !== 0 && quadratic[variant].has(norm) ? 1 : 0;
    });
  }
  return { size, ulam, gaussian, residues: residueVariants[0], residueVariants, squares };
}

/** The sweep visits fixed columns; only changed classifications blend. */
export function classificationBlend(column, size, phase) {
  const progress = Math.min(1, Math.max(0, (phase - 30) / 20));
  const front = progress * (size + 12) - 6;
  const t = Math.min(1, Math.max(0, (front - column) / 12 + .5));
  return t * t * (3 - 2 * t);
}

export function bindMathematicalBackground(root) {
  const fields = mathematicalFields(), canvas = document.createElement('canvas');
  canvas.className = 'pool-math-background'; canvas.setAttribute('aria-hidden', 'true');
  root.prepend(canvas); root.classList.add('pool-math-surface');
  const context = canvas.getContext('2d');
  if (!context) { canvas.remove(); root.classList.remove('pool-math-surface'); return () => {}; }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const arrays = [...fields.residueVariants, fields.gaussian];
  // Rasterize dots once. Animation composites strips from two cached 906px textures;
  // no per-point loops, paths, color strings or inference in an animation frame.
  const textures = new Map(), step = 6, extent = fields.size * step;
  const texture = index => {
    if (textures.has(index)) return textures.get(index);
    const layer = document.createElement('canvas'); layer.width = layer.height = extent;
    const paint = layer.getContext('2d'), half = (fields.size - 1) / 2;
    for (let row = 0; row < fields.size; row++) for (let col = 0; col < fields.size; col++) {
      const lit = arrays[index][row * fields.size + col], u = col - half, v = row - half;
      const edge = Math.max(.12, 1 - Math.hypot(u, v) / 110);
      const band = .86 + .14 * Math.cos(u * .12 + v * .055);
      paint.fillStyle = `hsla(${185 + 115 * col / fields.size}, ${lit * 54}%, ${48 + lit * 18}%, ${(.045 + lit * .38) * edge * band})`;
      paint.beginPath(); paint.arc((col + .5) * step, (row + .5) * step, .25 + lit * .34, 0, Math.PI * 2); paint.fill();
    }
    textures.set(index, layer);
    // Only the current and next patterns remain allocated (about 6.3 MiB total).
    while (textures.size > 2) {
      const oldest = textures.keys().next().value, removed = textures.get(oldest);
      removed.width = removed.height = 0; textures.delete(oldest);
    }
    return layer;
  };
  let selected = 0, next = 1, phase = 30, lastTime = performance.now();
  let frame = 0, lastDraw = -Infinity;
  texture(selected); texture(next);
  const draw = () => {
    // A one-CSS-pixel backing store avoids high-DPI fullscreen rendering cost.
    const width = innerWidth, height = innerHeight;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, width, height);
    const scale = Math.max(width, height) / 112 / step;
    context.setTransform(scale, 0, 0, scale, width * .38 - extent * scale / 2, height * .42 - extent * scale / 2);
    const current = texture(selected), upcoming = texture(next);
    // Add premultiplied contributions over transparency: common dots retain their
    // exact brightness. Merge adjacent fully visited/unvisited columns into one draw.
    context.globalCompositeOperation = 'lighter';
    let col = 0;
    while (col < fields.size) {
      const blend = reduced.matches ? 0 : classificationBlend(col, fields.size, phase);
      let end = col + 1;
      if (blend === 0 || blend === 1) {
        while (end < fields.size && (reduced.matches ? 0 : classificationBlend(end, fields.size, phase)) === blend) end++;
      }
      const x = col * step, width = (end - col) * step;
      if (blend < 1) { context.globalAlpha = 1 - blend; context.drawImage(current, x, 0, width, extent, x, 0, width, extent); }
      if (blend > 0) { context.globalAlpha = blend; context.drawImage(upcoming, x, 0, width, extent, x, 0, width, extent); }
      col = end;
    }
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
  };
  const schedule = () => { if (!frame && !document.hidden && !reduced.matches) frame = requestAnimationFrame(animate); };
  const animate = now => {
    frame = 0;
    if (document.hidden || reduced.matches) return;
    if (now - lastDraw >= 1000 / 30 - 1) {
      const elapsed = Math.min(now - lastTime, 100) / 1000;
      phase += elapsed; lastTime = now;
      const completed = phase >= 50;
      if (completed) { selected = next; next = (next + 1) % arrays.length; phase -= 50; texture(next); }
      if (phase >= 30 || completed) draw();
      lastDraw = now;
    }
    schedule();
  };
  const visibility = () => { cancelAnimationFrame(frame); frame = 0; lastTime = performance.now(); schedule(); };
  const preference = () => { visibility(); draw(); };
  window.addEventListener('resize', draw); document.addEventListener('visibilitychange', visibility);
  reduced.addEventListener('change', preference); draw(); schedule();
  return () => {
    cancelAnimationFrame(frame); window.removeEventListener('resize', draw);
    document.removeEventListener('visibilitychange', visibility); reduced.removeEventListener('change', preference);
    for (const layer of textures.values()) layer.width = layer.height = 0;
    textures.clear(); canvas.remove(); root.classList.remove('pool-math-surface');
  };
}
