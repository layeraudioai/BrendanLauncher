'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {addresses,chooseHost}=require('./start-launcher.cjs');

test('discovers usable IPv4 addresses and excludes loopback/link-local interfaces',()=>{
 const found=addresses({
  ethernet:[
   {family:'IPv4',internal:false,netmask:'255.255.255.0',address:'10.0.0.5'},
   {family:'IPv4',internal:false,netmask:'255.255.255.0',address:'10.0.0.5'},
   {family:'IPv4',internal:false,netmask:'255.255.255.0',address:'169.254.1.2'},
   {family:'IPv4',internal:false,netmask:'255.255.255.255',address:'192.0.2.1'}
  ],
  loopback:[{family:'IPv4',internal:true,netmask:'255.0.0.0',address:'127.0.0.1'}]
 });
 assert.deepEqual(found,['10.0.0.5']);
});

test('uses the supplied address when more than one network interface exists',async()=>{
 assert.equal(await chooseHost(['10.0.0.5'],{choices:['10.0.0.5','192.168.56.1']}),'10.0.0.5');
});

test('reports available addresses when unattended startup needs a choice',async()=>{
 await assert.rejects(
  chooseHost([],{choices:['10.0.0.5','192.168.56.1'],stdin:{isTTY:false}}),
  /node server\.cjs <computer-IP>[\s\S]*10\.0\.0\.5, 192\.168\.56\.1/
 );
});
