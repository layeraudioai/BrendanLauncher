'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createProfile, verifyProfile, restoreDonor} = require('../tools/nro-profile-manager.cjs');
function fakeNro(seed) { const b = Buffer.alloc(0x100, seed); b.write('NRO0', 0x10, 'ascii'); return b; }
async function fixture(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nro-prof-')); t.after(() => fs.rm(root, {recursive:true, force:true})); return root; }
test('stages donor original and payload with hashes without modifying sources', async t => {
 const root = await fixture(t), donor = path.join(root,'donor.nro'), payload = path.join(root,'payload.nro');
 const d=fakeNro(0x31), p=fakeNro(0x52); await fs.writeFile(donor,d); await fs.writeFile(payload,p);
 const m=await createProfile({root:path.join(root,'profiles'),id:'demo',donor,payload,titleId:'0100000000001000',donorLabel:'Test donor'});
 assert.equal(m.state,'staged-only'); assert.match(m.warning,/not bootable/);
 assert.deepEqual(await fs.readFile(donor),d); assert.deepEqual(await fs.readFile(payload),p);
 const staged=path.join(root,'profiles','demo'); assert.deepEqual(await fs.readFile(path.join(staged,'donor-original.nro')),d);
 assert.deepEqual(await fs.readFile(path.join(staged,'payload.nro')),p);
 assert.equal((await verifyProfile({id:'demo',root:path.join(root,'profiles')})).payload.sha256,m.payload.sha256);
});
test('never overwrites an existing profile or restore destination', async t => {
 const root=await fixture(t), donor=path.join(root,'d.nro'), payload=path.join(root,'p.nro'), profiles=path.join(root,'profiles');
 await fs.writeFile(donor,fakeNro(1)); await fs.writeFile(payload,fakeNro(2));
 await createProfile({root:profiles,id:'d',donor,payload});
 await assert.rejects(createProfile({root:profiles,id:'d',donor,payload}));
 const out=path.join(root,'restored.nro'); await fs.writeFile(out,'keep');
 await assert.rejects(restoreDonor({id:'d',root:profiles,output:out})); assert.equal(await fs.readFile(out,'utf8'),'keep');
 const fresh=path.join(root,'restored-fresh.nro'); const result=await restoreDonor({id:'d',root:profiles,output:fresh});
 assert.equal(result.sha256,(await verifyProfile({id:'d',root:profiles})).donorOriginal.sha256);
});
test('rejects invalid NRO, traversal IDs, bad title IDs, and tampering', async t => {
 const root=await fixture(t), donor=path.join(root,'d.nro'), payload=path.join(root,'p.nro'), profiles=path.join(root,'profiles');
 await fs.writeFile(donor,Buffer.alloc(0x100)); await fs.writeFile(payload,fakeNro(2));
 await assert.rejects(createProfile({root:profiles,id:'d',donor,payload}),/NRO0/);
 await fs.writeFile(donor,fakeNro(1)); await assert.rejects(createProfile({root:profiles,id:'../bad',donor,payload}),/safe filename/);
 await assert.rejects(createProfile({root:profiles,id:'d',donor,payload,titleId:'123'}),/16 hexadecimal/);
 await createProfile({root:profiles,id:'d',donor,payload}); await fs.writeFile(path.join(profiles,'d','payload.nro'),fakeNro(3));
 await assert.rejects(verifyProfile({id:'d',root:profiles}),/hash verification/);
});
