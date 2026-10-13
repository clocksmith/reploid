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
try {const r=await call('Runtime.evaluate',{expression:'globalThis.__reploidNativeCustodyObservation?.snapshot()',returnByValue:true});console.log(JSON.stringify(r.result.value,null,2));} finally {ws.close();}
