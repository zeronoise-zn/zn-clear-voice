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

/** Prima installazione: nessuna password/chiave in questo sorgente.
 * WebCrypto apre AES-GCM con le credenziali dell'operatore. I byte decifrati
 * restano in RAM e non vanno in log, storage, DOM, download o service worker.
 * I normali aggiornamenti continuano a usare ZNFW e la verifica sul dispositivo.
 */
const FORMAT = 'ZN_FACTORY_AES256_GCM_V1';
const enc = new TextEncoder();
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => Uint8Array.from(s.match(/../g), (b) => parseInt(b, 16));
export const factoryHash = async (bytes) =>
  hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
const fail = (code) => {
  throw new Error(code);
};

export async function openFactoryPackage(raw, username, password) {
  if (raw.byteLength > 100000 || raw.byteLength < 80000) fail('FACTORY_FORMAT');
  let envelope;
  try {
    envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    fail('FACTORY_FORMAT');
  }
  const h = envelope.header;
  if (
    !h ||
    h.format !== FORMAT ||
    h.product !== 'HEADSET_BT' ||
    h.hardware !== 'REV01' ||
    h.mcu !== 'STM32C071G8U6' ||
    h.flashBytes !== 65536 ||
    h.kdf !== 'PBKDF2-SHA256' ||
    h.iterations !== 600000 ||
    !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(h.version) ||
    !/^[a-f0-9]{32}$/.test(h.saltHex) ||
    !/^[a-f0-9]{24}$/.test(h.ivHex) ||
    !/^[a-f0-9]{64}$/.test(h.sha256) ||
    !/^[A-Za-z0-9._-]{1,32}$/.test(h.username) ||
    typeof envelope.ciphertext !== 'string' ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.ciphertext)
  )
    fail('FACTORY_FORMAT');
  if (username !== h.username || typeof password !== 'string' || password.length > 256)
    fail('FACTORY_CREDENTIALS');
  const canonical = JSON.stringify(
    Object.fromEntries(
      Object.keys(h)
        .sort()
        .map((k) => [k, h[k]]),
    ),
  );
  let image;
  try {
    const material = await crypto.subtle.importKey(
      'raw',
      enc.encode(username + '\0' + password),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: unhex(h.saltHex), iterations: 600000 },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    const cipher = Uint8Array.from(atob(envelope.ciphertext), (b) => b.charCodeAt(0));
    if (cipher.length !== 65552) fail('FACTORY_FORMAT');
    image = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: unhex(h.ivHex),
          additionalData: enc.encode(canonical),
          tagLength: 128,
        },
        key,
        cipher,
      ),
    );
  } catch {
    fail('FACTORY_CREDENTIALS');
  }
  try {
    await validateFactoryImage(image);
    if ((await factoryHash(image)) !== h.sha256) fail('FACTORY_FORMAT');
    return { image, version: h.version, sha256: h.sha256 };
  } catch (e) {
    image.fill(0);
    throw e;
  }
}

export async function validateFactoryImage(image) {
  if (!(image instanceof Uint8Array) || image.length !== 65536) fail('FACTORY_FORMAT');
  const v = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const validVectors = (offset, limit) => {
    const msp = v.getUint32(offset, true),
      reset = v.getUint32(offset + 4, true);
    if (msp !== 0x20005fe0 || !reset || !(reset & 1)) fail('FACTORY_FORMAT');
    for (let at = offset + 4; at < offset + 192; at += 4) {
      const entry = v.getUint32(at, true),
        address = entry & ~1;
      if (entry && (!(entry & 1) || address < 0x08000000 + offset || address >= 0x08000000 + limit))
        fail('FACTORY_FORMAT');
    }
  };
  validVectors(0, 0x5000);
  const meta = 0xf800,
    header = meta + 4,
    size = v.getUint32(header + 24, true);
  if (
    new TextDecoder().decode(image.slice(meta, meta + 4)) !== 'BTM1' ||
    hex(image.slice(header, header + 8)) !== '5a4e465702008000' ||
    v.getUint32(header + 8, true) !== 0x48575442 ||
    v.getUint32(header + 12, true) !== 1 ||
    v.getUint32(header + 28, true) !== 0x01020000 ||
    size < 192 ||
    size > 0xa800 ||
    new TextDecoder().decode(image.slice(meta + 136, meta + 144)) !== 'BTCOMMIT' ||
    new TextDecoder().decode(image.slice(meta + 176, meta + 184)) !== 'BTUSB001'
  )
    fail('FACTORY_FORMAT');
  validVectors(0x5000, 0x5000 + size);
  if (
    (await factoryHash(image.slice(0x5000, 0x5000 + size))) !==
    hex(image.slice(header + 32, header + 64))
  )
    fail('FACTORY_FORMAT');
}

export async function fetchFactoryPackage(fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetcher('./first-install/manifest.json', {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) fail('FACTORY_DOWNLOAD');
    const m = await response.json();
    if (
      m.schema !== 1 ||
      m.format !== FORMAT ||
      m.product !== 'HEADSET_BT' ||
      m.hardware !== 'REV01' ||
      !/^HEADSET_BT_\d+\.\d+\.\d+_FACTORY\.znfi$/.test(m.filename) ||
      m.url !== './' + m.filename ||
      !/^[a-f0-9]{64}$/.test(m.sha256) ||
      m.size < 80000 ||
      m.size > 100000
    )
      fail('FACTORY_FORMAT');
    const download = await fetcher('./first-install/' + m.filename, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!download.ok) fail('FACTORY_DOWNLOAD');
    const raw = await download.arrayBuffer();
    if (raw.byteLength !== m.size || (await factoryHash(raw)) !== m.sha256) fail('FACTORY_FORMAT');
    return { raw, manifest: m };
  } finally {
    clearTimeout(timer);
  }
}
