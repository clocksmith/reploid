import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const root='/var/tmp/reploid-native-path-delivery-20261012';
const installed=path.join(root,'installed/reploid');
const build=JSON.parse(await fs.readFile(path.join(root,'build.json')));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(sha(await fs.readFile(build.archive)),build.archiveSha256);
const deliveryBytes=await fs.readFile(path.join(installed,'native-delivery.json'));
assert.equal(sha(deliveryBytes),build.manifestSha256);
const delivery=JSON.parse(deliveryBytes);
for(const entry of delivery.entries){const b=await fs.readFile(path.join(installed,entry.path));assert.equal(b.length,entry.bytes);assert.equal(sha(b),entry.sha256);}
const helper='self/host/work-partition-artifact-source.js';
assert(delivery.entries.some(e=>e.path===helper));
const imported=await import('file://'+path.join(installed,helper));
assert.equal(typeof imported.resolvePartitionArtifactSource,'function');
const pin=JSON.parse(await fs.readFile(path.join(installed,'self/config/doppler-package.json')));
const runtimeArchive=path.join(installed,pin.spec.slice(5));
assert.equal('sha512-'+crypto.createHash('sha512').update(await fs.readFile(runtimeArchive)).digest('base64'),pin.integrity);
await fs.mkdir(path.join(root,'runtime-reference'),{recursive:true});
execFileSync('tar',['-xzf',runtimeArchive,'-C',path.join(root,'runtime-reference')]);
async function files(directory,prefix=''){const out=[];for(const entry of await fs.readdir(directory,{withFileTypes:true})){const name=prefix+entry.name;if(entry.isDirectory())out.push(...await files(path.join(directory,entry.name),name+'/'));else if(entry.isFile())out.push(name);else throw Error('Unexpected archive entry '+name);}return out.sort();}
const reference=path.join(root,'runtime-reference/package'), runtime=path.join(installed,'node_modules/doppler-gpu');
const refFiles=await files(reference), actualFiles=await files(runtime);
assert.deepEqual(actualFiles,refFiles);
for(const name of refFiles)assert.equal(sha(await fs.readFile(path.join(runtime,name))),sha(await fs.readFile(path.join(reference,name))));
const dependencies={};for(const name of ['doppler-gpu','@roamhq/wrtc','ws','webgpu']){const file=path.join(installed,'node_modules',name,'package.json');dependencies[name]={version:JSON.parse(await fs.readFile(file)).version,path:file};}
const output={schema:'reploid.native-installed-delivery-check/v1',sourceRevision:'342f0760',node:process.version,installed,build,
 deliveryEntries:delivery.entries.length,helper:delivery.entries.find(e=>e.path===helper),helperImported:true,
 runtimeArchiveSha256:sha(await fs.readFile(runtimeArchive)),runtimeFilesVerified:refFiles.length,dependencies,
 generatedStateDirectoryPresent:await fs.stat(path.join(installed,'state')).then(()=>true,()=>false),
 scope:'Extracted standard generated artifact; ordinary npm ci, exact source/runtime inventory verification and CLI help. No participant connection, acquisition, inference or GPU initialization performed.'};
await fs.writeFile(path.join(root,'installed-check.json'),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output));
