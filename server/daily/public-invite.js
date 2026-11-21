import {randomUUID} from 'node:crypto';
import {link,readFile,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

// An operator opts in once. Page views cannot mint credentials or resurrect a revoked invite.
export async function ensurePublicDailyInvite({store,directory,origin}) {
  if (new URL(origin).protocol !== 'https:') throw Error('Public play requires its own HTTPS origin.');
  const path = join(directory,'public-circle-invite.json');
  const existing = async () => {
    const record = JSON.parse(await readFile(path,'utf8'));
    if (record.origin !== origin) throw Error('Circle invitation belongs to another origin.');
    return store.resolveCircle(record.token) ? record.token : null;
  };
  try { return await existing(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }

  const grant = store.circleInvite({expiresAt:Date.now()+30*86400_000});
  const tmp = path + '.' + randomUUID();
  let installed = false;
  try {
    await writeFile(tmp,JSON.stringify({origin,id:grant.id,token:grant.token,expiresAt:grant.expiresAt}),{flag:'wx',mode:0o600});
    try {await link(tmp,path);}
    catch (error) {if (error.code === 'EEXIST') return await existing(); throw error;}
    installed = true;
    return grant.token;
  } finally {
    if (!installed) store.revokeCircle(grant.id);
    await unlink(tmp).catch(error => {if (error.code !== 'ENOENT') throw error;});
  }
}
