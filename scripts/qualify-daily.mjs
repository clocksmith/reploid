// Private operator tooling. No network service, provider enrollment, or production publication.
import { createPrivateKey, sign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { canonicalize } from '../shared/vendor/reploid/artifacts/canonical-json.js';
import { PROFILE, RULE_VERSION, judgePrompt } from '../server/daily/rules.js';
import { CALENDAR_SCHEMA, QUALIFICATION_SCHEMA } from '../server/daily/challenges.js';
import { openDailyPhysical } from '../server/daily/local-doppler.js';

const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const write = (file, value) => writeFile(file, JSON.stringify(value) + '\n', {flag:'wx', mode:0o600});
async function measure(directory, bankFile, provider, destination, key) {
  const providerId = provider === '-' ? null : provider;
  if (providerId !== null && !/^peer:[a-f0-9]{24}$/.test(providerId)) throw Error('Expected an enrolled provider identity, or - for reference hardware');
  const bank = await readJson(bankFile);
  const physical = await openDailyPhysical(directory);
  const attempts = [];
  try {
    for (const {target, prompts} of bank) {
      for (const candidate of prompts) {
        let prompt;
        try { prompt = judgePrompt(candidate,target).prompt; } catch { continue; }
        attempts.push({target, prompt, ...await physical.measure(prompt)});
      }
    }
  } finally { await physical.close(); }
  const report = {schema:QUALIFICATION_SCHEMA,profile:PROFILE,ruleVersion:RULE_VERSION,providerId,nativeBackend:physical.nativeBackend,attempts};
  await write(destination, key ? await signed(report,key) : report);
}
async function signed(body, keyFile) {
  const key = createPrivateKey(await readFile(keyFile));
  if (key.asymmetricKeyType !== 'ed25519') throw Error('Daily calendar requires an Ed25519 operator key');
  return {...body,signature:sign(null, Buffer.from(canonicalize(body)), key).toString('base64')};
}

const [command,...args] = process.argv.slice(2);
if (command === 'measure' && args.length === 5) {
  await measure(args[0],args[1],args[2],args[4],args[3]);
} else if (command === 'collect' && args.length === 4) {
  await measure(...args);
} else if (command === 'endorse' && args.length === 3) {
  const [reportFile,keyPath,out] = args, body = await readJson(reportFile);
  if (body.schema !== QUALIFICATION_SCHEMA || body.signature || !Array.isArray(body.attempts)) throw Error('Expected an unsigned local qualification report');
  await write(out,await signed(body,keyPath));
} else if (command === 'sign-calendar' && args.length === 3) {
  const [daysFile,keyPath,out] = args;
  await write(out,await signed({schema:CALENDAR_SCHEMA,days:await readJson(daysFile)},keyPath));
} else {
  throw Error('Use collect MODEL_DIR PRIVATE_BANK PROVIDER_OR_DASH PRIVATE_REPORT; endorse REPORT OPERATOR_KEY SIGNED_REPORT; measure MODEL_DIR PRIVATE_BANK PROVIDER_OR_DASH OPERATOR_KEY SIGNED_REPORT; or sign-calendar DAYS_JSON OPERATOR_KEY SIGNED_CALENDAR');
}
