// BM83 ROM HCI/FCA4 SPI programmer, restricted to SST26VF016B (BF2641).
// SST26VF016B DS20005262F: SPI 03/05/06/02/20/42/72. No chip erase,
// global unlock, security/OTP commands, or vendor executable is used.
import {UpdateError} from './znfw.js';
import {FLASH_SIZE,inspectBm83Image,parseBm83Hex} from './bm83-image.js';
import {connectBm83Test} from './bm83-test-link.js';
import {Bm83Bridge} from './bm83-updater.js';
import {crc32} from './zn-protocol.js';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const hex=b=>Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');
const equal=(a,b)=>a.length===b.length && a.every((v,i)=>v===b[i]);
const fail=(code,message)=>{throw new UpdateError(code,message);};
const addressBytes=a=>[a>>>16,(a>>>8)&255,a&255];
export const sha256=async bytes=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
const versionCompare=(a,b)=>{for(let i=0;i<4;i++){if(a[i]!==b[i])return Math.sign(a[i]-b[i]);}return 0;};

export async function readBm83FlashIdentity(flash) {
  const header=await flash.read(0,4096);
  const empty=header.every(b=>b===255);
  let validHeader=false,dsp=null;
  if(header[0]===0 && header[1]===0x80 && header[2]===4) {
    const end=7+new DataView(header.buffer,header.byteOffset,header.length).getUint32(3,false);
    if(end>=13 && end<=4096 && header[end-6]===0x81 && header[end-5]===4 &&
       new DataView(header.buffer,header.byteOffset,header.length).getUint32(end-4,false)===0x23454e44) {
      let at=7;validHeader=true;
      while(at<end-6){const tag=header[at++],length=header[at++];
        if(!length||at+length>end-6){validHeader=false;break;}
        if(tag===0x92 && length===4)dsp=Array.from(header.slice(at,at+4));
        at+=length;
      }
      if(at!==end-6)validHeader=false;
    }
  }
  const raw=Array.from(await flash.read(0x121fc,4));
  const mcu=raw.every(b=>b===255)||raw.every(b=>b===0)?null:raw;
  return {validHeader,empty,mcu,dsp:validHeader?dsp:null};
}

export async function planBm83Flash(text,filename) {
  const image=await inspectBm83Image(text,filename),{data,present}=parseBm83Hex(text);
  const regions=[];
  const add=(name,start,end,bytes=data.slice(start,end))=>{
    if(start%4096 || end%4096 || start>=end || end>FLASH_SIZE || (start<0x4000 && end>0x2000))
      fail('BM83_FLASH_PLAN','Intervallo Flash non consentito.');
    regions.push({name,start,bytes});
  };
  // Keep both header sectors until all payload sectors have been verified.
  // Erase the old alternate header and commit the supplied primary header last.
  add('HEADER',0,0x2000);
  for(const part of image.images) {
    if(part.type===0)add('MCU',0x10000,0x90000);
    if(part.type===1)add('DSP',0x110000,Math.ceil((0x110000+part.bytes.length)/4096)*4096);
    if(part.type===2) {
      const length=(data[0x6001]<<8)|data[0x6002];
      if(data[0x6000]!==0 || length<1 || length+3>0x2000 || !present.slice(0x6000,0x6003+length).every(Boolean))
        fail('BM83_FLASH_PLAN','Intestazione configurazione BM83 non valida.');
      add('RUNTIME',0x4000,0x6000,new Uint8Array(0x2000).fill(255));
      add('CONFIG',0x6000,0x8000); // Physical image includes the leading marker.
    }
  }
  const sorted=[...regions].sort((a,b)=>a.start-b.start);
  if(sorted.some((r,i)=>i && r.start<sorted[i-1].start+sorted[i-1].bytes.length))
    fail('BM83_FLASH_PLAN','Regioni Flash sovrapposte.');
  return {...image,format:'BM83_TEST_SPI',regions,total:regions.reduce((n,r)=>n+r.bytes.length,0)};
}

// The ROM returns status, echoed SPI opcode, read length and data in FCA4
// Command Complete. Match ALL fields; an ACK alone does not prove a write.
export class Bm83SpiFlash {
  constructor(link,{sleep=pause,check=()=>{},bridge=null}={}){this.link=link;this.sleep=sleep;this.check=check;this.bridge=bridge;}
  async spi(tx,read=0) {
    this.check();
    if(!tx.length || tx.length>252 || read<0 || read>240)fail('BM83_SPI','Dimensione transazione SPI non valida.');
    const result=await this.link.command(0xfca4,[0,read,tx.length,...tx]);
    if(result.length!==read+2 || result[0]!==tx[0] || result[1]!==read)
      fail('BM83_SPI','Risposta SPI incompleta o riferita a un altro comando.');
    return result.slice(2);
  }
  async read(address,length,onProgress=()=>{}) {
    if(!Number.isInteger(address)||!Number.isInteger(length)||address<0||length<0||address+length>FLASH_SIZE)
      fail('BM83_SPI','Lettura fuori Flash.');
    const bytes=new Uint8Array(length);
    if(this.bridge) {
      for(let offset=0;offset<length;offset+=4096) {
        this.check();const count=Math.min(4096,length-offset);
        const line=await this.bridge.rpc('ZN_BM83_READ '+(address+offset).toString(16).padStart(8,'0')+' '+count.toString(16).padStart(4,'0'),'READ',15000);
        const raw=line.slice(12).trim();
        if(raw.length!==count*2 || !/^(?:[a-f\d]{2})+$/i.test(raw))fail('BM83_SPI','Blocco letto incompleto.');
        bytes.set(Uint8Array.from(raw.match(/../g),v=>parseInt(v,16)),offset);onProgress(offset+count,length);
      }
      return bytes;
    }
    for(let offset=0;offset<length;offset+=240){
      const count=Math.min(240,length-offset);
      bytes.set(await this.spi([3,...addressBytes(address+offset)],count),offset);
      onProgress(offset+count,length);
    }
    return bytes;
  }
  async ready(timeout=4000) {
    const end=Date.now()+timeout;
    do {const status=(await this.spi([5],1))[0];
      if(status&4)fail('BM83_SPI','La Flash contiene una cancellazione sospesa.');
      if(!(status&1))return status;
      await this.sleep(2);
    }while(Date.now()<end);
    fail('BM83_SPI_TIMEOUT','La Flash non termina la scrittura. Nessun comando ritentato.');
  }
  async enableWrite() {
    await this.ready();await this.spi([6]);
    if(!((await this.spi([5],1))[0]&2))fail('BM83_SPI_PROTECTED','La Flash rifiuta Write Enable.');
  }
  async protection(){return this.spi([0x72],6);}
  async setProtection(bytes) {
    await this.enableWrite();await this.spi([0x42,...bytes]);await this.ready();
    if(!equal(await this.protection(),bytes))fail('BM83_SPI_PROTECTED','Protezione Flash non confermata.');
  }
  async sector(address,bytes) {
    if(address%4096 || bytes.length!==4096 || address<0 || address+4096>FLASH_SIZE || (address>=0x2000&&address<0x4000))
      fail('BM83_SPI','Settore Flash non consentito.');
    if(this.bridge) {
      this.check();
      await this.bridge.rpc('ZN_BM83_SECTOR '+address.toString(16).padStart(8,'0'),'SECTOR');
      for(let offset=0;offset<4096;offset+=512){
        this.check();const reply=await this.bridge.rpc('ZN_BM83_CHUNK '+offset.toString(16).padStart(4,'0')+' '+hex(bytes.subarray(offset,offset+512)),'CHUNK');
        if(reply.trim()!=='[BM83] CHUNK='+(offset+512))fail('BM83_SPI','Offset buffer STM32 non confermato.');
      }
      this.check();const crc=crc32(bytes).toString(16).padStart(8,'0');
      const reply=await this.bridge.rpc('ZN_BM83_PROGRAM '+crc,'PROGRAM',15000);
      if(reply.trim().toLowerCase()!=='[bm83] program=ok crc='+crc)fail('BM83_FLASH_VERIFY','Conferma settore STM32 non valida.');
      return;
    }
    await this.enableWrite();await this.spi([0x20,...addressBytes(address)]);await this.ready();
    // ROM command input buffers are smaller than standard HCI's length
    // field. Keep vendor SPI programs within a 43-byte HCI command frame
    // and never cross a 256-byte physical Flash page boundary.
    for(let offset=0;offset<4096;){
      const length=Math.min(32,256-(offset&255),4096-offset);
      const block=bytes.subarray(offset,offset+length);
      if(!block.every(b=>b===255)){
        await this.spi([6]);await this.spi([2,...addressBytes(address+offset),...block]);await this.ready();
      }
      offset+=length;
    }
    if(!equal(await this.read(address,4096),bytes))fail('BM83_FLASH_VERIFY',`Dati riletti diversi nel settore 0x${address.toString(16)}.`);
  }
}

// Only volatile WRITE protection bits are changed; calibration stays locked.
export function unlockedProtection(original,sectors) {
  if(original.length!==6)fail('BM83_SPI','BPR incompleto.');
  let value=BigInt('0x'+hex(original));
  for(const address of sectors){
    if(address%4096 || address<0 || address>=FLASH_SIZE || address>=0x2000&&address<0x4000)
      fail('BM83_FLASH_PLAN','Settore da sbloccare non consentito.');
    let bit;
    if(address<0x8000)bit=32+2*Math.floor(address/0x2000);
    else if(address<0x10000)bit=30;
    else if(address<0x1f0000)bit=Math.floor(address/0x10000)-1;
    else if(address<0x1f8000)bit=31;
    else bit=40+2*Math.floor((address-0x1f8000)/0x2000);
    value&=~(1n<<BigInt(bit));
  }
  value|=1n<<34n;
  return Uint8Array.from(value.toString(16).padStart(12,'0').match(/../g),s=>parseInt(s,16));
}

export class Bm83FlashUpdater {
  constructor(io,notify=()=>{},{sleep=pause,bridgeFactory,connect=connectBm83Test}={}) {
    this.io=io;this.notify=notify;this.sleep=sleep;this.connect=connect;
    this.bridgeFactory=bridgeFactory || (io=>new Bm83Bridge(io,{sleep,log:e=>notify({state:'BM83_LOG',...e})}));
    this.busy=false;this.cancelled=false;
  }
  cancel(){this.cancelled=true;}
  async run(plan,{baud=921600,automatic=false}={}) {
    if(this.busy)fail('BUSY','Operazione BM83 in corso.');
    if(plan?.format!=='BM83_TEST_SPI' || !plan.regions?.length)
      fail('BM83_FLASH_PLAN','Piano TEST obbligatorio.');
    this.busy=true;this.cancelled=false;
    const bridge=this.bridgeFactory(this.io),started=Date.now();let guarded=false,committed=false,flash,protection,detailed=true,context={phase:'CONNECT'};
    const log=e=>this.notify({state:'BM83_LOG',...e});
    const check=()=>{if(this.cancelled)fail('BM83_CANCELLED','Aggiornamento interrotto; ripeti il caricamento per recuperare il BM83.');};
    let lastProgress=0,lastPart='';
    const progress=(state,offset,total,part)=>{
      if(offset!==total && state+part===lastPart && Date.now()-lastProgress<200)return;
      lastProgress=Date.now();lastPart=state+part;
      this.notify({state,offset,total,part,baud,elapsedMs:Date.now()-started});
    };
    try {
      log({kind:'SESSION',protocol:'TEST_HCI_SPI',baud,file:plan.filename,sha256:plan.sha256,total:plan.total});
      const link=await this.connect(bridge,baud,{sleep:this.sleep,log:e=>{
        if(detailed || e.kind==='HCI_ACK' && e.status!==0 && e.status!==null)log(e);
      }});
      if(bridge.info?.bm83_bridge!==3)fail('BM83_BRIDGE_REQUIRED','La programmazione TEST richiede il firmware STM32 con bridge v3.');
      if(link.flashId!=='bf2641')fail('BM83_FLASH_UNSUPPORTED','Flash non supportata: '+link.flashId+'. Nessuna cancellazione eseguita.');
      detailed=false;context={phase:'COMPARE'};
      const capabilities=await bridge.rpc('ZN_BM83_INFO?','BRIDGE');
      const batch=/\bSPI_BATCH=4096\b/.test(capabilities);
      log({kind:'TRANSFER_MODE',usbBlock:batch?4096:32,executor:batch?'STM32':'BROWSER'});
      flash=new Bm83SpiFlash(link,{sleep:this.sleep,check,bridge:batch?bridge:null});
      let installed=null;
      if(automatic) {
        installed=await readBm83FlashIdentity(flash);
        this.notify({state:'BM83_INSTALLED',...installed});
        for(const part of plan.images) {
          const actual=part.type===0?installed.mcu:part.type===1?installed.dsp:null;
          if(installed.validHeader && actual && part.version && versionCompare(actual,part.version)>0)
            fail('BM83_NEWER_FIRMWARE','La Flash contiene una versione '+part.name+' piu recente: downgrade automatico bloccato.');
        }
      }
      // Retain only calibration in RAM; no full dump or persistent backup.
      await bridge.rpc('ZN_BM83_GUARD ON','GUARD');guarded=true;
      const calibration=await flash.read(0x2000,0x2000);
      log({kind:'CALIBRATION_SNAPSHOT',bytes:calibration.length,sha256:await sha256(calibration)});
      protection=await flash.protection();
      const sectors=[];let compared=0;
      // Runtime is mutable application data, never evidence of stale firmware.
      const compareRegions=automatic?plan.regions.filter(r=>r.name!=='RUNTIME'):plan.regions;
      const compareTotal=compareRegions.reduce((n,r)=>n+r.bytes.length,0);
      for(const region of compareRegions)for(let offset=0;offset<region.bytes.length;offset+=4096){
        const address=region.start+offset,bytes=region.bytes.slice(offset,offset+4096);
        const current=await flash.read(address,bytes.length);
        if(!equal(current,bytes))sectors.push({address,bytes,name:region.name});
        compared+=bytes.length;progress('BM83_COMPARING',compared,compareTotal,region.name);
      }
      const expectedVersions=Object.fromEntries(plan.images.filter(p=>p.version).map(p=>[p.name,p.version]));
      if(automatic && !sectors.length) {
        check();await bridge.rpc('ZN_BM83_GUARD OFF','GUARD');guarded=false;
        await bridge.close();
        this.notify({state:'BM83_UP_TO_DATE',readbackVerified:true,expectedVersions,sha256:plan.sha256,elapsedMs:Date.now()-started});
        return {state:'UP_TO_DATE',installed,expectedVersions};
      }
      // Microchip requires clearing runtime when CONFIG is actually updated.
      const clearRuntime=automatic && sectors.some(s=>s.name==='CONFIG');
      if(clearRuntime)for(const region of plan.regions.filter(r=>r.name==='RUNTIME'))for(let offset=0;offset<region.bytes.length;offset+=4096){
        const address=region.start+offset,bytes=region.bytes.slice(offset,offset+4096);
        if(!equal(await flash.read(address,bytes.length),bytes))sectors.push({address,bytes,name:region.name});
      }
      // Headers last, secondary first. Guard stays on until the complete
      // physical image, calibration and restored BPR have been verified.
      sectors.sort((a,b)=>(a.name==='HEADER')-(b.name==='HEADER') ||
        (a.name==='HEADER'?b.address-a.address:a.address-b.address));
      log({kind:'FLASH_PLAN',sectors:sectors.map(s=>({address:s.address,part:s.name})),preserveCalibration:true});
      context={phase:'UNLOCK'};
      if(sectors.length)await flash.setProtection(unlockedProtection(protection,sectors.map(s=>s.address)));
      let sent=0;
      for(const sector of sectors){
        context={phase:'PROGRAM',part:sector.name,address:sector.address};
        check();log({kind:'SECTOR_START',address:sector.address,part:sector.name});
        await flash.sector(sector.address,sector.bytes);sent+=4096;
        progress('BM83_FLASHING',sent,sectors.length*4096,sector.name);
      }
      for(const region of plan.regions.filter(r=>!automatic || r.name!=='RUNTIME' || clearRuntime)){
        context={phase:'READBACK',part:region.name,address:region.start};
        const actual=await flash.read(region.start,region.bytes.length,(n,total)=>progress('BM83_FLASH_VERIFY',n,total,region.name));
        if(!equal(actual,region.bytes))fail('BM83_FLASH_VERIFY',region.name+': verifica finale fallita.');
        log({kind:'FLASH_REGION_VERIFIED',part:region.name,address:region.start,bytes:actual.length,sha256:await sha256(actual)});
      }
      if(!equal(await flash.read(0x2000,0x2000),calibration))fail('BM83_CALIBRATION','Calibrazione diversa dalla lettura iniziale.');
      context={phase:'RESTORE_PROTECTION'};
      await flash.setProtection(protection);await flash.spi([4]);
      check();await bridge.rpc('ZN_BM83_GUARD OFF','GUARD');guarded=false;committed=true;
      await bridge.close();this.notify({state:'BM83_REBOOTING'});await this.sleep(3000);
      // Embedded Mode may disable the APP UART entirely. Do not require
      // host-mode commands or power-on via UART after programming. Physical
      // readback above proves the image; MFB/Bluetooth/audio prove operation.
      log({kind:'EMBEDDED_RELEASED',testPin:'FLOATING',q1:'OFF',runtimeVerified:false,expectedVersions});
      this.notify({state:'BM83_COMPLETE',protocol:'TEST_HCI_SPI',baud,applicationMode:'EMBEDDED',readbackVerified:true,calibrationPreserved:true,runtimeVerified:false,expectedVersions,elapsedMs:Date.now()-started});
      return {state:'COMPLETE',installed,expectedVersions,firstInstall:automatic&&!installed?.validHeader};
    } catch(error) {
      // Never claim commit after failed readback. CLOSE releases
      // TEST and RESET on STM32 1.0.10+; an incomplete image needs TEST recovery.
      this.notify({state:committed?'BM83_REBOOT_UNVERIFIED':'BM83_FAILED',error,guarded,...context,elapsedMs:Date.now()-started});
      if(bridge.opened)try{log({kind:'BRIDGE_SNAPSHOT',reply:await bridge.rpc('ZN_BM83_INFO?','BRIDGE')});}catch{}
      throw error;
    } finally {try{await bridge.close();}finally{this.busy=false;}}
  }
}
