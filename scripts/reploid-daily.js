import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createDailyCalendar } from '../server/daily/challenges.js';
import { createDailyApp } from '../server/daily/http.js';
import { createEmailIdentity } from '../server/daily/identity.js';
import { PROFILE } from '../server/daily/rules.js';
import { createDailyStore } from '../server/daily/store.js';

const staticRoot = fileURLToPath(new URL('../server/daily/site/',import.meta.url));
const readJson = async path => JSON.parse(await readFile(path,'utf8'));
const print = value => console.log(JSON.stringify(value,null,2));
const help = 'npm run daily -- preview [--port 4180] | serve --config FILE | issue --config FILE --expires ISO_DATE | revoke --config FILE --id INVITE_ID | review|stats --config FILE | approve|reject --config FILE --id ATTEMPT_ID';
async function main() {
  const {values,positionals} = parseArgs({allowPositionals:true,options:{
    config:{type:'string'},port:{type:'string'},expires:{type:'string'},id:{type:'string'},help:{type:'boolean'}
  }});
  if (values.help || !positionals.length) { console.log(help); return; }
  if (positionals.length !== 1) throw Error(help);
  const [command] = positionals;
  const preview = command === 'preview';
  if (!preview && !values.config) throw Error(help);
  const config = preview ? {} : await readJson(values.config);
  const dir = preview ? '.' : dirname(resolve(values.config));
  const file = path => resolve(dir,path);
  const store = createDailyStore({path:preview ? ':memory:' : file(config.database),
    hostId:preview ? 'staged-preview' : config.providerId, hostDailyCap:preview ? 0 : config.hostDailyCap});
  let fleetPromise, server;
  try {
    if (!preview && command !== 'serve') {
      switch (command) {
        case 'issue': {
          const url = new URL(config.origin);
          if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname))) {
            throw Error('Use a dedicated HTTPS origin or loopback HTTP.');
          }
          if (url.pathname !== '/' || url.username || url.password || url.hash || url.search) throw Error('Use the root circle origin.');
          const grant = store.circleInvite({expiresAt:values.expires});
          url.hash = new URLSearchParams({invite:grant.token});
          print({id:grant.id,expiresAt:new Date(grant.expiresAt).toISOString(),url:url.href});
          break;
        }
        case 'revoke':
          if (!values.id || !store.revokeCircle(values.id)) throw Error('Active invitation ID required.');
          print({revoked:values.id}); break;
        case 'review': print(store.reviewQueue()); break;
        case 'approve':
        case 'reject':
          if (!values.id || !store.reviewQueue().some(row => row.attemptId === values.id)
            || !store.reviewReveal(values.id,command === 'approve')) throw Error('Choose a consenting winning entry from yesterday’s review queue.');
          print({id:values.id,approved:command === 'approve'}); break;
        case 'stats': print(store.ownerStats()); break;
        default: throw Error(help);
      }
      return;
    }
    const port = Number(values.port ?? config.port ?? 4180);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Port must be between 0 and 65535.');
    if (!preview && (!config.origin || !config.circleName || !config.fleetConfig || !config.backendIdentityHash
      || !Number.isSafeInteger(config.hostDailyCap))) throw Error('Complete the circle, host budget and provider configuration.');
    const calendar = createDailyCalendar(preview ? {previewTarget:'Paris'} : {
      schedule: config.signedCalendar ? await readJson(file(config.signedCalendar)) : undefined,
      qualifications: await Promise.all((config.qualifications ?? []).map(p => readJson(file(p)))),
      calendarPublicKey: config.calendarPublicKey ? await readFile(file(config.calendarPublicKey)) : undefined,
      providerId:config.providerId,backendIdentityHash:config.backendIdentityHash,previewTarget:config.previewTarget,
    });
    async function run(input) {
      if (!fleetPromise) {
        fleetPromise = import('../server/daily/fleet.js').then(({openDailyFleet}) => openDailyFleet({
          configFile:file(config.fleetConfig), modelId:PROFILE.modelId, modelIdentity:PROFILE.modelIdentity,
          providerId:config.providerId, backendIdentityHash:config.backendIdentityHash,
        })).catch(error => { fleetPromise = undefined; throw error; });
      }
      const fleet = await fleetPromise;
      input.signal.throwIfAborted();
      return fleet.run(input);
    }
    const app = createDailyApp({store,gameForDay:calendar.gameForDay,run:preview ? undefined : run,
      identity:preview ? null : createEmailIdentity(config.auth),circleName:preview ? 'Preview circle' : config.circleName,
      origin:preview ? undefined : config.origin,staticRoot});
    server = app.listen(port,'127.0.0.1');
    await new Promise((done,fail) => {server.once('listening',done); server.once('error',fail);});
    console.log('Reploid Daily listening on http://127.0.0.1:' + server.address().port);
    const stop = () => server.close();
    process.once('SIGTERM',stop); process.once('SIGINT',stop);
    await new Promise(done => server.once('close',done));
    process.removeListener('SIGTERM',stop); process.removeListener('SIGINT',stop);
  } finally {
    if (server?.listening) server.close();
    try { if (fleetPromise) await (await fleetPromise).close(); }
    finally { store.close(); }
  }
}
main().catch(error => {console.error(error.message);process.exitCode=1;});
