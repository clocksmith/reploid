import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { verifyStageTokenWitnesses } from '../../server/fleet/stage-token-witness.js';

const [fixture, headers, stream, inputFile, outputFile, ...rest] = process.argv.slice(2);
assert(fixture && headers && stream && inputFile && outputFile && !rest.length,
  'Usage: node tests/fixtures/verify-private-stage-tokens.mjs REFERENCE HTTP_HEADERS RESPONSE_SSE INPUT_RECEIPT OUTPUT_RECEIPT');
const [fixtureBytes, header, body, input, output] = await Promise.all(
  [fixture, headers, stream, inputFile, outputFile].map(file => readFile(file)));
const attempts = [...header.toString().matchAll(/^x-reploid-attempt-id:[ \t]*(\S+)[ \t]*\r?$/gmi)];
assert.equal(attempts.length, 1, 'Require one HTTP attempt header');
const terminal = body.toString().split(/\r?\n\r?\n/).filter(frame => /^event: response\.completed\r?$/m.test(frame));
assert.equal(terminal.length, 1, 'Require one completed response');
const data = terminal[0].split(/\r?\n/).find(line => line.startsWith('data: '));
const event = JSON.parse(data.slice(6));
assert.equal(event.type, 'response.completed');
console.log(JSON.stringify(verifyStageTokenWitnesses({ fixtureBytes, httpAttemptId: attempts[0][1],
  response: event.response, input: JSON.parse(input), output: JSON.parse(output) })));
