// Physical adapter for Pooled's existing flash_gold.mjs protocol. No model code is changed.
// Usage: node pooled-flash-physical.js config.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { createRoom, joinRoom } = await import(pathToFileURL(cfg.sdk));
const { greedy } = await import(pathToFileURL(path.join(cfg.source, 'room/sampling.js')));
const { judgeGolden } = await import(pathToFileURL(path.join(cfg.source, 'tests/q38flash_rule.js')));
const gold = JSON.parse(fs.readFileSync(path.join(cfg.source, 'tests/golden/q38flash_llama_greedy.json'), 'utf8'));
const out = { started: new Date().toISOString(), config: cfg, pid: process.pid,
  host: os.hostname(), node: process.version, platform: process.platform, totalMemory: os.totalmem(), cases: [] };
let room;
let peakRss = 0;
let closing = false;
const log = message => console.error(new Date().toISOString(), message);
const write = () => fs.writeFileSync(cfg.out, JSON.stringify(out, null, 2));
function snapshot() {
  const memory = process.memoryUsage();
  peakRss = Math.max(peakRss, memory.rss);
  let io = null, availableMemory = null;
  if (process.platform === 'linux') {
    io = Object.fromEntries(fs.readFileSync('/proc/self/io', 'utf8').trim().split('\n')
      .map(line => { const [k, v] = line.split(':'); return [k, Number(v.trim())]; }));
    availableMemory = Number(fs.readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)/m)?.[1]) * 1024;
  }
  const e = room?.ai?.engine?.experts;
  const powerMicrowatts = Object.fromEntries((cfg.powerPaths || []).map(p => {
    try { return [p, Number(fs.readFileSync(p, 'utf8').trim())]; } catch { return [p, null]; }
  }));
  return { at: new Date().toISOString(), memory, peakRss, freeMemory: os.freemem(), availableMemory, io, powerMicrowatts,
    expert: e ? { stats: { ...e.stats }, diskReader: { ...e.reader?.stats },
      ramCache: { ...e.t1?.stats }, parkedBytes: e.parkedBytes, diskLayers: [...e.diskSet] } : null };
}
async function network() {
  const reports = [];
  const seen = new Set();
  for (const conns of Object.values(room?.peer?.connections || {})) {
    for (const conn of conns) {
      try {
        if (seen.has(conn.peerConnection)) continue;
        seen.add(conn.peerConnection);
        const stats = await conn.peerConnection?.getStats();
        if (stats) reports.push([...stats.values()].filter(x =>
          ['transport', 'candidate-pair', 'data-channel'].includes(x.type)));
      } catch (e) { reports.push({ unavailable: String(e.message) }); }
    }
  }
  return reports;
}
out.telemetry = [];
const monitor = setInterval(() => {
  const s = snapshot();
  out.telemetry.push(s);
  if (cfg.minAvailableGiB && s.availableMemory !== null && s.availableMemory < cfg.minAvailableGiB * 2 ** 30) {
    out.error = `Memory guard: ${s.availableMemory} available bytes, below ${cfg.minAvailableGiB} GiB`;
    log(out.error);
    close('memory guard');
  }
}, 1000);
monitor.unref();
async function close(reason) {
  if (closing) return;
  closing = true;
  clearInterval(monitor);
  out.finished = new Date().toISOString();
  out.finishReason = reason;
  out.final = snapshot();
  write();
  try { await room?.close(); } catch (e) { log(`close: ${e.message}`); }
  setTimeout(() => process.exit(out.error ? 1 : 0), 500);
}
process.on('SIGTERM', () => close('SIGTERM'));
process.on('SIGINT', () => close('SIGINT'));
try {
  const options = { name: cfg.name, pledgeGB: cfg.gpuGB, ramGB: cfg.ramGB || 0,
    expertDisk: !!cfg.disk, signal: cfg.signal, modelDir: cfg.models, ctx: cfg.ctx,
    autoRedeal: false, ckpt: false, allowApi: false, relay: false, split: 'memory', log };
  out.before = snapshot();
  if (cfg.mode === 'worker') {
    const invite = JSON.parse(fs.readFileSync(cfg.invite, 'utf8'));
    room = await joinRoom(invite.code, { ...options, key: invite.key });
    out.meta = room.meta;
    write();
    log('worker joined; waiting for host load');
    await new Promise(() => {});
  }
  room = await createRoom({ ...options, model: 'qwen3.8-flash', gate: true });
  if (cfg.invite) fs.writeFileSync(cfg.invite, JSON.stringify({ code: room.code,
    key: room.inviteFragment.replace(/^#k=/, '') }), { mode: 0o600 });
  const loadStart = performance.now();
  await room.start('qwen3.8-flash', { minDevices: cfg.mode === 'pair' ? 2 : 1, waitMs: 600000 });
  out.loadS = (performance.now() - loadStart) / 1000;
  out.meta = room.meta;
  out.split = room.split;
  out.flash = room.ai.roomFlash;
  out.loaded = snapshot();
  if (cfg.coldFiles?.length) {
    // Only this experiment's newly provisioned files; never drop global caches.
    execFileSync('python3', ['-c',
      'import os,sys\nfor p in sys.argv[1:]:\n f=os.open(p,os.O_RDONLY)\n try:\n  os.fsync(f)\n  os.posix_fadvise(f,0,0,os.POSIX_FADV_DONTNEED)\n finally: os.close(f)',
      ...cfg.coldFiles], { stdio: 'pipe' });
    out.fileCacheAdvice = { at: new Date().toISOString(), operation: 'POSIX_FADV_DONTNEED', files: cfg.coldFiles };
  }
  write();
  log(`loaded in ${out.loadS.toFixed(2)}s: ${JSON.stringify(out.split)}`);
  const reference = cfg.reference ? JSON.parse(fs.readFileSync(cfg.reference, 'utf8')) : null;
  for (const spec of cfg.cases) {
    const g = gold[spec.name];
    if (!g || g.prompt.length + g.ids.length > cfg.ctx) throw new Error(`invalid case ${spec.name}`);
    room.ai.fed = null;
    room.ckptClear(true);
    const before = snapshot();
    const netBefore = await network();
    const gaps = [];
    const emissions = [];
    const t0 = performance.now();
    const sample = logits => {
      let first = -Infinity, second = -Infinity;
      for (const v of logits) {
        if (v > first) { second = first; first = v; } else if (v > second) second = v;
      }
      gaps.push(first - second);
      return greedy(logits);
    };
    const r = await room.locked(() => room.generate(g.prompt, { maxNew: g.ids.length,
      sample, stop: new Set(), onToken: () => emissions.push(performance.now() - t0) }));
    const wallS = (performance.now() - t0) / 1000;
    const ids = Array.from(r.tokens);
    if (gaps.length !== ids.length) throw new Error('sampling/output counts differ');
    const judgement = judgeGolden(g, ids, gaps, g.ids.length);
    const exact = ids.length === g.ids.length && ids.every((id, i) => id === g.ids[i]);
    const ref = reference?.cases.find(c => c.name === spec.name && !c.warmup);
    const result = { ...spec, promptTokens: g.prompt.length, outputTokens: ids.length,
      wallS, ttftS: emissions.length ? emissions[0] / 1000 : null,
      prefillS: r.tPre / 1000, prefillTps: g.prompt.length / (r.tPre / 1000),
      decodeS: r.tDecode / 1000, decodeTps: r.tps, reused: r.reused,
      ids, text: room.ai.tok.decode(ids), judgement, exact,
      referenceExact: ref ? ids.length === ref.ids.length && ids.every((id, i) => id === ref.ids[i]) : null,
      before, after: snapshot(), netBefore, netAfter: await network() };
    out.cases.push(result);
    write();
    log(`${spec.name}${spec.warmup ? ' warmup' : ''}: ${exact ? 'MATCH' : judgement.excused ? 'TIE' : 'MISMATCH'}, ${wallS.toFixed(2)}s, ${r.tps.toFixed(2)} decode tok/s`);
  }
  await close('completed');
} catch (e) {
  out.error = String(e.stack || e);
  log(out.error);
  await close('error');
}
