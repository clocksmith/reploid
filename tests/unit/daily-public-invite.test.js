// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDailyStore} from '../../server/daily/store.js';
import {ensurePublicDailyInvite} from '../../server/daily/public-invite.js';

it('concurrent starts publish one durable circle invite and never rearm a revoked grant',async () => {
  const directory = await mkdtemp(join(tmpdir(),'circle-invite-'));
  const store = createDailyStore({path:':memory:',hostId:'test'});
  const config = {store,directory,origin:'https://daily.example'};
  try {
    const [a,b] = await Promise.all([ensurePublicDailyInvite(config),ensurePublicDailyInvite(config)]);
    expect(a).toBe(b);
    expect(await ensurePublicDailyInvite(config)).toBe(a);
    await expect(ensurePublicDailyInvite({...config,origin:'https://other.example'})).rejects.toThrow('another origin');
    store.revokeCircle(store.resolveCircle(a).id);
    expect(await ensurePublicDailyInvite(config)).toBeNull();
  } finally {store.close();await rm(directory,{recursive:true,force:true});}
});
