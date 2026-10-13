import assert from 'node:assert/strict';
import { readFile, mkdir, copyFile, link, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root='/var/tmp/reploid-cold-compile-three-stage-20261013';
const previous='/var/tmp/doppler-gate-model-20261013';
const model='/var/tmp/doppler-cold-compile-model-20261013';
const runtime='/var/tmp/reploid-cold-compile-three-stage-20261013/vendor/doppler/0.6.28';
const { hash:blake3 }=await import(runtime+'/src/storage/blake3.js');
const bytes=await readFile(root+'/manifest.json'), manifest=JSON.parse(bytes);
const config=JSON.parse(await readFile(root+'/config-preparation.json'));
assert.equal('sha256:'+createHash('sha256').update(bytes).digest('hex'),config.manifest.hash);
await mkdir(model);
await copyFile(root+'/manifest.json',model+'/manifest.json');
const shards=[];
for(const shard of manifest.shards){
 assert(/^[\w.-]+$/.test(shard.filename) && !shard.filename.includes('..'));
 const bytes=await readFile(previous+'/'+shard.filename);
 assert.equal(bytes.length,shard.size);assert.equal(Buffer.from(await blake3(bytes)).toString('hex'),shard.blake3);
 await link(previous+'/'+shard.filename,model+'/'+shard.filename);shards.push({filename:shard.filename,bytes:bytes.length,blake3:shard.blake3});
}
const tokenizer=await readFile(previous+'/tokenizer.json');const tokenizerSha256=createHash('sha256').update(tokenizer).digest('hex');
assert.equal(tokenizerSha256,'8fc3b6de02de5a8e21d3867aba335e2d9a3c2263201f55daaed1feab3541bea4');
await link(previous+'/tokenizer.json',model+'/tokenizer.json');
await writeFile(model+'/verification.json',JSON.stringify({model,shards,tokenizerSha256,gpuOpened:false},null,2)+'\n');
console.log(JSON.stringify({model,shards:shards.length,gpuOpened:false}));
