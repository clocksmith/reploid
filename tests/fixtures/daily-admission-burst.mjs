// Controlled launch rehearsal. Always starts its own in-memory circle on loopback.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createDailyApp} from '../../server/daily/http.js';
import {createDailyStore} from '../../server/daily/store.js';
const store = createDailyStore({path:':memory:',hostId:'burst-fixture',hostDailyCap:6});
const expiry = Date.now() + 3600000;
const invitation = store.circleInvite({expiresAt:expiry});
const players = Array.from({length:10},(_,i)=>store.authorizeGuest({subject:'fixture/'+i,expiresAt:expiry}));
let generationCount = 0, active = 0, maxActive = 0;
const gameForDay = day => ({day,digest:'fixture-'+day,qualified:true,target:'Blue',banned:['blue'],ruleVersion:'fixture',modelId:'fixture'});
const app = createDailyApp({store,circleName:'Local load fixture',publicInvite:invitation.token,gameForDay,
  async run({onDispatch}) {
    onDispatch(); generationCount++; active++; maxActive = Math.max(maxActive,active);
    try {await new Promise(r => setTimeout(r,5)); return {output:'Blue',receipt:{sequence:generationCount}};}
    finally {active--;}
  }
});
const server = app.listen(0,'127.0.0.1');
await once(server,'listening');
const base = 'http://127.0.0.1:' + server.address().port;
const today = new Date().toISOString().slice(0,10);
async function play(player,key) {
  const response = await fetch(base+'/api/attempt',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',
    'x-circle-invite':invitation.token,...(player?{Cookie:'reploid_daily_guest='+player.token}:{})},
    body:JSON.stringify({day:today,digest:gameForDay(today).digest,prompt:'Sky',key})});
  return {status:response.status,...await response.json()};
}
try {
  const started = performance.now();
  const first = await play(players[0],'first');
  assert.equal(first.status,201);
  const card = store.publish(players[0].token,first.attempt.id,{});
  // Half are plain visits, half open one recorded dare. Neither path runs the model.
  const requests = 50000, concurrency = 24;
  let next = 0;
  await Promise.all(Array.from({length:concurrency},async () => {
    while (next < requests) {
      const index = next++;
      const response = await fetch(base+'/api/today'+(index%2?'?share='+card.id:''));
      assert.equal(response.status,200);
      const state = await response.json();
      assert.equal(state.authenticated,false);
      assert.equal(state.publicInvite,invitation.token);
      if (index%2) assert.equal(state.share.output,'Blue');
    }
  }));
  const readMs = Math.round(performance.now()-started);
  assert.equal(generationCount,1);
  const anonymous = await play(null,'anonymous');
  assert.equal(anonymous.status,401);
  const concurrent = await Promise.all(players.map((p,i)=>play(p,'burst-'+i)));
  assert(concurrent.some(r => r.status === 201));
  for (const r of concurrent) assert(r.status===201 || r.error==='busy' || r.error==='host-full');
  // Drain the remaining capacity through admitted accounts.
  for (let i=0;i<players.length;i++) await play(players[i],'last-'+i);
  assert.equal(store.capacity(today).used,6);
  assert.equal(generationCount,6); assert.equal(maxActive,1);
  assert.equal((await play(players.at(-1),'over-cap')).error,'host-full');
  console.log(JSON.stringify({traffic:'local admission + SQLite with fixture inference',reads:requests,concurrency,
    plainVisits:requests/2,replays:requests/2,readMs,readTriggeredGenerations:0,
    unauthorizedGenerations:0,hostCap:6,executedTurns:generationCount,maxActive},null,2));
} finally {await new Promise(resolve=>server.close(resolve));store.close();}
