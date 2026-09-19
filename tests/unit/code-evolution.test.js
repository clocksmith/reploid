import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { createCodeEvolution, createImprovementLedger } from '../../packages/reploid/src/improvement/index.js';
import { ensureIdentityBundle } from '../../self/identity.js';

const candidate = '({value}) => value.trim().toLowerCase()';
async function fixture() {
  const files = new Map(), identities = new Map(); let state = null, approved = true, failSave = false;
  let queue = Promise.resolve();
  const ledger = createImprovementLedger({ VFS: { exists: async p => files.has(p), read: async p => files.get(p), write: async (p, v) => files.set(p,v) },
    getIdentity: () => ensureIdentityBundle({ instanceId: 'unit-evolution', storage: {getItem:k=>identities.get(k)||null,setItem:(k,v)=>identities.set(k,v),key:i=>[...identities.keys()][i],get length(){return identities.size;}} }) });
  const options = { targets: [{ id:'Normalize', description:'Trim and lowercase a string', code:'({value}) => value.toLowerCase()',
    tests:[{input:{value:'A'},expected:'a'},{input:{value:' B '},expected:'b'}] }], policy:{maxCodeCharacters:500,maxCandidates:8}, ports:{ledger,
    load:async()=>state?structuredClone(state):null, save:async next=>{if(failSave)throw new Error('Storage full');state=structuredClone(next);},
    lock:operation=>{const task=queue.then(operation,operation);queue=task.catch(()=>{});return task;},
    execute:async(code,input)=>vm.runInNewContext('('+code+')(input)',{input},{timeout:100}),
    verify:async()=>({passed:true}),writeEvidence:async(p,v)=>files.set(p,JSON.stringify(v)),authorize:async()=>approved
  }};
  const engine=createCodeEvolution(options);
  const propose=(code=candidate)=>engine.propose({targetId:'Normalize',code,reason:'Handle surrounding whitespace',baselineGeneration:'Normalize:genesis',taskId:'task:1',
    generator:{implementation:'unit-fixture',model:'injected-model',instruction:'Normalize text'}});
  return {engine,propose,options,getState:()=>state,setState:v=>{state=v;},deny:()=>{approved=false;},fail:v=>{failSave=v;}};
}

describe('governed code evolution',()=>{
  it('does not count a sandbox timeout as correct rejection of invalid input',async()=>{
    const f=await fixture();
    f.options.targets[0].tests.push({input:{invalid:true},throws:true});
    const execute=f.options.ports.execute;
    const engine=createCodeEvolution({...f.options,ports:{...f.options.ports,execute:async(code,input)=>{
      if(input.invalid) throw new Error('Code execution exceeded its time limit');
      return execute(code,input);
    }}});
    const result=await engine.propose({targetId:'Normalize',code:candidate,reason:'Trim text',baselineGeneration:'Normalize:genesis',taskId:'task:timeout',
      generator:{implementation:'fixture',model:'fixture',instruction:'Trim text'}});
    expect(result.status).toBe('rejected');expect(result.evaluation.candidatePassed).toBe(2);
  });
  it('keeps passing candidates inactive until approval and restores their baseline',async()=>{
    const {engine,propose}=await fixture();const proposed=await propose();
    expect(proposed.status).toBe('awaiting-approval');expect(await engine.run('Normalize',{value:' B '})).toBe(' b ');
    await engine.decide(proposed.id,true);expect(await engine.run('Normalize',{value:' B '})).toBe('b');
    const evidence=await engine.export(proposed.id);expect(evidence.episode.integrity.valid).toBe(true);
    await engine.rollback(proposed.id);expect(await engine.run('Normalize',{value:' B '})).toBe(' b ');
  });
  it('rejects a candidate that improves nothing and preserves evaluation failures',async()=>{
    const {engine,propose}=await fixture();const proposed=await propose('({value}) => value.toLowerCase()');
    expect(proposed.status).toBe('rejected');await expect(engine.decide(proposed.id,true)).rejects.toThrow('not awaiting');
    expect((await engine.export(proposed.id)).episode.comparison.conclusion).toBe('not-improved');
  });
  it('cannot bypass the host adoption permission or change an evaluated candidate',async()=>{
    const f=await fixture();const proposed=await f.propose();f.deny();
    await expect(f.engine.decide(proposed.id,true)).rejects.toThrow('Host denied');
    const state=f.getState();state.candidates[0].code='() => "forged"';f.setState(state);
    const other=createCodeEvolution({...f.options,ports:{...f.options.ports,authorize:async()=>true}});
    await expect(other.decide(proposed.id,true)).rejects.toThrow('Candidate bytes differ');
  });
  it('retries failed persistence after approval without activating an uncommitted version',async()=>{
    const f=await fixture();const proposed=await f.propose();f.fail(true);
    await expect(f.engine.decide(proposed.id,true)).rejects.toThrow('Storage full');
    expect(await f.engine.run('Normalize',{value:' B '})).toBe(' b ');
    f.fail(false);await f.engine.decide(proposed.id,true);expect(await f.engine.run('Normalize',{value:' B '})).toBe('b');
  });
  it('refuses changed active bytes and recovers interrupted evaluations',async()=>{
    const f=await fixture();const proposed=await f.propose();await f.engine.decide(proposed.id,true);
    const state=f.getState();state.active.Normalize.code='() => "tampered"';f.setState(state);
    await expect(f.engine.describe()).rejects.toThrow('signed approval');
    state.active.Normalize.episodeId=null;state.active.Normalize.generationId='Normalize:genesis';f.setState(state);
    await expect(f.engine.describe()).rejects.toThrow('immutable baseline');
    const other=await fixture();other.setState({revision:1,active:{},candidates:[{id:'interrupted',status:'evaluating',baseline:{generationId:'Normalize:genesis'}}]});
    expect((await other.engine.list())[0].status).toBe('cancelled');
  });
});
