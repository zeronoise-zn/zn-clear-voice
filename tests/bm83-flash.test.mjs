import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {planBm83Flash,Bm83SpiFlash,Bm83FlashUpdater,unlockedProtection} from '../docs/bm83-flash.js';
import {crc32} from '../docs/zn-protocol.js';
const size=0x200000,eq=(a,b)=>assert.deepEqual([...a],[...b]);
const source=await readFile(new URL('../Firmware/Bluethoot/BM83_CLEARVOICE_REV01.HEX',import.meta.url),'utf8');

test('4096-byte STM32 path stages exact offsets, checks CRC, reads large blocks and never uses browser SPI programs',async()=>{
  const memory=new Uint8Array(8192),calls=[];let staged=[],address;
  const bridge={async rpc(c){
    calls.push(c.split(' ')[0]);const parts=c.split(' ');
    if(parts[0]==='ZN_BM83_SECTOR'){address=parseInt(parts[1],16);staged=[];return '[BM83] SECTOR=OK';}
    if(parts[0]==='ZN_BM83_CHUNK'){
      assert.equal(parseInt(parts[1],16),staged.length);
      assert.equal(parts[2].length,1024);staged.push(...Buffer.from(parts[2],'hex'));
      return '[BM83] CHUNK='+staged.length;
    }
    if(parts[0]==='ZN_BM83_PROGRAM'){
      assert.equal(staged.length,4096);assert.equal(parseInt(parts[1],16),crc32(staged));
      memory.set(staged,address);return '[BM83] PROGRAM=OK CRC='+parts[1].toUpperCase();
    }
    assert.equal(parts[0],'ZN_BM83_READ');const a=parseInt(parts[1],16),n=parseInt(parts[2],16);
    assert(n<=4096);return '[BM83] READ='+Buffer.from(memory.slice(a,a+n)).toString('hex');
  }};
  const f=new Bm83SpiFlash({async command(){assert.fail('No browser SPI transactions for batched data');}},{bridge});
  const bytes=Uint8Array.from({length:4096},(_,i)=>i&255);
  await f.sector(0,bytes);eq(await f.read(0,8192),memory);
  assert.equal(calls.filter(c=>c==='ZN_BM83_CHUNK').length,8);
  assert.equal(calls.filter(c=>c==='ZN_BM83_PROGRAM').length,1);
  bridge.rpc=async()=> '[BM83] READ=ff';
  await assert.rejects(f.read(0,4096),/BM83_SPI/);
});

test('TEST image uses physical config marker, clears runtime and keeps calibration and pairing outside every sector',async()=>{
  const p=await planBm83Flash(source,'rev01.hex');
  assert.equal(p.format,'BM83_TEST_SPI');
  assert.deepEqual(p.regions.map(r=>[r.name,r.start,r.bytes.length]),[
    ['HEADER',0,8192],['MCU',0x10000,0x80000],['DSP',0x110000,0x3f000],['RUNTIME',0x4000,8192],['CONFIG',0x6000,8192]]);
  assert.equal(p.regions.at(-1).bytes[0],0);
  assert(p.regions.find(r=>r.name==='RUNTIME').bytes.every(b=>b===255));
  for(const r of p.regions){assert(!(r.start<0x4000 && r.start+r.bytes.length>0x2000));
    assert(!(r.start<0x10000 && r.start+r.bytes.length>0x8000));}
});

test('SST protection bitmap changes only target write bits and always locks calibration',()=>{
  const original=Uint8Array.from([0x55,0x55,255,255,255,255]);
  eq(unlockedProtection(original,[0,0x1000,0x4000,0x5000,0x6000,0x7000,0x10000,0x110000]),[0x55,0x04,255,0xfe,255,0xfe]);
  for(const a of [0x2000,0x3000,1,-4096,0x200000])assert.throws(()=>unlockedProtection(original,[a]),/non consentito/);
  const empty=new Uint8Array(6);assert.equal(unlockedProtection(empty,[])[1]&4,4);
});

function simulated({corrupt=false,unsupported=false,bridgeVersion=3}={}) {
  const memory=new Uint8Array(size).fill(255);memory.set([0x12,0x34,0x56],0x2000);
  const original=Uint8Array.from([0x55,0x55,255,255,255,255]);let bpr=original.slice(),status=0,calibrationRead=false,guard=false,held=false;
  const operations=[],events=[];
  const bridge={opened:false,info:{bm83_bridge:bridgeVersion},async open(mode){operations.push('OPEN '+mode);this.opened=true;},
    async close(){if(!this.opened)return;operations.push('CLOSE');held=false;guard=false;this.opened=false;},
    async rpc(cmd){operations.push(cmd);if(cmd==='ZN_BM83_GUARD ON')guard=true;if(cmd==='ZN_BM83_GUARD OFF')guard=false;return '[BM83] OK';},
    async readVersion(){return [1,2,3,4];}};
  const link={flashId:unsupported?'000000':'bf2641',rom:'rom',async command(opcode,p){
    assert.equal(opcode,0xfca4);assert.equal(p[0],0);const read=p[1],tx=p.slice(3),op=tx[0];assert.equal(p[2],tx.length);
    let data=[];const address=(tx[1]<<16)|(tx[2]<<8)|tx[3];
    operations.push({op,address});
    if(op===3){data=memory.slice(address,address+read);if(address+read===0x4000)calibrationRead=true;if(corrupt && operations.some(x=>x.op===2))data=data.slice(),data[0]^=1;}
    else if(op===5)data=[status];
    else if(op===6)status=2;
    else if(op===4)status=0;
    else if(op===0x72)data=bpr;
    else if(op===0x42){assert(calibrationRead);assert(guard);assert.equal(status,2);bpr=Uint8Array.from(tx.slice(1));status=0;}
    else if(op===0x20){assert(calibrationRead);assert(guard);assert.equal(status,2);assert(address<0x2000||address>=0x4000);memory.fill(255,address,address+4096);status=0;}
    else if(op===2){assert(calibrationRead);assert(guard);assert.equal(status,2);assert((address&255)+tx.length-4<=256);tx.slice(4).forEach((v,i)=>memory[address+i]&=v);status=0;}
    else assert.fail('Unexpected/destructive SPI opcode '+op);
    return Uint8Array.from([op,read,...data]);
  }};
  const updater=new Bm83FlashUpdater({},e=>events.push(e),{sleep:async()=>{},bridgeFactory:()=>bridge,
    connect:async b=>{await b.open('TEST');return link;}});
  return {memory,operations,events,updater,bridge,link,original,get bpr(){return bpr;},get held(){return held;}};
}
function smallPlan(){
  const body=new Uint8Array(4096).fill(255);body[127]=0x56;body[128]=0x78;
  const header=body.slice();header[0]=0;
  return {format:'BM83_TEST_SPI',filename:'test.hex',sha256:'a'.repeat(64),total:8192,
    images:[{name:'MCU',type:0,version:[1,2,3,4]}],
    regions:[{name:'HEADER',start:0,bytes:header},{name:'MCU',start:0x10000,bytes:body}]};
}

test('SPI updater reads only target sectors and calibration, needs no backup, verifies readback and commits header last',async()=>{
  const s=simulated();
  s.bridge.readVersion=async()=>assert.fail('Embedded Mode must not require APP UART');
  s.bridge.detectAppBaud=async()=>assert.fail('Embedded Mode must not probe APP UART');
  await s.updater.run(smallPlan());
  assert.deepEqual(s.operations.filter(x=>x.op===0x20).map(x=>x.address),[0x10000,0]);
  assert.equal(s.memory[0],0);assert.equal(s.memory[0x1007f],0x56);
  eq(s.memory.slice(0x2000,0x2003),[0x12,0x34,0x56]);eq(s.bpr,s.original);
  assert.equal(s.held,false);assert.equal(s.events.at(-1).state,'BM83_COMPLETE');
  assert.equal(s.events.at(-1).readbackVerified,true);assert.equal(s.updater.busy,false);
  assert.equal(s.events.at(-1).applicationMode,'EMBEDDED');
  assert.equal(s.events.at(-1).runtimeVerified,false);
  assert(!s.operations.includes('OPEN APP'));
  assert(!s.events.some(e=>e.state==='BM83_BACKUP'||e.kind==='BACKUP_SAVED'));
  const reads=s.operations.filter(o=>o.op===3);
  assert(reads.every(o=>o.address<0x4000 || o.address>=0x10000&&o.address<0x11000));
  // Second identical upload compares sectors but never erases/programs again.
  const erased=s.operations.filter(o=>o.op===0x20).length;
  await s.updater.run(smallPlan());
  assert.equal(s.operations.filter(o=>o.op===0x20).length,erased);
});

test('Wrong bridge/Flash never erases; failed verification never commits and always closes',async()=>{
  for(const setup of [{unsupported:true},{bridgeVersion:2},{corrupt:true}]){
    const s=simulated(setup);
    await assert.rejects(s.updater.run(smallPlan()),/BM83_/);
    if(!setup.corrupt)assert(!s.operations.some(x=>x.op===0x20));
    else {assert(!s.held);assert(!s.operations.includes('ZN_BM83_GUARD OFF'));}
    assert(!s.events.some(e=>e.state==='BM83_COMPLETE'));assert.equal(s.updater.busy,false);
  }
});

test('Cancellation during comparison releases session and stops before any write; mismatched SPI reply is fatal',async()=>{
  const s=simulated(),notify=s.updater.notify;
  s.updater.notify=e=>{notify(e);if(e.state==='BM83_COMPARING')s.updater.cancel();};
  await assert.rejects(s.updater.run(smallPlan()),/BM83_CANCELLED/);
  assert(!s.operations.some(x=>x.op===0x20));assert(!s.held);
  const f=new Bm83SpiFlash({async command(){return Uint8Array.of(5,1,0);}});
  await assert.rejects(f.read(0,16),/BM83_SPI/);
  await assert.rejects(f.sector(0x2000,new Uint8Array(4096)),/non consentito/);
});
