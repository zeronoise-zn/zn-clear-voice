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
// isUpdate 2.97 (official AT 1.0.1 tool), routine 0x409030, sends FC5D with
// the 32-bit little-endian baud. It requires Command Complete success at the
// OLD baud, waits 1000ms, then changes the host UART. No Flash command below.
export async function testBm83Uart(bridge,baud,{sleep=ms=>new Promise(r=>setTimeout(r,ms)),log=()=>{}}={}) {
  if(![115200,230400,460800,921600].includes(baud))throw new UpdateError('BM83_BAUD','Velocita UART non supportata.');
  await bridge.open('TEST');
  let parser=new HciEventParser(),queue=[];
  const command=async(opcode,parameters=[])=>{
    const raw=hciCommand(opcode,parameters),name='0x'+opcode.toString(16).padStart(4,'0');
    log({kind:'HCI_TX',opcode:name,packet:hex(raw)});
    await bridge.send(raw);const deadline=Date.now()+4000;
    while(Date.now()<deadline) {
      const index=queue.findIndex(e=>e.event===0x0e && e.parameters.length>=4 && (e.parameters[1]|e.parameters[2]<<8)===opcode);
      if(index>=0) {
        const ack=queue.splice(index,1)[0];
        log({kind:'HCI_ACK',opcode:name,status:ack.parameters[3],packet:hex(ack.raw)});
        if(ack.parameters[3]!==0)throw new UpdateError('BM83_HCI_NACK',`${name}: stato ${ack.parameters[3]}.`);
        return ack.parameters.slice(4);
      }
      const line=await bridge.rpc('ZN_BM83_RX?','DATA'),value=line.slice(12).trim();
      if(!/^(?:[a-f\d]{2})*$/i.test(value))throw new UpdateError('BM83_HCI','Risposta bridge non valida.');
      const packets=parser.push(Uint8Array.from(value.match(/../g)||[],b=>parseInt(b,16)));
      for(const p of packets)log({kind:'HCI_RX',packet:hex(p.raw)});
      queue.push(...packets);if(queue.length>64)throw new UpdateError('BM83_HCI','Troppi eventi HCI.');
      await sleep(5);
    }
    throw new UpdateError('BM83_HCI_TIMEOUT',`Nessuna conferma per ${name}; la velocita non e verificata.`);
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
  log({kind:'TEST_UART_VERIFIED',baud,identity:hex(after),flashWritten:false});
  return {baud,identity:hex(after),flashWritten:false};
}
