// Wire source: zn_update_protocol.h/.c and UPDATE_PROTOCOL.md at STM32 HEAD 11a737c93613.
import { UpdateError, PRODUCT } from './znfw.js';
export const CMD = Object.freeze({ HELLO: 1, INFO: 2, BEGIN: 3, DATA: 4, END: 5, STATUS: 6, ABORT: 7, REBOOT: 8 });
export const CHUNK = 1024, MAX_WIRE = 1044;
export const ERRORS = ['OK','VERSION','COMMAND','LENGTH','CRC','COBS','STATE','SEQUENCE','OFFSET','SIZE','PRODUCT','HARDWARE','MIN_VERSION','FLASH','HASH','SIGNATURE','VECTOR','METADATA','TARGET','PENDING','TIMEOUT','SEQUENCE_CONFLICT','INTERNAL','FRAME_TOO_LARGE','UPDATE_ENGINE_NOT_AVAILABLE','GEOMETRY','UART_RX','UART_TX_TIMEOUT'];
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
export function cobsEncode(raw) {
  const out = new Uint8Array(raw.length + Math.floor(raw.length / 254) + 2);
  let mark = 0, n = 1, code = 1;
  for (const b of raw) {
    if (!b) { out[mark] = code; mark = n++; code = 1; }
    else { out[n++] = b; if (++code === 255) { out[mark] = code; mark = n++; code = 1; } }
  }
  out[mark] = code; out[n++] = 0;
  return out.subarray(0, n);
}
export function cobsDecode(encoded) {
  const out = new Uint8Array(encoded.length); let i = 0, n = 0;
  while (i < encoded.length) {
    const code = encoded[i++];
    if (!code || i + code - 1 > encoded.length) throw new UpdateError('INVALID_FRAME', 'COBS');
    for (let j = 1; j < code; j++) out[n++] = encoded[i++];
    if (code !== 255 && i < encoded.length) out[n++] = 0;
  }
  return out.subarray(0, n);
}
export function frame(command, sequence, payload = new Uint8Array()) {
  if (payload.length > 1028) throw new UpdateError('INVALID_FRAME', 'Payload too large');
  const raw = new Uint8Array(10 + payload.length), v = new DataView(raw.buffer);
  raw[0] = 1; raw[1] = command; v.setUint16(2, sequence, true); v.setUint16(4, payload.length, true);
  raw.set(payload, 6); v.setUint32(raw.length - 4, crc32(raw.subarray(0, -4)), true);
  return cobsEncode(raw);
}
export function decodeFrame(encoded) {
  const raw = cobsDecode(encoded), v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (raw.length < 10 || raw.length > 1038 || raw[0] !== 1 || v.getUint16(4, true) !== raw.length - 10 ||
      v.getUint32(raw.length - 4, true) !== crc32(raw.subarray(0, -4))) throw new UpdateError('INVALID_FRAME', 'Length, version or CRC');
  return { command: raw[1], sequence: v.getUint16(2, true), payload: raw.subarray(6, -4) };
}
export function response(decoded) {
  const p = decoded.payload;
  if (p.length < 8) throw new UpdateError('INVALID_FRAME', 'Response prefix');
  const v = new DataView(p.buffer, p.byteOffset, p.byteLength);
  return { ...decoded, status: v.getUint16(0, true), state: p[2], request: p[3], offset: v.getUint32(4, true) };
}
export function* chunks(payload) {
  for (let offset = 0; offset < payload.length; offset += CHUNK) {
    const n = Math.min(CHUNK, payload.length - offset), data = new Uint8Array(n + 4);
    new DataView(data.buffer).setUint32(0, offset, true); data.set(payload.subarray(offset, offset + n), 4);
    yield { offset, end: offset + n, data };
  }
}
export function parseHello(r) {
  const p = r.payload, v = new DataView(p.buffer, p.byteOffset, p.byteLength);
  if (p.length !== 26 || new TextDecoder().decode(p.subarray(8,16)) !== 'ZNBLCVWH' || p[16] !== 1 || p[17] !== 0 ||
      v.getUint16(18,true) !== CHUNK || v.getUint16(20,true) !== 1028 || v.getUint16(22,true) !== 1038 || v.getUint16(24,true) !== MAX_WIRE)
    throw new UpdateError('PROTOCOL_MISMATCH', 'Not the supported ClearVoice bootloader.');
  return r;
}
export function parseBootInfo(r) {
  const p = r.payload, v = new DataView(p.buffer, p.byteOffset, p.byteLength);
  if (p.length !== 209 || p[8] !== 2 || p[9] !== 1 || v.getUint32(40,true) !== PRODUCT || p[18] > 64 || p[19] > 94)
    throw new UpdateError('PROTOCOL_MISMATCH', 'GET_INFO format 2 required.');
  return { hardwareMask: v.getUint32(12,true), hardware: `REV${String(p[10]).padStart(2,'0')}`,
    flags: p[11], flashKb: v.getUint16(16,true), capacity: v.getUint32(28,true), capabilities: v.getUint32(36,true),
    minimumBootloader: v.getUint32(203,true), product: 'ClearVoice', mode: 'bootloader',
    bootBuildId: new TextDecoder().decode(p.subarray(108,108+p[19])),
    bootGit: new TextDecoder().decode(p.subarray(44,44+p[18])), activeSlot:p[207], targetSlot:p[208] };
}
export function parseStatus(r) {
  const p = r.payload;
  if (p.length !== 18 || r.state > 5) throw new UpdateError('PROTOCOL_MISMATCH', 'GET_STATUS format 2 required.');
  const v = new DataView(p.buffer, p.byteOffset, p.byteLength);
  return { ...r, lastError: v.getUint16(8,true), nextSequence: v.getUint16(10,true), imageSize: v.getUint32(14,true),
    activeSlot:p[12], targetSlot:p[13] };
}
export function checkTarget(pkg, info) {
  if (!(info.flags & 8) || (info.flags & 20) || (info.capabilities & 0xc0000000) >>> 0 !== 0xc0000000)
    throw new UpdateError('PROD_REQUIRED', 'Device must have the provisioned production bootloader.');
  if (!(pkg.hardwareMask & info.hardwareMask)) throw new UpdateError('TARGET_MISMATCH', 'Hardware mask');
  if (pkg.minimumBootloader > info.minimumBootloader) throw new UpdateError('TARGET_MISMATCH', 'Minimum bootloader');
  if (pkg.imageSize > info.capacity || ![256,512].includes(info.flashKb)) throw new UpdateError('TARGET_MISMATCH', 'Flash capacity');
}
