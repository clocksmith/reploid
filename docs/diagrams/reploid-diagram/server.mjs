/** Local, read-only server. No credentials, external APIs or write endpoints. */
import http from 'node:http';
import path from 'node:path';
import {readFile,stat,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.md':'text/plain; charset=utf-8'};
const port=Number(process.env.PORT??8080);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT.');
const server=http.createServer(async(req,res)=>{
  try {
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
    let p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(p.includes('\0')||p.includes('\\')||p.split('/').some(x=>x==='..'||x.startsWith('.'))){res.writeHead(403);res.end();return;}
    let base=root,name=p==='/'?'index.html':p.slice(1);
    if(p.startsWith('/vendor/three/')){base=path.join(root,'node_modules/three/build');name=p.slice('/vendor/three/'.length);}
    else if(p.includes('/node_modules/')||p.startsWith('/node_modules/')){res.writeHead(403);res.end();return;}
    const target=path.resolve(base,name);if(!target.startsWith(path.resolve(base)+path.sep)){res.writeHead(403);res.end();return;}
    const actual=await realpath(target);if(!actual.startsWith(path.resolve(base)+path.sep)){res.writeHead(403);res.end();return;}
    if(!(await stat(actual)).isFile()){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':types[path.extname(actual)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?undefined:await readFile(actual));
  }catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found. Run npm install for local Three.js assets.');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Open http://localhost:${port}\nThree.js is loaded from local node_modules; no CDN requests.`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
