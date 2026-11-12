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
import { readFile } from 'node:fs/promises';
import { inspectPackage } from '../docs/znfw.js';
import { PRODUCT_PROFILES } from '../docs/product-profiles.js';
import { parseHello, parseBootInfo, checkTarget, CMD } from '../docs/zn-protocol.js';
import { appInfo, FirmwareUpdater, matchInstalled } from '../docs/fw-updater.js';

const p = PRODUCT_PROFILES.find((p) => p.name === 'HEADSET_BT');
const text = (s) => new TextEncoder().encode(s);
const app = {
  product: p.name,
  hardware: 'REV01',
  firmware: '1.0.3',
  git: 'a'.repeat(40),
  dirty: 0,
  shallow: 0,
};
async function fixture() {
  const bytes = new Uint8Array(128 + 1028),
    v = new DataView(bytes.buffer);
  bytes.set(text('ZNFW'));
  v.setUint16(4, 1, true);
  v.setUint16(6, 128, true);
  v.setUint32(8, p.id, true);
  v.setUint32(12, 1, true);
  v.setUint16(16, 1, true);
  v.setUint16(22, 3, true);
  v.setUint32(24, 1028, true);
  v.setUint32(28, 0x01010000, true);
  v.setUint32(128, p.ramEnd, true);
  v.setUint32(132, p.base + 193, true);
  const object = 128 + 256;
  v.setUint16(object, 1, true);
  v.setUint16(object + 6, 3, true);
  v.setUint32(object + 8, 1, true);
  bytes[object + 12] = 1;
  [320, 350, 400, 480].forEach((n, i) => v.setUint32(object + 16 + 4 * i, p.base + n, true));
  [app.firmware, app.git, app.firmware + '-' + app.git.slice(0, 12), app.hardware].forEach((s, i) =>
    bytes.set(text(s + '\0'), 128 + [320, 350, 400, 480][i]),
  );
  bytes.set(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.subarray(128))), 32);
  return bytes;
}
function reply(command, length, state = 1, offset = 0) {
  const payload = new Uint8Array(length),
    v = new DataView(payload.buffer);
  payload[2] = state;
  payload[3] = command;
  v.setUint32(4, offset, true);
  return { command: command | 128, payload, state, offset, status: 0 };
}
function hello() {
  const r = reply(1, 26),
    v = new DataView(r.payload.buffer);
  r.payload.set(text('ZNBLBTWH'), 8);
  r.payload[16] = 1;
  [1024, 1028, 1038, 1044].forEach((n, i) => v.setUint16(18 + i * 2, n, true));
  return r;
}
function info() {
  const r = reply(2, 209),
    b = r.payload,
    v = new DataView(b.buffer);
  b[8] = 2;
  b[9] = 1;
  b[10] = 1;
  b[11] = 16;
  v.setUint32(12, 1, true);
  v.setUint16(16, 64, true);
  v.setUint32(28, p.maxImage, true);
  v.setUint32(36, 0x60000007, true);
  v.setUint32(40, p.id, true);
  v.setUint32(203, 0x01010000, true);
  return r;
}
test('HEADSET profile accepts 48 C071 vectors and preserves compiled identity', async () => {
  const pkg = await inspectPackage((await fixture()).buffer, 'HEADSET_BT_1.0.3_PROD.znfw');
  assert.equal(pkg.productName, 'HEADSET_BT');
  assert.equal(pkg.identity.git, app.git);
  const device = parseBootInfo(info());
  checkTarget(pkg, device);
  assert.equal(parseHello(hello()).family, 'BTWH');
  assert.equal(device.flashKb, 64);
  assert.equal(appInfo(JSON.stringify(app)).product, 'HEADSET_BT');
  assert.throws(
    () => checkTarget(pkg, { ...device, product: 'ClearVoice', flashKb: 256 }),
    /TARGET_MISMATCH/,
  );
  assert.throws(() => checkTarget(pkg, { ...device, flashKb: 256 }), /TARGET_MISMATCH/);
  assert.throws(() => checkTarget(pkg, { ...device, flags: 4 }), /UPDATE_POLICY_MISMATCH/);
  assert.throws(() => checkTarget(pkg, { ...device, capabilities: 7 }), /UPDATE_POLICY_MISMATCH/);
  assert.throws(() => checkTarget(pkg, { ...device, flashKb: 128 }), /TARGET_MISMATCH/);
  assert.throws(
    () => matchInstalled(pkg, { ...appInfo(JSON.stringify(app)), product: 'ClearVoice' }),
    /MISMATCH/,
  );
});
test('C071 profile rejects G474 stack addresses, image overflow and bad vectors', async () => {
  for (const [offset, value] of [
    [128, 0x20020000],
    [132, 0x080081e1],
    [24, p.maxImage + 1],
  ]) {
    const bytes = await fixture();
    new DataView(bytes.buffer).setUint32(offset, value, true);
    bytes.set(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.subarray(128))), 32);
    await assert.rejects(inspectPackage(bytes.buffer, 'HEADSET_BT.znfw'), /INVALID_HEADER/);
  }
});
test('HEADSET accepts zero signature field only; ClearVoice retains its signed policy', async () => {
  const bytes = await fixture();
  assert.equal(
    (await inspectPackage(bytes.buffer, 'HEADSET_BT_USB.znfw')).signatureRequired,
    false,
  );
  bytes[64] = 1;
  await assert.rejects(
    inspectPackage(bytes.buffer, 'HEADSET_BT_USB.znfw'),
    /reserved header bytes/,
  );
  assert.equal(PRODUCT_PROFILES.find((x) => x.family === 'CVWH').signatureRequired, true);
});
test('legacy ClearVoice still rejects 128 KiB and HELLO/INFO families must agree', async () => {
  const legacy = PRODUCT_PROFILES[0];
  assert.throws(
    () =>
      checkTarget(
        { product: legacy.id, hardwareMask: 1, minimumBootloader: 0, imageSize: 512 },
        {
          product: legacy.name,
          flags: 8,
          capabilities: 0xc0000007,
          hardwareMask: 1,
          minimumBootloader: 0x01000000,
          capacity: 96256,
          flashKb: 128,
        },
      ),
    /TARGET_MISMATCH/,
  );
  const bad = info();
  new DataView(bad.payload.buffer).setUint32(40, legacy.id, true);
  const updater = new FirmwareUpdater({
    async hello() {
      return hello();
    },
    async request() {
      return bad;
    },
  });
  await assert.rejects(updater.bootInfo(), /HELLO\/GET_INFO product mismatch/);
});
test('HEADSET complete update requires accepted END, exact installed product and confirmation', async () => {
  const pkg = await inspectPackage((await fixture()).buffer, 'HEADSET_BT.znfw');
  const commands = [];
  const io = {
    connected: true,
    state: 1,
    offset: 0,
    async open() {},
    async close() {},
    async hello() {
      return hello();
    },
    async text(command) {
      return command === 'ZN_BOOT\n'
        ? 'ZN_BOOT_ACK'
        : command.includes('ZN_STATS?')
          ? '[RUNTIME] STATUS=RUNNING FAULT=OK CODE=0 AUDIO_BLOCKS=0 CONFIRMED=1 UART_ERRORS=0x00000000'
          : JSON.stringify(app);
    },
    async request(cmd, data) {
      commands.push(cmd);
      if (cmd === CMD.INFO) return info();
      if (cmd === CMD.BEGIN) {
        this.state = 3;
        this.offset = 0;
      }
      if (cmd === CMD.DATA) this.offset += data.length - 4;
      if (cmd === CMD.END) this.state = 5;
      return reply(cmd, cmd === CMD.STATUS ? 18 : 8, this.state, this.offset);
    },
  };
  const updater = new FirmwareUpdater(io, () => {}, { sleep: async () => {} });
  await updater.connect();
  await updater.run(pkg);
  assert.equal(updater.state, 'COMPLETE');
  assert.ok(commands.indexOf(CMD.END) < commands.indexOf(CMD.REBOOT));
});
test(
  'real compiled HEADSET ARM application passes the same online parser',
  { skip: !process.env.HEADSET_TEST_PACKAGE },
  async () => {
    const raw = await readFile(process.env.HEADSET_TEST_PACKAGE);
    const pkg = await inspectPackage(
      raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
      'HEADSET_BT_TEST.znfw',
    );
    assert.equal(pkg.productName, 'HEADSET_BT');
    assert.ok(pkg.identity);
    assert.equal(
      pkg.identity.abi,
      pkg.encrypted ? 'ZNFW2_authenticated_metadata' : 'clearvoice_identity_t_ARM32',
    );
  },
);
