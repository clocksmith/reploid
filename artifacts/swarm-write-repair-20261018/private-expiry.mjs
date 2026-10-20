import WebSocket from 'ws';import {randomUUID} from 'node:crypto';
const began=Date.now();const ws=new WebSocket('wss://reploid-swarm.reploid.workers.dev/swarm?scope=private&roomId=reploid-swarm-repair-'+randomUUID(),{headers:{Origin:'https://replo.id'}});
const timer=setTimeout(()=>{console.log({passed:false,elapsed:Date.now()-began});ws.terminate();},25000);
ws.on('open',()=>console.log('open'));ws.on('error',e=>{console.log(e.message);clearTimeout(timer);});ws.on('close',code=>{clearTimeout(timer);console.log({code,elapsed:Date.now()-began});});
