/*
Read the top of perf_takehome.py for more introduction.

This file is separate mostly for ease of copying it to freeze the machine and
reference kernel for testing.
*/

const UINT32_MASK = 0xffffffff;
const toUint32 = (value) => value >>> 0;

const add32 = (a, b) => (a + b) >>> 0;
const sub32 = (a, b) => (a - b) >>> 0;
const mul32 = (a, b) => Math.imul(a, b) >>> 0;
const div32 = (a, b) => Math.floor(a / b) >>> 0;
const mod32 = (a, b) => (a % b) >>> 0;
const shl32 = (a, b) => (a << b) >>> 0;
const shr32 = (a, b) => (a >>> b) >>> 0;

const traceKey = (key) => {
  if (Array.isArray(key)) {
    return JSON.stringify(key);
  }
  return String(key);
};

const setTraceValue = (trace, key, value) => {
  if (!trace) {
    return;
  }
  const k = traceKey(key);
  if (trace instanceof Map) {
    trace.set(k, value);
  } else {
    trace[k] = value;
  }
};

const getTraceValue = (trace, key) => {
  const k = traceKey(key);
  if (trace instanceof Map) {
    return trace.get(k);
  }
  return trace ? trace[k] : undefined;
};

export const SLOT_LIMITS = {
  alu: 12,
  valu: 6,
  load: 2,
  store: 2,
  flow: 1,
  debug: 64,
};

export const VLEN = 8;
export const N_CORES = 1;
export const SCRATCH_SIZE = 1536;
export const BASE_ADDR_TID = 100000;

export const CoreState = Object.freeze({
  RUNNING: 1,
  PAUSED: 2,
  STOPPED: 3,
});

export class Core {
  constructor(id, scratchSize) {
    this.id = id;
    this.scratch = new Array(scratchSize).fill(0);
    this.trace_buf = [];
    this.pc = 0;
    this.state = CoreState.RUNNING;
  }
}

export class DebugInfo {
  constructor(scratchMap = {}) {
    this.scratch_map = scratchMap;
  }
}

export const cdiv = (a, b) => Math.floor((a + b - 1) / b);

export class Machine {
  constructor(
    mem_dump,
    program,
    debug_info,
    n_cores = 1,
    scratch_size = SCRATCH_SIZE,
    trace = false,
    value_trace = {},
  ) {
    if (n_cores && typeof n_cores === "object") {
      const opts = n_cores;
      n_cores = opts.n_cores ?? 1;
      scratch_size = opts.scratch_size ?? SCRATCH_SIZE;
      trace = opts.trace ?? false;
      value_trace = opts.value_trace ?? {};
    }

    this.cores = Array.from({ length: n_cores }, (_, i) => new Core(i, scratch_size));
    this.mem = mem_dump.slice();
    this.program = program;
    this.debug_info = debug_info || new DebugInfo();
    if (!this.debug_info.scratch_map) {
      this.debug_info.scratch_map = {};
    }
    this.value_trace = value_trace;
    this.prints = false;
    this.cycle = 0;
    this.enable_pause = true;
    this.enable_debug = true;
    if (trace) {
      this.setup_trace();
    } else {
      this.trace = null;
    }
  }

  rewrite_instr(instr) {
    const res = {};
    for (const [name, slots] of Object.entries(instr)) {
      res[name] = slots.map((slot) => this.rewrite_slot(slot));
    }
    return res;
  }

  print_step(instr, core) {
    console.log(this.scratch_map(core));
    console.log(core.pc, instr, this.rewrite_instr(instr));
  }

  scratch_map(core) {
    const res = {};
    for (const [addrStr, entry] of Object.entries(this.debug_info.scratch_map)) {
      const addr = Number(addrStr);
      const [name, length] = entry;
      res[name] = core.scratch.slice(addr, addr + length);
    }
    return res;
  }

  rewrite_slot(slot) {
    return slot.map((s) => {
      if (Object.prototype.hasOwnProperty.call(this.debug_info.scratch_map, s)) {
        const name = this.debug_info.scratch_map[s]?.[0];
        return name || s;
      }
      return s;
    });
  }

  setup_trace() {
    this.trace_buf = [];
    this.trace = {
      write: (text) => this.trace_buf.push(text),
      close: () => {},
    };
    this.trace.write("[");
    let tidCounter = 0;
    this.tids = {};
    for (let ci = 0; ci < this.cores.length; ci += 1) {
      this.trace.write(
        `{"name": "process_name", "ph": "M", "pid": ${ci}, "tid": 0, "args": {"name":"Core ${ci}"}},\n`,
      );
      for (const [name, limit] of Object.entries(SLOT_LIMITS)) {
        if (name === "debug") {
          continue;
        }
        for (let i = 0; i < limit; i += 1) {
          tidCounter += 1;
          this.trace.write(
            `{"name": "thread_name", "ph": "M", "pid": ${ci}, "tid": ${tidCounter}, "args": {"name":"${name}-${i}"}},\n`,
          );
          this.tids[`${ci}:${name}:${i}`] = tidCounter;
        }
      }
    }

    for (let ci = 0; ci < this.cores.length; ci += 1) {
      for (const [name, limit] of Object.entries(SLOT_LIMITS)) {
        if (name === "debug") {
          continue;
        }
        for (let i = 0; i < limit; i += 1) {
          const tid = this.tids[`${ci}:${name}:${i}`];
          this.trace.write(
            `{"name": "init", "cat": "op", "ph": "X", "pid": ${ci}, "tid": ${tid}, "ts": 0, "dur": 0},\n`,
          );
        }
      }
    }
    for (let ci = 0; ci < this.cores.length; ci += 1) {
      this.trace.write(
        `{"name": "process_name", "ph": "M", "pid": ${this.cores.length + ci}, "tid": 0, "args": {"name":"Core ${ci} Scratch"}},\n`,
      );
      for (const [addrStr, entry] of Object.entries(this.debug_info.scratch_map)) {
        const addr = Number(addrStr);
        const [name, length] = entry;
        this.trace.write(
          `{"name": "thread_name", "ph": "M", "pid": ${this.cores.length + ci}, "tid": ${BASE_ADDR_TID + addr}, "args": {"name":"${name}-${length}"}},\n`,
        );
      }
    }
  }

  close_trace() {
    if (this.trace) {
      this.trace.write("]");
      this.trace.close();
    }
  }

  trace_json() {
    if (!this.trace_buf) {
      return "";
    }
    if (this.trace_buf[this.trace_buf.length - 1] !== "]") {
      return this.trace_buf.join("") + "]";
    }
    return this.trace_buf.join("");
  }

  run() {
    for (const core of this.cores) {
      if (core.state === CoreState.PAUSED) {
        core.state = CoreState.RUNNING;
      }
    }
    while (this.cores.some((c) => c.state === CoreState.RUNNING)) {
      let hasNonDebug = false;
      for (const core of this.cores) {
        if (core.state !== CoreState.RUNNING) {
          continue;
        }
        if (core.pc >= this.program.length) {
          core.state = CoreState.STOPPED;
          continue;
        }
        const instr = this.program[core.pc];
        if (this.prints) {
          this.print_step(instr, core);
        }
        core.pc += 1;
        this.step(instr, core);
        if (Object.keys(instr).some((name) => name !== "debug")) {
          hasNonDebug = true;
        }
      }
      if (hasNonDebug) {
        this.cycle += 1;
      }
    }
  }

  alu(core, op, dest, a1, a2) {
    const v1 = core.scratch[a1];
    const v2 = core.scratch[a2];
    let res;
    switch (op) {
      case "+":
        res = add32(v1, v2);
        break;
      case "-":
        res = sub32(v1, v2);
        break;
      case "*":
        res = mul32(v1, v2);
        break;
      case "//":
        res = div32(v1, v2);
        break;
      case "cdiv":
        res = toUint32(cdiv(v1, v2));
        break;
      case "^":
        res = toUint32(v1 ^ v2);
        break;
      case "&":
        res = toUint32(v1 & v2);
        break;
      case "|":
        res = toUint32(v1 | v2);
        break;
      case "<<":
        res = shl32(v1, v2);
        break;
      case ">>":
        res = shr32(v1, v2);
        break;
      case "%":
        res = mod32(v1, v2);
        break;
      case "<":
        res = v1 < v2 ? 1 : 0;
        break;
      case "==":
        res = v1 === v2 ? 1 : 0;
        break;
      default:
        throw new Error(`Unknown alu op ${op}`);
    }
    this.scratch_write.set(dest, toUint32(res));
  }

  valu(core, ...slot) {
    const op = slot[0];
    if (op === "vbroadcast") {
      const dest = slot[1];
      const src = slot[2];
      for (let i = 0; i < VLEN; i += 1) {
        this.scratch_write.set(dest + i, core.scratch[src]);
      }
      return;
    }
    if (op === "multiply_add") {
      const dest = slot[1];
      const a = slot[2];
      const b = slot[3];
      const c = slot[4];
      for (let i = 0; i < VLEN; i += 1) {
        const mul = mul32(core.scratch[a + i], core.scratch[b + i]);
        this.scratch_write.set(dest + i, add32(mul, core.scratch[c + i]));
      }
      return;
    }
    if (slot.length === 4) {
      const dest = slot[1];
      const a1 = slot[2];
      const a2 = slot[3];
      for (let i = 0; i < VLEN; i += 1) {
        this.alu(core, op, dest + i, a1 + i, a2 + i);
      }
      return;
    }
    throw new Error(`Unknown valu op ${slot}`);
  }

  load(core, ...slot) {
    const op = slot[0];
    if (op === "load") {
      const dest = slot[1];
      const addr = slot[2];
      this.scratch_write.set(dest, this.mem[core.scratch[addr]]);
      return;
    }
    if (op === "load_offset") {
      const dest = slot[1];
      const addr = slot[2];
      const offset = slot[3];
      this.scratch_write.set(dest + offset, this.mem[core.scratch[addr + offset]]);
      return;
    }
    if (op === "vload") {
      const dest = slot[1];
      const addr = core.scratch[slot[2]];
      for (let i = 0; i < VLEN; i += 1) {
        this.scratch_write.set(dest + i, this.mem[addr + i]);
      }
      return;
    }
    if (op === "const") {
      const dest = slot[1];
      const val = slot[2];
      this.scratch_write.set(dest, toUint32(val));
      return;
    }
    throw new Error(`Unknown load op ${slot}`);
  }

  store(core, ...slot) {
    const op = slot[0];
    if (op === "store") {
      const addr = core.scratch[slot[1]];
      const src = slot[2];
      this.mem_write.set(addr, core.scratch[src]);
      return;
    }
    if (op === "vstore") {
      const addr = core.scratch[slot[1]];
      const src = slot[2];
      for (let i = 0; i < VLEN; i += 1) {
        this.mem_write.set(addr + i, core.scratch[src + i]);
      }
      return;
    }
    throw new Error(`Unknown store op ${slot}`);
  }

  flow(core, ...slot) {
    const op = slot[0];
    if (op === "select") {
      const dest = slot[1];
      const cond = slot[2];
      const a = slot[3];
      const b = slot[4];
      this.scratch_write.set(dest, core.scratch[cond] !== 0 ? core.scratch[a] : core.scratch[b]);
      return;
    }
    if (op === "add_imm") {
      const dest = slot[1];
      const a = slot[2];
      const imm = slot[3];
      this.scratch_write.set(dest, add32(core.scratch[a], imm));
      return;
    }
    if (op === "vselect") {
      const dest = slot[1];
      const cond = slot[2];
      const a = slot[3];
      const b = slot[4];
      for (let i = 0; i < VLEN; i += 1) {
        this.scratch_write.set(
          dest + i,
          core.scratch[cond + i] !== 0 ? core.scratch[a + i] : core.scratch[b + i],
        );
      }
      return;
    }
    if (op === "halt") {
      core.state = CoreState.STOPPED;
      return;
    }
    if (op === "pause") {
      if (this.enable_pause) {
        core.state = CoreState.PAUSED;
      }
      return;
    }
    if (op === "trace_write") {
      const val = slot[1];
      core.trace_buf.push(core.scratch[val]);
      return;
    }
    if (op === "cond_jump") {
      const cond = slot[1];
      const addr = slot[2];
      if (core.scratch[cond] !== 0) {
        core.pc = addr;
      }
      return;
    }
    if (op === "cond_jump_rel") {
      const cond = slot[1];
      const offset = slot[2];
      if (core.scratch[cond] !== 0) {
        core.pc += offset;
      }
      return;
    }
    if (op === "jump") {
      const addr = slot[1];
      core.pc = addr;
      return;
    }
    if (op === "jump_indirect") {
      const addr = slot[1];
      core.pc = core.scratch[addr];
      return;
    }
    if (op === "coreid") {
      const dest = slot[1];
      this.scratch_write.set(dest, core.id);
      return;
    }
    throw new Error(`Unknown flow op ${slot}`);
  }

  trace_post_step(instr, core) {
    for (const [addrStr, entry] of Object.entries(this.debug_info.scratch_map)) {
      const addr = Number(addrStr);
      const [name, length] = entry;
      let touched = false;
      for (let vi = 0; vi < length; vi += 1) {
        if (this.scratch_write.has(addr + vi)) {
          touched = true;
          break;
        }
      }
      if (touched) {
        const val = core.scratch.slice(addr, addr + length).join(", ");
        this.trace.write(
          `{"name": "${val}", "cat": "op", "ph": "X", "pid": ${this.cores.length + core.id}, "tid": ${BASE_ADDR_TID + addr}, "ts": ${this.cycle}, "dur": 1 },\n`,
        );
      }
    }
  }

  trace_slot(core, slot, name, i) {
    const slotText = JSON.stringify(slot);
    const named = JSON.stringify(this.rewrite_slot(slot));
    const tid = this.tids[`${core.id}:${name}:${i}`];
    this.trace.write(
      `{"name": "${slot[0]}", "cat": "op", "ph": "X", "pid": ${core.id}, "tid": ${tid}, "ts": ${this.cycle}, "dur": 1, "args":{"slot": "${slotText}", "named": "${named}" } },\n`,
    );
  }

  step(instr, core) {
    const engineFns = {
      alu: this.alu.bind(this),
      valu: this.valu.bind(this),
      load: this.load.bind(this),
      store: this.store.bind(this),
      flow: this.flow.bind(this),
    };
    this.scratch_write = new Map();
    this.mem_write = new Map();

    for (const [name, slots] of Object.entries(instr)) {
      if (name === "debug") {
        if (!this.enable_debug) {
          continue;
        }
        for (const slot of slots) {
          if (slot[0] === "compare") {
            const loc = slot[1];
            const key = slot[2];
            const ref = getTraceValue(this.value_trace, key);
            const res = core.scratch[loc];
            if (res !== ref) {
              throw new Error(`${res} != ${ref} for ${traceKey(key)} at pc=${core.pc}`);
            }
          } else if (slot[0] === "vcompare") {
            const loc = slot[1];
            const keys = slot[2];
            const ref = keys.map((k) => getTraceValue(this.value_trace, k));
            const res = core.scratch.slice(loc, loc + VLEN);
            const matches = res.length === ref.length && res.every((v, i) => v === ref[i]);
            if (!matches) {
              throw new Error(
                `${res} != ${ref} for ${traceKey(keys)} at pc=${core.pc} loc=${loc}`,
              );
            }
          }
        }
        continue;
      }
      if (slots.length > SLOT_LIMITS[name]) {
        throw new Error(`Too many slots for ${name}`);
      }
      for (let i = 0; i < slots.length; i += 1) {
        const slot = slots[i];
        if (this.trace) {
          this.trace_slot(core, slot, name, i);
        }
        engineFns[name](core, ...slot);
      }
    }

    for (const [addr, val] of this.scratch_write.entries()) {
      core.scratch[addr] = val;
    }
    for (const [addr, val] of this.mem_write.entries()) {
      this.mem[addr] = val;
    }

    if (this.trace) {
      this.trace_post_step(instr, core);
    }

    this.scratch_write = null;
    this.mem_write = null;
  }
}

const randInt = (maxInclusive) => Math.floor(Math.random() * (maxInclusive + 1));

export class Tree {
  constructor(height, values) {
    this.height = height;
    this.values = values;
  }

  static generate(height) {
    const nNodes = 2 ** (height + 1) - 1;
    const values = Array.from({ length: nNodes }, () => randInt(2 ** 30 - 1));
    return new Tree(height, values);
  }
}

export class Input {
  constructor(indices, values, rounds) {
    this.indices = indices;
    this.values = values;
    this.rounds = rounds;
  }

  static generate(forest, batch_size, rounds) {
    const indices = Array.from({ length: batch_size }, () => 0);
    const values = Array.from({ length: batch_size }, () => randInt(2 ** 30 - 1));
    return new Input(indices, values, rounds);
  }
}

export const HASH_STAGES = [
  ["+", 0x7ed55d16, "+", "<<", 12],
  ["^", 0xc761c23c, "^", ">>", 19],
  ["+", 0x165667b1, "+", "<<", 5],
  ["+", 0xd3a2646c, "^", "<<", 9],
  ["+", 0xfd7046c5, "+", "<<", 3],
  ["^", 0xb55a4f09, "^", ">>", 16],
];

const opFns = {
  "+": (x, y) => add32(x, y),
  "^": (x, y) => toUint32(x ^ y),
  "<<": (x, y) => shl32(x, y),
  ">>": (x, y) => shr32(x, y),
};

export function myhash(a) {
  let acc = toUint32(a);
  for (const [op1, val1, op2, op3, val3] of HASH_STAGES) {
    const a1 = opFns[op1](acc, val1);
    const a3 = opFns[op3](acc, val3);
    acc = opFns[op2](a1, a3);
    acc = toUint32(acc);
  }
  return acc;
}

export function reference_kernel(t, inp) {
  for (let h = 0; h < inp.rounds; h += 1) {
    for (let i = 0; i < inp.indices.length; i += 1) {
      let idx = inp.indices[i];
      let val = inp.values[i];
      val = myhash(val ^ t.values[idx]);
      idx = 2 * idx + (val % 2 === 0 ? 1 : 2);
      idx = idx >= t.values.length ? 0 : idx;
      inp.values[i] = val;
      inp.indices[i] = idx;
    }
  }
}

export function build_mem_image(t, inp) {
  const header = 7;
  const extra_room = t.values.length + inp.indices.length * 2 + VLEN * 2 + 32;
  const mem = new Array(
    header + t.values.length + inp.indices.length + inp.values.length + extra_room,
  ).fill(0);
  const forest_values_p = header;
  const inp_indices_p = forest_values_p + t.values.length;
  const inp_values_p = inp_indices_p + inp.values.length;
  const extra_room_p = inp_values_p + inp.values.length;

  mem[0] = inp.rounds;
  mem[1] = t.values.length;
  mem[2] = inp.indices.length;
  mem[3] = t.height;
  mem[4] = forest_values_p;
  mem[5] = inp_indices_p;
  mem[6] = inp_values_p;
  mem[7] = extra_room_p;

  for (let i = 0; i < t.values.length; i += 1) {
    mem[header + i] = t.values[i];
  }
  for (let i = 0; i < inp.indices.length; i += 1) {
    mem[inp_indices_p + i] = inp.indices[i];
  }
  for (let i = 0; i < inp.values.length; i += 1) {
    mem[inp_values_p + i] = inp.values[i];
  }
  return mem;
}

export function myhash_traced(a, trace, round, batch_i) {
  let acc = toUint32(a);
  for (let i = 0; i < HASH_STAGES.length; i += 1) {
    const [op1, val1, op2, op3, val3] = HASH_STAGES[i];
    const a1 = opFns[op1](acc, val1);
    const a3 = opFns[op3](acc, val3);
    acc = opFns[op2](a1, a3);
    acc = toUint32(acc);
    setTraceValue(trace, [round, batch_i, "hash_stage", i], acc);
  }
  return acc;
}

export function* reference_kernel2(mem, trace = {}) {
  const rounds = mem[0];
  const n_nodes = mem[1];
  const batch_size = mem[2];
  const forest_values_p = mem[4];
  const inp_indices_p = mem[5];
  const inp_values_p = mem[6];
  yield mem;
  for (let h = 0; h < rounds; h += 1) {
    for (let i = 0; i < batch_size; i += 1) {
      let idx = mem[inp_indices_p + i];
      setTraceValue(trace, [h, i, "idx"], idx);
      let val = mem[inp_values_p + i];
      setTraceValue(trace, [h, i, "val"], val);
      const node_val = mem[forest_values_p + idx];
      setTraceValue(trace, [h, i, "node_val"], node_val);
      val = myhash_traced(val ^ node_val, trace, h, i);
      setTraceValue(trace, [h, i, "hashed_val"], val);
      idx = 2 * idx + (val % 2 === 0 ? 1 : 2);
      setTraceValue(trace, [h, i, "next_idx"], idx);
      idx = idx >= n_nodes ? 0 : idx;
      setTraceValue(trace, [h, i, "wrapped_idx"], idx);
      mem[inp_values_p + i] = val;
      mem[inp_indices_p + i] = idx;
    }
  }
  yield mem;
}

export const referenceKernel = reference_kernel;
export const buildMemImage = build_mem_image;
export const myhashTraced = myhash_traced;
export const referenceKernel2 = reference_kernel2;
