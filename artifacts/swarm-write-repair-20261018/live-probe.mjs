import WebSocket from 'ws';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const endpoint='https://reploid-swarm.reploid.workers.dev';
const roomId='reploid-swarm-public';
const token='reploid-public-namespace-not-a-secret-v1';
const clients=[], timers=[];
const receipt={startedAt:new Date().toISOString(),passed:false,checks:[]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function connect(join=true, keepAlive=true, id='repair-'+randomUUID()) {
 const ws=new WebSocket(endpoint.replace('https:','wss:')+'/swarm?scope=public',{headers:{Origin:'https://replo.id'}});
 const messages=[];clients.push(ws);
 ws.on('message',raw=>messages.push(JSON.parse(String(raw))));
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('WebSocket opening timed out')),12000);ws.once('open',()=>{clearTimeout(t);resolve();});ws.once('error',e=>{clearTimeout(t);reject(e);});});
 const wait=async(type,predicate=()=>true,ms=10000)=>{const deadline=Date.now()+ms;while(Date.now()<deadline){const m=messages.find(m=>m.type===type&&predicate(m));if(m)return m;if(ws.readyState===WebSocket.CLOSED)throw Error('Socket closed before '+type);await sleep(50);}throw Error('Missing '+type);};
 if(join){ws.send(JSON.stringify({type:'join',peerId:id,roomId,token}));await wait('joined');}
 if(join&&keepAlive)timers.push(setInterval(()=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'heartbeat',peerId:id,roomId}));},20000));
 return {ws,id,messages,wait};
}
try{
 const health=await fetch(endpoint+'/health');assert.equal(health.status,200);receipt.health=await health.json();
 assert.equal(receipt.health.release,'cloudflare-swarm-20261018-lease-renewal');
 const a=await connect(), b=await connect();
 assert.ok((await b.wait('joined')).peers.includes(a.id));receipt.checks.push('public discovery');
 const idle=await connect(true,false), pending=await connect(false);
 const closed=(peer,limit)=>new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Expiry deadline missed')),limit);peer.ws.once('close',(code)=>{clearTimeout(t);resolve(code);});});
 const expiry=Promise.all([closed(idle,75000),closed(pending,20000)]);
 expiry.catch(()=>{}); // Retain a deadline failure until the joined checks settle.
 const began=Date.now();
 while(Date.now()-began<120000){await sleep(15000);assert.equal(a.ws.readyState,WebSocket.OPEN);assert.equal(b.ws.readyState,WebSocket.OPEN);console.log('Healthy peers retained for',Date.now()-began,'ms');}
 assert.deepEqual(await expiry,[4001,4001]);receipt.checks.push('unjoined and inactive expiry','healthy membership beyond 90-second lease');
 a.ws.send(JSON.stringify({type:'offer',peerId:a.id,targetPeer:b.id,offer:{type:'offer',sdp:'repair-check'}}));
 assert.equal((await b.wait('offer',m=>m.peerId===a.id)).offer.sdp,'repair-check');receipt.checks.push('negotiation after renewal');
 a.ws.close();await b.wait('peer-left',m=>m.peerId===a.id);receipt.checks.push('departure');
 const reconnected=await connect(true,true,a.id);assert.ok((await reconnected.wait('joined')).peers.includes(b.id));receipt.checks.push('same-identity reconnect');
 receipt.passed=true;
}catch(error){receipt.error=error.message;process.exitCode=1;}
finally{for(const t of timers)clearInterval(t);for(const ws of clients)ws.terminate();receipt.finishedAt=new Date().toISOString();await writeFile(new URL(process.env.PROBE_RECEIPT||'./live-probe.json',import.meta.url),JSON.stringify(receipt,null,2)+'\n');console.log(receipt);}
