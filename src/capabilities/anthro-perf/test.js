import {
  Machine,
  build_mem_image,
  reference_kernel2,
  Tree,
  Input,
  N_CORES,
} from "./simulator.js";
import { KernelBuilder } from "./harness.js";
import "./kernel-optimized.js";
import "./kernel-suby.js";

export const BASELINE = 147734;

const kernelCache = new Map();
let cachedCycles = null;

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const arraysEqual = (a, b) => {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
};

export const kernel_builder = (forestHeight, nNodes, batchSize, rounds) => {
  const key = `${forestHeight}:${nNodes}:${batchSize}:${rounds}`;
  if (!kernelCache.has(key)) {
    const kb = new KernelBuilder();
    if (typeof kb.build_kernel === "function") {
      kb.build_kernel(forestHeight, nNodes, batchSize, rounds);
    } else {
      kb.buildKernel(forestHeight, nNodes, batchSize, rounds);
    }
    kernelCache.set(key, kb);
  }
  return kernelCache.get(key);
};

export const do_kernel_test = (forestHeight, rounds, batchSize) => {
  console.log(
    `Testing forest_height=${forestHeight}, rounds=${rounds}, batch_size=${batchSize}`,
  );
  const forest = Tree.generate(forestHeight);
  const inp = Input.generate(forest, batchSize, rounds);
  const mem = build_mem_image(forest, inp);

  const kb = kernel_builder(forest.height, forest.values.length, inp.indices.length, rounds);
  const debugInfo =
    typeof kb.debug_info === "function" ? kb.debug_info() : kb.debugInfo();
  const machine = new Machine(mem, kb.instrs, debugInfo, N_CORES);
  machine.enable_pause = false;
  machine.enable_debug = false;
  machine.run();

  let refMem = null;
  for (const nextMem of reference_kernel2(mem)) {
    refMem = nextMem;
  }
  if (!refMem) {
    throw new Error("reference_kernel2 returned no memory");
  }

  const inpValuesP = refMem[6];
  const expectedValues = refMem.slice(inpValuesP, inpValuesP + inp.values.length);
  const actualValues = machine.mem.slice(inpValuesP, inpValuesP + inp.values.length);
  assert(arraysEqual(actualValues, expectedValues), "Incorrect output values");

  console.log("CYCLES: ", machine.cycle);
  return machine.cycle;
};

export const cycles = () => {
  if (cachedCycles !== null) {
    return cachedCycles;
  }
  try {
    const res = do_kernel_test(10, 16, 256);
    console.log("Speedup over baseline: ", BASELINE / res);
    cachedCycles = res;
    return res;
  } catch (err) {
    cachedCycles = BASELINE * 2;
    return cachedCycles;
  }
};

export const test_kernel_correctness = () => {
  for (let i = 0; i < 8; i += 1) {
    do_kernel_test(10, 16, 256);
  }
};

export const test_kernel_speedup = () => {
  assert(cycles() < BASELINE, "Did not beat baseline");
};

export const test_kernel_updated_starting_point = () => {
  assert(cycles() < 18532, "Did not beat updated starting point");
};

export const test_opus4_many_hours = () => {
  assert(cycles() < 2164, "Did not beat Opus 4 many-hours threshold");
};

export const test_opus45_casual = () => {
  assert(cycles() < 1790, "Did not beat Opus 4.5 casual threshold");
};

export const test_opus45_2hr = () => {
  assert(cycles() < 1579, "Did not beat Opus 4.5 2hr threshold");
};

export const test_sonnet45_many_hours = () => {
  assert(cycles() < 1548, "Did not beat Sonnet 4.5 many-hours threshold");
};

export const test_opus45_11hr = () => {
  assert(cycles() < 1487, "Did not beat Opus 4.5 11hr threshold");
};

export const test_opus45_improved_harness = () => {
  assert(cycles() < 1363, "Did not beat Opus 4.5 improved harness threshold");
};

export const run_speed_tests = () => {
  test_kernel_speedup();
  test_kernel_updated_starting_point();
  test_opus4_many_hours();
  test_opus45_casual();
  test_opus45_2hr();
  test_sonnet45_many_hours();
  test_opus45_11hr();
  test_opus45_improved_harness();
};

export const run_all_tests = () => {
  test_kernel_correctness();
  run_speed_tests();
};

const shouldAutoRun = (() => {
  if (typeof globalThis === "undefined") {
    return false;
  }
  if (globalThis.RUN_TESTS === true) {
    return true;
  }
  if (globalThis.location && typeof globalThis.location.hash === "string") {
    return globalThis.location.hash === "#run-tests";
  }
  return false;
})();

if (shouldAutoRun) {
  try {
    run_all_tests();
  } catch (err) {
    console.error(err);
  }
}
