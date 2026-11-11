import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseBm83Hex,bm83Crc,inspectBm83Image} from '../docs/bm83-image.js';
import {bm83Packet,Bm83Parser,Bm83Bridge,Bm83Updater,prepareBm83Standby} from '../docs/bm83-updater.js';
import {hciCommand,HciEventParser,testBm83Uart} from '../docs/bm83-test-link.js';
function record(address,kind,data) {
  const b=[data.length,address>>8,address&255,kind,...data];
  b.push((-b.reduce((a,b)=>a+b,0))&255);
  return ':'+b.map(b=>b.toString(16).padStart(2,'0')).join('');
}
const u32=n=>[n>>>24,(n>>>16)&255,(n>>>8)&255,n&255];
function fixture({type=0}={}) {
  const data=Uint8Array.from({length:type===0?0x2300:768},(_,i)=>i&255);
  if(type===0){data[0]=2;data.set([1,3,4,6],0x21fc);}
  const descriptor=(used,max,first,second)=>[0,...u32(used),...u32(max),2,...u32(first),...u32(second)];
  const body=[0x82,4,...u32(0x200000)];
  if(type===0)body.push(0x83,18,...descriptor(data.length,0x80000,0x10000,0x90000));
  if(type===1)body.push(0x90,8,...new Array(8).fill(0),0x91,18,...descriptor(data.length,0x2000,0x110000,0x180000),0x92,4,1,4,0,1);
  body.push(0x81,4,0x23,0x45,0x4e,0x44);
  const header=[0,0x80,4,...u32(body.length),...body];
  const address=[0x10000,0x110000,0x6000][type];
  const lines=[record(0,4,[0,0]),record(0,0,header),record(0,4,[address>>>24,(address>>>16)&255])];
  for(let i=0;i<data.length;i+=16)lines.push(record((address+i)&65535,0,[...data.subarray(i,i+16)]));
  lines.push(';;;Microchip footer');
  return {text:lines.join('\n'),data};
}
test('BM83 Intel HEX validates every record, boundaries, overlapping data and protected calibration',async()=>{
  const f=fixture(),parsed=parseBm83Hex(f.text);
  assert.equal(parsed.eof,false);assert.deepEqual(parsed.data.slice(0x10000,0x10000+f.data.length),f.data);
  for(const text of [f.text.replace(/:020000040000fa/i,':02000004000000'),f.text+'\n'+record(0,0,[1]),
    record(0,4,[0xfd,0])+ '\n'+record(0,0,[1]),record(0xfffe,0,[1,2,3]),f.text+'\nINVALID'])
    assert.throws(()=>parseBm83Hex(text),/BM83_IMAGE_INVALID/);
  await assert.rejects(inspectBm83Image(f.text+'\n'+record(0,4,[0,0])+'\n'+record(0x2000,0,[0xff])),/calibration/);
});
test('BM83 CRC uses Microchip reflected-input/final-bit-reversal algorithm',()=>{
  assert.equal(bm83Crc(new TextEncoder().encode('123456789')),0x89f6);
});
test('General Use header plans full MCU bank, aligned DSP, config without leading marker',async()=>{
  for(let type=0;type<3;type++) {
    const f=fixture({type}),image=await inspectBm83Image(f.text,'test.hex');
    assert.equal(image.format,'BM83_MCU_DFU');assert.equal(image.total,type===0?0x80000:768);
    assert.equal(image.images[0].type,type);
    if(type===0)assert.deepEqual(image.images[0].bytes.subarray(0,f.data.length),f.data);
    if(type===1)assert.deepEqual(image.images[0].bytes,f.data);
    if(type===2)assert.deepEqual(image.images[0].bytes,Uint8Array.from([...f.data.slice(1),255]));
    assert.equal(image.sha256.length,64);
    await assert.rejects(inspectBm83Image(f.text.split('\n').filter((_,i)=>i!==4).join('\n')),/Missing/);
  }
  await assert.rejects(inspectBm83Image(record(0,0,[0,0x80,4,0,0,0,6,0x81,4,0x23,0x45,0x4e,0x44])),/No updatable/);
});
test('Actual REV01 HEX matches the official tool CRC oracle and exact partition plan',async()=>{
  const bytes=await readFile(new URL('../Firmware/Bluethoot/BM83_CLEARVOICE_REV01.HEX',import.meta.url));
  const p=parseBm83Hex(bytes.toString());
  assert.equal(p.count,2088960);
  assert.equal(p.present.subarray(0x2000,0x4000).some(Boolean),false);
  const image=await inspectBm83Image(bytes.toString());
  assert.equal(image.sha256,'61054f6e77c7dcfeb8253779d6c61d28b10e88b291630bad657a9bd1ffc84d7f');
  assert.deepEqual(image.images.map(i=>[i.name,i.bytes.length,i.crc]),[['MCU',524288,54966],['DSP',257616,63316],['CONFIG',640,23142]]);
  assert.equal(image.total,782544);assert.equal(image.images[1].header.length,756);
  assert.deepEqual(image.images[0].version,[1,3,4,6]);assert.deepEqual(image.images[1].version,[1,4,4,17]);
});
test('UART packet parser handles fragmented/coalesced events, wake bytes and rejects corruption',()=>{
  assert.deepEqual([...bm83Packet(8,[0])],[0xaa,0,2,8,0,0xf6]); // Official SPK tool trace.
  const parser=new Bm83Parser(),b=bm83Packet(0,[8,0]);
  assert.deepEqual(parser.push(Uint8Array.from([0,...b.slice(0,4)])),[]);
  const result=parser.push(Uint8Array.from([...b.slice(4),...bm83Packet(0x18,[0,2,7])]));
  assert.deepEqual(result.map(e=>e.event),[0,0x18]);
  const bad=b.slice();bad[bad.length-1]^=1;
  assert.throws(()=>parser.push(bad),/checksum/);
  assert.throws(()=>new Bm83Parser().push([0xaa,255,255]),/length/);
});
test('Bridge uses the existing serial reader, checks capability, ACKs events and does not retry failed TX',async()=>{
  const calls=[],rx=[...bm83Packet(0,[8,0]),...bm83Packet(0x18,[0,2,7])];
  const io={connected:true,port:{async setSignals(s){assert.equal(s.dataTerminalReady,true);calls.push('DTR');}},async text(command,predicate) {
    calls.push(command);
    const response=command.includes('ZN_INFO?')?JSON.stringify({product:'HEADSET_BT',hardware:'REV01',firmware:'1.0.6',git:'a'.repeat(40),dirty:0,shallow:0,bm83_bridge:1}):
      command.includes('OPEN')?'[BM83] OPEN=OK BRIDGE=1':command.includes('RX?')?'[BM83] DATA='+Buffer.from(rx.splice(0)).toString('hex'):
      command.includes('CLOSE')?'[BM83] CLOSED=OK':'[BM83] TX=OK';
    assert.equal(predicate(response),true);return response;
  }};
  const bridge=new Bm83Bridge(io,{sleep:async()=>{}});
  await bridge.open();assert.equal(await bridge.version(),'2.7');await bridge.close();
  assert(calls.indexOf('DTR')<calls.indexOf('ZN_BM83_OPEN APP\n'));
  assert(calls.includes('ZN_BM83_TX '+Buffer.from(bm83Packet(0x14,[0x18])).toString('hex')+'\n'));
  assert.equal(calls.filter(c=>c.includes('ZN_BM83_TX aa00020800f6')).length,1);
  let transmissions=0;
  const broken=new Bm83Bridge({async text(){transmissions++;throw new Error('port removed');}});
  await assert.rejects(broken.send(new Uint8Array(12)),/port removed/);assert.equal(transmissions,1);
});
test('DFU orders sizes/init/data/CRC validation/END/reset and requires a post-reboot probe',async()=>{
  const image=await inspectBm83Image(fixture().text),commands=[],events=[];
  const bridge={async open(){},async close(){commands.push('close');},async version(){return '2.8';},
    async readVersion(){return image.images[0].version;},
    async command(c,p){assert.equal(c,0x49);commands.push(p);},events:[]};
  const updater=new Bm83Updater({connected:true},e=>events.push(e),{sleep:async()=>{},bridgeFactory:()=>bridge});
  await updater.run(image);
  assert.deepEqual(commands.slice(0,2),[[0,0,8,0,0,0,0,0,0,0,0,0,0],[1,...[(image.images[0].crc>>8),image.images[0].crc&255]]]);
  assert.deepEqual(commands[2].slice(0,8),[4,0,0,0,0,0,1,0]);
  assert.deepEqual(commands[4].slice(0,8),[4,0,0,0,2,0,1,0]);
  assert.deepEqual(commands.filter(Array.isArray).slice(-3),[[5,0],[6],[7]]);assert.equal(commands.at(-1),'close');
  assert.equal(events.at(-1).state,'BM83_COMPLETE');assert.equal(events.at(-1).firmwareIdentityVerified,false);
  assert.equal(updater.busy,false);
});
test('Failed BM83 validation never sends END or reset; cleanup always releases bridge',async()=>{
  const image=await inspectBm83Image(fixture().text),commands=[],events=[];
  const bridge={async open(){},async close(){commands.push('close');},async version(){return '2.8';},
    async readVersion(){return image.images[0].version;},
    async command(c,p){commands.push(p);if(p[0]===5)throw new Error('CRC rejected');}};
  const updater=new Bm83Updater({connected:true},e=>events.push(e),{sleep:async()=>{},bridgeFactory:()=>bridge});
  await assert.rejects(updater.run(image),/CRC rejected/);
  assert(!commands.some(p=>p[0]===6 || p[0]===7));assert.equal(commands.at(-1),'close');
  assert.equal(events.at(-1).state,'BM83_FAILED');assert.equal(updater.busy,false);
});
test('Image versions must match after reboot; unsupported version query stops before DFU starts',async()=>{
  const image=await inspectBm83Image(fixture().text);
  for(const failBefore of [false,true]) {
    const commands=[],events=[];let queries=0;
    const bridge={async open(){},async close(){},async version(){return '2.7';},
      async readVersion(){if(failBefore)throw new Error('Unsupported identity query');return ++queries===1?image.images[0].version:[0,0,0,0];},
      async command(c,p){commands.push(p);}};
    const updater=new Bm83Updater({connected:true},e=>events.push(e),{sleep:async()=>{},bridgeFactory:()=>bridge});
    await assert.rejects(updater.run(image),failBefore?/Unsupported/:/BM83_VERSION_MISMATCH/);
    if(failBefore)assert.equal(commands.length,0);
    assert(!events.some(e=>e.state==='BM83_COMPLETE'));assert.equal(updater.busy,false);
  }
});

test('Status 3 reports parameter error with the DFU phase and offset, never a standby instruction',async()=>{
  const logs=[],bridge=new Bm83Bridge({}, {log:e=>logs.push(e)});let sent=0;
  bridge.send=async()=>{sent++;};
  bridge.wait=async()=>({event:0,parameters:Uint8Array.of(0x49,3)});
  await assert.rejects(bridge.command(0x49,[4,1,0,0,1,0,0,1,0xaa],4000,{part:'DSP',offset:256,length:1}),e=>{
    assert.equal(e.code,'BM83_NACK');assert.equal(e.context.status,3);
    assert.match(e.message,/Image_Update \/ DSP \/ offset 256/);assert.match(e.message,/Parameters error/);
    assert.doesNotMatch(e.message,/standby|retry/);return true;
  });
  assert.equal(sent,1);assert.deepEqual(logs.map(l=>l.kind),['TX','ACK','COMMAND_FAILED']);
  assert.equal(logs[1].packet.hex,'aa0003004903b1');
});

test('Non-standby state is checked before any DFU mutation',async()=>{
  const image=await inspectBm83Image(fixture().text);let commands=0,closed=false;
  const bridge={async open(){},async close(){closed=true;},async version(){return '2.7';},
    async readVersion(){return image.images[0].version;},async readState(){return 4;},async command(){commands++;}};
  const updater=new Bm83Updater({},()=>{},{bridgeFactory:()=>bridge});
  await assert.rejects(updater.run(image),/BM83_NOT_STANDBY/);
  assert.equal(commands,0);assert.equal(closed,true);assert.equal(updater.busy,false);
});

test('Power OFF after TEST is prepared with power press/release and pairing exit before standby',async()=>{
  const states=[0,0,1,2],commands=[],events=[];
  const bridge={async readState(){return states.shift();},async command(c,p){commands.push([c,...p]);}};
  assert.equal(await prepareBm83Standby(bridge,{sleep:async()=>{},notify:e=>events.push(e)}),2);
  assert.deepEqual(commands,[[2,0,0x51],[2,0,0x52],[2,0,0x6b]]);
  assert.equal(events.at(-1).kind,'STANDBY_READY');assert.equal(events.at(-1).poweredOn,true);
  assert.deepEqual([...bm83Packet(2,[0,0x51])],[0xaa,0,3,2,0,0x51,0xaa]);
  assert.deepEqual([...bm83Packet(2,[0,0x52])],[0xaa,0,3,2,0,0x52,0xa9]);
});

test('Standby is left unchanged; failed power-on is bounded and never bypasses state check',async()=>{
  let commands=[],reads=0;
  const standby={async readState(){return 2;},async command(c,p){commands.push([c,...p]);}};
  assert.equal(await prepareBm83Standby(standby),2);assert.deepEqual(commands,[]);
  const off={async readState(){reads++;return 0;},async command(c,p){commands.push([c,...p]);}};
  await assert.rejects(prepareBm83Standby(off,{sleep:async()=>{}}),/BM83_POWER_ON_FAILED/);
  assert.equal(reads,33);assert.deepEqual(commands,[[2,0,0x51],[2,0,0x52]]);
});

test('Power-on command failure stops before DFU and preserves the actual NACK',async()=>{
  const image=await inspectBm83Image(fixture().text),commands=[];let closed=false;
  const bridge={async open(){},async close(){closed=true;},async version(){return '2.7';},
    async readVersion(){return image.images[0].version;},async readState(){return 0;},
    async command(c,p){commands.push([c,...p]);throw new Error('Power_On_Press: Parameters error');}};
  const updater=new Bm83Updater({},()=>{},{sleep:async()=>{},bridgeFactory:()=>bridge});
  await assert.rejects(updater.run(image),/Power_On_Press: Parameters error/);
  assert.deepEqual(commands,[[2,0,0x51]]);assert.equal(closed,true);assert.equal(updater.busy,false);
});

test('TEST UART uses the official HCI FC5D packet, confirms old speed and verifies identity at fast speed',async()=>{
  assert.deepEqual([...hciCommand(0xfc5d,[0,0x10,0x0e,0])],[1,0x5d,0xfc,4,0,0x10,0x0e,0]);
  const identity=[8,1,0,8,0x46,0,1,0],calls=[],logs=[];let rx=[],hostBaud=115200;
  const rom=[...new TextEncoder().encode('BT5511_002'),...new Array(12).fill(0)];
  const bridge={async open(mode){assert.equal(mode,'TEST');},async send(raw){
    const opcode=raw[1]|raw[2]<<8;calls.push(['HCI',opcode,hostBaud]);
    assert([0x1001,0xfc5d,0xfc20,0xfca4].includes(opcode));
    if(opcode===0xfc5d)assert.equal(hostBaud,115200);
    if(opcode===0xfca4)assert.deepEqual([...raw],[1,0xa4,0xfc,4,0,3,1,0x9f]);
    const parameters=[1,raw[1],raw[2],...(opcode===0xfc20?rom:[0,...(opcode===0x1001?identity:opcode===0xfca4?[0x9f,3,0xbf,0x26,0x41]:[])])];
    rx.push(4,0x0e,parameters.length,...parameters);
  },async rpc(command){
    if(command.startsWith('ZN_BM83_BAUD ')){
      assert.equal(rx.length,0);hostBaud=Number(command.split(' ')[1]);calls.push(['BAUD',hostBaud]);return '[BM83] BAUD='+hostBaud;
    }
    assert.equal(command,'ZN_BM83_RX?');return '[BM83] DATA='+Buffer.from(rx.splice(0,4)).toString('hex');
  }};
  const result=await testBm83Uart(bridge,921600,{sleep:async()=>{},log:e=>logs.push(e)});
  assert.equal(result.baud,921600);assert.equal(result.flashWritten,false);
  assert.deepEqual(calls.slice(0,4),[['HCI',0x1001,115200],['HCI',0xfc5d,115200],['BAUD',921600],['HCI',0x1001,921600]]);
  assert.deepEqual(calls.slice(4),Array.from({length:32},()=>[['HCI',0xfc20,921600],['HCI',0xfca4,921600]]).flat());
  assert.equal(result.flashId,'bf2641');assert.equal(result.identificationRounds,32);
  assert.equal(logs.at(-1).kind,'TEST_UART_VERIFIED');
  const parser=new HciEventParser();assert.deepEqual(parser.push([4,14]),[]);
  assert.equal(parser.push([4,1,0x5d,0xfc,0])[0].event,14);
  assert.throws(()=>new HciEventParser().push([0xaa]),/BM83_HCI/);
});

test('Fast UART probe rejects overrun and unstable identification; never reports verified or writes Flash',async()=>{
  for(const fault of ['overrun','identity']) {
    const logs=[];let rx=[],reads=0,closed=false;
    const rom=[...new TextEncoder().encode('BT5511_002'),...new Array(12).fill(0)];
    const bridge={async open(){},async close(){closed=true;},async send(raw){
      const opcode=raw[1]|raw[2]<<8;
      assert([0x1001,0xfc5d,0xfc20,0xfca4].includes(opcode));
      if(opcode===0xfca4)reads++;
      const payload=opcode===0xfc20?rom:[0,...(opcode===0x1001?new Array(8).fill(0):opcode===0xfca4?[0x9f,3,0xbf,0x26,reads===2?0x42:0x41]:[])];
      const p=[1,raw[1],raw[2],...payload];rx.push(4,14,p.length,...p);
    },async rpc(command){
      if(command.startsWith('ZN_BM83_BAUD '))return '[BM83] BAUD=921600';
      if(fault==='overrun' && reads===1)throw new Error('[BM83] ERROR=UART_FAULT');
      return '[BM83] DATA='+Buffer.from(rx.splice(0)).toString('hex');
    }};
    const updater=new Bm83Updater({},e=>logs.push(e),{sleep:async()=>{},bridgeFactory:()=>bridge});
    await assert.rejects(updater.testUart(),fault==='overrun'?/UART_FAULT/:/instabile/);
    assert.equal(closed,true);assert.equal(updater.busy,false);
    assert(!logs.some(e=>e.kind==='TEST_UART_VERIFIED'));
  }
});

test('Failed TEST baud negotiation never switches host baud and releases bridge',async()=>{
  let closed=false,switched=false,rx=[];
  const bridge={async open(){},async close(){closed=true;},async send(raw){
    const opcode=raw[1]|raw[2]<<8,p=[1,raw[1],raw[2],opcode===0xfc5d?1:0,...(opcode===0x1001?new Array(8).fill(0):[])];
    rx.push(4,14,p.length,...p);
  },async rpc(command){if(command.startsWith('ZN_BM83_BAUD '))switched=true;return '[BM83] DATA='+Buffer.from(rx.splice(0)).toString('hex');}};
  const updater=new Bm83Updater({},()=>{},{sleep:async()=>{},bridgeFactory:()=>bridge});
  await assert.rejects(updater.testUart(),/BM83_HCI_NACK/);
  assert.equal(switched,false);assert.equal(closed,true);assert.equal(updater.busy,false);
});

test('Application baud detection only reads versions and clears stale parser data between explicit host rates',async()=>{
  const bridge=new Bm83Bridge({}),calls=[];
  bridge.rpc=async c=>{calls.push(c);bridge.rate=Number(c.split(' ').at(-1));return '[BM83] BAUD='+bridge.rate;};
  bridge.version=async()=>{if(bridge.rate!==921600)throw new Error('UART_FAULT');return '2.9';};
  assert.deepEqual(await bridge.detectAppBaud(),{baud:921600,version:'2.9'});
  assert.deepEqual(calls,['ZN_BM83_APP_BAUD 115200','ZN_BM83_APP_BAUD 921600']);
});
