import {readFile, writeFile} from 'node:fs/promises';
const target = (await (await fetch('http://127.0.0.1:9229/json/list')).json())[0];
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let id=0;const pending=new Map(), listeners=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(JSON.stringify(m.error))):p?.resolve(m.result);}else listeners.get(m.method)?.(m.params);};
const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
let breakpoint;
try {
 await send('Debugger.enable');
 const source=await readFile('scripts/run-mesh-contributor.js','utf8');
 const captured=new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error('No contributor timer observation within 30 seconds')),30000);
  listeners.set('Debugger.paused',async event=>{
   try{
    if(!event.hitBreakpoints?.includes(breakpoint?.breakpointId)){await send('Debugger.resume');return;}
    const v=await send('Debugger.evaluateOnCallFrame',{callFrameId:event.callFrames[0].callFrameId,expression:'globalThis.__settlementPage = page; true',returnByValue:true});
    if(v.exceptionDetails)throw Error(JSON.stringify(v.exceptionDetails));
    await send('Debugger.removeBreakpoint',{breakpointId:breakpoint.breakpointId});
    await send('Debugger.resume');clearTimeout(timeout);resolve();
   }catch(e){clearTimeout(timeout);await send('Debugger.resume').catch(()=>{});reject(e);}
  });
 });
 breakpoint=await send('Debugger.setBreakpointByUrl',{urlRegex:'/scripts/run-mesh-contributor\\.js$',lineNumber:source.split('\n').findIndex(l=>l.includes('const state = { phase:'))});
 await captured;
 async function snapshotInput() {
   const page=globalThis.__settlementPage;
   const cdp=await page.context().newCDPSession(page);
   let bp;
   try {
     const snapshot=new Promise((resolve,reject)=>{
       const timer=setTimeout(()=>reject(Error('No automatic owner snapshot in 45 seconds')),45000);
       cdp.on('Debugger.paused',async event=>{
         if(!event.hitBreakpoints?.includes(bp?.breakpointId)) return;
         try {
           const result=await cdp.send('Debugger.evaluateOnCallFrame',{callFrameId:event.callFrames[0].callFrameId,returnByValue:true,
             expression:'({observedAt:new Date().toISOString(),participantId:identity.peerId,phase,resident:program?.resident.getState(),attempts:chat?.getState().attempts})'});
           if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
           clearTimeout(timer);resolve(result.result.value);
         } catch(e){clearTimeout(timer);reject(e);}
         finally{await cdp.send('Debugger.resume');}
       });
     });
     await cdp.send('Debugger.enable');
     bp=await cdp.send('Debugger.setBreakpointByUrl',{urlRegex:'/automatic-partitions\\.js$',lineNumber:26});
     return await snapshot;
   } finally {
     if(bp) await cdp.send('Debugger.removeBreakpoint',{breakpointId:bp.breakpointId}).catch(()=>{});
     await cdp.send('Debugger.resume').catch(()=>{});
     await cdp.send('Debugger.disable');await cdp.detach();
   }
 }
 const observed=await send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:'('+snapshotInput.toString()+')()'});
 if(observed.exceptionDetails)throw Error(JSON.stringify(observed.exceptionDetails));
 await writeFile('/var/tmp/reploid-active-cleanup-input-resident.json',JSON.stringify(observed.result.value,null,2)+'\n');
 console.log(JSON.stringify(observed.result.value));
} finally {
 await send('Debugger.resume').catch(()=>{});
 await send('Debugger.disable').catch(()=>{});
 await send('Runtime.evaluate',{expression:"delete globalThis.__settlementPage; setTimeout(()=>process.getBuiltinModule('node:inspector').close(),100); true"}).catch(()=>{});
 ws.close();
}
