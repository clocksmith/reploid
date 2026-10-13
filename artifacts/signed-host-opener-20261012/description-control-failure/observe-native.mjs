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
const out={at:new Date().toISOString(),pid:2103894};
try{
 const stop=(await call('Runtime.evaluate',{expression:'process.listeners("SIGTERM")[0]'})).result;
 const participant=await scope(stop,'participant');
 const partitions=await scope(await prop(participant.objectId,'getState'),'partitions');
 const discovery=await scope(await prop(partitions.objectId,'getState'),'discovery');
 const connections=await scope(await prop(discovery.objectId,'getSnapshot'),'connections');
 out.connections=await invoke(connections,'function(){return [...this.entries()].map(([id,p])=>({id,participantId:p.participantId,receipt:p.endpoint.getReceipt()}))}');
 const describe=await scope(await prop(discovery.objectId,'refresh'),'describe');
 out.describeFound=!!describe; const policy=await scope(await prop(discovery.objectId,'refresh'),'policy');out.policy=await invoke(policy,'function(){return this.controlChannel}');
 if(describe){out.description=await invoke(describe,'function(){const d=this();return {bytes:new TextEncoder().encode(JSON.stringify(d)).length,phase:d.phase,index:d.index,modelCount:d.models.length,models:d.models.map(m=>({keys:Object.keys(m),bytes:new TextEncoder().encode(JSON.stringify(m)).length,id:m.id,fields:Object.fromEntries(Object.entries(m).map(([k,v])=>[k,new TextEncoder().encode(JSON.stringify(v)).length]))})),keys:Object.keys(d)}}');}
}catch(e){out.error=String(e.stack||e)}finally{ws.close()}
fs.writeFileSync('/var/tmp/reploid-signed-drain-v2-20261013/description-readonly.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));
