import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const artifact=JSON.parse(await fs.readFile(process.argv[2] || new URL('./native-delivery.json', import.meta.url),'utf8'));
const ledger=await fs.mkdtemp(path.join((await import('node:os')).tmpdir(), 'reploid-installed-budget-'));
const module=pathToFileURL(path.join(artifact.directory,'server/native-supply-budget.js')).href;
const script=path.join(ledger,'consumer.mjs');const cache=path.join(ledger,'cache');
await fs.writeFile(script,`import {openNativeSupplyBudget} from ${JSON.stringify(module)}; const b=await openNativeSupplyBudget({directory:process.argv[2],maxBytes:10});try{ console.log(JSON.stringify(await b.reserve(Number(process.argv[3]))));}catch(e){console.log(JSON.stringify({error:e.code}));}finally{b.close();}`);
const run=async amount=>JSON.parse((await promisify(execFile)(process.execPath,[script,cache,String(amount)],{cwd:artifact.directory})).stdout);
const first=await run(7), second=await run(4), third=await run(3);assert.equal(first.reservedBytes,7);assert.equal(second.error,'CUSTODY_BUDGET_LIMIT');assert.equal(third.reservedBytes,10);
const manifest=JSON.parse(await fs.readFile(path.join(artifact.directory,'native-delivery.json'),'utf8'));
const required=['server/native-supply-budget.js','packages/reploid/src/artifacts/custody/supply-budget.js'];
for(const filename of required){const item=manifest.entries.find(x=>x.path===filename);assert.ok(item);assert.equal(createHash('sha256').update(await fs.readFile(path.join(artifact.directory,filename))).digest('hex'),item.sha256);}
console.log(JSON.stringify({artifact,node:process.version,required,first,second,third,scope:'Installed artifact adapter, three separate processes. No inference/GPU/public supplier or pin change.'},null,2));
