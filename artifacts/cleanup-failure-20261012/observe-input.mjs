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
 const observed=await send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`globalThis.__settlementPage.evaluate(async()=>{const {DOPPLER_PARTITIONS_MODULE_URL}=await import('/config/doppler-local-models.js');return {observedAt:new Date().toISOString(),phase:document.querySelector('[data-contrib-label]')?.textContent,error:document.querySelector('[data-network-message]')?.textContent,memory:(await import(DOPPLER_PARTITIONS_MODULE_URL)).inspectDeviceMemory()};})`});
 if(observed.exceptionDetails)throw Error(JSON.stringify(observed.exceptionDetails));
 await writeFile('/var/tmp/reploid-active-cleanup-input.json',JSON.stringify(observed.result.value,null,2)+'\n');
 console.log(JSON.stringify({phase:observed.result.value.phase,memory:{liveBytes:observed.result.value.memory.liveBytes,categories:observed.result.value.memory.categories}}));
} finally {
 await send('Debugger.resume').catch(()=>{});
 await send('Debugger.disable').catch(()=>{});
 await send('Runtime.evaluate',{expression:"delete globalThis.__settlementPage; setTimeout(()=>process.getBuiltinModule('node:inspector').close(),100); true"}).catch(()=>{});
 ws.close();
}
