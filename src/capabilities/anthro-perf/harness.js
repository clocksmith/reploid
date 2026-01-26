import {
  SLOT_LIMITS,
  VLEN,
  N_CORES,
  SCRATCH_SIZE,
  Machine,
  Tree,
  Input,
  HASH_STAGES,
  build_mem_image,
  reference_kernel2,
} from "./simulator.js";

let defaultKernelName = "optimized";
if (typeof process !== "undefined" && process?.env?.PERF_KERNEL) {
  defaultKernelName = process.env.PERF_KERNEL;
} else if (typeof globalThis !== "undefined" && globalThis.PERF_KERNEL) {
  defaultKernelName = globalThis.PERF_KERNEL;
}

const kernelBuilders = new Map();

export function registerKernel(name, fn) {
  if (kernelBuilders.has(name)) {
    throw new Error(`Kernel '${name}' is already registered.`);
  }
  kernelBuilders.set(name, fn);
  return fn;
}

export function availableKernels() {
  return Array.from(kernelBuilders.keys()).sort();
}

function requireKnownKernel(name) {
  if (!kernelBuilders.has(name)) {
    throw new Error(
      `Unknown kernel '${name}'. Register it first. Available: ${availableKernels().join(", ")}`,
    );
  }
}

export function setDefaultKernel(name) {
  requireKnownKernel(name);
  defaultKernelName = name;
}

export function getDefaultKernelName() {
  return defaultKernelName;
}

export class KernelBuilder {
  constructor(kernelName = null) {
    this.instrs = [];
    this.scratch = {};
    this.scratchDebug = {};
    this.scratchPtr = 0;
    this.constMap = new Map();
    this.kernelName = kernelName || defaultKernelName;
    requireKnownKernel(this.kernelName);
  }

  debugInfo() {
    return { scratch_map: this.scratchDebug };
  }

  debug_info() {
    return this.debugInfo();
  }

  build(slots, vliw = false) {
    const instrs = [];
    for (const [engine, slot] of slots) {
      instrs.push({ [engine]: [slot] });
    }
    return instrs;
  }

  add(engine, slot) {
    this.instrs.push({ [engine]: [slot] });
  }

  allocScratch(name = null, length = 1) {
    const addr = this.scratchPtr;
    if (name !== null) {
      this.scratch[name] = addr;
      this.scratchDebug[addr] = [name, length];
    }
    this.scratchPtr += length;
    if (this.scratchPtr > SCRATCH_SIZE) {
      throw new Error("Out of scratch space");
    }
    return addr;
  }

  scratchConst(val, name = null) {
    if (!this.constMap.has(val)) {
      const addr = this.allocScratch(name);
      this.add("load", ["const", addr, val]);
      this.constMap.set(val, addr);
    }
    return this.constMap.get(val);
  }

  buildHash(valHashAddr, tmp1, tmp2, round, i) {
    const slots = [];
    for (let hi = 0; hi < HASH_STAGES.length; hi += 1) {
      const [op1, val1, op2, op3, val3] = HASH_STAGES[hi];
      slots.push(["alu", [op1, tmp1, valHashAddr, this.scratchConst(val1)]]);
      slots.push(["alu", [op3, tmp2, valHashAddr, this.scratchConst(val3)]]);
      slots.push(["alu", [op2, valHashAddr, tmp1, tmp2]]);
      slots.push(["debug", ["compare", valHashAddr, [round, i, "hash_stage", hi]]]);
    }
    return slots;
  }

  build_hash(...args) {
    return this.buildHash(...args);
  }

  buildKernel(forestHeight, nNodes, batchSize, rounds) {
    const builder = kernelBuilders.get(this.kernelName);
    if (!builder) {
      throw new Error(`Kernel '${this.kernelName}' is not registered.`);
    }
    return builder(this, forestHeight, nNodes, batchSize, rounds);
  }

  build_kernel(...args) {
    return this.buildKernel(...args);
  }
}


export const BASELINE = 147734;

function trySeedRandom(seed) {
  if (typeof globalThis?.seedRandom === "function") {
    globalThis.seedRandom(seed);
    return;
  }
  if (typeof globalThis?.setRandomSeed === "function") {
    globalThis.setRandomSeed(seed);
    return;
  }
  if (typeof globalThis?.Math?.seedrandom === "function") {
    globalThis.Math.seedrandom(String(seed));
  }
}

function createMachine(mem, instrs, debugInfo, trace, valueTrace) {
  try {
    return new Machine(mem, instrs, debugInfo, N_CORES, SCRATCH_SIZE, trace, valueTrace);
  } catch (err) {
    return new Machine(mem, instrs, debugInfo, {
      n_cores: N_CORES,
      scratch_size: SCRATCH_SIZE,
      trace,
      value_trace: valueTrace,
    });
  }
}

function assertArrayEqual(actual, expected, message) {
  if (actual.length !== expected.length) {
    throw new Error(message);
  }
  for (let i = 0; i < actual.length; i += 1) {
    if (actual[i] !== expected[i]) {
      throw new Error(message);
    }
  }
}

export function doKernelTest(
  forestHeight,
  rounds,
  batchSize,
  { seed = 123, trace = false, prints = false, kernel = null } = {},
) {
  console.log(
    `forest_height=${forestHeight}, rounds=${rounds}, batch_size=${batchSize}`,
  );
  trySeedRandom(seed);
  const forest = Tree.generate(forestHeight);
  const inp = Input.generate(forest, batchSize, rounds);
  const mem = build_mem_image(forest, inp);

  const kb = new KernelBuilder(kernel);
  kb.buildKernel(forest.height, forest.values.length, inp.indices.length, rounds);

  const valueTrace = {};
  const machine = createMachine(mem, kb.instrs, kb.debugInfo(), trace, valueTrace);
  machine.prints = prints;

  let roundI = 0;
  for (const refMem of reference_kernel2(mem, valueTrace)) {
    machine.run();
    const inpValuesP = refMem[6];
    const expectedValues = refMem.slice(inpValuesP, inpValuesP + inp.values.length);
    const actualValues = machine.mem.slice(
      inpValuesP,
      inpValuesP + inp.values.length,
    );
    assertArrayEqual(
      actualValues,
      expectedValues,
      `Incorrect result on round ${roundI}`,
    );
    if (prints) {
      console.log(actualValues);
      console.log(expectedValues);
    }
    const inpIndicesP = refMem[5];
    if (prints) {
      console.log(
        machine.mem.slice(inpIndicesP, inpIndicesP + inp.indices.length),
      );
      console.log(refMem.slice(inpIndicesP, inpIndicesP + inp.indices.length));
    }
    roundI += 1;
  }

  console.log("CYCLES:", machine.cycle);
  console.log("Speedup over baseline:", BASELINE / machine.cycle);
  return machine.cycle;
}

export function do_kernel_test(...args) {
  return doKernelTest(...args);
}
