import { expect, it, vi } from 'vitest';
import { automaticOrderedMesh, tasks } from '../fixtures/automatic-ordered-mesh.js';

// Injected task responses test custody/isolation, not factual/code quality.
it('isolates distinct tasks through cancellation, replica join, middle withdrawal and freshly approved replacement', async () => {
  const f = await automaticOrderedMesh();
  const run = (requester, coordinator, task, threadId, controls = {}) => {
    const approve = vi.fn(async () => true), deltas = [];
    const input = { model: f.select(requester, coordinator), messages: [{ role: 'user', content: tasks[task].prompt }], threadId, attemptId: threadId };
    const promise = f.meshes[requester].generate(input, { requestApproval: approve, onDelta: event => deltas.push(event), ...controls });
    // Retain rejections promptly while the other route remains deliberately paused.
    return { input, approve, deltas, outcome: promise.then(value => ({ value }), error => ({error})) };
  };
  try {
    await f.prepare();
    await vi.waitFor(() => { expect(f.select(5,0)).toBeTruthy(); expect(f.select(6,3)).toBeTruthy(); }, { timeout: 5000 });
    const routeA = structuredClone(f.select(5,0).partition.route), routeB = structuredClone(f.select(6,3).partition.route);
    expect(routeA.stages[1].participantId).toBe(f.identities[1].peerId);
    expect(routeB.stages[1].participantId).toBe(f.identities[4].peerId);
    const gateA = f.gate(1,'cancel-code'), gateB = f.gate(4,'survivor-explanation');
    const cancellation = new AbortController();
    const a = run(5,0,0,'cancel-code',{signal:cancellation.signal}), b = run(6,3,1,'survivor-explanation');
    await vi.waitFor(()=>{expect(gateA.used).toBe(true);expect(gateB.used).toBe(true);},{timeout:4000});
    // A new eligible replica must not retarget either already-approved route.
    await f.meshes[7].contribute(f.model.id,true);
    expect(f.meshes[0].getModels()[0].partition.route).toEqual(routeA);
    cancellation.abort(Error('Requester stopped coding answer')); gateA.release();
    expect((await a.outcome).error).toBeTruthy();
    expect(a.deltas.map(row=>row.text).join('')).toBe(tasks[0].chunks[0]);
    await vi.waitFor(()=>expect(f.states[2].attempts.size).toBe(1));
    gateB.release(); const completeB = await b.outcome;
    expect(completeB.error).toBeUndefined(); expect(completeB.value.content).toBe(tasks[1].chunks.join(''));
    expect(completeB.value.execution.identity.route).toEqual(routeB);
    expect(b.deltas.every(row=>row.threadId==='survivor-explanation')).toBe(true);
    expect(f.states[2].resident.close).not.toHaveBeenCalled();

    const withdrawGate = f.gate(1,'withdraw-code'), survivorGate = f.gate(4,'withdraw-survivor');
    const failed = run(5,0,0,'withdraw-code'), survivor = run(6,3,1,'withdraw-survivor');
    await Promise.all([withdrawGate.entered,survivorGate.entered]);
    const stop = f.meshes[1].stop(); withdrawGate.release(); await stop;
    expect((await failed.outcome).error).toBeTruthy();
    expect(f.states[1].attempts.size).toBe(0); expect(f.states[1].resident.close).toHaveBeenCalledOnce();
    expect(f.states[2].resident.close).not.toHaveBeenCalled();
    survivorGate.release(); expect((await survivor.outcome).value.content).toBe(tasks[1].chunks.join(''));
    await vi.waitFor(() => expect(f.select(5,0)?.partition.route.stages[1].participantId).toBe(f.identities[7].peerId), { timeout: 5000 });
    const retry = run(5,0,0,'replacement-code'); const retried = await retry.outcome;
    expect(retried.error).toBeUndefined(); expect(retried.value.content).toBe(tasks[0].chunks.join(''));
    expect(retry.approve).toHaveBeenCalledOnce();
    expect(retry.approve.mock.calls[0][0].input.recipients).toContain(f.identities[7].peerId);
    expect(retry.approve.mock.calls[0][0].input.recipients).not.toContain(f.identities[1].peerId);
    expect(retried.value.execution.identity.attemptId).not.toBe(failed.input.attemptId);
    expect(failed.deltas.map(row=>row.text).join('')).toBe(tasks[0].chunks[0]);
    expect(f.states[0].received.every(messages=>messages[0].content===tasks[0].prompt)).toBe(true);
    expect(f.states[3].received.every(messages=>messages[0].content===tasks[1].prompt)).toBe(true);
    expect(f.loads[5]).not.toHaveBeenCalled(); expect(f.loads[6]).not.toHaveBeenCalled();
    expect(f.loads[2]).toHaveBeenCalledOnce(); expect(f.loads[4]).toHaveBeenCalledOnce();
    expect(f.states.every(state=>state.attempts.size===0)).toBe(true);
  } catch(error) { console.log('PRIMARY',error); throw error; } finally { await f.close(); }
}, 20000);
