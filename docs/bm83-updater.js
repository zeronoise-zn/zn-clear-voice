import { UpdateError } from './znfw.js';
import { appInfo } from './fw-updater.js';
import { testBm83Uart } from './bm83-test-link.js';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const be16=n=>[(n>>>8)&255,n&255];
const be32=n=>[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255];
export const BM83_ACK_STATUS=Object.freeze({0:'Command complete',1:'Command disallow',2:'Unknown command',3:'Parameters error',4:'BTM is busy',5:'BTM memory is full'});
const DFU_PHASE=['Start_Req','Mcu_Image_Init','Dsp_Image_Init','Factory_Image_Init','Image_Update','Image_Validate','DFU_End','DFU_Reset'];
const summary=bytes=>({bytes:bytes.length,hex:hex(bytes.subarray(0,96)),truncated:bytes.length>96});
const DEVICE_STATE={0:'Power OFF',1:'Pairing',2:'Standby',3:'HF connesso',4:'A2DP connesso',5:'SPP connesso',6:'Profili connessi'};
export async function prepareBm83Standby(bridge,{sleep=pause,notify=()=>{}}={}) {
  let state=await bridge.readState();const before=state;
  let poweredOn=false,pairingExited=false;
  // Reset/TEST exit can leave the application alive but its Bluetooth system
  // logically OFF. Per Microchip DS50002896A 4.6.2, power-on requires BOTH
  // MMI actions 51 (press) and 52 (release). No settings/Flash are changed.
  if(state===0) {
    notify({state:'BM83_POWERING_ON',deviceState:state,stateName:DEVICE_STATE[state]});
    await bridge.command(0x02,[0,0x51],4000,{phase:'Power_On_Press'});
    await sleep(20);
    await bridge.command(0x02,[0,0x52],4000,{phase:'Power_On_Release'});
    poweredOn=true;
  }
  for(let poll=0;poll<32;poll++) {
    if(state===2) {
      notify({state:'BM83_LOG',kind:'STANDBY_READY',before,deviceState:state,poweredOn,pairingExited});return state;
    }
    if(state===1 && !pairingExited) {
      notify({state:'BM83_LEAVING_PAIRING',deviceState:state});
      await bridge.command(0x02,[0,0x6b],4000,{phase:'Exit_Pairing'});pairingExited=true;
    }else if(state!==0 && state!==1) {
      throw new UpdateError('BM83_NOT_STANDBY',`Stato ${state} (${DEVICE_STATE[state]||'sconosciuto'}): scollega il Bluetooth del telefono e termina chiamate/audio. Nessun comando DFU inviato.`);
    }
    await sleep(250);state=await bridge.readState();
  }
  if(state===2) {
    notify({state:'BM83_LOG',kind:'STANDBY_READY',before,deviceState:state,poweredOn,pairingExited});return state;
  }
  throw new UpdateError(state===0?'BM83_POWER_ON_FAILED':'BM83_NOT_STANDBY',
    `Stato ${state} (${DEVICE_STATE[state]||'sconosciuto'}) dopo la preparazione. ${state===0?'Accendi il BM83 con il suo tasto e riprova.':'Disattiva il Bluetooth del telefono e verifica lo standby.'} Nessun comando DFU inviato.`);
}
export function bm83Packet(command, parameters=[]) {
  const length=parameters.length+1;
  if(length>2048)throw new UpdateError('BM83_PROTOCOL','Packet too large.');
  const b=Uint8Array.from([0xAA,...be16(length),command,...parameters,0]);
  b[b.length-1]=(-b.subarray(1).reduce((a,b)=>a+b,0))&255;
  return b;
}
export class Bm83Parser {
  constructor(){this.buffer=[];}
  push(bytes) {
    this.buffer.push(...bytes);const packets=[];
    while(this.buffer.length) {
      if(this.buffer[0]===0){this.buffer.shift();continue;} // Optional wake-up byte.
      if(this.buffer[0]!==0xAA)throw new UpdateError('BM83_PROTOCOL','Invalid BM83 UART start byte.');
      if(this.buffer.length<3)break;
      const size=(this.buffer[1]<<8)|this.buffer[2];
      if(size<1 || size>2048)throw new UpdateError('BM83_PROTOCOL','Invalid BM83 UART length.');
      if(this.buffer.length<size+4)break;
      const packet=Uint8Array.from(this.buffer.splice(0,size+4));
      if(packet.subarray(1).reduce((a,b)=>a+b,0)&255)throw new UpdateError('BM83_PROTOCOL','BM83 UART checksum mismatch.');
      packets.push({event:packet[3],parameters:packet.slice(4,-1)});
    }
    return packets;
  }
}
export class Bm83Bridge {
  constructor(io,{sleep=pause,log=()=>{}}={}) { this.io=io;this.sleep=sleep;this.log=log;this.sequence=0;this.parser=new Bm83Parser();this.events=[];this.opened=false; }
  async rpc(command,key,timeout=2500) {
    const line=await this.io.text(command+'\n',line=>line.startsWith('[BM83] '+key+'=')||line.startsWith('[BM83] ERROR='),timeout);
    if(line==='[BM83] ERROR=TEST_GUARD')throw new UpdateError('BM83_RECOVERY_REQUIRED','Il BM83 e protetto in reset. Completa il caricamento con Programmazione diretta TEST.');
    if(line.startsWith('[BM83] ERROR='))throw new UpdateError('BM83_BRIDGE',line);
    return line;
  }
  async open(mode='APP') {
    if(!['APP','TEST'].includes(mode))throw new UpdateError('BM83_PROTOCOL','Invalid bridge mode.');
    const info=appInfo(await this.io.text('\nZN_INFO?\n',line=>!!appInfo(line)));
    if(info?.product!=='HEADSET_BT' || ![1,2,3].includes(info.bm83_bridge))throw new UpdateError('BM83_BRIDGE_REQUIRED','Installa il firmware HEADSET_BT con bridge BM83.');
    if(mode==='TEST' && info.bm83_bridge<2)throw new UpdateError('BM83_BRIDGE_REQUIRED','La prova UART veloce richiede il nuovo firmware STM32 con bridge BM83 v2.');
    this.log({kind:'DEVICE',mode,info});
    this.info=info;
    // TinyUSB's connected state includes DTR. Assert it explicitly instead
    // of relying on the host driver default when opening a Web Serial port.
    if(this.io.port?.setSignals)await this.io.port.setSignals({dataTerminalReady:true});
    await this.rpc('ZN_BM83_OPEN '+mode,'OPEN');
    this.opened=true;
    this.events=[];this.parser=new Bm83Parser();
  }
  async close() { if(this.opened && this.io.connected)await this.rpc('ZN_BM83_CLOSE','CLOSED');this.opened=false; }
  async send(bytes) {
    for(let offset=0;offset<bytes.length;offset+=512)await this.rpc('ZN_BM83_TX '+hex(bytes.subarray(offset,offset+512)),'TX');
  }
  async poll() {
    const line=await this.rpc('ZN_BM83_RX?','DATA');
    const value=line.slice(12).trim();
    if(!/^(?:[a-f\d]{2})*$/i.test(value))throw new UpdateError('BM83_PROTOCOL','Invalid bridge response.');
    const bytes=Uint8Array.from(value.match(/../g)||[],b=>parseInt(b,16));
    const packets=this.parser.push(bytes);
    for(const item of packets) {
      // Command_Ack is not acknowledged; every other BM83 event is.
      if(item.event!==0)await this.send(bm83Packet(0x14,[item.event]));
      this.events.push(item);
    }
    if(this.events.length>64)throw new UpdateError('BM83_PROTOCOL','Too many unsolicited BM83 events.');
    return packets.length;
  }
  async wait(predicate,timeout=4000) {
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline) {
      const index=this.events.findIndex(predicate);
      if(index>=0)return this.events.splice(index,1)[0];
      await this.poll();await this.sleep(5);
    }
    throw new UpdateError('BM83_TIMEOUT','BM83 did not acknowledge the command. No write was retried; reconnect and restart the procedure.');
  }
  async command(command,parameters=[],timeout=4000,context={}) {
    // ACKs carry command ID only, without sequence/sub-opcode. A timed-out
    // mutation is ambiguous and must never be replayed automatically.
    this.events=this.events.filter(e=>e.event!==0);
    const packet=bm83Packet(command,parameters),started=Date.now();
    const details={sequence:++this.sequence,command:'0x'+command.toString(16).padStart(2,'0'),
      ...(command===0x49?{subOpcode:parameters[0],phase:DFU_PHASE[parameters[0]]||'Unknown_DFU'}:{}),...context};
    this.log({kind:'TX',...details,packet:summary(packet)});
    try {
      await this.send(packet);
      const ack=await this.wait(e=>e.event===0 && e.parameters[0]===command,timeout);
      if(ack.parameters.length!==2)throw new UpdateError('BM83_PROTOCOL','ACK BM83 malformato.');
      const status=ack.parameters[1],statusName=BM83_ACK_STATUS[status]||'Reserved status';
      this.log({kind:'ACK',...details,status,statusName,elapsedMs:Date.now()-started,packet:summary(bm83Packet(0,ack.parameters))});
      if(status!==0) {
        const location=[details.phase,details.part,details.offset!==undefined?'offset '+details.offset:null].filter(Boolean).join(' / ');
        const hint=status===3?'Il BM83 ha rifiutato i parametri; conserva il log e non ripetere alla cieca.':
          status===1?'Comando non consentito nello stato attuale del modulo.':'Il trasferimento e stato interrotto senza ritentare il comando.';
        const error=new UpdateError('BM83_NACK',`${details.command}${location?' / '+location:''}: stato ${status} (${statusName}). ${hint}`);
        error.context={...details,status,statusName};throw error;
      }
    } catch(error) {
      this.log({kind:'COMMAND_FAILED',...details,elapsedMs:Date.now()-started,error:error.message});throw error;
    }
  }
  async readVersion(type=0) {
    const length={0:2,1:2,3:4,4:4}[type];
    if(!length)throw new UpdateError('BM83_PROTOCOL','Unsupported version query.');
    await this.command(0x08,[type]);
    const reply=await this.wait(e=>e.event===0x18 && e.parameters[0]===type);
    if(reply.parameters.length!==length+1)throw new UpdateError('BM83_PROTOCOL','Unexpected BM83 version reply.');
    return reply.parameters.slice(1);
  }
  async version() {return Array.from(await this.readVersion(0)).join('.');}
  async detectAppBaud() {
    // Host-only adaptation to the settings ALREADY in the BM83 image.
    // Read-version is safe to probe; no persistent BM83 setting is changed.
    for(const baud of [115200,921600,460800,230400]) {
      await this.rpc('ZN_BM83_APP_BAUD '+baud,'BAUD');
      this.events=[];this.parser=new Bm83Parser();
      this.log({kind:'APP_UART_PROBE',baud});
      try {const version=await this.version();this.log({kind:'APP_UART_VERIFIED',baud,version});return {baud,version};}
      catch(error){this.log({kind:'APP_UART_PROBE_FAILED',baud,error:error.message});}
    }
    throw new UpdateError('BM83_APP_UART','Il BM83 non risponde alle velocita applicative supportate. Flash scritta ma avvio non verificato.');
  }
  async readState() {
    this.events=this.events.filter(e=>e.event!==0x1e);
    await this.command(0x0d);
    const reply=await this.wait(e=>e.event===0x1e);
    if(!reply.parameters.length)throw new UpdateError('BM83_PROTOCOL','Risposta stato BM83 vuota.');
    this.log({kind:'LINK_STATE',deviceState:reply.parameters[0],stateName:DEVICE_STATE[reply.parameters[0]]||'sconosciuto',raw:hex(reply.parameters)});
    return reply.parameters[0];
  }
}
export class Bm83Updater {
  constructor(io,notify=()=>{},{sleep=pause,bridgeFactory}={}) {
    this.io=io;this.notify=notify;this.sleep=sleep;
    this.bridgeFactory=bridgeFactory || (io=>new Bm83Bridge(io,{sleep,log:event=>this.notify({state:'BM83_LOG',...event})}));this.busy=false;
  }
  async probe() {
    if(this.busy)throw new UpdateError('BUSY');this.busy=true;
    const bridge=this.bridgeFactory(this.io);
    try { await bridge.open();return await bridge.version(); }
    finally { try {await bridge.close();} finally {this.busy=false;} }
  }
  async recover() {
    if(this.busy)throw new UpdateError('BUSY');this.busy=true;
    const bridge=this.bridgeFactory(this.io);
    try {
      await bridge.open();await bridge.rpc('ZN_BM83_RESET','RESET');await this.sleep(3000);
      await bridge.close();await bridge.open();
      return await bridge.version();
    } finally {try {await bridge.close();} finally {this.busy=false;}}
  }
  async testUart(baud=921600) {
    if(this.busy)throw new UpdateError('BUSY');this.busy=true;
    const bridge=this.bridgeFactory(this.io);
    try {return await testBm83Uart(bridge,baud,{sleep:this.sleep,log:event=>this.notify({state:'BM83_LOG',...event})});}
    finally {try {await bridge.close();} finally {this.busy=false;}}
  }
  async run(image) {
    if(this.busy)throw new UpdateError('BUSY');
    if(image?.format!=='BM83_MCU_DFU' || !image.images?.length)throw new UpdateError('BM83_IMAGE_INVALID');
    this.busy=true;const bridge=this.bridgeFactory(this.io);
    let ended=false,context={phase:'CONNECT'};const started=Date.now();
    try {
      this.notify({state:'BM83_LOG',kind:'SESSION',protocol:'MCU_DFU_0x49',baud:115200,file:image.filename,sha256:image.sha256,
        total:image.total,images:image.images.map(p=>({name:p.name,type:p.type,bytes:p.bytes.length,crc:p.crc,version:p.version}))});
      this.notify({state:'BM83_CONNECTING'});await bridge.open();
      const before=await bridge.version();
      // Check that this installed application supports the identity queries
      // we will require after reboot, before sending any DFU mutation.
      for(const part of image.images)if(part.version)await bridge.readVersion(part.type===0?3:4);
      context={phase:'PREPARE_STANDBY'};
      if(bridge.readState)await prepareBm83Standby(bridge,{sleep:this.sleep,notify:this.notify});
      this.notify({state:'BM83_START',before});
      const sizes=[0,0,0];for(const part of image.images)sizes[part.type]=part.bytes.length;
      const dfu=async(parameters,timeout,detail={})=>{
        context={phase:DFU_PHASE[parameters[0]],...detail};
        this.notify({state:'BM83_LOG',kind:'DFU_STEP',...context,subOpcode:parameters[0]});
        return bridge.command(0x49,parameters,timeout,detail);
      };
      await dfu([0,...sizes.flatMap(be32)],30000,{sizes});
      let sent=0;
      for(const part of image.images) {
        if(part.type===1) {
          const h=part.header;
          for(let offset=0;offset<h.length;offset+=256) {
            const block=h.subarray(offset,offset+256);
            await dfu([2,...be16(part.crc),...be16(h.length),...be16(block.length),...block],30000,{part:part.name,headerOffset:offset,length:block.length,crc:part.crc});
          }
        } else await dfu([part.type===0?1:3,...be16(part.crc)],30000,{part:part.name,crc:part.crc});
        for(let offset=0;offset<part.bytes.length;offset+=256) {
          const block=part.bytes.subarray(offset,offset+256);
          await dfu([4,part.type,...be32(offset),...be16(block.length),...block],30000,{part:part.name,offset,length:block.length});
          sent+=block.length;const elapsedMs=Date.now()-started;
          this.notify({state:'BM83_SENDING',part:part.name,offset:sent,total:image.total,elapsedMs,bytesPerSecond:Math.round(sent*1000/Math.max(1,elapsedMs))});
        }
        this.notify({state:'BM83_VALIDATING',part:part.name});
        await dfu([5,part.type],120000,{part:part.name});
      }
      await dfu([6],30000);ended=true;
      this.notify({state:'BM83_REBOOTING'});
      await dfu([7],10000);
      await this.sleep(3000);
      // Deliberate BM83 reboot can produce UART framing transients while its
      // TX pin changes state. Start a new bridge session only after reboot;
      // errors during actual data/CRC/END processing remain fatal.
      await bridge.close();await bridge.open();
      bridge.events=[];bridge.parser=new Bm83Parser();
      const after=await bridge.version();
      const versions={};
      for(const part of image.images)if(part.version) {
        const actual=Array.from(await bridge.readVersion(part.type===0?3:4));
        if(actual.length!==part.version.length || actual.some((b,i)=>b!==part.version[i]))
          throw new UpdateError('BM83_VERSION_MISMATCH',`${part.name}: expected ${hex(part.version)}, received ${hex(actual)}.`);
        versions[part.name]=actual;
      }
      // UART protocol version is not firmware identity. CRC ACK proves image
      // validation; this probe proves only that the module runs after reboot.
      this.notify({state:'BM83_COMPLETE',before,after,versions,crcValidated:true,versionsMatched:true,firmwareIdentityVerified:false});
    } catch(error) {
      this.notify({state:ended?'BM83_REBOOT_UNVERIFIED':'BM83_FAILED',error,...context,elapsedMs:Date.now()-started});
      if(bridge.opened)try {
        this.notify({state:'BM83_LOG',kind:'BRIDGE_SNAPSHOT',reply:await bridge.rpc('ZN_BM83_INFO?','BRIDGE')});
      }catch(snapshotError){this.notify({state:'BM83_LOG',kind:'SNAPSHOT_FAILED',error:snapshotError.message});}
      throw error;
    } finally {
      try {await bridge.close();} finally {this.busy=false;}
    }
  }
}
