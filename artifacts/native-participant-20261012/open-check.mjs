import fs from 'node:fs/promises';

import {openNativePartition,createNativeGpuHost} from '/home/x/deco/reploid/server/native-participant.js';
const model=JSON.parse(await fs.readFile('/home/x/deco/reploid/self/config/chat-models.json')).find(m=>m.id==='qwen-3-5-0-8b-q4k-ehaf16');
const signal=new AbortController().signal;
const gpuHost=createNativeGpuHost(()=>import('/home/x/deco/reploid/node_modules/webgpu/index.js'));
let opened;
try{
 opened=await openNativePartition({model,modelDirectory:'/home/x/deco/doppler/models/local/'+model.id,index:1,participantId:'peer:6fef3a618f40d5acfc712941',signal,
 nativeGpu:()=>gpuHost.open(),onProgress:console.log});
 const ready=opened.resident.getState(),before=opened.getReceipt();await opened.resident.close(); await gpuHost.close();
 const out={schema:'reploid.native-partition-open/v1',passed:true,ready,before,after:opened.getReceipt(),final:opened.resident.getState(),provider:'webgpu',node:process.version};
 await fs.writeFile('/var/tmp/reploid-native-20261012/open-settled-result.json',JSON.stringify(out,null,2));console.log(JSON.stringify({passed:true,ready:ready.descriptor,after:out.after.memory}));
}catch(error){await fs.writeFile('/var/tmp/reploid-native-20261012/open-settled-result.json',JSON.stringify({passed:false,error:error.stack},null,2));console.error(error);process.exitCode=1}finally{await opened?.resident.close();await gpuHost.close()}
