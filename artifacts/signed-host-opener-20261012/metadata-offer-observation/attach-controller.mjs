import fs from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire('/var/tmp/reploid-signed-drain-v2-20261013/reploid/package.json');
const WebSocket=require('ws');
const targets=await(await fetch('http://127.0.0.1:9229/json/list')).json();
const ws=new WebSocket(targets[0].webSocketDebuggerUrl), pending=new Map();let seq=0;
await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j)});
ws.on('message',data=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}});
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const props=async id=>(await call('Runtime.getProperties',{objectId:id,ownProperties:true}));
const prop=async(id,name)=>(await props(id)).result.find(p=>p.name===name)?.value;
async function scope(fn,name) {
 const scopes=(await props(fn.objectId)).internalProperties.find(p=>p.name==='[[Scopes]]').value;
 for(const item of (await props(scopes.objectId)).result){if(!item.value?.objectId)continue;const value=await prop(item.value.objectId,name);if(value)return value;}
 return null;
}
const invoke=async(object,fun)=>(await call('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:fun,returnByValue:true,awaitPromise:true})).result.value;

const { attachNativeCustodyObservation } = await import('./native-custody-observer-v2.mjs');
try {
 const stop=(await call('Runtime.evaluate',{expression:'process.listeners("SIGTERM")[0]'})).result;
 const participant=await scope(stop,'participant');
 const files=await scope(await prop(participant.objectId,'getFileState'),'files');
 const exchange=await scope(await prop(files.objectId,'getState'),'exchange');
 const transport=await scope(await prop(exchange.objectId,'getState'),'transport');
 const swarm=await scope(await prop(transport.objectId,'sendToPeer'),'_webrtcSwarm');
 const innerSend=await prop(swarm.objectId,'sendToPeer');
 const handlers=await scope(innerSend,'_messageHandlers'), peers=await scope(innerSend,'_peers');
 const declaration=`function(handlers,peers){if(globalThis.__reploidNativeCustodyObservation&&!globalThis.__reploidNativeCustodyObservation.snapshot().stopped)throw new Error('observer already active');globalThis.__reploidNativeCustodyObservation=(${attachNativeCustodyObservation.toString()})(this,handlers,peers);return globalThis.__reploidNativeCustodyObservation.snapshot();}`;
 const result=await call('Runtime.callFunctionOn',{objectId:transport.objectId,functionDeclaration:declaration,arguments:[{objectId:handlers.objectId},{objectId:peers.objectId}],returnByValue:true});
 if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));
 console.log(JSON.stringify(result.result.value));
}finally{ws.close();}
