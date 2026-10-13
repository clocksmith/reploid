import { it, expect, vi } from 'vitest';
import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';
import { projectExecutionActivity } from '../../self/ui/pool-home/execution-activity.js';
import { automaticOrderedMesh, tasks } from '../fixtures/automatic-ordered-mesh.js';

it('projects authenticated measured stage timing in the actual requester workspace before generation finishes',async()=>{
  const f=await automaticOrderedMesh();let workspace,gate,callback,last,stored;
  try{
    await f.prepare();await vi.waitFor(()=>expect(f.select(5,0)).toBeTruthy());
    workspace=createChatWorkspace({meshId:'mesh',participantId:f.identities[5].peerId,
      store:{load:()=>stored,save:value=>{stored=structuredClone(value);}},
      execute:(request,controls)=>{
        callback=controls.onActivity;
        return f.meshes[5].generate(request,{...controls,onActivity:event=>{last=structuredClone(event);return callback(event);}});
      }});
    const thread=workspace.createThread({model:f.select(5,0),permissions:{sharingScope:'mesh'}});
    gate=f.gate(0,thread,1);
    const pending=workspace.send(thread,tasks[0].prompt);
    await vi.waitFor(()=>expect(workspace.getState().threads[0].attempts.at(-1).status).toBe('approval'));
    const attempt=workspace.getState().threads[0].attempts.at(-1);
    workspace.approve(thread,attempt.id,attempt.approval.id,true);
    await gate.entered;
    const state=workspace.getState(),activeThread=state.threads[0],view=projectExecutionActivity({...state,activeThread});
    expect(activeThread.attempts.at(-1).status).toBe('executing');
    expect(activeThread.messages.at(-1).content).toBe(tasks[0].chunks[0]);
    expect(view.nodes).toHaveLength(3);
    expect(view.nodes.every(row=>row.timing.count===1&&Number.isFinite(row.timing.total)&&row.timing.total>0)).toBe(true);
    expect(view.nodes.reduce((sum,row)=>sum+row.share,0)).toBeCloseTo(1);
    expect(view.nodes.map(row=>row.id)).toEqual(f.select(5,0).partition.route.stages.map(row=>row.participantId));
    const original=structuredClone(activeThread.attempts.at(-1).execution);
    expect(()=>callback(last)).toThrow(/activity/);
    expect(workspace.getState().threads[0].attempts.at(-1).execution).toEqual(original);
    gate.release();const completed=await pending;expect(completed.status).toBe('completed');
    const terminal=workspace.getState();expect(()=>callback(last)).toThrow(/Late/);expect(workspace.getState()).toEqual(terminal);
    expect(terminal.threads[0].messages.at(-1).content).toBe(tasks[0].chunks.join(''));
    expect(f.loads[5]).not.toHaveBeenCalled();
  }finally{gate?.release();await workspace?.close();await f.close();}
});
