import { UpdateError } from './znfw.js';

const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
export function hciCommand(opcode,parameters=[]) {
  if(!Number.isInteger(opcode)||opcode<0||opcode>65535||parameters.length>255)throw new UpdateError('BM83_HCI','Comando HCI non valido.');
  return Uint8Array.from([1,opcode&255,opcode>>>8,parameters.length,...parameters]);
}
export class HciEventParser {
  constructor(){this.buffer=[];}
  push(bytes) {
    this.buffer.push(...bytes);const events=[];
    while(this.buffer.length) {
      if(this.buffer[0]===0){this.buffer.shift();continue;}
      if(this.buffer[0]!==4)throw new UpdateError('BM83_HCI','Inizio evento HCI non valido.');
      if(this.buffer.length<3)break;
      const size=this.buffer[2]+3;
      if(this.buffer.length<size)break;
      const raw=Uint8Array.from(this.buffer.splice(0,size));
      events.push({event:raw[1],parameters:raw.slice(3),raw});
    }
    return events;
  }
}

// TEST/ROM uses HCI vendor commands, not the application's AA/0x49 protocol.
// Official AT 1.0.1 isUpdate tool, routine 0x409030, sends FC5D with
// the 32-bit little-endian baud. It requires Command Complete success at the
// OLD baud, waits 1000ms, then changes the host UART. No Flash command below.
export async function connectBm83Test(bridge,baud=921600,{sleep=ms=>new Promise(r=>setTimeout(r,ms)),log=()=>{}}={}) {
  if(![115200,230400,460800,921600].includes(baud))throw new UpdateError('BM83_BAUD','Velocita UART non supportata.');
  await bridge.open('TEST');
  let parser=new HciEventParser(),queue=[];
  const command=async(opcode,parameters=[],statusByte=true)=>{
    const raw=hciCommand(opcode,parameters),name='0x'+opcode.toString(16).padStart(4,'0');
    log({kind:'HCI_TX',opcode:name,packet:hex(raw)});
    await bridge.send(raw);const deadline=Date.now()+4000;
    while(Date.now()<deadline) {
      const index=queue.findIndex(e=>e.event===0x0e && e.parameters.length>=3 && (e.parameters[1]|e.parameters[2]<<8)===opcode);
      if(index>=0) {
        const ack=queue.splice(index,1)[0];
        // FC20 returns the ROM name immediately after the opcode, without
        // a status byte. Standard HCI and FCA4 responses include status.
        const status=statusByte?ack.parameters[3]:null;
        log({kind:'HCI_ACK',opcode:name,status,packet:hex(ack.raw)});
        if(statusByte && status!==0)throw new UpdateError('BM83_HCI_NACK',`${name}: stato ${status}.`);
        // ROM vendor handlers need a turnaround interval after completion,
        // particularly after SPI programming at 921600 without RTS/CTS.
        await sleep(2);
        return ack.parameters.slice(statusByte?4:3);
      }
      const line=await bridge.rpc('ZN_BM83_RX?','DATA'),value=line.slice(12).trim();
      if(!/^(?:[a-f\d]{2})*$/i.test(value))throw new UpdateError('BM83_HCI','Risposta bridge non valida.');
      const packets=parser.push(Uint8Array.from(value.match(/../g)||[],b=>parseInt(b,16)));
      for(const p of packets)log({kind:'HCI_RX',packet:hex(p.raw)});
      queue.push(...packets);if(queue.length>64)throw new UpdateError('BM83_HCI','Troppi eventi HCI.');
      if(!packets.length)await sleep(1);
    }
    throw new UpdateError('BM83_HCI_TIMEOUT',`Nessuna conferma per ${name}. Nessun comando ritentato.`);
  };
  log({kind:'TEST_UART_START',initialBaud:115200,targetBaud:baud});
  const before=await command(0x1001); // Standard HCI Read Local Version Information.
  if(before.length!==8)throw new UpdateError('BM83_HCI','Identita HCI incompleta.');
  if(baud!==115200) {
    await command(0xfc5d,[baud&255,(baud>>>8)&255,(baud>>>16)&255,(baud>>>24)&255]);
    await sleep(1000);
    const reply=await bridge.rpc('ZN_BM83_BAUD '+baud,'BAUD');
    if(reply.trim()!=='[BM83] BAUD='+baud)throw new UpdateError('BM83_BAUD','Il bridge non conferma la velocita richiesta.');
    parser=new HciEventParser();queue=[];
  }
  const after=await command(0x1001);
  if(hex(before)!==hex(after))throw new UpdateError('BM83_HCI','Identita diversa dopo il cambio velocita.');
  // A single short reply can pass despite UART overrun under USB load.
  // Read ROM/JEDEC identities repeatedly, using ONLY the vendor tool's
  // identification commands (42A360). Never initialize/erase/write Flash.
  let rom,flashId;
  for(let round=0;round<32;round++) {
    const device=await command(0xfc20,[],false);
    if(device.length!==22 || new TextDecoder().decode(device.slice(0,7))!=='BT5511_')
      throw new UpdateError('BM83_HCI','Identita ROM BM83 non riconosciuta.');
    const flash=await command(0xfca4,[0,3,1,0x9f]); // SPI Read JEDEC ID only.
    if(flash.length!==5 || flash[0]!==0x9f || flash[1]!==3 ||
       flash.slice(2).every(b=>b===0) || flash.slice(2).every(b=>b===255))
      throw new UpdateError('BM83_HCI','Identificativo Flash non valido.');
    const nextRom=hex(device),nextFlash=hex(flash.slice(2));
    if(round && (nextRom!==rom || nextFlash!==flashId))
      throw new UpdateError('BM83_HCI','Identita ROM/Flash instabile alla velocita selezionata.');
    rom=nextRom;flashId=nextFlash;
  }
  const result={baud,identity:hex(after),rom,flashId,identificationRounds:32,flashWritten:false};
  log({kind:'TEST_UART_VERIFIED',...result});
  return {...result,command};
}
export async function testBm83Uart(bridge,baud=921600,options={}) {
  const {command,...result}=await connectBm83Test(bridge,baud,options);
  if(bridge.info?.bm83_bridge===3)result.guarded=/\bGUARD=1\b/.test(await bridge.rpc('ZN_BM83_INFO?','BRIDGE'));
  return result;
}
