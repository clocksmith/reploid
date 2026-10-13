import fs from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire('/var/tmp/reploid-signed-compact-20261013/reploid/package.json');
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
const out={at:new Date().toISOString(),pid:2525851};
try {
 const observed=(await call('Runtime.evaluate',{expression:'process.pid',returnByValue:true})).result.value;if(observed!==2525851)throw Error('Wrong inspector process');
 const stop=(await call('Runtime.evaluate',{expression:'process.listeners("SIGTERM")[0]'})).result;
 const participant=await scope(stop,'participant');
 const partitions=await scope(await prop(participant.objectId,'getState'),'partitions');
 out.public=await invoke(participant,'function(){const s=this.getState();return {phase:s.phase,error:s.error,reservations:s.reservations,attempts:s.attempts,unsettledOwners:s.unsettledOwners}}');
 const gs=await prop(partitions.objectId,'getState');
 out.networks={};
 for(const name of ['entries','execution']) {
  const network=await scope(gs,name);if(!network?.objectId)continue;
  const conns=await scope(await prop(network.objectId,'connect'),'entries');
  out.networks[name]=await invoke(conns,'function(){return [...this.entries()].map(([id,e])=>({id,channel:{label:e.channel.label,readyState:e.channel.readyState,bufferedAmount:e.channel.bufferedAmount},state:e.endpoint?.getState?.(),receipt:e.endpoint?.getReceipt?.()}))}');
 }
 const chat=await scope(gs,'chat');if(chat?.objectId)out.chat=await invoke(chat,'function(){return this.getState()}');
}catch(e){out.error=String(e.stack||e)}finally{ws.close()}
fs.writeFileSync('/var/tmp/reploid-signed-compact-20261013/generation-failure-readonly.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));
