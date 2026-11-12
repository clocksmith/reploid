import {it,expect} from 'vitest';
import {createPieceAcquisition} from '../../packages/reploid/src/artifacts/custody/piece-acquisition.js';
import {countSupplier} from '../../packages/reploid/src/artifacts/custody/supplier-summary.js';
const piece={identity:'sha256:'+'a'.repeat(64),path:'file.bin',offset:0,size:4};
const limits={maxConcurrent:1,maxQueued:4,maxPieceBytes:4,timeoutMs:1000};
it('deduplicates in-flight work, reuses verified cache, and replaces a departed supplier',async()=>{
 const cache=new Map();let calls=0;const store=createPieceAcquisition({limits,
  cache:{get:async k=>cache.get(k),put:async(k,v)=>cache.set(k,v)},
  sources:()=>[{id:'lost',read:async()=>{throw Error('offline');}},{id:'ready',read:async()=>{calls++;return new Uint8Array([1,2,3,4]);}}],
  authorize:async()=>true,verify:async(_p,b)=>b[0]===1&&b.length===4,foregroundIdle:async()=>{}});
 const [a,b]=await Promise.all([store.acquire(piece),store.acquire(piece)]);expect(calls).toBe(1);expect(a).toEqual(b);expect(a).not.toBe(b);
 await new Promise(r=>setTimeout(r,0));await store.acquire(piece);expect(calls).toBe(1);
 expect(store.getReceipt().reusedBytes).toBe(4);expect(store.getReceipt().failedSources).toHaveLength(1);await store.close();
});
it('does not admit unverified bytes into cache and respects source permissions',async()=>{
 let cached=false,calls=0;const store=createPieceAcquisition({limits,cache:{get:async()=>null,put:async()=>{cached=true;}},
  sources:()=>[{id:'forbidden',read:async()=>{calls++;return new Uint8Array(4);}},{id:'bad',read:async()=>new Uint8Array(4)}],
  authorize:async({sourceId})=>sourceId!=='forbidden',verify:async()=>false,foregroundIdle:async()=>{}});
 await expect(store.acquire(piece)).rejects.toThrow('eligible');expect(cached).toBe(false);expect(calls).toBe(0);await store.close();
});
it('names the participant or origin that supplied each verified piece, bounded',async()=>{
 const other={...piece,identity:'sha256:'+'b'.repeat(64)};
 const store=createPieceAcquisition({limits,cache:{get:async()=>null,put:async()=>{}},
  sources:p=>p===undefined?[]:[p.identity===piece.identity
   ?{id:'peers',read:async(_p,{onSupplier})=>{onSupplier('peer_7');return new Uint8Array([1,2,3,4]);}}
   :{id:'pinned-origin:huggingface',supplier:'origin:owner/repo@'+'c'.repeat(40),read:async()=>new Uint8Array([1,2,3,4])}],
  authorize:async()=>true,verify:async(_p,b)=>b[0]===1,foregroundIdle:async()=>{}});
 await store.acquire(piece);await store.acquire(other);
 expect(store.getReceipt().suppliers).toEqual({peer_7:{pieces:1,bytes:4},['origin:owner/repo@'+'c'.repeat(40)]:{pieces:1,bytes:4}});
 await store.close();
 const summary={};for(let i=0;i<20;i++)countSupplier(summary,'peer_'+i,1);countSupplier(summary,'peer_0',1);countSupplier(summary,'10.0.0.1:443 x',1);
 expect(Object.keys(summary)).toHaveLength(17);expect(summary.peer_0).toEqual({pieces:2,bytes:2});expect(summary.other).toEqual({pieces:5,bytes:5});
 expect(countSupplier({},'host name with spaces',1)).toEqual({unlabelled:{pieces:1,bytes:1}});
});
