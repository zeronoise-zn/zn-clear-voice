import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectPackage, sha256, PRODUCT, compiledIdentity, UpdateError } from '../docs/znfw.js';
import { crc32, cobsEncode, cobsDecode, frame, decodeFrame, response, chunks, CMD, parseHello, parseBootInfo, parseStatus, checkTarget } from '../docs/zn-protocol.js';
import { SerialTransport } from '../docs/serial-transport.js';
import { FirmwareUpdater, appInfo, runtimeInfo, matchInstalled, diagnosticLine } from '../docs/fw-updater.js';
import { startUi } from '../docs/updater-ui.js';

const text = s => new TextEncoder().encode(s);
const app = { product: 'ClearVoice', hardware: 'REV01', firmware: '1.0.0.47', git: '11a737c9361307cc9e7c1b6d470dd7a128f1ac65', dirty: 0, shallow: 0 };
const healthy = '[RUNTIME] STATUS=RUNNING FAULT=OK CODE=0 AUDIO_BLOCKS=42 CONFIRMED=1 UART_ERRORS=0x00000000';
const bootDiag = '[BOOT_DIAG] BOOT_ADMITTED=1 BOOT_TRIAL=1 BOOT_CONFIRM_ATTEMPTED=1 BOOT_CONFIRM_RESULT=SUCCESS CONFIRMED=1';
test('R4E optional diagnostic fields are verbatim visibility, not completion evidence', () => {
  for (const result of ['SUCCESS','ALREADY_CONFIRMED','NOT_CALLED','NOT_PENDING','INVALID_METADATA','FLASH_ERROR','INVALID_CONTEXT']) {
    const line = bootDiag.replace('RESULT=SUCCESS',`RESULT=${result}`);
    assert.equal(diagnosticLine(line).fields.BOOT_CONFIRM_RESULT,result);
    assert.equal(runtimeInfo(line),null);
  }
  assert.equal(diagnosticLine('[RESET] RESET_CAUSE=IWDG|SOFTWARE FLAGS=0x30000000').fields.RESET_CAUSE,'IWDG|SOFTWARE');
  assert.equal(diagnosticLine('[HEALTH] BATTERY_VALID=0 RTX_HEALTH_AGE_MS=UNKNOWN').fields.RTX_HEALTH_AGE_MS,'UNKNOWN');
  assert.equal(diagnosticLine('[SAI] SAI_A_ERROR=0x00000001 SAI_B_ERROR=0x00000000').fields.SAI_A_ERROR,'0x00000001');
  assert.equal(diagnosticLine('[BOOT_DIAG] CONFIRMED=1 CONFIRMED=0'),null);
  assert.equal(diagnosticLine(healthy),null);
});
async function fixture() {
  const bytes = new Uint8Array(128 + 2052), v = new DataView(bytes.buffer);
  bytes.set(text('ZNFW')); v.setUint16(4,1,true); v.setUint16(6,128,true); v.setUint32(8,PRODUCT,true);
  v.setUint32(12,1,true); v.setUint16(16,1,true); v.setUint16(22,47,true); v.setUint32(24,2052,true); v.setUint32(28,0x01000000,true);
  bytes.fill(42,64,128); v.setUint32(128,0x20020000,true); v.setUint32(132,0x080081e1,true);
  const object = 128+600;
  v.setUint16(object,1,true); v.setUint16(object+6,47,true); v.setUint32(object+8,1,true); bytes[object+12] = 1;
  [640,680,750,850].forEach((offset,i) => v.setUint32(object+16+i*4,0x08008000+offset,true));
  [app.firmware,app.git,app.firmware+'-'+app.git.slice(0,12),app.hardware].forEach((s,i) => bytes.set(text(s+'\0'),128+[640,680,750,850][i]));
  const hash = await crypto.subtle.digest('SHA-256',bytes.subarray(128)); bytes.set(new Uint8Array(hash),32);
  return bytes;
}
function reply(cmd, seq, status = 0, state = 1, offset = 0, length = 8) {
  const p = new Uint8Array(length), v = new DataView(p.buffer);
  v.setUint16(0,status,true); p[2] = state; p[3] = cmd; v.setUint32(4,offset,true);
  return { command: status ? 255 : cmd|128, sequence: seq, payload: p, status, state, request: cmd, offset };
}
function hello(seq = 0) {
  const r = reply(1,seq,0,1,0,26), p = r.payload, v = new DataView(p.buffer);
  p.set(text('ZNBLCVWH'),8); p[16] = 1;
  [1024,1028,1038,1044].forEach((x,i) => v.setUint16(18+2*i,x,true)); return r;
}
function info() {
  const r = reply(2,1,0,1,0,209), p = r.payload, v = new DataView(p.buffer);
  p[8] = 2; p[9] = 1; p[10] = 1; p[11] = 8; v.setUint32(12,1,true); v.setUint16(16,256,true);
  v.setUint32(28,0x17800,true); v.setUint32(36,0xc0000007,true); v.setUint32(40,PRODUCT,true); v.setUint32(203,0x01000000,true);
  return r;
}

test('ZNFW parser: valid, extension, header, length, hash, signature placeholder, vectors', async () => {
  const bytes = await fixture(); const p = await inspectPackage(bytes.buffer,'test.znfw');
  assert.equal(p.imageSize,2052); assert.equal(p.version,'1.0.0.47'); assert.equal(p.signatureVerified,false);
  assert.equal(p.identity.git,app.git); assert.equal(p.identity.offset,600);
  for (const name of ['x.bin','x.hex','x.elf','x']) await assert.rejects(inspectPackage(bytes.buffer,name), /INVALID_ZNFW/);
  await assert.rejects(inspectPackage(bytes.slice(0,100).buffer,'x.znfw'), /INVALID_HEADER/);
  await assert.rejects(inspectPackage(bytes.slice(0,-1).buffer,'x.znfw'), /INVALID_ZNFW/);
  for (const offset of [0,4,6,8,12,24]) {
    const b = bytes.slice(); b[offset] ^= 1;
    await assert.rejects(inspectPackage(b.buffer,'x.znfw'));
  }
  const b = bytes.slice(); b[140] ^= 1; await assert.rejects(inspectPackage(b.buffer,'x.znfw'), /PAYLOAD_HASH_MISMATCH/);
  const unsigned = bytes.slice(); unsigned.fill(0,64,128); await assert.rejects(inspectPackage(unsigned.buffer,'x.znfw'), /Missing signature/);
  const badVector = bytes.slice(); new DataView(badVector.buffer).setUint32(128,0x20000000,true);
  badVector.set(new Uint8Array(await crypto.subtle.digest('SHA-256',badVector.subarray(128))),32);
  await assert.rejects(inspectPackage(badVector.buffer,'x.znfw'), /vectors/);
});
test('R4 local fixture read-only, never copied', { skip: !process.env.ZNFW_TEST_FIXTURE }, async () => {
  const b = await readFile(process.env.ZNFW_TEST_FIXTURE); const p = await inspectPackage(b.buffer.slice(b.byteOffset,b.byteOffset+b.length),'fixture.znfw');
  assert.equal(b.length,82228); assert.equal(p.imageSize,82100);
  assert.equal(await sha256(b),'67b319934bc2c237fb9fba108bc085f9458507afed8bc68c2140972a4f9060d2');
  assert.equal(p.payloadHash,'7826fcae5e122efe0d91834f418cac1ae2162bacba8fe03f4418e94c59a5e141');
  assert.equal(p.identity.offset,73732); assert.equal(p.identity.git,app.git);
  assert.equal([...chunks(p.payload)].length,81);
});
test('CRC vendor golden HELLO, COBS long/zeros, frame corruption and chunks', async () => {
  assert.equal(crc32(text('123456789')),0xcbf43926);
  assert.equal(Buffer.from(frame(1,0)).toString('hex'),'03010101010105b65bfe4700');
  for (const n of [0,1,253,254,255,508,1038]) for (const fill of [0,7]) {
    const b = new Uint8Array(n).fill(fill); assert.deepEqual(cobsDecode(cobsEncode(b).subarray(0,-1)),b);
  }
  const parts = [...chunks(new Uint8Array(2052))]; assert.deepEqual(parts.map(x => x.data.length),[1028,1028,8]);
  assert.deepEqual(parts.map(x => x.end),[1024,2048,2052]);
  const f = frame(4,65535,parts[0].data); assert.ok(f.length <= 1044);
  assert.equal(decodeFrame(f.subarray(0,-1)).sequence,65535);
  f[10] ^= 4; assert.throws(() => decodeFrame(f.subarray(0,-1)), /INVALID_FRAME/);
  assert.throws(() => cobsDecode(new Uint8Array([4,1])), /COBS/);
});
test('HELLO/INFO/status and PROD target guards', async () => {
  parseHello(hello()); const device = parseBootInfo(info()), pkg = await inspectPackage((await fixture()).buffer,'x.znfw');
  checkTarget(pkg,device); assert.throws(() => checkTarget(pkg,{...device, flags:4}), /PROD_REQUIRED/);
  assert.throws(() => checkTarget(pkg,{...device,hardwareMask:2}), /TARGET_MISMATCH/);
  assert.throws(() => checkTarget(pkg,{...device,capacity:100}), /TARGET_MISMATCH/);
  assert.throws(() => parseStatus(reply(6,1)), /PROTOCOL_MISMATCH/);
  parseStatus(reply(6,1,0,1,0,18));
  assert.equal(appInfo(JSON.stringify(app)).displayId,'1.0.0.47-11a737c93613');
  assert.equal(appInfo('{"firmware":"1.0.0.47"}'),null);
});

class FakePort {
  constructor(handler) { this.handler = handler; this.writes = []; }
  async open(options) {
    this.options = options;
    this.readable = new ReadableStream({start: controller => {this.rx = controller;}});
    this.writable = new WritableStream({write: bytes => { this.writes.push(bytes.slice()); return this.handler?.(bytes,this); }});
  }
  send(bytes) { for (let i=0; i<bytes.length; i+=3) this.rx.enqueue(bytes.slice(i,i+3)); }
  async close() { this.readable = this.writable = null; }
}
test('Serial single reader, fragmented/coalesced ACK, old duplicates and exact timeout retry', async () => {
  let count = 0;
  const port = new FakePort((bytes,p) => {
    const d = decodeFrame(bytes.subarray(0,-1));
    if (++count === 1) return; // Drop first ACK.
    const old = reply(d.command,d.sequence-1), good = reply(d.command,d.sequence);
    p.send(frame(old.command,old.sequence,old.payload)); p.send(frame(good.command,good.sequence,good.payload));
  });
  const io = new SerialTransport(port); await io.open();
  const r = await io.request(CMD.END,undefined,{timeout:10,retries:1});
  assert.equal(r.sequence,1); assert.deepEqual(port.writes[0],port.writes[1]); assert.equal(io.sequence,2);
  assert.equal(port.options.parity,'none'); assert.equal(port.options.baudRate,230400);
  await io.close(); assert.equal(io.pending,null);
});
test('Serial NACK mapping/consumed LENGTH, bounded timeout, disconnect and LF query', async () => {
  let status = 3;
  const port = new FakePort((bytes,p) => {
    if (bytes[0] === 10) { p.send(text('noise\n'+JSON.stringify(app)+'\n')); return; }
    const d = decodeFrame(bytes.subarray(0,-1)); const r = reply(d.command,d.sequence,status);
    p.send(frame(r.command,r.sequence,r.payload));
  });
  const io = new SerialTransport(port); await io.open();
  await assert.rejects(io.request(4),/LENGTH/); assert.equal(io.sequence,2);
  status = 15; await assert.rejects(io.request(3),/SIGNATURE_REJECTED/);
  const line = await io.text('\nZN_INFO?\n',s=>!!appInfo(s)); assert.equal(appInfo(line).version,app.firmware);
  port.handler = null; await assert.rejects(io.request(2,undefined,{timeout:5,retries:0}),/TRANSFER_TIMEOUT/);
  const wait = io.request(2,undefined,{timeout:100,retries:0}); port.rx.error(new Error('cable'));
  await assert.rejects(wait,/SERIAL_DISCONNECTED/); await io.close();
});

class FakeIo {
  connected = true; commands = []; state = 1; offset = 0; sequence = 1;
  async open() {} async close() {} async hello() { this.sequence = 1; return hello(); }
  async text(command) { return command === 'ZN_BOOT\n' ? 'ZN_BOOT_ACK' : command.includes('ZN_STATS?') ? healthy : JSON.stringify(app); }
  async request(cmd, payload) {
    this.commands.push(cmd);
    if (cmd === 2) return info();
    if (cmd === 3) { this.state = 3; this.offset = 0; this.size = new DataView(payload.buffer,payload.byteOffset).getUint32(24,true); }
    if (cmd === 4) { assert.equal(new DataView(payload.buffer,payload.byteOffset,payload.byteLength).getUint32(0,true),this.offset); this.offset += payload.length - 4; }
    if (cmd === 5) { assert.equal(this.offset,this.size); this.state = 5; }
    if (cmd === 7) this.state = 1;
    return reply(cmd,this.sequence++,0,this.state,this.offset,cmd === 6 ? 18 : 8);
  }
}
test('State machine full update, END before REBOOT, actual app observation', async () => {
  const io = new FakeIo(), events = [], updater = new FirmwareUpdater(io,e=>events.push(e.state));
  await updater.connect(); const pkg = await inspectPackage((await fixture()).buffer,'x.znfw');
  await updater.run(pkg);
  assert.equal(updater.state,'COMPLETE'); assert.ok(io.commands.indexOf(5)<io.commands.indexOf(8));
  assert.deepEqual(io.commands.filter(c=>c===4),[4,4,4]);
  for (const s of ['ENTERING_BOOTLOADER','WAITING_BOOTLOADER','BEGIN_UPDATE','SENDING','TRANSFER_COMPLETE','VERIFYING','FINALIZING','WAITING_FOR_APPLICATION','VERIFYING_INSTALLED_VERSION','WAITING_BOOT_CONFIRM','COMPLETE']) assert.ok(events.includes(s),s);
});
test('Recovery reentrancy guard, interrupted transaction, and abort at ACK boundary', async () => {
  const pkg = await inspectPackage((await fixture()).buffer,'x.znfw');
  const io = new FakeIo(), updater = new FirmwareUpdater(io);
  updater.info = parseBootInfo(info());
  const run = updater.run(pkg); await assert.rejects(updater.run(pkg),/BUSY/); await run;
  io.state = 3; updater.info = parseBootInfo(info()); await assert.rejects(updater.run(pkg),/RECOVERY_TRANSACTION/);
  await updater.abort(); assert.equal(updater.state,'ABORTED');
  io.state = 1; updater.notify = e => { if(e.state === 'BEGIN_UPDATE') updater.cancel(); };
  await updater.run(pkg); assert.equal(updater.state,'ABORTED'); assert.equal(io.commands.at(-1),7);
});
test('Wrong ACK offset / signature NACK / boot and reset timeout never COMPLETE', async () => {
  const pkg = await inspectPackage((await fixture()).buffer,'x.znfw');
  const io = new FakeIo(), updater = new FirmwareUpdater(io,()=>{}, {bootTimeout:0,resetTimeout:0});
  updater.info = appInfo(JSON.stringify(app)); await assert.rejects(updater.run(pkg),/BOOTLOADER_TIMEOUT/);
  updater.info = parseBootInfo(info());
  const original = io.request.bind(io);
  io.request = async (...args) => { const r = await original(...args); if(args[0]===4) r.offset++; return r; };
  await assert.rejects(updater.run(pkg),/OFFSET_ERROR/); assert.equal(updater.state,'FAILED');
  io.request = original; await updater.restart().catch(e => assert.match(e.message,/DEVICE_RESET_TIMEOUT/));
  assert.notEqual(updater.state,'COMPLETE');
});

test('ABORT cannot undo committed END and wrong returned application is not COMPLETE', async () => {
  const io = new FakeIo(), updater = new FirmwareUpdater(io);
  const original = io.request.bind(io);
  io.request = async (...args) => {
    if (args[0] === 7) { const e = new Error('STATE: pending, not rolled back'); e.response = reply(7,1,6,5); throw e; }
    return original(...args);
  };
  updater.bootState = 3;
  await assert.rejects(updater.abort(), /pending/); assert.equal(updater.bootState,5);
  io.text = async () => JSON.stringify({...app,firmware:'1.0.0.46'});
  const pkg = await inspectPackage((await fixture()).buffer,'x.znfw');
  await assert.rejects(updater.restart(pkg), /fallback\/rollback/); assert.equal(updater.state,'FAILED');
});

test('Identity must be uniquely bound to current ABI, full Git and flags', async () => {
  const pkg = await inspectPackage((await fixture()).buffer,'x.znfw');
  const bad = pkg.payload.slice(); new DataView(bad.buffer).setUint32(600+20,0x90000000,true);
  assert.equal(compiledIdentity(bad,pkg.version,pkg.hardwareMask),null);
  const ambiguous = pkg.payload.slice(); ambiguous.set(ambiguous.subarray(600,632),1000);
  assert.equal(compiledIdentity(ambiguous,pkg.version,pkg.hardwareMask),null);
  assert.throws(() => matchInstalled(pkg,appInfo(JSON.stringify({...app,git:'a'.repeat(40)}))),/INSTALLED_IDENTITY_MISMATCH/);
  assert.throws(() => matchInstalled(pkg,appInfo(JSON.stringify({...app,dirty:1}))),/INSTALLED_IDENTITY_MISMATCH/);
  const io = new FakeIo(), updater = new FirmwareUpdater(io);
  await assert.rejects(updater.run({...pkg,identity:null}),/PACKAGE_IDENTITY_UNKNOWN/);
  assert.equal(io.commands.length,0);
});
test('Full transfer / generic END response cannot declare update complete', async () => {
  const pkg = await inspectPackage((await fixture()).buffer,'x.znfw'), io = new FakeIo(), states = [];
  const original = io.request.bind(io);
  io.request = async (...args) => { const r = await original(...args); if(args[0]===CMD.END) r.state=1; return r; };
  const updater = new FirmwareUpdater(io,e=>states.push(e.state)); await updater.connect();
  await assert.rejects(updater.run(pkg),/VERIFY_FAILED/);
  assert.ok(states.includes('TRANSFER_COMPLETE')); assert.ok(!states.includes('COMPLETE')); assert.ok(!io.commands.includes(CMD.REBOOT));
});
test('Application JSON followed by unconfirmed trial returning to recovery never COMPLETE', async () => {
  const pkg = await inspectPackage((await fixture()).buffer,'x.znfw'), io = new FakeIo(), states = [];
  const originalText = io.text.bind(io); let trialObserved = false;
  io.text = async command => {
    if(command.includes('ZN_STATS?')) { trialObserved=true; return healthy.replace('CONFIRMED=1','CONFIRMED=0'); }
    return originalText(command);
  };
  const updater = new FirmwareUpdater(io,e=>states.push(e.state),{sleep:async()=> {
    if(trialObserved) { io.state=0; io.text=async()=>{throw new UpdateError('TRANSFER_TIMEOUT');}; }
  }});
  await updater.connect(); await assert.rejects(updater.run(pkg),/APPLICATION_DID_NOT_START/);
  assert.equal(updater.state,'FAILED_RECOVERY'); assert.ok(!states.includes('COMPLETE'));
  assert.equal(io.commands.filter(x=>x===CMD.BEGIN).length,1); assert.equal(io.commands.filter(x=>x===CMD.REBOOT).length,1);
  assert.equal(updater.diagnostics.status.state,0);
});
test('Runtime fault and lack of END evidence block COMPLETE; diagnostics never mutate', async () => {
  const pkg = await inspectPackage((await fixture()).buffer,'x.znfw'), io = new FakeIo(), states = [];
  const updater = new FirmwareUpdater(io,e=>states.push(e.state));
  updater.endAccepted=false;
  await updater.connect(pkg,false); assert.equal(updater.state,'CONNECTED'); assert.ok(!states.includes('COMPLETE'));
  io.text=async cmd=>cmd.includes('ZN_STATS?') ? healthy.replace('STATUS=RUNNING FAULT=OK CODE=0','STATUS=FAULT FAULT=TX_ERROR CODE=4') : JSON.stringify(app);
  await assert.rejects(updater.restart(pkg),/APPLICATION_HEALTH_FAILED/);
  io.commands=[]; io.text=async()=>{throw new UpdateError('TRANSFER_TIMEOUT');};
  await updater.readDiagnostics(); assert.deepEqual(io.commands,[CMD.INFO,CMD.STATUS]);
  assert.equal(updater.state,'FAILED_RECOVERY');
});

test('Existing UI controller: no permission on load, selected package/errors, connect and complete with mock serial only', async () => {
  class Element {
    textContent = ''; style = {}; files = []; listeners = {}; disabled = false; value = 'en';
    classList = { toggle() {}, add() {}, remove() {} };
    addEventListener(type,fn) { this.listeners[type] = fn; }
    querySelector() { return this.child ||= new Element(); }
    async fire(type) { return this.listeners[type]?.({target:this}); }
  }
  const elements = new Map(), get = id => { if(!elements.has(id)) elements.set(id,new Element()); return elements.get(id); };
  const engine = new FakeIo(); let requests = 0;
  const port = new FakePort(async (bytes,p) => {
    if (bytes[0]===10 || new TextDecoder().decode(bytes).startsWith('ZN_BOOT')) {
      const command = new TextDecoder().decode(bytes);
      p.send(text(command === 'ZN_BOOT\n' ? 'ZN_BOOT_ACK\n' : command.includes('ZN_STATS?') ? bootDiag+'\n'+healthy+'\n' : JSON.stringify(app)+'\n')); return;
    }
    if (bytes.length === 1 && bytes[0] === 0) return;
    const d = decodeFrame(bytes.subarray(0,-1));
    const r = d.command === 1 ? hello() : await engine.request(d.command,d.payload);
    p.send(frame(r.command,d.sequence,r.payload));
  });
  const applicationHandler = port.handler;
  const saved = Object.fromEntries(['document','navigator','window','localStorage','sessionStorage','fetch','confirm','isSecureContext'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const store = {getItem:()=>null,setItem(){}};
  const globals = {document:{getElementById:get,documentElement:{},querySelectorAll:()=>[]},window:{},
    navigator:{language:'en',serial:{requestPort:async()=>{requests++;return port;},addEventListener(){}}},
    localStorage:store,sessionStorage:store,fetch:async()=>({ok:true,json:async()=>({targets:[]})}),confirm:()=>true,isSecureContext:true};
  for(const [k,v] of Object.entries(globals)) Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});
  try {
    startUi(Object.fromEntries(['en','it','de','fr','es'].map(x=>[x,{}])), {manifestUrl:'./firmware-manifest.json',usbFilters:[],appBaudRate:230400,bootBaudRate:230400});
    await new Promise(r=>setImmediate(r)); assert.equal(requests,0); assert.equal(get('updateButton').disabled,true);
    const bytes = await fixture();
    get('localFirmwareInput').files = [{name:'wrong.bin',size:bytes.length,arrayBuffer:async()=>bytes.buffer}];
    await get('localFirmwareInput').fire('change'); assert.match(get('packageInfo').textContent,/INVALID_ZNFW/);
    get('localFirmwareInput').files = [{name:'test.znfw',size:bytes.length,arrayBuffer:async()=>bytes.buffer}];
    await get('localFirmwareInput').fire('change'); assert.match(get('packageInfo').textContent,/Signature validation pending/);
    await get('connectButton').fire('click'); assert.equal(requests,1); assert.equal(get('updateButton').disabled,false);
    assert.equal(port.options.baudRate,230400);
    assert.equal(get('productValue').textContent,'ClearVoice Portable Unit');
    assert.equal(app.product,'ClearVoice');
    let finishManifest;
    globalThis.fetch = () => new Promise(resolve => {finishManifest = resolve;});
    const refresh = get('refreshReleaseButton').fire('click');
    assert.equal(get('updateButton').disabled,true); // No old target while version refresh is in flight.
    finishManifest({ok:true,json:async()=>({targets:[]})}); await refresh;
    assert.equal(get('updateButton').disabled,false);
    await get('updateButton').fire('click'); assert.equal(get('releaseBadge').textContent,'UPDATE COMPLETE',get('technicalLog').textContent);
    assert.match(get('progressDetail').textContent,/full identity matched; CONFIRMED=1 observed/);
    assert.equal(get('progressPercent').textContent,'100%'); assert.equal(get('progressBytes').textContent,'2052 / 2052 bytes');
    assert.match(get('technicalLog').textContent,/TX DATA .*offset=/);
    assert.match(get('technicalLog').textContent,/RX ACK END/);
    assert.match(get('technicalLog').textContent,/ZN_STATS\?/);
    assert.match(get('diagnosticInfo').textContent,/BOOT_CONFIRM_RESULT/);
    assert.match(get('diagnosticInfo').textContent,/SUCCESS/);
    await get('connectButton').fire('click'); assert.equal(port.readable,null);
    assert.notEqual(get('releaseBadge').textContent,'UPDATE COMPLETE');
    engine.state=0; engine.offset=0;
    port.handler = async (bytes,p) => {
      if(bytes[0]===10 || bytes.length===1) return; // Recovery ignores ASCII.
      const d=decodeFrame(bytes.subarray(0,-1)); const r=d.command===1 ? hello() : await engine.request(d.command,d.payload);
      p.send(frame(r.command,d.sequence,r.payload));
    };
    await get('connectButton').fire('click');
    assert.equal(get('currentVersionValue').textContent,'Recovery');
    assert.equal(port.options.baudRate,230400);
    assert.equal(get('releaseBadge').textContent,'UPDATE NOT CONFIRMED');
    assert.match(get('installationStatus').textContent,/recovery/);
    await get('connectButton').fire('click');
    const otherPort = new FakePort(applicationHandler);
    navigator.serial.requestPort = async () => otherPort;
    await get('connectButton').fire('click');
    assert.notEqual(get('releaseBadge').textContent,'UPDATE COMPLETE');
    assert.match(get('technicalLog').textContent,/previous END acceptance discarded/);
    await get('connectButton').fire('click');
  } finally {
    for(const [k,descriptor] of Object.entries(saved)) { if(descriptor) Object.defineProperty(globalThis,k,descriptor); else delete globalThis[k]; }
  }
});
