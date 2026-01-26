import { registerKernel } from "./harness.js";
import { SLOT_LIMITS, VLEN } from "./simulator.js";

export function buildKernelOptimized(kb, forestHeight, nNodes, batchSize, rounds) {
  if (forestHeight !== 10 || nNodes !== 2047 || batchSize !== 256 || rounds !== 16) {
    throw new Error("Optimized kernel expects the submission sizes");
  }

  kb.add("flow", ["pause"]);

  const allocVec = (name = null) => kb.allocScratch(name, VLEN);
  const vecAddrs = (base) => {
    const res = new Array(VLEN);
    for (let i = 0; i < VLEN; i += 1) {
      res[i] = base + i;
    }
    return res;
  };

  const c_zero = kb.scratchConst(0, "c_zero");
  const c_one = kb.scratchConst(1, "c_one");
  const c_forest_base = kb.scratchConst(7, "c_forest_base");
  const c_forest_base_minus1 = kb.scratchConst(6, "c_forest_base_minus1");
  const c_mul0 = kb.scratchConst(4097, "c_mul0");
  const c_mul2 = kb.scratchConst(33, "c_mul2");
  const c_mul4 = kb.scratchConst(9, "c_mul4");
  const c_add0 = kb.scratchConst(0x7ed55d16, "c_add0");
  const c_xor1 = kb.scratchConst(0xc761c23c, "c_xor1");
  const c_add2 = kb.scratchConst(0x165667b1, "c_add2");
  const c_add3 = kb.scratchConst(0xd3a2646c, "c_add3");
  const c_add4 = kb.scratchConst(0xfd7046c5, "c_add4");
  const c_xor5 = kb.scratchConst(0xb55a4f09, "c_xor5");
  const c_shift19 = kb.scratchConst(19, "c_shift19");
  const c_shift9 = kb.scratchConst(9, "c_shift9");
  const c_shift16 = kb.scratchConst(16, "c_shift16");
  const c_two = kb.scratchConst(2, "c_two");

  const broadcasts = [];
  const vecConst = (name, scalarAddr) => {
    const base = allocVec(name);
    broadcasts.push([base, scalarAddr]);
    return base;
  };

  const v_one = vecConst("v_one", c_one);
  const v_forest_base_minus1 = vecConst("v_forest_base_minus1", c_forest_base_minus1);
  const v_mul0 = vecConst("v_mul0", c_mul0);
  const v_mul2 = vecConst("v_mul2", c_mul2);
  const v_mul4 = vecConst("v_mul4", c_mul4);
  const v_add0 = vecConst("v_add0", c_add0);
  const v_xor1 = vecConst("v_xor1", c_xor1);
  const v_add2 = vecConst("v_add2", c_add2);
  const v_add3 = vecConst("v_add3", c_add3);
  const v_add4 = vecConst("v_add4", c_add4);
  const v_xor5 = vecConst("v_xor5", c_xor5);
  const v_shift19 = vecConst("v_shift19", c_shift19);
  const v_shift9 = vecConst("v_shift9", c_shift9);
  const v_shift16 = vecConst("v_shift16", c_shift16);
  const v_two = vecConst("v_two", c_two);

  for (let i = 0; i < broadcasts.length; i += SLOT_LIMITS.valu) {
    const slots = [];
    for (const [base, src] of broadcasts.slice(i, i + SLOT_LIMITS.valu)) {
      slots.push(["vbroadcast", base, src]);
    }
    kb.instrs.push({ valu: slots });
  }

  const root_val = kb.allocScratch("root_val");
  kb.instrs.push({ load: [["load", root_val, c_forest_base]] });
  const v_root = allocVec("v_root");
  kb.instrs.push({ valu: [["vbroadcast", v_root, root_val]] });

  const node1_val = kb.allocScratch("node1_val");
  const node2_val = kb.allocScratch("node2_val");
  const node1_addr = kb.scratchConst(8, "node1_addr");
  const node2_addr = kb.scratchConst(9, "node2_addr");
  kb.instrs.push({
    load: [
      ["load", node1_val, node1_addr],
      ["load", node2_val, node2_addr],
    ],
  });
  const v_node1 = allocVec("v_node1");
  const v_node2 = allocVec("v_node2");
  kb.instrs.push({
    valu: [
      ["vbroadcast", v_node1, node1_val],
      ["vbroadcast", v_node2, node2_val],
    ],
  });

  const node3_val = kb.allocScratch("node3_val");
  const node4_val = kb.allocScratch("node4_val");
  const node5_val = kb.allocScratch("node5_val");
  const node6_val = kb.allocScratch("node6_val");
  const node3_addr = kb.scratchConst(10, "node3_addr");
  const node4_addr = kb.scratchConst(11, "node4_addr");
  const node5_addr = kb.scratchConst(12, "node5_addr");
  const node6_addr = kb.scratchConst(13, "node6_addr");
  kb.instrs.push({
    load: [
      ["load", node3_val, node3_addr],
      ["load", node4_val, node4_addr],
    ],
  });
  kb.instrs.push({
    load: [
      ["load", node5_val, node5_addr],
      ["load", node6_val, node6_addr],
    ],
  });
  const v_node3 = allocVec("v_node3");
  const v_node4 = allocVec("v_node4");
  const v_node5 = allocVec("v_node5");
  const v_node6 = allocVec("v_node6");
  kb.instrs.push({
    valu: [
      ["vbroadcast", v_node3, node3_val],
      ["vbroadcast", v_node4, node4_val],
    ],
  });
  kb.instrs.push({
    valu: [
      ["vbroadcast", v_node5, node5_val],
      ["vbroadcast", v_node6, node6_val],
    ],
  });

  const nVecs = batchSize / VLEN;
  const valVecs = Array.from({ length: nVecs }, () => allocVec());
  const idxVecs = Array.from({ length: nVecs }, () => allocVec());
  const addrVecs = Array.from({ length: nVecs }, () => allocVec());
  const nodeVecs = Array.from({ length: nVecs }, () => allocVec());
  const tmpVecs = Array.from({ length: nVecs }, () => allocVec());

  const inpValuesP = 7 + nNodes + batchSize;
  const valAddrConsts = Array.from({ length: nVecs }, (_, i) =>
    kb.scratchConst(inpValuesP + i * VLEN),
  );

  for (let i = 0; i < nVecs; i += SLOT_LIMITS.load) {
    const slots = [];
    for (let j = i; j < Math.min(i + SLOT_LIMITS.load, nVecs); j += 1) {
      slots.push(["vload", valVecs[j], valAddrConsts[j]]);
    }
    kb.instrs.push({ load: slots });
  }

  for (let i = 0; i < nVecs; i += SLOT_LIMITS.valu) {
    const slots = [];
    for (let j = i; j < Math.min(i + SLOT_LIMITS.valu, nVecs); j += 1) {
      slots.push(["vbroadcast", idxVecs[j], c_one]);
    }
    kb.instrs.push({ valu: slots });
  }

  const scheduleOps = (opsByVec, readyAddrs) => {
    const READY_FAR = 1_000_000;
    const readyCycle = new Map();
    for (const addr of readyAddrs) {
      readyCycle.set(addr, 0);
    }
    const indices = new Array(opsByVec.length).fill(0);
    let remaining = opsByVec.reduce((sum, ops) => sum + ops.length, 0);
    const bundles = [];
    let cycle = 0;
    while (remaining) {
      const slots = { load: [], valu: [], flow: [] };
      const readsInBundle = new Set();
      const writesInBundle = new Set();
      let scheduledAny = true;
      while (scheduledAny) {
        scheduledAny = false;
        for (let vecI = 0; vecI < opsByVec.length; vecI += 1) {
          const ops = opsByVec[vecI];
          const opI = indices[vecI];
          if (opI >= ops.length) {
            continue;
          }
          const [engine, slot, reads, writes] = ops[opI];
          if (slots[engine].length >= SLOT_LIMITS[engine]) {
            continue;
          }
          if (
            reads.some(
              (addr) => (readyCycle.has(addr) ? readyCycle.get(addr) : READY_FAR) > cycle,
            )
          ) {
            continue;
          }
          if (reads.some((addr) => writesInBundle.has(addr))) {
            continue;
          }
          if (writes.some((addr) => writesInBundle.has(addr) || readsInBundle.has(addr))) {
            continue;
          }
          slots[engine].push(slot);
          reads.forEach((addr) => readsInBundle.add(addr));
          writes.forEach((addr) => writesInBundle.add(addr));
          indices[vecI] += 1;
          remaining -= 1;
          scheduledAny = true;
        }
      }
      if (!slots.load.length && !slots.valu.length && !slots.flow.length) {
        cycle += 1;
        continue;
      }
      writesInBundle.forEach((addr) => readyCycle.set(addr, cycle + 1));
      const bundle = {};
      if (slots.load.length) {
        bundle.load = slots.load;
      }
      if (slots.valu.length) {
        bundle.valu = slots.valu;
      }
      if (slots.flow.length) {
        bundle.flow = slots.flow;
      }
      bundles.push(bundle);
      cycle += 1;
    }
    return bundles;
  };

  const readyAddrs = new Set();
  const addVec = (base) => {
    for (let i = 0; i < VLEN; i += 1) {
      readyAddrs.add(base + i);
    }
  };
  for (const base of valVecs.concat(idxVecs)) {
    addVec(base);
  }
  for (const base of [
    v_one,
    v_forest_base_minus1,
    v_mul0,
    v_mul2,
    v_mul4,
    v_add0,
    v_xor1,
    v_add2,
    v_add3,
    v_add4,
    v_xor5,
    v_shift19,
    v_shift9,
    v_shift16,
    v_two,
    v_root,
    v_node1,
    v_node2,
    v_node3,
    v_node4,
    v_node5,
    v_node6,
  ]) {
    addVec(base);
  }
  readyAddrs.add(c_one);

  const addValuBin = (ops, opcode, dest, a1, a2) => {
    ops.push([
      "valu",
      [opcode, dest, a1, a2],
      vecAddrs(a1).concat(vecAddrs(a2)),
      vecAddrs(dest),
    ]);
  };

  const addValuMadd = (ops, dest, a1, a2, a3) => {
    ops.push([
      "valu",
      ["multiply_add", dest, a1, a2, a3],
      vecAddrs(a1).concat(vecAddrs(a2), vecAddrs(a3)),
      vecAddrs(dest),
    ]);
  };

  const addLoadOffset = (ops, dest, addr, offset) => {
    ops.push(["load", ["load_offset", dest, addr, offset], [addr + offset], [dest + offset]]);
  };

  const addValuBroadcast = (ops, dest, src) => {
    ops.push(["valu", ["vbroadcast", dest, src], [src], vecAddrs(dest)]);
  };

  const addFlowVselect = (ops, dest, cond, a, b) => {
    ops.push([
      "flow",
      ["vselect", dest, cond, a, b],
      vecAddrs(cond).concat(vecAddrs(a), vecAddrs(b)),
      vecAddrs(dest),
    ]);
  };

  const roundLayerIndex = (roundI) => (roundI > 10 ? roundI - 11 : roundI);

  const emitLayerOps = (roundI, state, ops) => {
    const layer = roundLayerIndex(roundI);
    if (layer === 0) {
      addValuBin(ops, "^", state.val, state.val, v_root);
      return;
    }
    if (layer === 1) {
      addValuBin(ops, "&", state.tmp, state.idxp, v_one);
      addFlowVselect(ops, state.node, state.tmp, v_node2, v_node1);
      addValuBin(ops, "^", state.val, state.val, state.node);
      return;
    }
    if (layer === 2) {
      addValuBin(ops, "&", state.tmp, state.idxp, v_one);
      addValuBin(ops, "&", state.addr, state.idxp, v_two);
      addFlowVselect(ops, state.node, state.tmp, v_node4, v_node3);
      addFlowVselect(ops, state.tmp, state.tmp, v_node6, v_node5);
      addFlowVselect(ops, state.node, state.addr, state.tmp, state.node);
      addValuBin(ops, "^", state.val, state.val, state.node);
      return;
    }
    addValuBin(ops, "+", state.addr, state.idxp, v_forest_base_minus1);
    for (let off = 0; off < VLEN; off += 1) {
      addLoadOffset(ops, state.node, state.addr, off);
    }
    addValuBin(ops, "^", state.val, state.val, state.node);
  };

  const emitHashOps = (state, ops) => {
    addValuMadd(ops, state.val, state.val, v_mul0, v_add0);

    addValuBin(ops, ">>", state.tmp, state.val, v_shift19);
    addValuBin(ops, "^", state.val, state.val, state.tmp);
    addValuBin(ops, "^", state.val, state.val, v_xor1);

    addValuMadd(ops, state.val, state.val, v_mul2, v_add2);

    addValuBin(ops, "<<", state.tmp, state.val, v_shift9);
    addValuBin(ops, "+", state.val, state.val, v_add3);
    addValuBin(ops, "^", state.val, state.val, state.tmp);

    addValuMadd(ops, state.val, state.val, v_mul4, v_add4);

    addValuBin(ops, ">>", state.tmp, state.val, v_shift16);
    addValuBin(ops, "^", state.val, state.val, state.tmp);
    addValuBin(ops, "^", state.val, state.val, v_xor5);
  };

  const emitIndexUpdate = (roundI, updateIdx, state, ops) => {
    if (roundI === 10) {
      addValuBroadcast(ops, state.idxp, c_one);
      return;
    }
    if (updateIdx) {
      addValuBin(ops, "&", state.tmp, state.val, v_one);
      addValuMadd(ops, state.idxp, state.idxp, v_two, state.tmp);
    }
  };

  const emitRound = (roundI, updateIdx, state, ops) => {
    emitLayerOps(roundI, state, ops);
    emitHashOps(state, ops);
    emitIndexUpdate(roundI, updateIdx, state, ops);
  };

  const opsByVec = Array.from({ length: nVecs }, () => []);
  const states = valVecs.map((val, i) => ({
    val,
    idxp: idxVecs[i],
    addr: addrVecs[i],
    node: nodeVecs[i],
    tmp: tmpVecs[i],
  }));

  for (let roundI = 0; roundI < rounds; roundI += 1) {
    const updateIdx = roundI !== rounds - 1;
    for (let v = 0; v < states.length; v += 1) {
      emitRound(roundI, updateIdx, states[v], opsByVec[v]);
    }
  }

  kb.instrs.push(...scheduleOps(opsByVec, readyAddrs));

  for (let i = 0; i < nVecs; i += SLOT_LIMITS.store) {
    const slots = [];
    for (let j = i; j < Math.min(i + SLOT_LIMITS.store, nVecs); j += 1) {
      slots.push(["vstore", valAddrConsts[j], valVecs[j]]);
    }
    kb.instrs.push({ store: slots });
  }

  kb.instrs.push({ flow: [["pause"]] });

  return kb.instrs;
}

registerKernel("optimized", buildKernelOptimized);
