'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const src=fs.readFileSync(require.resolve('../ports/ozone-nro-launcher/src/main.c'),'utf8');
test('separate companion requires loader-provided chainload support',()=>{assert.match(src,/envHasNextLoad\(\)/);assert.match(src,/envSetNextLoad\(path, NULL\)/);assert.match(src,/Blocked: active loader has no NextLoadPath handoff/);});
test('companion only scans SD switch directory and NRO paths',()=>{assert.match(src,/fsFsOpenDirectory\(&g_sd, "\/switch"/);assert.match(src,/"\/switch\/%s"/);assert.match(src,/"sdmc:\/switch\/%s"/);assert.doesNotMatch(src,/svcMapProcessCodeMemory|svcCreateProcess|svcStartProcess/);});
test('companion validates NRO segment bounds before chainload request',()=>{assert.match(src,/offset > image_size \|\| size > image_size - offset/);assert.match(src,/fsFileRead\(&f, 0x10, header/);});
test('companion keeps unverified transport boundaries explicit',()=>{assert.match(src,/Only top-level SD:\/switch\/\*\.nro files are scanned/);assert.match(src,/envSetNextLoad/);});
