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
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Stm32Dfu } from '../docs/stm32-dfu.js';
import { openFactoryPackage, factoryHash, validateFactoryImage } from '../docs/factory-package.js';
import { mountFirstInstall, assertProvisionedApplication } from '../docs/first-install-ui.js';
globalThis.crypto ??= webcrypto;
const enc = new TextEncoder();

async function imageFixture() {
  // Dati sintetici: NON usare mai il vero factory con password di test.
  const image = new Uint8Array(65536).fill(255),
    v = new DataView(image.buffer);
  image.fill(0, 0, 192);
  image.fill(0, 0x5000, 0x5200);
  v.setUint32(0, 0x20005fe0, true);
  v.setUint32(4, 0x08000101, true);
  v.setUint32(0x5000, 0x20005fe0, true);
  v.setUint32(0x5004, 0x08005101, true);
  const m = 0xf800,
    h = m + 4;
  image.set(enc.encode('BTM1'), m);
  image.fill(0, h, h + 128);
  image.set([90, 78, 70, 87, 2, 0, 128, 0], h);
  v.setUint32(h + 8, 0x48575442, true);
  v.setUint32(h + 12, 1, true);
  v.setUint32(h + 24, 512, true);
  v.setUint32(h + 28, 0x01020000, true);
  image.set(
    new Uint8Array(await crypto.subtle.digest('SHA-256', image.slice(0x5000, 0x5200))),
    h + 32,
  );
  image.set(enc.encode('BTCOMMIT'), m + 136);
  image.set(enc.encode('BTUSB001'), m + 176);
  return image;
}
async function envelope(image) {
  const h = {
    format: 'ZN_FACTORY_AES256_GCM_V1',
    product: 'HEADSET_BT',
    hardware: 'REV01',
    mcu: 'STM32C071G8U6',
    version: '1.0.99',
    flashBytes: 65536,
    username: 'test',
    kdf: 'PBKDF2-SHA256',
    iterations: 600000,
    saltHex: '00112233445566778899aabbccddeeff',
    ivHex: '00112233445566778899aabb',
    sha256: await factoryHash(image),
  };
  const unhex = (s) => Uint8Array.from(s.match(/../g), (b) => parseInt(b, 16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode('test\0test-password-for-factory'),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: unhex(h.saltHex), iterations: 600000 },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const aad = enc.encode(
    JSON.stringify(
      Object.fromEntries(
        Object.keys(h)
          .sort()
          .map((k) => [k, h[k]]),
      ),
    ),
  );
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: unhex(h.ivHex), additionalData: aad },
    key,
    image,
  );
  return { header: h, ciphertext: Buffer.from(cipher).toString('base64') };
}

class UsbMock {
  constructor() {
    this.vendorId = 0x0483;
    this.productId = 0xdf11;
    this.configuration = {
      interfaces: [
        {
          interfaceNumber: 0,
          alternates: [
            {
              alternateSetting: 0,
              interfaceClass: 0xfe,
              interfaceSubclass: 1,
              interfaceProtocol: 2,
            },
          ],
        },
      ],
    };
    this.memory = new Uint8Array(65536).fill(255);
    this.state = 2;
    this.pointer = 0;
    this.writes = [];
    this.commands = [];
    this.id = 0x493;
    this.kib = 64;
    this.left = false;
  }
  async open() {
    this.opened = true;
  }
  async close() {
    this.opened = false;
  }
  async claimInterface() {}
  async selectAlternateInterface() {}
  async controlTransferOut(s, data) {
    if (s.request === 6) this.state = 2;
    else if (s.request === 1) {
      if (s.value === 0 && data.length === 5) {
        this.commands.push(data[0]);
        assert.equal(data[0], 0x21, 'Only SetAddress is allowed, never erase/unprotect');
        this.pointer = new DataView(data.buffer, data.byteOffset, data.length).getUint32(1, true);
        this.state = 3;
      } else if (s.value === 2) {
        assert.ok(this.pointer >= 0x08000000 && this.pointer + data.length <= 0x08010000);
        this.writes.push({ address: this.pointer, bytes: data.slice() });
        if (this.failWrite) return { status: 'stall', bytesWritten: 0 };
        const offset = this.pointer - 0x08000000;
        assert.ok(
          this.memory.subarray(offset, offset + data.length).every((b) => b === 255),
          'Do not reprogram non-erased doublewords',
        );
        this.memory.set(data, offset);
        this.state = 3;
      } else if (s.value === 0 && data.length === 0) {
        this.left = true;
        this.state = 6;
      } else throw new Error('Unexpected USB request');
    } else throw new Error('Unexpected USB request');
    return { status: 'ok', bytesWritten: data.length };
  }
  async controlTransferIn(s, length) {
    let bytes;
    if (s.requestType === 'standard') {
      bytes = Uint8Array.from([
        9, 2, 27, 0, 1, 1, 0, 0x80, 50, 9, 4, 0, 0, 0, 0xfe, 1, 2, 0, 9, 0x21, 0x0b, 0xff, 0, 0, 4,
        0x1a, 1,
      ]).slice(0, length);
    } else if (s.request === 3) {
      if (this.state === 3) {
        bytes = Uint8Array.of(0, 1, 0, 0, 4, 0);
        this.state = 5;
      } else bytes = Uint8Array.of(0, 0, 0, 0, this.state, 0);
    } else if (s.request === 2) {
      bytes = new Uint8Array(length);
      if (this.pointer === 0x40015800) new DataView(bytes.buffer).setUint32(0, this.id, true);
      else if (this.pointer === 0x1fff75a0) new DataView(bytes.buffer).setUint16(0, this.kib, true);
      else if (this.pointer === 0x1fff7550) bytes.set(Array.from({ length: 12 }, (_, i) => i + 1));
      else {
        bytes.set(
          this.memory.subarray(this.pointer - 0x08000000, this.pointer - 0x08000000 + length),
        );
        if (this.corruptReadback && this.writes.length) bytes[length - 1] ^= 1;
      }
      this.state = 9;
    } else throw new Error('Unexpected USB request');
    return { status: 'ok', data: new DataView(bytes.buffer) };
  }
}
const makeDfu = async (usb) => {
  const dfu = new Stm32Dfu(usb, () => {}, { sleep: async () => {} });
  await dfu.open();
  return dfu;
};

test('Factory password container authenticates headers and rejects wrong credentials before device access', async () => {
  const image = await imageFixture(),
    value = await envelope(image),
    encode = (v) => enc.encode(JSON.stringify(v));
  const opened = await openFactoryPackage(encode(value), 'test', 'test-password-for-factory');
  assert.deepEqual(opened.image, image);
  await assert.rejects(openFactoryPackage(encode(value), 'test', 'wrong'), /FACTORY_CREDENTIALS/);
  await assert.rejects(
    openFactoryPackage(encode(value), 'other', 'test-password-for-factory'),
    /FACTORY_CREDENTIALS/,
  );
  value.header.version = '1.0.98';
  await assert.rejects(
    openFactoryPackage(encode(value), 'test', 'test-password-for-factory'),
    /FACTORY_CREDENTIALS/,
  );
  value.header.iterations = 1;
  await assert.rejects(
    openFactoryPackage(encode(value), 'test', 'test-password-for-factory'),
    /FACTORY_FORMAT/,
  );
});
test('WebUSB first install proves chip/blank Flash, verifies readback and commits boot vectors last', async () => {
  const image = await imageFixture(),
    usb = new UsbMock(),
    dfu = await makeDfu(usb);
  const result = await dfu.install(image);
  assert.equal(result.uid, '0102030405060708090A0B0C');
  assert.deepEqual(usb.memory, image);
  assert.equal(usb.writes.at(-1).address, 0x08000000);
  assert.equal(usb.writes.at(-1).bytes.length, 8);
  assert.equal(usb.writes.filter((w) => w.address === 0x08000000).length, 1);
  assert.equal(usb.left, true);
  assert.ok(usb.commands.every((c) => c === 0x21));
});
test('Wrong MCU, wrong Flash size, programmed board or different partial data never authorize writes', async () => {
  const image = await imageFixture();
  for (const variant of ['id', 'size', 'programmed', 'partial']) {
    const usb = new UsbMock();
    if (variant === 'id') usb.id = 0x460;
    if (variant === 'size') usb.kib = 128;
    if (variant === 'programmed') usb.memory[0] = 0;
    if (variant === 'partial') usb.memory[8000] = 0x34;
    const dfu = await makeDfu(usb);
    await assert.rejects(dfu.install(image), /DFU_(DEVICE|NOT_BLANK|PARTIAL_IMAGE)/);
    assert.equal(usb.writes.length, 0);
  }
});
test('Interrupted identical first install resumes only missing doublewords and keeps vectors last', async () => {
  const image = await imageFixture(),
    usb = new UsbMock();
  usb.memory.set(image.subarray(8, 64), 8);
  const dfu = await makeDfu(usb);
  await dfu.install(image);
  assert.deepEqual(usb.memory, image);
  assert.ok(usb.writes.slice(0, -1).every((w) => w.address >= 0x08000040));
});
test('Readback mismatch and lost/stalled writes never commit vectors or leave DFU', async () => {
  const image = await imageFixture();
  for (const error of ['corruptReadback', 'failWrite']) {
    const usb = new UsbMock();
    usb[error] = true;
    const dfu = await makeDfu(usb);
    await assert.rejects(dfu.install(image), /DFU_(VERIFY|TRANSFER)/);
    assert.ok(usb.memory.subarray(0, 8).every((b) => b === 255));
    assert.equal(usb.left, false);
    if (error === 'failWrite') assert.equal(usb.writes.length, 1);
  }
});
test('Invalid factory vectors or app digest are rejected before chip operations', async () => {
  const image = await imageFixture(),
    usb = new UsbMock(),
    dfu = await makeDfu(usb);
  image[0x5100] ^= 1;
  await assert.rejects(dfu.install(image), /FACTORY_FORMAT/);
  assert.equal(usb.writes.length, 0);
  const valid = await imageFixture();
  new DataView(valid.buffer).setUint32(4, 0x20000101, true);
  await assert.rejects(validateFactoryImage(valid), /FACTORY_FORMAT/);
});
test('DFU-to-serial handoff rejects another headset or version before Bluetooth programming', () => {
  const expected = { uid: '0102030405060708090A0B0C', version: '1.0.99' };
  const info = {
    product: 'HEADSET_BT',
    usb_serial: expected.uid,
    version: expected.version,
    bm83_secure: 1,
  };
  assert.doesNotThrow(() => assertProvisionedApplication(info, expected));
  for (const changed of [
    { usb_serial: 'OTHER' },
    { version: '1.0.98' },
    { bm83_secure: 0 },
    { product: 'ClearVoice' },
  ])
    assert.throws(
      () => assertProvisionedApplication({ ...info, ...changed }, expected),
      /FACTORY_WRONG_DEVICE/,
    );
});
test('First-install UI never requests permissions on load and clears password before USB chooser', async () => {
  const nodes = new Map();
  const get = (id) => {
    if (!nodes.has(id))
      nodes.set(id, {
        value: '',
        handlers: {},
        addEventListener(event, fn) {
          this.handlers[event] = fn;
        },
      });
    return nodes.get(id);
  };
  let requested = 0;
  const ui = mountFirstInstall({
    language: () => 'it',
    externalBusy: () => false,
    connected: () => false,
    changed() {},
    document: { getElementById: get },
    serial: { requestPort() {} },
    usb: {
      getDevices: async () => [],
      requestDevice: async () => {
        requested++;
        assert.equal(get('firstInstallPassword').value, '');
        const e = new Error();
        e.name = 'NotFoundError';
        throw e;
      },
    },
  });
  await Promise.resolve();
  assert.equal(requested, 0);
  get('firstInstallUser').value = 'test';
  get('firstInstallPassword').value = 'test-password-for-factory';
  await get('firstInstallForm').handlers.submit({ preventDefault() {} });
  assert.equal(requested, 1);
  assert.equal(ui.busy, false);
});
test(
  'Python-generated password package opens with browser WebCrypto (synthetic fixture only)',
  { skip: !process.env.ZN_FACTORY_TEST_PACKAGE },
  async () => {
    const raw = await readFile(process.env.ZN_FACTORY_TEST_PACKAGE);
    const opened = await openFactoryPackage(raw, 'test', 'test-password-for-factory');
    assert.equal(opened.version, '1.0.99');
    await validateFactoryImage(opened.image);
    opened.image.fill(0);
  },
);
test('First-install UI sequences MCU then serial/Bluetooth, clears plaintext, and cannot complete after Bluetooth failure', async () => {
  const image = await imageFixture(),
    raw = enc.encode(JSON.stringify(await envelope(image)));
  for (const bluetoothFails of [false, true]) {
    const nodes = new Map(),
      order = [],
      expected = { uid: '0102030405060708090A0B0C', version: '1.0.99' };
    const get = (id) => {
      if (!nodes.has(id))
        nodes.set(id, {
          value: '',
          handlers: {},
          addEventListener(event, fn) {
            this.handlers[event] = fn;
          },
        });
      return nodes.get(id);
    };
    let plaintext;
    const ui = mountFirstInstall({
      language: () => 'it',
      externalBusy: () => false,
      connected: () => false,
      changed() {},
      document: { getElementById: get },
      sleep: async () => {},
      usb: { getDevices: async () => [], requestDevice: async () => ({}) },
      serial: {
        getPorts: async () => [],
        requestPort: async () => {
          order.push('serial-permission');
          return 'chosen-port';
        },
      },
      fetcher: async (url) =>
        url.endsWith('manifest.json')
          ? {
              ok: true,
              json: async () => ({
                schema: 1,
                format: 'ZN_FACTORY_AES256_GCM_V1',
                product: 'HEADSET_BT',
                hardware: 'REV01',
                version: '1.0.99',
                filename: 'HEADSET_BT_1.0.99_FACTORY.znfi',
                url: './HEADSET_BT_1.0.99_FACTORY.znfi',
                size: raw.length,
                sha256: await factoryHash(raw),
              }),
            }
          : { ok: true, arrayBuffer: async () => raw.buffer },
      createDfu: () => ({
        open: async () => {},
        install: async (data) => {
          plaintext = data;
          order.push('MCU');
          return { uid: expected.uid };
        },
        close: async () => order.push('DFU-close'),
      }),
      connectApplication: async (port, identity) => {
        assert.equal(port, 'chosen-port');
        assert.deepEqual(identity, expected);
        assert.ok(plaintext.every((b) => b === 0));
        order.push('Bluetooth');
        if (bluetoothFails) throw new Error('BM83_NACK');
      },
    });
    get('firstInstallUser').value = 'test';
    get('firstInstallPassword').value = 'test-password-for-factory';
    await get('firstInstallForm').handlers.submit({ preventDefault() {} });
    assert.equal(get('firstInstallPassword').value, '');
    assert.ok(plaintext.every((b) => b === 0));
    assert.equal(get('firstInstallContinue').hidden, false);
    await get('firstInstallContinue').handlers.click();
    assert.deepEqual(order, ['MCU', 'DFU-close', 'serial-permission', 'Bluetooth']);
    assert.equal(ui.busy, bluetoothFails);
    assert.equal(get('firstInstallProgress').value === 100, !bluetoothFails);
  }
});
