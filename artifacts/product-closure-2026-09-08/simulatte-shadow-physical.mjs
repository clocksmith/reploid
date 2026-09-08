import {chromium} from '/Users/xyz/deco/reploid/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist','--use-angle=metal']});
const page=await browser.newPage();await page.goto('http://127.0.0.1:4301/');
await page.addScriptTag({url:'/simulatte/app/webgpu-math.js'});await page.addScriptTag({url:'/simulatte/app/webgpu-sun-shadow.js'});
const report=await page.evaluate(async()=>{
 const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('adapter missing');const device=await adapter.requestDevice();const errors=[];device.addEventListener('uncapturederror',event=>errors.push(event.error.message));
 const shadow=SimulatteSunShadow.create(device,3);
 const corners=[[-2,0,-2],[2,0,-2],[2,0,2],[-2,0,2],[-2,10,-2],[2,10,-2],[2,10,2],[-2,10,2]];
 const faces=[[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[0,3,2,1]];const values=new Float32Array(faces.flatMap(([a,b,c,d])=>[a,b,c,a,c,d].flatMap(i=>corners[i])));
 const vertex=device.createBuffer({size:values.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(vertex,0,values);
 const texture=device.createTexture({size:[3,1],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
 const read=device.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 const layout=device.createBindGroupLayout({entries:shadow.layoutEntries});const group=device.createBindGroup({layout,entries:shadow.entries});
 const shader=device.createShaderModule({code:SimulatteSunShadow.WGSL+`
 @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4<f32>{let p=array<vec2<f32>,3>(vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));return vec4(p[i],0.,1.);}
 @fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{let queries=array<vec3<f32>,3>(vec3(-10.,0.,0.),vec3(10.,0.,0.),vec3(0.,10.,0.));let v=sunVisibility(queries[u32(p.x)]);return vec4(v,v,v,1.);}`});
 const compilation=await shader.getCompilationInfo();if(compilation.messages.some(m=>m.type==='error'))throw Error(JSON.stringify(compilation.messages));
 const pipeline=device.createRenderPipeline({layout:device.createPipelineLayout({bindGroupLayouts:[layout]}),vertex:{module:shader,entryPoint:'vs'},fragment:{module:shader,entryPoint:'fs',targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'}});
 const samples=[];for(const directionToSun of [[1,1,0],[-1,1,0],[1,-1,0]]){
 const encoder=device.createCommandEncoder();const receipt=shadow.encode(encoder,{sun:{directionToSun},center:[0,0,0],radius:120,rows:[{buffer:vertex,vertexCount:values.length/3}]});
 const pass=encoder.beginRenderPass({colorAttachments:[{view:texture.createView(),clearValue:[0,0,0,1],loadOp:'clear',storeOp:'store'}]});pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.draw(3);pass.end();encoder.copyTextureToBuffer({texture},{buffer:read,bytesPerRow:256},[3,1]);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const pixels=new Uint8Array(read.getMappedRange()).slice(0,12);read.unmap();samples.push({directionToSun,visibility:[pixels[0],pixels[4],pixels[8]],receipt});}
 shadow.destroy();vertex.destroy();texture.destroy();read.destroy();device.destroy();return{adapter:adapter.info,samples,errors};
});await browser.close();await fs.writeFile('/tmp/simulatte-shadow-physical.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
const [east,west,night]=report.samples.map(s=>s.visibility);if(report.errors.length||east[0]>50||east[1]<240||west[0]<240||west[1]>50||night.some(v=>v!==255))throw Error('Physical occlusion comparison failed');
