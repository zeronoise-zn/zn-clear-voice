/*
 * Copyright (c) 2026 Racing Force S.p.A.
 * All rights reserved.
 *
 * Author: Oscar Tofanelli
 *
 * PROPRIETARY AND CONFIDENTIAL
 *
 * This software, excluding third-party libraries and components governed by
 * their respective license terms, is the exclusive property of Racing Force S.p.A.
 *
 * Any unauthorized use, modification, reproduction, distribution, disclosure,
 * publication, transfer, or sharing of this software, in whole or in part,
 * is strictly prohibited without the prior written consent of Racing Force S.p.A.
 *
 * This notice shall not alter or supersede the applicable license terms of any
 * third-party software, libraries, or components included in or used by this project.
 */

/** Lettura pubblica del contenitore cifrato: qui NON esistono chiavi o decifratura.
 * Il browser controlla struttura e metadati; il dispositivo verifica HMAC e dati.
 * SHA da solo non dimostra autenticita: non dichiarare authenticated=true qui.
 */
import { UpdateError, sha256, hex, versionForms } from './znfw.js';
import { profileById } from './product-profiles.js';

export async function inspectSecurePackage(buffer, filename, target = 1) {
  const bytes = new Uint8Array(buffer);
  const fail = (s) => {
    throw new UpdateError('INVALID_ENCRYPTED_PACKAGE', s);
  };
  if (bytes.length < 128) fail('Intestazione troncata.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const profile = profileById(v.getUint32(8, true));
  if (
    hex(bytes.subarray(0, 8)) !== '5a4e465702008000' ||
    profile?.name !== 'HEADSET_BT' ||
    bytes[76] !== target ||
    bytes[77] !== 1 ||
    !v.getUint32(12, true) ||
    v.getUint32(28, true) < 0x01020000
  )
    fail('Formato, prodotto o destinazione incompatibili.');
  if (!(target === 1 ? /\.znfw$/i : /\.znbt$/i).test(filename)) fail('Estensione errata.');
  const imageSize = v.getUint32(24, true),
    metadataSize = v.getUint16(78, true);
  const block = target === 1 ? 992 : 4096;
  const count = Math.ceil(imageSize / block);
  if (
    !metadataSize ||
    imageSize < (target === 1 ? 192 : 8192) ||
    imageSize > (target === 1 ? profile.maxImage : 0x180000) ||
    (target === 2 && imageSize % block) ||
    bytes.length !== 128 + metadataSize + imageSize + count * (target === 1 ? 32 : 36)
  )
    fail('Dimensioni non valide.');
  const metadataBytes = bytes.subarray(128, 128 + metadataSize);
  if ((await sha256(metadataBytes)).slice(0, 32) !== hex(bytes.subarray(80, 96)))
    fail('Metadati diversi da quelli del contenitore.');
  let metadata;
  try {
    metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(metadataBytes));
  } catch {
    fail('Metadati non leggibili.');
  }
  const parts = [16, 18, 20, 22].map((n) => v.getUint16(n, true));
  const forms = versionForms(parts);
  let identity = null;
  if (target === 1) {
    const m = metadata;
    if (
      !m ||
      !/^[a-f0-9]{40}$/i.test(m.git_sha || '') ||
      ![0, 1].includes(m.dirty) ||
      ![0, 1].includes(m.shallow) ||
      !Number.isInteger(m.hw_rev) ||
      m.hw_rev < 1 ||
      m.hw_rev > 32 ||
      m.hw_mask !== (1 << (m.hw_rev - 1)) >>> 0 ||
      m.hw_mask !== v.getUint32(12, true) ||
      m.hw_string !== `REV${String(m.hw_rev).padStart(2, '0')}` ||
      ![forms.legacy, forms.compact].includes(m.version) ||
      !parts.every((n, i) => n === m[['major', 'minor', 'patch', 'build'][i]]) ||
      m.build_id !==
        `${m.version}-${m.git_sha.slice(0, 12)}${m.dirty ? '-dirty' : ''}${m.shallow ? '-shallow' : ''}`
    )
      fail('Identita compilata non coerente.');
    identity = {
      version: m.version,
      git: m.git_sha,
      buildId: m.build_id,
      hardware: m.hw_string,
      hardwareMask: m.hw_mask,
      dirty: m.dirty,
      shallow: m.shallow,
      abi: 'ZNFW2_authenticated_metadata',
    };
  }
  const records = [];
  let at = 128 + metadataSize;
  for (let index = 0, offset = 0; index < count; index++) {
    const address = target === 1 ? offset : v.getUint32(at, true);
    if (target === 2) at += 4;
    const size = Math.min(block, imageSize - offset);
    const record = bytes.subarray(at, at + size + 32);
    const data = new Uint8Array(4 + record.length);
    new DataView(data.buffer).setUint32(0, address, true);
    data.set(record, 4);
    records.push({ index, address, offset, end: offset + size, record, data });
    at += record.length;
    offset += size;
  }
  return {
    bytes,
    header: bytes.subarray(0, 128),
    payload: bytes.subarray(128 + metadataSize),
    metadata,
    records,
    product: profile.id,
    productName: profile.name,
    profile,
    hardwareMask: v.getUint32(12, true),
    minimumBootloader: v.getUint32(28, true),
    imageSize,
    identity,
    headerVersion: forms.legacy,
    version: identity?.version || forms.legacy,
    plaintextHash: hex(bytes.subarray(32, 64)),
    packageHash: await sha256(bytes),
    filename,
    encrypted: true,
    authenticationRequired: true,
    authenticated: false,
    signatureVerified: false,
    signatureRequired: false,
  };
}
