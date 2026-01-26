import { registerKernel } from "./harness.js";
import { SLOT_LIMITS, VLEN } from "./simulator.js";

const CHUNK_VECS = 22;

export function buildKernelSuby(kb, forestHeight, nNodes, batchSize, rounds) {
  if (forestHeight !== 10 || nNodes !== 2047 || batchSize !== 256 || rounds !== 16) {
    throw new Error("Suby kernel expects the submission sizes");
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

  const c_one = kb.scratchConst(1, "c_one");
  const c_two = kb.scratchConst(2, "c_two");
  const c_four = kb.scratchConst(4, "c_four");
  const c_forest_base_minus1 = kb.scratchConst(6, "c_forest_base_minus1");

  const c_madd0_mul = kb.scratchConst(4097, "c_madd0_mul");
  const c_madd0_add = kb.scratchConst(0x7ed55d16, "c_madd0_add");
  const c_madd2_mul = kb.scratchConst(33, "c_madd2_mul");
  const c_madd2_add = kb.scratchConst(0x165667b1, "c_madd2_add");
  const c_madd4_mul = kb.scratchConst(9, "c_madd4_mul");
  const c_madd4_add = kb.scratchConst(0xfd7046c5, "c_madd4_add");

  const c_xor1 = kb.scratchConst(0xc761c23c, "c_xor1");
  const c_add3 = kb.scratchConst(0xd3a2646c, "c_add3");
  const c_xor5 = kb.scratchConst(0xb55a4f09, "c_xor5");
  const c_shift19 = kb.scratchConst(19, "c_shift19");
  const c_shift9 = kb.scratchConst(9, "c_shift9");
  const c_shift16 = kb.scratchConst(16, "c_shift16");

  const broadcasts = [];
  const vecConst = (name, scalarAddr) => {
    const base = allocVec(name);
    broadcasts.push([base, scalarAddr]);
    return base;
  };

  const v_one = vecConst("v_one", c_one);
  const v_two = vecConst("v_two", c_two);
  const v_four = vecConst("v_four", c_four);
  const v_forest_base_minus1 = vecConst("v_forest_base_minus1", c_forest_base_minus1);

  const v_madd0_mul = vecConst("v_madd0_mul", c_madd0_mul);
  const v_madd0_add = vecConst("v_madd0_add", c_madd0_add);
  const v_madd2_mul = vecConst("v_madd2_mul", c_madd2_mul);
  const v_madd2_add = vecConst("v_madd2_add", c_madd2_add);
  const v_madd4_mul = vecConst("v_madd4_mul", c_madd4_mul);
  const v_madd4_add = vecConst("v_madd4_add", c_madd4_add);

  const v_xor1 = vecConst("v_xor1", c_xor1);
  const v_add3 = vecConst("v_add3", c_add3);
  const v_xor5 = vecConst("v_xor5", c_xor5);
  const v_shift19 = vecConst("v_shift19", c_shift19);
  const v_shift9 = vecConst("v_shift9", c_shift9);
  const v_shift16 = vecConst("v_shift16", c_shift16);

  for (let i = 0; i < broadcasts.length; i += SLOT_LIMITS.valu) {
    const slots = [];
    for (const [base, src] of broadcasts.slice(i, i + SLOT_LIMITS.valu)) {
      slots.push(["vbroadcast", base, src]);
    }
    kb.instrs.push({ valu: slots });
  }

  const preloadedNodes = [];
  for (let i = 0; i < 15; i += 1) {
    const addr = kb.scratchConst(7 + i, `node_${i}_addr`);
    const valScalar = kb.allocScratch(`node_${i}_val`);
    kb.instrs.push({ load: [["load", valScalar, addr]] });
    const valVec = allocVec(`v_node_${i}`);
    kb.instrs.push({ valu: [["vbroadcast", valVec, valScalar]] });
    preloadedNodes.push(valVec);
  }

  const totalVecs = batchSize / VLEN;
  const chunkVecs = Math.min(CHUNK_VECS, totalVecs);

  const valVecs = Array.from({ length: chunkVecs }, (_, i) => allocVec(`val_${i}`));
  const idxVecs = Array.from({ length: chunkVecs }, (_, i) => allocVec(`idx_${i}`));
  const addrVecs = Array.from({ length: chunkVecs }, (_, i) => allocVec(`addr_${i}`));
  const nodeVecs = Array.from({ length: chunkVecs }, (_, i) => allocVec(`node_${i}`));
  const tmpVecs = Array.from({ length: chunkVecs }, (_, i) => allocVec(`tmp_${i}`));

  const inpValuesP = 7 + nNodes + batchSize;
  const valAddrConsts = Array.from({ length: totalVecs }, (_, i) =>
    kb.scratchConst(inpValuesP + i * VLEN),
  );

  const spillBase = 7 + nNodes + batchSize * 2;
  const spillAddrConsts = Array.from({ length: chunkVecs }, (_, i) =>
    kb.scratchConst(spillBase + i * VLEN, `spill_${i}_addr`),
  );

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

  const addFlowVselect = (ops, dest, cond, a, b) => {
    ops.push([
      "flow",
      ["vselect", dest, cond, a, b],
      vecAddrs(cond).concat(vecAddrs(a), vecAddrs(b)),
      vecAddrs(dest),
    ]);
  };

  const addValuBroadcast = (ops, dest, src) => {
    ops.push(["valu", ["vbroadcast", dest, src], [src], vecAddrs(dest)]);
  };

  const addVload = (ops, destVec, addrConst) => {
    ops.push(["load", ["vload", destVec, addrConst], [addrConst], vecAddrs(destVec)]);
  };

  const addVstore = (ops, addrConst, srcVec) => {
    ops.push(["store", ["vstore", addrConst, srcVec], vecAddrs(srcVec), [addrConst]]);
  };

  const addStoreSpill = (ops, spillAddr, srcVec) => {
    ops.push([
      "store",
      ["vstore", spillAddr, srcVec],
      vecAddrs(srcVec).concat([spillAddr]),
      [spillAddr],
    ]);
  };

  const addLoadSpill = (ops, destVec, spillAddr) => {
    ops.push(["load", ["vload", destVec, spillAddr], [spillAddr], vecAddrs(destVec)]);
  };

  const buildRoundSelect1 = (ops, dest, idx, tmp) => {
    addValuBin(ops, "&", tmp, idx, v_one);
    addFlowVselect(ops, dest, tmp, preloadedNodes[2], preloadedNodes[1]);
  };

  const buildRoundSelect2 = (ops, dest, idx, tmp, addr) => {
    addValuBin(ops, "&", addr, idx, v_one);
    addFlowVselect(ops, dest, addr, preloadedNodes[4], preloadedNodes[3]);
    addFlowVselect(ops, addr, addr, preloadedNodes[6], preloadedNodes[5]);
    addValuBin(ops, "&", tmp, idx, v_two);
    addFlowVselect(ops, dest, tmp, addr, dest);
  };

  const buildRoundSelect3 = (ops, dest, idx, tmp, addr, val, spillAddr) => {
    addStoreSpill(ops, spillAddr, val);

    addValuBin(ops, "&", tmp, idx, v_one);
    addFlowVselect(ops, dest, tmp, preloadedNodes[8], preloadedNodes[7]);
    addFlowVselect(ops, addr, tmp, preloadedNodes[10], preloadedNodes[9]);
    addValuBin(ops, "&", val, idx, v_two);
    addFlowVselect(ops, dest, val, addr, dest);

    addValuBin(ops, "&", addr, idx, v_one);
    addFlowVselect(ops, val, addr, preloadedNodes[12], preloadedNodes[11]);
    addFlowVselect(ops, addr, addr, preloadedNodes[14], preloadedNodes[13]);
    addValuBin(ops, "&", tmp, idx, v_two);
    addFlowVselect(ops, addr, tmp, addr, val);

    addValuBin(ops, "&", val, idx, v_four);
    addFlowVselect(ops, dest, val, addr, dest);

    addLoadSpill(ops, val, spillAddr);
  };

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
      const slots = { load: [], valu: [], flow: [], store: [] };
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

      if (!Object.values(slots).some((ops) => ops.length)) {
        cycle += 1;
        continue;
      }

      writesInBundle.forEach((addr) => readyCycle.set(addr, cycle + 1));

      const bundle = {};
      for (const [engine, ops] of Object.entries(slots)) {
        if (ops.length) {
          bundle[engine] = ops;
        }
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

  const allConsts = [
    v_one,
    v_two,
    v_four,
    v_forest_base_minus1,
    v_madd0_mul,
    v_madd0_add,
    v_madd2_mul,
    v_madd2_add,
    v_madd4_mul,
    v_madd4_add,
    v_xor1,
    v_add3,
    v_xor5,
    v_shift19,
    v_shift9,
    v_shift16,
  ].concat(preloadedNodes);
  for (const base of allConsts) {
    addVec(base);
  }
  readyAddrs.add(c_one);
  valAddrConsts.forEach((addr) => readyAddrs.add(addr));
  spillAddrConsts.forEach((addr) => readyAddrs.add(addr));

  for (let chunkStart = 0; chunkStart < totalVecs; chunkStart += chunkVecs) {
    const chunkLen = Math.min(chunkVecs, totalVecs - chunkStart);
    const opsByVec = Array.from({ length: chunkLen }, () => []);

    for (let i = 0; i < chunkLen; i += 1) {
      const globalV = chunkStart + i;
      const ops = opsByVec[i];
      addVload(ops, valVecs[i], valAddrConsts[globalV]);
      addValuBroadcast(ops, idxVecs[i], c_one);
    }

    for (let roundI = 0; roundI < rounds; roundI += 1) {
      for (let i = 0; i < chunkLen; i += 1) {
        const ops = opsByVec[i];
        const val = valVecs[i];
        const idx = idxVecs[i];
        const addr = addrVecs[i];
        const node = nodeVecs[i];
        const tmp = tmpVecs[i];
        const spillAddr = spillAddrConsts[i];
        const tmp2 = node;

        if (roundI === 0 || roundI === 11) {
          addValuBin(ops, "|", node, preloadedNodes[0], preloadedNodes[0]);
        } else if (roundI === 1 || roundI === 12) {
          buildRoundSelect1(ops, node, idx, tmp);
        } else if (roundI === 2 || roundI === 13) {
          buildRoundSelect2(ops, node, idx, tmp, addr);
        } else if (roundI === 3 || roundI === 14) {
          buildRoundSelect3(ops, node, idx, tmp, addr, val, spillAddr);
        } else {
          addValuBin(ops, "+", addr, idx, v_forest_base_minus1);
          for (let off = 0; off < VLEN; off += 1) {
            addLoadOffset(ops, node, addr, off);
          }
        }

        addValuBin(ops, "^", val, val, node);
        addValuMadd(ops, val, val, v_madd0_mul, v_madd0_add);

        addValuBin(ops, ">>", tmp, val, v_shift19);
        addValuBin(ops, "^", tmp2, val, v_xor1);
        addValuBin(ops, "^", val, tmp2, tmp);

        addValuMadd(ops, val, val, v_madd2_mul, v_madd2_add);

        addValuBin(ops, "+", tmp2, val, v_add3);
        addValuBin(ops, "<<", tmp, val, v_shift9);
        addValuBin(ops, "^", val, tmp2, tmp);

        addValuMadd(ops, val, val, v_madd4_mul, v_madd4_add);

        addValuBin(ops, ">>", tmp, val, v_shift16);
        addValuBin(ops, "^", tmp2, val, v_xor5);
        addValuBin(ops, "^", val, tmp2, tmp);

        if (roundI === 10) {
          addValuBroadcast(ops, idx, c_one);
        } else {
          addValuBin(ops, "&", tmp, val, v_one);
          addValuMadd(ops, idx, idx, v_two, tmp);
        }
      }
    }

    for (let i = 0; i < chunkLen; i += 1) {
      const globalV = chunkStart + i;
      addVstore(opsByVec[i], valAddrConsts[globalV], valVecs[i]);
    }

    kb.instrs.push(...scheduleOps(opsByVec, readyAddrs));
  }

  kb.instrs.push({ flow: [["pause"]] });

  return kb.instrs;
}

registerKernel("suby", buildKernelSuby);
