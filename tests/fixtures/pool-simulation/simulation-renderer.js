/**
 * @fileoverview Renderer selection and GPU backends for the Reploid landing graph.
 */

const compileShader = (gl, type, source) => {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'unknown shader error';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
};

const createProgram = (gl, vertexSource, fragmentSource) => {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'unknown program error';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
};

const cloneCanvasForFallback = (canvas) => {
  const next = canvas.cloneNode(false);
  next.width = canvas.width;
  next.height = canvas.height;
  canvas.replaceWith(next);
  return next;
};

const cssColor = (r, g, b, a) => (
  `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${Math.max(0, Math.min(1, a))})`
);

const DEFAULT_CLEAR_COLOR = Object.freeze({ r: 1, g: 1, b: 1, a: 1 });

const clampUnit = (value) => Math.max(0, Math.min(1, value));

const parseCssColorChannel = (token) => {
  const text = String(token || '').trim();
  if (!text) return NaN;
  if (text.endsWith('%')) return clampUnit(Number(text.slice(0, -1)) / 100);
  return clampUnit(Number(text) / 255);
};

const parseCssAlphaChannel = (token) => {
  const text = String(token || '').trim();
  if (!text) return NaN;
  if (text.endsWith('%')) return clampUnit(Number(text.slice(0, -1)) / 100);
  return clampUnit(Number(text));
};

const parseHexCssColor = (text) => {
  const hex = text.slice(1);
  if (![3, 4, 6, 8].includes(hex.length) || /[^0-9a-f]/i.test(hex)) return null;
  const expand = (value) => value.length === 1 ? `${value}${value}` : value;
  const size = hex.length <= 4 ? 1 : 2;
  const r = parseInt(expand(hex.slice(0, size)), 16) / 255;
  const g = parseInt(expand(hex.slice(size, size * 2)), 16) / 255;
  const b = parseInt(expand(hex.slice(size * 2, size * 3)), 16) / 255;
  const alphaText = hex.slice(size * 3, size * 4);
  const a = alphaText ? parseInt(expand(alphaText), 16) / 255 : 1;
  return { r, g, b, a };
};

export const parsePoolRendererCssColor = (value) => {
  const text = String(value || '').trim().toLowerCase();
  if (!text || text === 'transparent') return null;
  if (text.startsWith('#')) return parseHexCssColor(text);

  const match = text.match(/^rgba?\((.*)\)$/);
  if (!match) return null;
  let body = match[1].trim();
  let alphaToken = null;
  const slashIndex = body.indexOf('/');
  if (slashIndex >= 0) {
    alphaToken = body.slice(slashIndex + 1).trim();
    body = body.slice(0, slashIndex).trim();
  }
  const channels = body.includes(',')
    ? body.split(',').map((part) => part.trim()).filter(Boolean)
    : body.split(/\s+/).filter(Boolean);
  if (channels.length === 4 && !alphaToken) alphaToken = channels.pop();
  if (channels.length !== 3) return null;

  const color = {
    r: parseCssColorChannel(channels[0]),
    g: parseCssColorChannel(channels[1]),
    b: parseCssColorChannel(channels[2]),
    a: alphaToken ? parseCssAlphaChannel(alphaToken) : 1
  };
  return Object.values(color).every(Number.isFinite) ? color : null;
};

const flattenAgainstWhite = (color) => {
  const alpha = clampUnit(color.a);
  return {
    r: color.r * alpha + DEFAULT_CLEAR_COLOR.r * (1 - alpha),
    g: color.g * alpha + DEFAULT_CLEAR_COLOR.g * (1 - alpha),
    b: color.b * alpha + DEFAULT_CLEAR_COLOR.b * (1 - alpha),
    a: 1
  };
};

const readComputedStyle = (element) => {
  try {
    return globalThis.getComputedStyle?.(element) || null;
  } catch {
    return null;
  }
};

const findClosestPoolHome = (canvas) => {
  try {
    return typeof canvas?.closest === 'function' ? canvas.closest('.pool-home') : null;
  } catch {
    return null;
  }
};

export const resolvePoolRendererClearColor = (canvas, readStyle = readComputedStyle) => {
  const candidates = [
    canvas,
    findClosestPoolHome(canvas),
    globalThis.document?.body,
    globalThis.document?.documentElement
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const color = parsePoolRendererCssColor(readStyle(candidate)?.backgroundColor);
    if (color && color.a > 0) return flattenAgainstWhite(color);
  }
  return DEFAULT_CLEAR_COLOR;
};

const drawFillBatch2D = (ctx, data) => {
  for (let index = 0; index < data.length; index += 18) {
    const ax = data[index];
    const ay = data[index + 1];
    const bx = data[index + 6];
    const by = data[index + 7];
    const cx = data[index + 12];
    const cy = data[index + 13];
    const r = (data[index + 2] + data[index + 8] + data[index + 14]) / 3;
    const g = (data[index + 3] + data[index + 9] + data[index + 15]) / 3;
    const b = (data[index + 4] + data[index + 10] + data[index + 16]) / 3;
    const a = (data[index + 5] + data[index + 11] + data[index + 17]) / 3;
    if (a <= 0) continue;
    ctx.fillStyle = cssColor(r, g, b, a);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
  }
};

const drawCircleBatch2D = (ctx, data) => {
  for (let index = 0; index < data.length; index += 54) {
    const left = data[index];
    const top = data[index + 1];
    const right = data[index + 45];
    const bottom = data[index + 46];
    const inner = Math.max(0, Math.min(1, data[index + 4] || 0));
    const r = data[index + 5];
    const g = data[index + 6];
    const b = data[index + 7];
    const a = data[index + 8];
    if (a <= 0) continue;
    const centerX = (left + right) * 0.5;
    const centerY = (top + bottom) * 0.5;
    const radius = Math.max(0, Math.abs(right - left), Math.abs(bottom - top)) * 0.5;
    if (radius <= 0) continue;
    ctx.fillStyle = cssColor(r, g, b, a);
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    if (inner > 0) {
      ctx.moveTo(centerX + radius * inner, centerY);
      ctx.arc(centerX, centerY, radius * inner, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
    } else {
      ctx.fill();
    }
  }
};

const createCanvas2DRenderer = (canvas, buildBatches) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const clearColor = resolvePoolRendererClearColor(canvas);
  const clearFill = cssColor(clearColor.r, clearColor.g, clearColor.b, clearColor.a);
  return {
    backend: '2d',
    canvas,
    render: (frame, width, height) => {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = clearFill;
      ctx.fillRect(0, 0, width, height);
      for (const batch of buildBatches(frame, width, height)) {
        if (batch.kind === 'circle') drawCircleBatch2D(ctx, batch.data);
        else drawFillBatch2D(ctx, batch.data);
      }
    },
    dispose: () => {}
  };
};

const createWebGPURenderer = async (canvas, buildBatches) => {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu) return null;
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return null;
  let device = null;
  let uniformBuffer = null;
  const batchBuffers = [];
  try {
    device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    if (!context) {
      device.destroy?.();
      return null;
    }
    const format = gpu.getPreferredCanvasFormat();
    const clearColor = resolvePoolRendererClearColor(canvas);
    context.configure({
      device,
      format,
      alphaMode: 'opaque'
    });

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'uniform' }
      }]
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
    uniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
    });

    const fillShader = device.createShaderModule({ code: `
    struct Uniforms {
      resolution: vec2<f32>,
      pad: vec2<f32>
    };
    @group(0) @binding(0) var<uniform> uniforms: Uniforms;
    struct VertexOut {
      @builtin(position) position: vec4<f32>,
      @location(0) color: vec4<f32>
    };
    @vertex
    fn vertexMain(@location(0) position: vec2<f32>, @location(1) color: vec4<f32>) -> VertexOut {
      var out: VertexOut;
      let zeroToOne = position / uniforms.resolution;
      let clip = zeroToOne * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0);
      out.position = vec4<f32>(clip, 0.0, 1.0);
      out.color = color;
      return out;
    }
    @fragment
    fn fragmentMain(@location(0) color: vec4<f32>) -> @location(0) vec4<f32> {
      return color;
    }
  ` });

    const circleShader = device.createShaderModule({ code: `
    struct Uniforms {
      resolution: vec2<f32>,
      pad: vec2<f32>
    };
    @group(0) @binding(0) var<uniform> uniforms: Uniforms;
    struct VertexOut {
      @builtin(position) position: vec4<f32>,
      @location(0) uv: vec2<f32>,
      @location(1) inner: f32,
      @location(2) color: vec4<f32>
    };
    @vertex
    fn vertexMain(
      @location(0) position: vec2<f32>,
      @location(1) uv: vec2<f32>,
      @location(2) inner: f32,
      @location(3) color: vec4<f32>
    ) -> VertexOut {
      var out: VertexOut;
      let zeroToOne = position / uniforms.resolution;
      let clip = zeroToOne * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0);
      out.position = vec4<f32>(clip, 0.0, 1.0);
      out.uv = uv;
      out.inner = inner;
      out.color = color;
      return out;
    }
    @fragment
    fn fragmentMain(@location(0) uv: vec2<f32>, @location(1) inner: f32, @location(2) color: vec4<f32>) -> @location(0) vec4<f32> {
      let distance = length(uv);
      if (distance > 1.0) {
        discard;
      }
      var alpha = color.a * (1.0 - smoothstep(0.82, 1.0, distance));
      if (inner > 0.0) {
        alpha = alpha * smoothstep(inner - 0.035, inner + 0.035, distance);
      }
      return vec4<f32>(color.rgb, alpha);
    }
  ` });

    const blend = {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
    };
    const fillPipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: fillShader,
        entryPoint: 'vertexMain',
        buffers: [{
          arrayStride: 24,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
            { shaderLocation: 1, offset: 8, format: 'float32x4' }
          ]
        }]
      },
      fragment: {
        module: fillShader,
        entryPoint: 'fragmentMain',
        targets: [{ format, blend }]
      },
      primitive: { topology: 'triangle-list' }
    });
    const circlePipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: circleShader,
        entryPoint: 'vertexMain',
        buffers: [{
          arrayStride: 36,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
            { shaderLocation: 1, offset: 8, format: 'float32x2' },
            { shaderLocation: 2, offset: 16, format: 'float32' },
            { shaderLocation: 3, offset: 20, format: 'float32x4' }
          ]
        }]
      },
      fragment: {
        module: circleShader,
        entryPoint: 'fragmentMain',
        targets: [{ format, blend }]
      },
      primitive: { topology: 'triangle-list' }
    });

    const uniformData = new Float32Array(4);
    const preparedBatches = [];
    const preparedBatchPool = [];
    const ensureBatchBuffer = (index, byteLength) => {
      const nextSize = Math.max(4, Math.ceil(byteLength / 4) * 4);
      const existing = batchBuffers[index];
      if (existing?.size >= nextSize) return existing.buffer;
      existing?.buffer.destroy();
      const buffer = device.createBuffer({
        size: nextSize,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      });
      batchBuffers[index] = { buffer, size: nextSize };
      return buffer;
    };

    return {
      backend: 'webgpu',
      canvas,
      render: (frame, width, height) => {
        const batches = buildBatches(frame, width, height);
        uniformData[0] = width;
        uniformData[1] = height;
        uniformData[2] = 0;
        uniformData[3] = 0;
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        preparedBatches.length = 0;
        for (let index = 0; index < batches.length; index += 1) {
          const batch = batches[index];
          const vertexCount = batch.kind === 'circle'
            ? batch.data.length / 9
            : batch.data.length / 6;
          if (vertexCount <= 0) continue;
          const buffer = ensureBatchBuffer(index, batch.data.byteLength);
          device.queue.writeBuffer(buffer, 0, batch.data.buffer, batch.data.byteOffset, batch.data.byteLength);
          const prepared = preparedBatchPool[preparedBatches.length] || {
            kind: batch.kind,
            buffer,
            vertexCount
          };
          prepared.kind = batch.kind;
          prepared.buffer = buffer;
          prepared.vertexCount = vertexCount;
          preparedBatches.push(prepared);
          preparedBatchPool[preparedBatches.length - 1] = prepared;
        }
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: clearColor,
            loadOp: 'clear',
            storeOp: 'store'
          }]
        });
        for (const batch of preparedBatches) {
          pass.setPipeline(batch.kind === 'circle' ? circlePipeline : fillPipeline);
          pass.setBindGroup(0, bindGroup);
          pass.setVertexBuffer(0, batch.buffer);
          pass.draw(batch.vertexCount);
        }
        pass.end();
        device.queue.submit([encoder.finish()]);
      },
      dispose: () => {
        uniformBuffer?.destroy();
        for (const entry of batchBuffers) entry?.buffer.destroy();
        device?.destroy?.();
      }
    };
  } catch (error) {
    uniformBuffer?.destroy();
    for (const entry of batchBuffers) entry?.buffer.destroy();
    device?.destroy?.();
    throw error;
  }
};

const createWebGLRenderer = (canvas, buildBatches) => {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false })
    || canvas.getContext('experimental-webgl', { antialias: true, alpha: false })
    || canvas.getContext('webgl', { antialias: true, alpha: true })
    || canvas.getContext('experimental-webgl', { antialias: true, alpha: true });
  if (!gl) return null;
  let fillProgram = null;
  let circleProgram = null;
  let fillBuffer = null;
  let circleBuffer = null;
  try {
    fillProgram = createProgram(gl, `
    attribute vec2 a_position;
    attribute vec4 a_color;
    uniform vec2 u_resolution;
    varying vec4 v_color;
    void main() {
      vec2 zeroToOne = a_position / u_resolution;
      vec2 clipSpace = zeroToOne * vec2(2.0, -2.0) + vec2(-1.0, 1.0);
      gl_Position = vec4(clipSpace, 0.0, 1.0);
      v_color = a_color;
    }
  `, `
    precision mediump float;
    varying vec4 v_color;
    void main() {
      gl_FragColor = v_color;
    }
  `);
    circleProgram = createProgram(gl, `
    attribute vec2 a_position;
    attribute vec2 a_uv;
    attribute float a_inner;
    attribute vec4 a_color;
    uniform vec2 u_resolution;
    varying vec2 v_uv;
    varying float v_inner;
    varying vec4 v_color;
    void main() {
      vec2 zeroToOne = a_position / u_resolution;
      vec2 clipSpace = zeroToOne * vec2(2.0, -2.0) + vec2(-1.0, 1.0);
      gl_Position = vec4(clipSpace, 0.0, 1.0);
      v_uv = a_uv;
      v_inner = a_inner;
      v_color = a_color;
    }
  `, `
    precision mediump float;
    varying vec2 v_uv;
    varying float v_inner;
    varying vec4 v_color;
    void main() {
      float dist = length(v_uv);
      if (dist > 1.0) discard;
      float alpha = v_color.a * (1.0 - smoothstep(0.82, 1.0, dist));
      if (v_inner > 0.0) {
        alpha *= smoothstep(v_inner - 0.035, v_inner + 0.035, dist);
      }
      gl_FragColor = vec4(v_color.rgb, alpha);
    }
  `);
    fillBuffer = gl.createBuffer();
    circleBuffer = gl.createBuffer();
    const fillLocations = {
      position: gl.getAttribLocation(fillProgram, 'a_position'),
      color: gl.getAttribLocation(fillProgram, 'a_color'),
      resolution: gl.getUniformLocation(fillProgram, 'u_resolution')
    };
    const circleLocations = {
      position: gl.getAttribLocation(circleProgram, 'a_position'),
      uv: gl.getAttribLocation(circleProgram, 'a_uv'),
      inner: gl.getAttribLocation(circleProgram, 'a_inner'),
      color: gl.getAttribLocation(circleProgram, 'a_color'),
      resolution: gl.getUniformLocation(circleProgram, 'u_resolution')
    };
    let fillBufferSize = 0;
    let circleBufferSize = 0;
    gl.enable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const clearColor = resolvePoolRendererClearColor(canvas);

    const uploadDynamicData = (data, currentSize, setSize) => {
      const nextSize = Math.max(4, Math.ceil(data.byteLength / 4) * 4);
      if (currentSize < nextSize) {
        const reservedSize = Math.ceil(nextSize * 1.35 / 4) * 4;
        gl.bufferData(gl.ARRAY_BUFFER, reservedSize, gl.DYNAMIC_DRAW);
        setSize(reservedSize);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    };

    const drawFillBatch = (data, width, height) => {
      gl.useProgram(fillProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, fillBuffer);
      uploadDynamicData(data, fillBufferSize, (size) => { fillBufferSize = size; });
      gl.enableVertexAttribArray(fillLocations.position);
      gl.vertexAttribPointer(fillLocations.position, 2, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(fillLocations.color);
      gl.vertexAttribPointer(fillLocations.color, 4, gl.FLOAT, false, 24, 8);
      gl.uniform2f(fillLocations.resolution, width, height);
      gl.drawArrays(gl.TRIANGLES, 0, data.length / 6);
    };

    const drawCircleBatch = (data, width, height) => {
      gl.useProgram(circleProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, circleBuffer);
      uploadDynamicData(data, circleBufferSize, (size) => { circleBufferSize = size; });
      gl.enableVertexAttribArray(circleLocations.position);
      gl.vertexAttribPointer(circleLocations.position, 2, gl.FLOAT, false, 36, 0);
      gl.enableVertexAttribArray(circleLocations.uv);
      gl.vertexAttribPointer(circleLocations.uv, 2, gl.FLOAT, false, 36, 8);
      gl.enableVertexAttribArray(circleLocations.inner);
      gl.vertexAttribPointer(circleLocations.inner, 1, gl.FLOAT, false, 36, 16);
      gl.enableVertexAttribArray(circleLocations.color);
      gl.vertexAttribPointer(circleLocations.color, 4, gl.FLOAT, false, 36, 20);
      gl.uniform2f(circleLocations.resolution, width, height);
      gl.drawArrays(gl.TRIANGLES, 0, data.length / 9);
    };

    return {
      backend: 'webgl',
      canvas,
      render: (frame, width, height) => {
        gl.viewport(0, 0, width, height);
        gl.clearColor(clearColor.r, clearColor.g, clearColor.b, clearColor.a);
        gl.clear(gl.COLOR_BUFFER_BIT);
        for (const batch of buildBatches(frame, width, height)) {
          if (batch.kind === 'circle') drawCircleBatch(batch.data, width, height);
          else drawFillBatch(batch.data, width, height);
        }
      },
      dispose: () => {
        gl.deleteBuffer(fillBuffer);
        gl.deleteBuffer(circleBuffer);
        gl.deleteProgram(fillProgram);
        gl.deleteProgram(circleProgram);
      }
    };
  } catch (error) {
    if (fillBuffer) gl.deleteBuffer(fillBuffer);
    if (circleBuffer) gl.deleteBuffer(circleBuffer);
    if (fillProgram) gl.deleteProgram(fillProgram);
    if (circleProgram) gl.deleteProgram(circleProgram);
    throw error;
  }
};

export const createPoolSimulationRenderer = async (initialCanvas, { buildBatches }) => {
  let canvas = initialCanvas;
  try {
    const renderer = await createWebGPURenderer(canvas, buildBatches);
    if (renderer) return renderer;
  } catch (error) {
    console.warn('Reploid graph WebGPU renderer failed; falling back to WebGL.', error);
    canvas = cloneCanvasForFallback(canvas);
  }
  try {
    const renderer = createWebGLRenderer(canvas, buildBatches);
    if (renderer) return renderer;
  } catch (error) {
    console.warn('Reploid graph WebGL renderer failed; falling back to Canvas 2D.', error);
    canvas = cloneCanvasForFallback(canvas);
  }
  const renderer = createCanvas2DRenderer(canvas, buildBatches);
  if (renderer) return renderer;
  throw new Error('No supported Reploid graph renderer is available.');
};
