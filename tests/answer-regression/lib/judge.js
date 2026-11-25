// Optional automated whole-answer judge through a configurable model adapter.
//
// Off unless a judge configuration is passed to `evaluate --judge`. Credentials come from an environment variable
// or a file outside the repository, and are never written anywhere. The judge must be a different model from the
// generator: its configured model, its configured identity and the model each response reports are checked against
// the run's generator identities, and the judge endpoint cannot be the run's own route. Every judge record is labeled
// "automated judge, not independent review"; it is a regression signal, not a grade under the review protocol.
//
// Adapters: openai-chat (any OpenAI-compatible /v1/chat/completions endpoint) and anthropic-messages (/v1/messages).
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { JUDGE_LABEL, POLICIES, POLICIES_SHA256, HarnessError, expand, fail, insideRepo, loadJson, resolvePath, sha256File,
  sha256Text } from './common.js';
import { cpSlice, pyRepr } from './python-compat.js';

export const JUDGE_SCHEMA = 'reploid.answer-regression.judge/v1';
export const ADAPTERS = ['openai-chat', 'anthropic-messages'];
const GRADES = ['correct', 'incorrect', 'unverified'];
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504, 529]);

/** Lowercase alphanumerics of the last path segment: 'Qwen/Qwen3.5-0.8B' and 'qwen-3-5-0-8b-q4k' share 'qwen3508b'. */
export const nameKey = value => String(value).toLowerCase().split('/').at(-1).replace(/[^a-z0-9]/g, '');

export function generatorIdentity(run) {
  const identities = run.identities || {};
  const model = identities.model || {};
  const route = identities.route || {};
  const names = [model.catalogId, model.source, model.modelId].filter(Boolean);
  const base = route.baseUrl && typeof route.baseUrl === 'object' ? route.baseUrl.configured ?? null : null;
  return { names, manifestIdentity: model.manifestIdentity ?? null, routeBaseUrl: base };
}

export function sameModel(candidate, generator) {
  const key = nameKey(candidate);
  if (!key) return true;
  return generator.names.some(name => {
    const other = nameKey(name);
    return Boolean(other) && (key.includes(other) || other.includes(key));
  });
}

const hostOf = value => {
  try {
    return new URL(value).host;
  } catch {
    return '';
  }
};

/** Refuses a judge that is, or could be, the generator. */
export function ensureDistinct(config, generator) {
  const problems = [];
  if (sameModel(config.model, generator)) problems.push(`judge model ${pyRepr(config.model)} matches the generator ${pyRepr(generator.names)}`);
  const identity = config.modelIdentity;
  if (identity && generator.manifestIdentity && identity === generator.manifestIdentity) {
    problems.push('judge modelIdentity equals the generator manifest identity');
  }
  if (generator.routeBaseUrl) {
    let sameHost = false;
    try {
      const route = generator.routeBaseUrl.includes('${') ? expand(generator.routeBaseUrl) : generator.routeBaseUrl;
      sameHost = Boolean(hostOf(route)) && hostOf(route) === hostOf(expand(config.endpoint));
    } catch (error) {
      if (!(error instanceof HarnessError)) throw error;
    }
    if (sameHost) problems.push("judge endpoint is the run's own installed route");
  }
  if (problems.length) fail(`The judge must be a different model from the generator: ${problems.join('; ')}`);
}

function readKey(credentials) {
  if (credentials.env) {
    const key = process.env[credentials.env];
    if (!key) fail(`Judge credentials: environment variable ${credentials.env} is empty`);
    return key.trim();
  }
  if (credentials.file) {
    const file = resolvePath(credentials.file);
    if (insideRepo(file)) fail('Judge credentials must be outside the repository');
    return fs.readFileSync(file, 'utf8').trim();
  }
  return fail('Judge credentials need env or file');
}

export const INSTRUCTIONS = `You are an automated judge for engineering regression tests of a small language model's answers.
Your output is labeled "automated judge, not independent review": it is a regression signal for engineers, not a
review under the human review protocol, and it grants no acceptance.

Grade the answer under the frozen evaluation policies below, using the policy letter given (Q, S or R).
Enumerate every element of the answer, grade each one correct, incorrect or unverified, and derive the status from
the grades exactly as section 3 says. You cannot run code yourself; when harness executions of the answer's code are
given, treat them as execution evidence for the inputs they ran. For policy R, the retrieval record's sources are the
only sources the answer may cite.

Return only one JSON object, with no other text:
{"reference": [{"part": "...", "correctAnswer": "..."}],
 "elements": [{"kind": "...", "quote": "...", "claim": "...", "addition": false, "grade": "correct|incorrect|unverified", "basis": "..."}],
 "status": "whole-answer-correct|has-incorrect-element|unverified-only"}

FROZEN EVALUATION POLICIES
`;

export function deriveStatus(elements) {
  const grades = elements.map(element => element.grade);
  if (!grades.length) return null;
  if (grades.includes('incorrect')) return 'has-incorrect-element';
  if (grades.includes('unverified')) return 'unverified-only';
  return 'whole-answer-correct';
}

class ReplyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValueError';
  }
}

export function parseReply(text) {
  let body = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(body);
  if (fenced) body = fenced[1];
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new ReplyError('no JSON object in the judge reply');
  let value;
  try {
    value = JSON.parse(body.slice(start, end + 1));
  } catch (error) {
    throw new ReplyError(error.message);
  }
  const elements = value.elements;
  if (!Array.isArray(elements) || !elements.length) throw new ReplyError('the judge reply has no elements');
  for (const element of elements) {
    if (!GRADES.includes(element.grade)) throw new ReplyError(`invalid grade ${pyRepr(element.grade ?? null)}`);
  }
  const derived = deriveStatus(elements);
  return { reference: value.reference ?? null, elements, declaredStatus: value.status ?? null, status: derived,
    statusCorrected: (value.status ?? null) !== derived };
}

class HttpError extends Error {
  constructor(status, statusText) {
    super(`HTTP Error ${status}: ${statusText}`);
    this.name = 'HTTPError';
    this.status = status;
  }
}

class UrlError extends Error {
  constructor(reason) {
    super(`<urlopen error ${reason}>`);
    this.name = 'URLError';
  }
}

export class Judge {
  constructor(config, generator) {
    if (config.schema !== JUDGE_SCHEMA || !ADAPTERS.includes(config.adapter)) {
      fail(`Judge configuration needs schema ${JUDGE_SCHEMA} and adapter in ${pyRepr(ADAPTERS)}`);
    }
    for (const key of ['endpoint', 'model', 'credentials']) if (!config[key]) fail(`Judge configuration needs ${key}`);
    const expanded = { ...config };
    for (const key of ['endpoint', 'model', 'provider', 'modelIdentity']) {
      if (typeof config[key] === 'string') expanded[key] = expand(config[key]);
    }
    ensureDistinct(expanded, generator);
    this.config = expanded;
    this.generator = generator;
    const policyPath = expanded.policyFile ? resolvePath(expanded.policyFile) : POLICIES;
    if (!fs.existsSync(policyPath)) {
      fail(`The evaluation policies are missing at ${policyPath}; restore artifacts/independent-answer-review-20261014 `
        + 'with node scripts/restore-evidence.js (or set REPLOID_ARX_EVIDENCE_ROOT)');
    }
    this.policySha = sha256File(policyPath);
    if (!expanded.policyFile && this.policySha !== POLICIES_SHA256) fail('The frozen evaluation policies changed');
    this.policyText = fs.readFileSync(policyPath, 'utf8');
    this.key = readKey(expanded.credentials);
    this.endpoint = expand(expanded.endpoint);
  }

  describe() {
    return { label: JUDGE_LABEL, adapter: this.config.adapter, endpointHost: hostOf(this.endpoint), model: this.config.model,
      modelIdentity: this.config.modelIdentity ?? null, provider: this.config.provider ?? null,
      temperature: this.config.temperature ?? 0, policySha256: this.policySha, generator: this.generator,
      distinctFromGenerator: 'enforced by model name, manifest identity, endpoint and each reported response model' };
  }

  async request(system, user) {
    const temperature = this.config.temperature ?? 0;
    const maxTokens = this.config.maxTokens ?? 4096;
    let body;
    let headers;
    if (this.config.adapter === 'openai-chat') {
      body = { model: this.config.model, temperature, max_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
      headers = { 'content-type': 'application/json', authorization: `Bearer ${this.key}` };
    } else {
      body = { model: this.config.model, temperature, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] };
      headers = { 'content-type': 'application/json', 'x-api-key': this.key, 'anthropic-version': '2023-06-01' };
    }
    let response;
    try {
      response = await fetch(this.endpoint, { method: 'POST', headers, body: JSON.stringify(body),
        signal: AbortSignal.timeout((this.config.timeoutSeconds ?? 180) * 1000) });
    } catch (error) {
      throw error.name === 'TimeoutError' ? error : new UrlError(error.cause?.message || error.message);
    }
    if (!response.ok) throw new HttpError(response.status, response.statusText);
    const reply = await response.json();
    const text = this.config.adapter === 'openai-chat'
      ? reply.choices[0].message.content || ''
      : (reply.content || []).filter(block => block.type === 'text').map(block => block.text || '').join('');
    return [text, reply.model ?? null, reply.id ?? null];
  }

  async call(system, user) {
    const retries = this.config.retries ?? 2;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.request(system, user);
      } catch (error) {
        const retryable = error instanceof HttpError ? RETRY_STATUSES.has(error.status)
          : error instanceof UrlError || error.name === 'TimeoutError';
        if (!retryable || attempt === retries) throw error;
      }
      await sleep(2000 * 4 ** attempt);
    }
  }

  async judge({ itemId, policy, context, prompt, answer, retrieval = null, executions = null }) {
    const payload = { itemId, policy, earlierTurns: context, prompt, answer };
    if (executions && executions.length) payload.harnessExecutions = executions;
    if (policy === 'R') {
      payload.retrievalRecord = retrieval === null ? null : {
        outcome: retrieval.outcome ?? null, error: retrieval.error ?? null, query: retrieval.query ?? null,
        sources: (retrieval.sources || []).map(source => Object.fromEntries(
          ['number', 'sourceId', 'url', 'title', 'retrievedAt', 'contentHash', 'passage'].map(key => [key, source[key] ?? null]))) };
    }
    const system = INSTRUCTIONS + this.policyText;
    const user = JSON.stringify(payload, null, 1);
    const record = { label: JUDGE_LABEL, promptSha256: sha256Text(`${system}\n${user}`), answerSha256: sha256Text(answer) };
    const started = performance.now();
    let text;
    let responseModel;
    let responseId;
    try {
      [text, responseModel, responseId] = await this.call(system, user);
    } catch (error) {
      return { ...record, status: null, error: `${error.name}: ${cpSlice(String(error.message), 0, 200)}` };
    }
    Object.assign(record, { responseModel, responseId, seconds: Math.round((performance.now() - started) / 10) / 100,
      replySha256: sha256Text(text) });
    if (responseModel && sameModel(responseModel, this.generator)) {
      return { ...record, status: null, error: 'the response came from the generator model; discarded' };
    }
    const configured = nameKey(this.config.model);
    if (responseModel && !nameKey(responseModel).startsWith(configured)) {
      return { ...record, status: null, error: `the response model ${pyRepr(responseModel)} is not the configured judge` };
    }
    try {
      return { ...record, ...parseReply(text) };
    } catch (error) {
      if (!(error instanceof ReplyError)) throw error;
      return { ...record, status: null, error: `unparseable judge reply: ${error.message}`, reply: cpSlice(text, 0, 2000) };
    }
  }
}

export const loadJudge = (file, run) => new Judge(loadJson(file), generatorIdentity(run));
