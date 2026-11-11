import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Bm83AutoUpdater} from '../docs/bm83-auto.js';
const manifest=JSON.parse(await readFile(new URL('../docs/bm83/manifest.json',import.meta.url),'utf8'));
const image=await readFile(new URL('../docs/bm83/'+manifest.filename,import.meta.url));
const info={product:'HEADSET_BT',hardware:'REV01',mode:'application',bm83_bridge:3};
function setup({changeManifest=m=>m,corrupt=false,missing=false}={}){
  const calls=[],events=[];let executions=0;
  const flash={cancel(){},async run(plan,options){executions++;assert.equal(plan.sha256,manifest.sha256);assert.equal(plan.filename,manifest.filename);assert.deepEqual(options,{baud:921600,automatic:true});return {state:'COMPLETE'};}};
  const updater=new Bm83AutoUpdater(flash,e=>events.push(e),{baseUrl:'https://example.test/docs/index.html',fetch:async url=>{
    calls.push(url);
    if(url.includes('manifest.json'))return {ok:!missing,status:missing?404:200,json:async()=>changeManifest(structuredClone(manifest))};
    const bytes=Buffer.from(image);if(corrupt)bytes[80]^=1;
    return {ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
  }});
  return {updater,calls,events,get executions(){return executions;}};
}
test('Approved web image is hash/target/version checked before automatic flashing',async()=>{
  const s=setup();assert.deepEqual(await s.updater.run(info),{state:'COMPLETE'});
  assert.equal(s.executions,1);assert.equal(s.updater.busy,false);
  assert(s.events.some(e=>e.state==='BM83_ONLINE_REFERENCE'&&e.revision===2));
});
test('Missing catalog, wrong hardware, external URL, altered image or false versions never touches the module',async()=>{
  for(const options of [{missing:true},{changeManifest:m=>({...m,hardware:'REV02'})},
    {changeManifest:m=>({...m,url:'https://other.test/fw.hex'})},{changeManifest:m=>({...m,url:null})},{corrupt:true},
    {changeManifest:m=>({...m,versions:{...m.versions,MCU:[1,9,9,9]}})}]){
    const s=setup(options);await assert.rejects(s.updater.run(info),/BM83_CATALOG/);
    assert.equal(s.executions,0);assert.equal(s.updater.busy,false);
  }
});
test('Other products and unsupported bridge do not begin BM83 downloads or writes',async()=>{
  const s=setup();assert.equal((await s.updater.run({...info,product:'ClearVoice'})).state,'NOT_APPLICABLE');
  await assert.rejects(s.updater.run({...info,bm83_bridge:2}),/BM83_BRIDGE_REQUIRED/);
  assert.equal(s.calls.length,0);assert.equal(s.executions,0);
});

test('Cancel while downloading aborts fetch, releases busy and never starts Flash programming',async()=>{
  let cancelCount=0,executions=0,fetchStarted;
  const started=new Promise(resolve=>{fetchStarted=resolve;});
  const updater=new Bm83AutoUpdater({cancel(){cancelCount++;},async run(){executions++;}},()=>{},{
    baseUrl:'https://example.test/index.html',fetch:async(url,{signal})=>{fetchStarted();return await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('fetch aborted'))));}
  });
  const pending=updater.run(info);await started;updater.cancel();
  await assert.rejects(pending,/BM83_CANCELLED/);
  assert.equal(cancelCount,1);assert.equal(executions,0);assert.equal(updater.busy,false);
});
