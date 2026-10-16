import {afterEach, expect, it} from 'vitest';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {synchronizeInventory} from '../../scripts/build-module-inventory.js';
const temporary=[];
afterEach(async()=>{await Promise.all(temporary.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
it('refreshes emitted bundle hashes and detects staleness without modifying check-mode output',async()=>{
 const root=await mkdtemp(join(tmpdir(),'reploid-inventory-'));temporary.push(root);
 await mkdir(join(root,'config'));await mkdir(join(root,'ui'));
 const bundle=join(root,'ui/app.bundle.js'), manifest=join(root,'config/module-inventory.json');
 await writeFile(bundle,'export const version = 1;');
 await synchronizeInventory({selfDir:root});
 const before=await readFile(manifest,'utf8');
 await writeFile(bundle,'export const version = 2;');
 await expect(synchronizeInventory({selfDir:root,checkOnly:true})).rejects.toThrow('stale');
 expect(await readFile(manifest,'utf8')).toBe(before);
 const updated=await synchronizeInventory({selfDir:root});
 expect(updated.modules[0].sha256).toBe('sha256:'+createHash('sha256').update(await readFile(bundle)).digest('hex'));
 await expect(synchronizeInventory({selfDir:root,checkOnly:true})).resolves.toEqual(updated);
});
it('fails missing or invalid inventories without manufacturing a successful check',async()=>{
 const root=await mkdtemp(join(tmpdir(),'reploid-inventory-'));temporary.push(root);await mkdir(join(root,'config'));
 await expect(synchronizeInventory({selfDir:root,checkOnly:true})).rejects.toThrow('missing or invalid');
 await writeFile(join(root,'config/module-inventory.json'),'invalid');
 await expect(synchronizeInventory({selfDir:root,checkOnly:true})).rejects.toThrow('missing or invalid');
 expect(await readFile(join(root,'config/module-inventory.json'),'utf8')).toBe('invalid');
});
