import assert from 'node:assert/strict';
import { attachNativeCustodyObservation } from './observer.mjs';
const sentinel = new Error('same error'), key='reploid:custody-request';
let called;
const original = function(...args) { called=args; if(this.failure) throw this.failure; return this.result; };
const handlers=new Map([[key,original]]), transport={result:false,sendToPeer:original};
const peers=new Map([['peer',{dataChannel:{readyState:'open',bufferedAmount:17,ordered:true,maxRetransmits:3}}]]);
const observer=attachNativeCustodyObservation(transport,handlers,peers);
try {
  assert.equal(transport.sendToPeer('peer','reploid:custody-response',{id:'id',authorization:{secret:'must-not-log'}}),false);
  assert.equal(called[1],'reploid:custody-response');
  const result=Promise.resolve(4), receiver={result};
  assert.equal(handlers.get(key).call(receiver,'peer',{id:'id',artifact:{path:'piece.bin',sizeBytes:20},requester:{privateKey:'must-not-log'}}),result);
  transport.failure=sentinel; assert.throws(()=>transport.sendToPeer('peer','reploid:custody-response',{id:'throw'}),error=>error===sentinel); delete transport.failure;
  assert.throws(()=>handlers.get(key).call({failure:sentinel},'peer',{id:'throw'}),error=>error===sentinel);
  for(let i=0;i<200;i++)transport.sendToPeer('peer','reploid:custody-response',{id:String(i)});
  const out=observer.snapshot();assert.equal(out.records.length,128);assert.equal(JSON.stringify(out).includes('must-not-log'),false);
  assert.equal(out.channels[0].maxRetransmits,3);
} finally {observer.stop();}
assert.equal(transport.sendToPeer,original);assert.equal(handlers.get(key),original);assert.equal(observer.snapshot().stopped,true);
console.log('observer controls passed: exact results/promise identity, bounded sanitized history, restore');
