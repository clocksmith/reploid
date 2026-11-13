import { DopplerRuntimeService } from './doppler-runtime-service.js';
import { GENERATION_CONTRACT } from '../../shared/config/doppler-generation-contract.js';
import { cosineSimilarity } from '../capabilities/cognition/vector-math.js';

let nextScope = 0;

/** Host expert policy over one owned public Doppler session. No private pipelines. */
export async function createFunctionGemmaNetwork(source, { generation: defaults = {}, ...loadOptions } = {}, service = DopplerRuntimeService) {
  const scope = `functiongemma:${++nextScope}`;
  const session = await service.open({ scope, source, options: loadOptions });
  const experts = new Map();
  defaults = structuredClone(Object.fromEntries(Object.keys(GENERATION_CONTRACT.options)
    .filter(key => defaults[key] !== undefined).map(key => [key, defaults[key]])));
  let tail = Promise.resolve(), closing = null, closed = false;
  let activeAdapter = null, prefix = null, combiner = { type: 'weighted' };
  const advanced = () => session.advanced;
  const serialize = operation => {
    if (closed) return Promise.reject(new Error('FunctionGemma session is closed'));
    const task = tail.then(() => {
      if (closed) throw new Error('FunctionGemma session is closed');
      return operation();
    });
    tail = task.catch(() => {});
    return task;
  };
  const text = async result => {
    if (typeof result === 'string') return result;
    if (typeof result?.outputText === 'string') return result.outputText;
    if (typeof result?.content === 'string') return result.content;
    if (result?.[Symbol.asyncIterator]) {
      let output = '';
      for await (const chunk of result) {
        if (typeof chunk !== 'string') throw new Error('FunctionGemma generation requires text chunks');
        output += chunk;
      }
      return output;
    }
    throw new Error('FunctionGemma generation returned no text');
  };
  const executeExpert = (expertId, prompt, options = {}) => {
    const expert = experts.get(expertId);
    options = { ...options, generation: { ...options.generation } };
    return serialize(async () => {
      options.signal?.throwIfAborted();
      if (!expert) throw new Error(`Unknown expert: ${expertId}`);
      const adapter = expert.adapterName ? expert : null;
      if (adapter !== activeAdapter) {
        if (adapter) await session.loadLoRA(expert.adapterSource);
        else await session.unloadLoRA();
        activeAdapter = adapter;
      }
      options.signal?.throwIfAborted();
      // topK selects experts in the host; sampling topK belongs to generation.
      const overrides = Object.fromEntries(Object.entries(options).filter(([key, value]) => key !== 'topK' && value !== undefined));
      const configured = { ...defaults, ...overrides, ...options.generation };
      const generation = Object.fromEntries(Object.keys(GENERATION_CONTRACT.options)
        .filter(key => configured[key] !== undefined).map(key => [key, configured[key]]));
      if (options.signal) generation.signal = options.signal;
      if (prefix) return text(await advanced().generateWithPrefixKV(prefix, prompt, generation));
      return text(await session.generate(prompt, generation));
    });
  };
  return {
    registerExpert(expert) {
      if (!expert?.id) throw new Error('FunctionGemma expert requires an id');
      if (expert.adapterName && !expert.adapterSource) throw new Error(`Expert ${expert.id} requires adapterSource`);
      experts.set(expert.id, structuredClone(expert));
    },
    listExperts: () => [...experts.values()],
    selectExpertsByEmbedding: (embedding, count) => [...experts.values()].filter(expert => expert.embedding)
      .map(expert => ({ expert, score: cosineSimilarity(embedding, expert.embedding) }))
      .sort((a, b) => b.score - a.score).slice(0, count).map(row => row.expert),
    setCombiner(config) {
      if (!['weighted', 'voting'].includes(config?.type)) throw new Error('Unknown FunctionGemma combiner');
      combiner = { ...config };
    },
    requireSharedPrefix() {
      if (typeof advanced()?.generateWithPrefixKV !== 'function') throw new Error('Loaded Doppler session does not support shared KV prefix generation');
    },
    setSharedPrefixSnapshot(snapshot) {
      if (snapshot && typeof advanced()?.generateWithPrefixKV !== 'function') {
        throw new Error('Loaded Doppler session does not support shared KV prefix generation');
      }
      prefix = snapshot;
    },
    executeExpert,
    async executeRing(ids, prompt, options) {
      const outputs = [];
      for (const id of ids) { prompt = await executeExpert(id, prompt, options); outputs.push(prompt); }
      return outputs;
    },
    async executeParallel(tasks, options) {
      // One session owns adapter state; requests settle before another adapter activates.
      return Object.fromEntries(await Promise.all(tasks.map(async task =>
        [task.id, await executeExpert(task.expertId, task.prompt, options)])));
    },
    async combineOutputs(outputs) {
      if (!outputs.length) return '';
      if (combiner.type === 'voting') {
        const counts = new Map();
        for (const output of outputs) counts.set(output, (counts.get(output) || 0) + 1);
        return [...counts].sort((a, b) => b[1] - a[1])[0][0];
      }
      const weights = combiner.weights || outputs.map(() => 1);
      let best = 0;
      for (let index = 1; index < outputs.length; index++) if ((weights[index] ?? 0) > (weights[best] ?? 0)) best = index;
      return outputs[best];
    },
    close() {
      if (!closing) {
        closed = true;
        closing = tail.then(() => service.close(scope));
        closing.catch(() => { closing = null; });
      }
      return closing;
    }
  };
}

/** Network topology is host policy, not an inference-library export. */
export async function evolveFunctionGemmaNetwork({ populationSize = 20, generations = 10, eliteCount = 2,
  mutationRate = 0.1, evaluate, randomGenome, random }) {
  if (typeof random !== 'function') throw new Error('Network evolution requires an explicit random source');
  if (!Number.isInteger(populationSize) || populationSize < 1 || !Number.isInteger(generations) || generations < 0
    || !Number.isInteger(eliteCount) || eliteCount < 1 || eliteCount > populationSize
    || !Number.isFinite(mutationRate) || mutationRate < 0 || mutationRate > 1) throw new Error('Invalid evolution population or mutation policy');
  const clone = value => structuredClone(value);
  const score = async population => {
    const rows = await Promise.all(population.map(async genome => ({ genome, score: await evaluate(genome) })));
    if (rows.some(row => !Number.isFinite(row.score))) throw new Error('Evolution requires finite fitness');
    return rows.sort((a, b) => b.score - a.score);
  };
  let population = Array.from({ length: populationSize }, () => randomGenome());
  for (let iteration = 0; iteration < generations; iteration++) {
    const rows = await score(population);
    population = rows.slice(0, eliteCount).map(row => clone(row.genome));
    while (population.length < populationSize) {
      const a = rows[Math.floor(random() * rows.length)].genome;
      const b = rows[Math.floor(random() * rows.length)].genome;
      const child = clone(random() < 0.5 ? a : b);
      if (random() < mutationRate) child.topology.type = ['chain', 'tree', 'mesh', 'dag'][Math.floor(random() * 4)];
      for (const node of child.nodes) if (random() < mutationRate && typeof node.temperature === 'number') {
        node.temperature = Math.min(1, Math.max(0, node.temperature + (random() - 0.5) * 0.2));
      }
      for (const edge of child.edges) if (random() < mutationRate) edge.weight = Math.min(1, Math.max(0, edge.weight + (random() - 0.5) * 0.4));
      population.push(child);
    }
  }
  const rows = await score(population);
  return { ...rows[0], population: rows.map(row => ({ genome: row.genome, fitness: row.score })) };
}
