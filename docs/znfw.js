// ZNFW128 v1: ClearvoicePUSTM32/Bootloader/Inc/zn_product.h, docs/bootloader/ZNFW_FORMAT.md.
export const PRODUCT = 0x48575643;
export const HEADER_SIZE = 128;
export const MAX_IMAGE = 0x37800;
export const UNIVERSAL_IMAGE = 0x17800;
export class UpdateError extends Error {
  constructor(code, detail = '') { super(`${code}${detail ? ': ' + detail : ''}`); this.code = code; }
}
export const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async bytes => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
// Current ClearVoice ARM32 clearvoice_identity_t ABI, not a ZNFW header extension.
// Require one fully coherent object and bounded in-image string pointers. Unknown
// or ambiguous future ABIs must never fall back to a filename/version-only match.
export function compiledIdentity(payload, version, packageMask) {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const base = 0x08008000, matches = [];
  function stringAt(pointer, limit) {
    const start = pointer - base;
    if (start < 0 || start >= payload.length) return null;
    let end = start;
    while (end < payload.length && end - start <= limit && payload[end]) {
      if (payload[end] < 32 || payload[end] > 126) return null;
      end++;
    }
    return end < payload.length && end - start <= limit && payload[end] === 0 ? new TextDecoder().decode(payload.subarray(start,end)) : null;
  }
  for (let offset = 0; offset + 32 <= payload.length; offset += 4) {
    if ([0,2,4,6].map(n => view.getUint16(offset+n,true)).join('.') !== version) continue;
    const mask = view.getUint32(offset+8,true), rev = payload[offset+12], dirty = payload[offset+13], shallow = payload[offset+14];
    if (rev < 1 || rev > 32 || mask !== ((1 << (rev-1)) >>> 0) || !(mask & packageMask) || dirty > 1 || shallow > 1) continue;
    const [v,git,buildId,hardware] = [16,20,24,28].map((n,i) => stringAt(view.getUint32(offset+n,true),[23,64,94,5][i]));
    if (v !== version || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(git || '') || hardware !== `REV${String(rev).padStart(2,'0')}`) continue;
    if (buildId !== `${version}-${git.slice(0,12)}${dirty ? '-dirty' : ''}${shallow ? '-shallow' : ''}`) continue;
    matches.push({version,git,buildId,hardware,hardwareMask:mask,dirty,shallow,offset,abi:'clearvoice_identity_t_ARM32'});
  }
  return matches.length === 1 ? matches[0] : null;
}
export async function inspectPackage(buffer, filename) {
  if (!/\.znfw$/i.test(filename)) throw new UpdateError('INVALID_ZNFW', 'Select a .znfw package, not BIN, HEX or ELF.');
  const bytes = new Uint8Array(buffer);
  if (bytes.length < HEADER_SIZE) throw new UpdateError('INVALID_HEADER', 'Truncated ZNFW128 header.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (hex(bytes.subarray(0, 4)) !== '5a4e4657' || v.getUint16(4, true) !== 1 || v.getUint16(6, true) !== HEADER_SIZE)
    throw new UpdateError('INVALID_HEADER', 'Expected ZNFW128 version 1.');
  const product = v.getUint32(8, true), hardwareMask = v.getUint32(12, true);
  const imageSize = v.getUint32(24, true), minimumBootloader = v.getUint32(28, true);
  if (product !== PRODUCT || !hardwareMask || imageSize < 472 || imageSize > MAX_IMAGE)
    throw new UpdateError('INVALID_HEADER', 'Product, hardware mask or image bounds.');
  if (bytes.length !== HEADER_SIZE + imageSize) throw new UpdateError('INVALID_ZNFW', 'Package length does not match signed image length.');
  const header = bytes.subarray(0, HEADER_SIZE), payload = bytes.subarray(HEADER_SIZE);
  // Cheap unsigned-placeholder rejection is NOT a signature verification.
  if (header.subarray(64).every(b => b === 0) || header.subarray(64).every(b => b === 255))
    throw new UpdateError('INVALID_HEADER', 'Missing signature. A signed production package is required.');
  const payloadHash = await sha256(payload);
  if (payloadHash !== hex(header.subarray(32, 64))) throw new UpdateError('PAYLOAD_HASH_MISMATCH');
  const vectors = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const msp = vectors.getUint32(0, true);
  if (msp <= 0x20000000 || msp > 0x20020000 || msp % 8 || !vectors.getUint32(4, true))
    throw new UpdateError('INVALID_HEADER', 'Invalid application vectors.');
  for (let i = 1; i < 118; i++) {
    const entry = vectors.getUint32(i * 4, true), address = entry & ~1;
    if (entry && (!(entry & 1) || address < 0x08008000 || address >= 0x08008000 + imageSize))
      throw new UpdateError('INVALID_HEADER', `Invalid vector ${i}.`);
  }
  const version = [16, 18, 20, 22].map(n => v.getUint16(n, true)).join('.');
  return { bytes, header, payload, product, hardwareMask, imageSize, minimumBootloader,
    version, identity: compiledIdentity(payload, version, hardwareMask),
    filename, payloadHash, packageHash: await sha256(bytes), signatureVerified: false };
}
