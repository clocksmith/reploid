import {it,expect} from 'vitest';
import {createPieceAcquisition} from '../../packages/reploid/src/artifacts/custody/piece-acquisition.js';
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
