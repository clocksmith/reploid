import { describe, it, expect, vi } from 'vitest';
import { createPartitionDataChannel } from '../../packages/reploid/src/transport/partition-data-channel.js';
import { createPartitionNetwork } from '../../packages/reploid/src/mesh/partitions/partition-network.js';
import { fixture as routeFixture } from '../fixtures/ordered-partition-ports.js';
function channels() {
  const pair = [new EventTarget(), new EventTarget()];
  pair.forEach((channel,index)=>Object.assign(channel,{readyState:'open',ordered:true,maxRetransmits:null,maxPacketLifeTime:null,bufferedAmount:0,
    send(data){queueMicrotask(()=>{if(pair[1-index].readyState==='open')pair[1-index].dispatchEvent(new MessageEvent('message',{data:structuredClone(data)}));});},
    close(){if(this.readyState==='closed')return;this.readyState='closed';this.dispatchEvent(new Event('close'));queueMicrotask(()=>pair[1-index].close());}}));
  return pair;
}
function fixture({maxPeers=4,timeoutMs=1000,mutate,verify,validate,makeEndpoint}={}) {
  const f=routeFixture(3), route=structuredClone(f.route), ids=['peer:'+'a'.repeat(24),'peer:'+'b'.repeat(24)];
  route.stages[0].participantId=ids[0];route.stages[1].participantId=ids[1];
  const subscribers=[new Map(),new Map()], pairs=[], owners=[[],[]], bindings=[{local:'a',remote:'b'},{local:'b',remote:'a'}];
  const networks=[0,1].map(index=>createPartitionNetwork({label:'reploid-partitions-ordered',maxPeers,timeoutMs,
    transport:{getPeerBinding:()=>bindings[index],onDataChannel(label,handler){subscribers[index].set(label,handler);return()=>subscribers[index].delete(label);},
      openDataChannel(peer,label){expect(peer).toBe('transport-'+(1-index));const pair=channels();pairs.push(pair);
        mutate?.(pair,index);subscribers[1-index].get(label)(`transport-${index}`,pair[1]);return pair[0];}},
    verifyPeer:verify?(peerId,signal)=>verify(index,signal):async()=>ids[1-index],
    ordered:{maxRouteBytes:16384,validateRoute:async(bound,context)=>{
      if(validate)return validate(index,bound,context);
      return context.remoteParticipantId===ids[1-index] && context.remoteTransportId===`transport-${1-index}`
        && bound.stages[0].participantId===ids[0] && bound.stages[1].participantId===ids[1]
        && bound.stages[1].residentId===route.stages[1].residentId;
    }},
    createEndpoint:input=>{const owner=makeEndpoint?makeEndpoint(index,input):{...input,close:vi.fn(async()=>{})};owners[index].push(owner);return owner;}}));
  return {route,networks,owners,pairs,bindings,async close(){await Promise.allSettled(networks.map(owner=>owner.close()));await f.runner.close();}};
}
describe('authenticated immutable route-keyed network (injected certificate verifier)',()=>{
  it('keeps simultaneous routes to the same participant on distinct channels and retires only the named route',async()=>{
    const f=fixture();try{
      const second=structuredClone(f.route);second.stages[2].residentId='other-final';
      const a=await f.networks[0].connect('transport-1',{route:f.route});
      const b=await f.networks[0].connect('transport-1',{route:second});
      expect(a).not.toBe(b);expect(f.networks[0].getState().channels).toBe(2);
      expect(await f.networks[0].connect('transport-1',{route:f.route})).toBe(a);
      await f.networks[0].retire('transport-1',{route:f.route});
      expect(a.close).toHaveBeenCalledTimes(1);expect(b.close).not.toHaveBeenCalled();
      expect(await f.networks[0].connect('transport-1',{route:second})).toBe(b);
    }finally{await f.close();}
  });
  it('hands the bound channel to the existing binary transport after authentication',async()=>{
    const policy={maxFrameBytes:64,maxControlBytes:4096,maxPayloadBytes:4096,maxPendingBytes:8192,
      maxPendingRequests:4,maxRequestsPerChannel:20,maxBufferedBytes:8192,maxTransferBytes:65536,timeoutMs:1000};
    const f=fixture({makeEndpoint:(index,input)=>createPartitionDataChannel({channel:input.channel,
      localParticipantId:'peer:'+(index?'b':'a').repeat(24),remoteParticipantId:input.remoteParticipantId,limits:policy,
      authorize:async({metadata})=>metadata.operation==='bound-echo',
      serve:async(_metadata,payload)=>({bytes:[...payload],route:input.route})})});
    try{
      const endpoint=await f.networks[0].connect('transport-1',{route:f.route});
      const result=await endpoint.request({operation:'bound-echo'},new Uint8Array([3,7,11]));
      expect(result.bytes).toEqual([3,7,11]);expect(result.route).toEqual(f.route);
    }finally{await f.close();}
  });
  it('snapshots route before authentication awaits and passes exact authenticated transport metadata',async()=>{
    const gate=Promise.withResolvers();const f=fixture({verify:async index=>{await gate.promise;return 'peer:'+(index?'a':'b').repeat(24);}});
    try{
      const route=structuredClone(f.route), pending=f.networks[0].connect('transport-1',{route});route.stages[2].residentId='caller-mutated';gate.resolve();
      const endpoint=await pending;expect(endpoint.route).toEqual(f.route);expect(endpoint.remoteTransportId).toBe('transport-1');
      expect(f.owners[1][0].route).toEqual(f.route);expect(Object.isFrozen(endpoint.route.stages[0])).toBe(true);
    }finally{gate.resolve();await f.close();}
  });
  it('rejects host stage mismatch before endpoint creation',async()=>{
    const f=fixture();try{
      const route=structuredClone(f.route);route.stages[1].residentId='not-resident';
      await expect(f.networks[0].connect('transport-1',{route})).rejects.toThrow();
      expect(f.owners).toEqual([[],[]]);
    }finally{await f.close();}
  });
  it('rejects an altered acceptance route and closes the already prepared peer endpoint',async()=>{
    const f=fixture({mutate:pair=>{const send=pair[1].send;pair[1].send=function(data){const message=JSON.parse(data);message.route.stages[2].executionId='altered';send.call(this,JSON.stringify(message));};}});
    try{await expect(f.networks[0].connect('transport-1',{route:f.route})).rejects.toThrow('route changed');
      await vi.waitFor(()=>expect(f.owners[1][0].close).toHaveBeenCalledTimes(1));expect(f.owners[0]).toEqual([]);
    }finally{await f.close();}
  });
  it('bounds handshake bytes before parsing and refuses extra routes without evicting a healthy one',async()=>{
    const f=fixture({maxPeers:1});try{
      const a=await f.networks[0].connect('transport-1',{route:f.route}), other=structuredClone(f.route);other.stages[2].executionId='other';
      expect(()=>f.networks[0].connect('transport-1',{route:other})).toThrow('allocation');expect(a.close).not.toHaveBeenCalled();
    }finally{await f.close();}
    const bad=fixture({mutate:pair=>{pair[0].send=function(){queueMicrotask(()=>pair[1].dispatchEvent(new MessageEvent('message',{data:'x'.repeat(20000)})));};}});
    try{await expect(bad.networks[0].connect('transport-1',{route:bad.route})).rejects.toThrow();expect(bad.owners).toEqual([[],[]]);}
    finally{await bad.close();}
  });
  it('checks certificates again after asynchronous route validation',async()=>{
    const entered=Promise.withResolvers(), release=Promise.withResolvers();const f=fixture({validate:async index=>{if(index===1){entered.resolve();await release.promise;}return true;}});
    try{const operation=f.networks[0].connect('transport-1',{route:f.route});const failure=expect(operation).rejects.toThrow();
      await entered.promise;f.bindings[1].remote='replacement';release.resolve();await failure;
      expect(f.owners).toEqual([[],[]]);
    }finally{release.resolve();await f.close();}
  });
  it('retains failed cleanup capacity and permits retry without disturbing another route',async()=>{
    const f=fixture();try{
      const second=structuredClone(f.route);second.stages[2].residentId='survivor';
      const a=await f.networks[0].connect('transport-1',{route:f.route}), b=await f.networks[0].connect('transport-1',{route:second});
      a.close.mockRejectedValueOnce(Error('cleanup unknown'));
      await expect(f.networks[0].retire('transport-1',{route:f.route})).rejects.toThrow('unknown');
      expect(f.networks[0].getState()).toMatchObject({channels:2,retiring:1});
      expect(()=>f.networks[0].connect('transport-1',{route:f.route})).toThrow('charged');expect(b.close).not.toHaveBeenCalled();
      await f.networks[0].retire('transport-1',{route:f.route});expect(a.close).toHaveBeenCalledTimes(2);
      expect(f.networks[0].getState().channels).toBe(1);
    }finally{await f.close();}
  });
  it('does not infer resident cleanup from a lost socket and retries network close explicitly',async()=>{
    const f=fixture();try{
      const a=await f.networks[0].connect('transport-1',{route:f.route});a.close.mockRejectedValue(Error('unsettled'));
      a.channel.close();await vi.waitFor(()=>expect(a.close).toHaveBeenCalledTimes(1));
      expect(f.networks[0].getState().channels).toBe(1);
      await expect(f.networks[0].close()).rejects.toThrow('unsettled');
      expect(f.networks[0].getState().channels).toBe(1);a.close.mockResolvedValue();await f.networks[0].close();
      expect(f.networks[0].getState().channels).toBe(0);
    }finally{await f.close();}
  });
  it('bounds a stalled validator and ignores its late completion without creating an endpoint',async()=>{
    const release=Promise.withResolvers(), entered=Promise.withResolvers();
    const f=fixture({timeoutMs:20,validate:async()=>{entered.resolve();return release.promise;}});
    try{
      const pending=f.networks[0].connect('transport-1',{route:f.route});const failure=expect(pending).rejects.toThrow();
      await entered.promise;await failure;await Promise.all(f.networks.map(network=>network.close()));
      release.resolve(true);await Promise.resolve();expect(f.owners).toEqual([[],[]]);
      expect(f.networks.every(network=>network.getState().channels===0)).toBe(true);
    }finally{release.resolve(true);await f.close();}
  });
  it('times out an absent handshake and never creates an endpoint',async()=>{
    const f=fixture({timeoutMs:20,mutate:pair=>{pair[0].send=()=>{};}});
    try{await expect(f.networks[0].connect('transport-1',{route:f.route})).rejects.toThrow();expect(f.owners).toEqual([[],[]]);}
    finally{await f.close();}
  });
});
