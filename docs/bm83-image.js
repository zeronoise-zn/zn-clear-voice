/**
 * Lettore Intel HEX General Use per i percorsi USB BM83. La mappa Flash e
 * grande 2 MiB; present distingue byte forniti da FF di riempimento. Questo
 * modulo rifiuta il formato OTA cifrato: condivide la sintassi HEX, non il
 * contenuto. La calibrazione non deve essere scritta da una immagine firmware.
 */
import { UpdateError } from './znfw.js';
const fail = (message) => {
  throw new UpdateError('BM83_IMAGE_INVALID', message);
};
export const FLASH_SIZE = 0x200000;
/**
 * Verifica ogni record, checksum, sovrapposizione e limite prima di interpretare gli indirizzi.
 */
export function parseBm83Hex(text) {
  if (typeof text !== 'string' || text.length > 8 * 1024 * 1024) fail('BM83 HEX exceeds 8 MiB.');
  const data = new Uint8Array(FLASH_SIZE).fill(255),
    present = new Uint8Array(FLASH_SIZE);
  let base = 0,
    count = 0,
    eof = false,
    records = 0;
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith(';;;')) continue; // isUpdate adds descriptive footer comments.
    if (eof || !/^:(?:[a-f\d]{2}){5,260}$/i.test(line))
      fail(`Invalid HEX record at line ${index + 1}.`);
    const b = Uint8Array.from(line.slice(1).match(/../g), (h) => parseInt(h, 16));
    if (b.length !== b[0] + 5 || b.reduce((a, b) => a + b, 0) & 255)
      fail(`HEX checksum/length at line ${index + 1}.`);
    const length = b[0],
      offset = (b[1] << 8) | b[2],
      kind = b[3];
    records++;
    if (kind === 4 && length === 2 && offset === 0) {
      base = ((b[4] << 8) | b[5]) * 65536;
      continue;
    }
    if (kind === 1 && length === 0 && offset === 0) {
      eof = true;
      continue;
    }
    if (kind !== 0 || !length || offset + length > 65536)
      fail(`Unsupported HEX record at line ${index + 1}.`);
    const address = base + offset;
    if (address + length > FLASH_SIZE)
      fail('Use a BM83 Rehex image, not raw MCU/config input files.');
    for (let i = 0; i < length; i++) {
      if (present[address + i]) fail('Overlapping HEX data.');
      data[address + i] = b[4 + i];
      present[address + i] = 1;
      count++;
    }
  }
  if (!count || !records) fail('Empty HEX image.');
  // Microchip general-use exports may omit the Intel HEX EOF record.
  return { data, present, count, eof };
}
// Microchip MBA source: reflected polynomial 0x8408, init FFFF, then
// reverse the 16 result bits (no final XOR). Not CRC-16/XMODEM or CRC32.
/**
 * CRC specifico Microchip: non sostituire con CRC32 o CRC16/XMODEM.
 */
export function bm83Crc(bytes) {
  let crc = 65535;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0x8408 : 0);
  }
  let result = 0;
  for (let bit = 0; bit < 16; bit++) {
    result = (result << 1) | (crc & 1);
    crc >>>= 1;
  }
  return result;
}
function u32(b, i) {
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(i, false);
}
/**
 * Ricostruisce MCU/DSP/CONFIG e i relativi CRC secondo il formato del tool Microchip.
 */
export async function inspectBm83Image(text, filename = 'BM83.hex') {
  const hex = parseBm83Hex(text),
    { data, present } = hex;
  // Calibration is not firmware and may never be supplied by a release image.
  if (present.subarray(0x2000, 0x4000).some(Boolean))
    fail('Image includes the protected calibration area.');
  if (data[0] !== 0 || data[1] !== 0x80 || data[2] !== 4)
    fail('Select an unencrypted BM83 General Use Rehex image.');
  const end = 7 + u32(data, 3);
  if (end < 13 || end > 0x1000 || !present.subarray(0, end).every(Boolean))
    fail('Truncated BM83 flash header.');
  if (data[end - 6] !== 0x81 || data[end - 5] !== 4 || u32(data, end - 4) !== 0x23454e44)
    fail('Invalid BM83 flash header terminator.');
  // General Use and OTA share HEX syntax, but not the image layout. OTA
  // metadata/encrypted payload must never be mistaken for plain MCU DFU.
  if (data.subarray(end, 0x1000).some((b) => b !== 255))
    fail('Post-header metadata is unsupported; select BM83 General Use, not OTA DFU.');
  let at = 7,
    mcu = null,
    dspStart = -1,
    dspEnd = -1,
    pendingDsp = false,
    dspVersion = null;
  const descriptors = [];
  const descriptor = (value, name, low, high) => {
    if (value.length !== 18 || value[0] !== 0 || value[9] !== 2)
      fail(`Unsupported ${name} bank descriptor.`);
    const used = u32(value, 1),
      maximum = u32(value, 5),
      first = u32(value, 10),
      second = u32(value, 14);
    if (
      !used ||
      used > maximum ||
      first < low ||
      first + maximum > high ||
      second - first !== (name === 'MCU' ? 0x80000 : 0x70000) ||
      second + maximum > FLASH_SIZE
    )
      fail(`Invalid ${name} memory range.`);
    if (!present.subarray(first, first + used).every(Boolean)) fail(`Missing ${name} image bytes.`);
    return { used, maximum, first, second };
  };
  while (at < end - 6) {
    const start = at,
      tag = data[at++],
      length = data[at++];
    if (!length || at + length > end - 6) fail('Invalid BM83 information block.');
    const value = data.subarray(at, at + length);
    at += length;
    if (tag === 0x82) {
      if (length !== 4 || u32(value, 0) !== 0x200000) fail('Unsupported BM83 program RAM.');
    } else if (tag === 0x83) {
      if (mcu) fail('Duplicate MCU descriptor.');
      mcu = descriptor(value, 'MCU', 0x10000, 0x90000);
      if (
        mcu.first !== 0x10000 ||
        mcu.maximum !== 0x80000 ||
        mcu.used < 0x2200 ||
        data[0x10000] !== 2 ||
        !present.subarray(0x121fc, 0x12200).every(Boolean)
      )
        fail('Unsupported MCU image layout.');
    } else if (tag === 0x90) {
      if (pendingDsp || length !== 8) fail('Invalid DSP information block.');
      if (dspStart < 0) dspStart = start;
      pendingDsp = true;
    } else if (tag === 0x91 || tag === 0xd0) {
      if (tag === 0x91 && !pendingDsp) fail('DSP descriptor has no information block.');
      descriptors.push(descriptor(value, 'DSP', 0x110000, 0x180000));
      if (dspStart < 0) dspStart = start;
      dspEnd = at;
      pendingDsp = false;
    } else if (tag === 0x92) {
      if (length !== 4 || dspVersion) fail('Invalid DSP version.');
      dspVersion = Array.from(value);
      dspEnd = at;
    } else fail(`Unsupported BM83 header tag 0x${tag.toString(16)}.`);
  }
  if (at !== end - 6 || pendingDsp) fail('Incomplete BM83 information block.');
  const trimmedEnd = (start, limit) => {
    let last = limit;
    while (last > start && data[last - 1] === 255) last--;
    return Math.ceil(last / 16) * 16;
  };
  const images = [];
  const add = (type, name, bytes, header = new Uint8Array(), version = null) =>
    images.push({ type, name, bytes, crc: bm83Crc(bytes), header, version });
  // SPKCommandSetTool 206.009 sends the complete 512 KiB MCU bank, including
  // FF padding. Trimming it to the descriptor's used size changes the CRC.
  if (mcu)
    add(
      0,
      'MCU',
      data.slice(0x10000, 0x90000),
      new Uint8Array(),
      Array.from(data.subarray(0x121fc, 0x12200)),
    );
  if (descriptors.length) {
    const ranges = descriptors
      .map((d) => [d.first, d.first + d.maximum])
      .sort((a, b) => a[0] - b[0]);
    if (ranges.some((r, i) => i && r[0] < ranges[i - 1][1])) fail('Overlapping DSP banks.');
    if (dspStart < 0 || dspEnd <= dspStart) fail('DSP flash information missing.');
    const payloadEnd = trimmedEnd(0x110000, 0x180000);
    if (payloadEnd === 0x110000) fail('Empty DSP payload.');
    add(1, 'DSP', data.slice(0x110000, payloadEnd), data.slice(dspStart, dspEnd), dspVersion);
  }
  if (data[0x6000] !== 255) {
    const configEnd = trimmedEnd(0x6000, 0x8000);
    if (!present.subarray(0x6000, configEnd).every(Boolean))
      fail('Missing factory configuration bytes.');
    // The leading config marker is not transmitted. Match the official tool:
    // aligned length from 6000, payload/CRC begin at 6001, final FF padding.
    add(2, 'CONFIG', data.slice(0x6001, configEnd + 1));
  }
  if (!images.length) fail('No updatable BM83 image components.');
  const bytes = new TextEncoder().encode(text);
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  return {
    filename,
    sha256,
    images,
    total: images.reduce((n, i) => n + i.bytes.length, 0),
    format: 'BM83_MCU_DFU',
  };
}
