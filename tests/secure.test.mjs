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

/** Chiave FINTA pubblica per test: nessun segreto o dispositivo di produzione. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes } from 'node:crypto';
import { inspectPackage, UpdateError } from '../docs/znfw.js';
import { inspectSecurePackage } from '../docs/secure-package.js';
import { FirmwareUpdater } from '../docs/fw-updater.js';
import { checkTarget, CMD } from '../docs/zn-protocol.js';
import { Bm83FlashUpdater } from '../docs/bm83-flash.js';
import { Bm83AutoUpdater } from '../docs/bm83-auto.js';

const MASTER = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
const hash = (b) => createHash('sha256').update(b).digest();
const mac = (key, b) => createHmac('sha256', key).update(b).digest();
const app = {
  product: 'HEADSET_BT',
  hardware: 'REV01',
  firmware: '1.0.23',
  git: 'a'.repeat(40),
  dirty: 0,
  shallow: 0,
};
function keys(h) {
  const context = Buffer.concat([h.subarray(8, 16), h.subarray(76, 77), h.subarray(64, 76)]);
  return [
    mac(MASTER, Buffer.concat([Buffer.from('ZNFW2/AES'), context])).subarray(0, 16),
    mac(MASTER, Buffer.concat([Buffer.from('ZNFW2/MAC'), context])),
  ];
}
function fixture(target = 1) {
  let metadata, sectors;
  if (target === 1) {
    metadata = {
      major: 1,
      minor: 0,
      patch: 0,
      build: 23,
      hw_mask: 1,
      hw_rev: 1,
      hw_string: 'REV01',
      version: app.firmware,
      git_sha: app.git,
      dirty: 0,
      shallow: 0,
      build_id: app.firmware + '-' + app.git.slice(0, 12),
    };
    const raw = Buffer.alloc(2052);
    raw.writeUInt32LE(0x20005fe0);
    raw.writeUInt32LE(0x080050c1, 4);
    sectors = [0, 992, 1984].map((a) => ({ address: a, bytes: raw.subarray(a, a + 992) }));
  } else {
    const cfg = Buffer.alloc(4096, 255);
    cfg.set([0, 0, 4, 0, 1, 2, 3]);
    const version = Buffer.alloc(4096, 255);
    version.set([1, 3, 5, 6], 0x1fc);
    const header = Buffer.alloc(4096, 255);
    header.set([0, 0x80, 4, 0, 0, 0, 12, 0x92, 4, 1, 4, 4, 18, 0x81, 4, 0x23, 0x45, 0x4e, 0x44]);
    sectors = [
      { name: 'CONFIG', address: 0x6000, bytes: cfg },
      { name: 'MCU', address: 0x10000, bytes: Buffer.alloc(4096, 0x55) },
      { name: 'MCU', address: 0x12000, bytes: version },
      { name: 'HEADER', address: 0x1000, bytes: Buffer.alloc(4096, 255) },
      { name: 'HEADER', address: 0, bytes: header },
    ];
    metadata = {
      schema: 1,
      revision: 5,
      versions: { MCU: [1, 3, 5, 6], DSP: [1, 4, 4, 18] },
      config: { length: 6, sha256: hash(cfg.subarray(1, 7)).toString('hex') },
      sectors: sectors.map(({ name, address }) => ({ name, address })),
    };
  }
  const meta = Buffer.from(JSON.stringify(metadata));
  const h = Buffer.alloc(128);
  h.write('ZNFW');
  h.writeUInt16LE(2, 4);
  h.writeUInt16LE(128, 6);
  h.writeUInt32LE(0x48575442, 8);
  h.writeUInt32LE(1, 12);
  [1, 0, 0, 23].forEach((v, i) => h.writeUInt16LE(v, 16 + i * 2));
  h.writeUInt32LE(
    sectors.reduce((n, s) => n + s.bytes.length, 0),
    24,
  );
  h.writeUInt32LE(0x01020000, 28);
  randomBytes(12).copy(h, 64);
  h[76] = target;
  h[77] = 1;
  h.writeUInt16LE(meta.length, 78);
  hash(meta).copy(h, 80, 0, 16);
  hash(
    Buffer.concat(
      sectors.map((s) => {
        if (target === 1) return s.bytes;
        const a = Buffer.alloc(4);
        a.writeUInt32LE(s.address);
        return Buffer.concat([a, s.bytes]);
      }),
    ),
  ).copy(h, 32);
  const [enc, auth] = keys(h);
  mac(auth, Buffer.concat([Buffer.from('H'), h.subarray(0, 96)])).copy(h, 96);
  const records = sectors.map((s, i) => {
    const iv = Buffer.alloc(16);
    h.copy(iv, 0, 64, 76);
    iv.writeUInt32BE(i * 256, 12);
    const c = createCipheriv('aes-128-ctr', enc, iv);
    const cipher = Buffer.concat([c.update(s.bytes), c.final()]);
    const fields = Buffer.alloc(8);
    fields.writeUInt32LE(i);
    fields.writeUInt32LE(s.address, 4);
    const tag = mac(auth, Buffer.concat([Buffer.from('B'), h, fields, cipher]));
    return Buffer.concat([...(target === 2 ? [fields.subarray(4)] : []), cipher, tag]);
  });
  return Buffer.concat([h, meta, ...records]);
}
const parse = async (raw, target = 1) =>
  target === 1
    ? inspectPackage(
        raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
        'HEADSET_BT.znfw',
      )
    : {
        ...(await inspectSecurePackage(
          raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
          'BT_REV5.znbt',
          2,
        )),
        format: 'ZNFW2_BM83',
      };

test('encrypted parser exposes metadata without keys, rejects altered metadata/length/target', async () => {
  const raw = fixture(),
    p = await parse(raw);
  assert.equal(p.encrypted, true);
  assert.equal(p.authenticated, false);
  assert.equal(p.identity.git, app.git);
  assert.deepEqual(
    p.records.map((r) => r.end),
    [992, 1984, 2052],
  );
  assert.ok(!raw.includes(Buffer.alloc(64)));
  for (const at of [0, 8, 76, 77, 78, 80, 128]) {
    const bad = Buffer.from(raw);
    bad[at] ^= 1;
    await assert.rejects(parse(bad), /INVALID/);
  }
  await assert.rejects(parse(raw.subarray(0, -1)), /INVALID/);
  await assert.rejects(inspectSecurePackage(raw, 'x.znbt', 2), /INVALID/);
});

test('encrypted STM32 requires new boot policy and acknowledges plaintext offsets', async () => {
  const pkg = await parse(fixture());
  const device = {
    product: 'HEADSET_BT',
    hardwareMask: 1,
    flags: 32,
    capabilities: 0x50000007,
    minimumBootloader: 0x01020000,
    capacity: 0xa800,
    flashKb: 64,
  };
  checkTarget(pkg, device);
  assert.throws(
    () => checkTarget(pkg, { ...device, flags: 16, capabilities: 0x60000007 }),
    /UPDATE_POLICY/,
  );
  const commands = [];
  const io = {
    connected: true,
    async request(cmd, data) {
      commands.push(cmd);
      if (cmd === CMD.BEGIN) this.offset = 0;
      if (cmd === CMD.DATA) this.offset += data.length - 4 - 32;
      return { state: cmd === CMD.END ? 5 : 3, offset: this.offset };
    },
  };
  const updater = new FirmwareUpdater(io, () => {}, { sleep: async () => {} });
  updater.enterBoot = async () => {
    updater.info = device;
    updater.bootState = 1;
  };
  updater.restart = async () => updater.set('COMPLETE');
  await updater.run(pkg);
  assert.equal(updater.state, 'COMPLETE');
  assert.equal(io.offset, 2052);
  assert.equal(commands.filter((c) => c === CMD.DATA).length, 3);
});

class Sim {
  memory = new Uint8Array(0x200000).fill(255);
  opened = false;
  applied = [];
  ended = 0;
  closed = 0;
  info = { bm83_bridge: 3, bm83_secure: 1 };
  protection = Uint8Array.of(255, 255, 255, 255, 255, 255);
  async close() {
    this.opened = false;
    this.closed++;
  }
  async rpc(command) {
    const [op, a, b] = command.split(' ');
    if (op === 'ZN_BM83_INFO?') return '[BM83] BRIDGE=3 SPI_BATCH=4096 SECURE=1';
    if (op === 'ZN_BM83_GUARD') return '[BM83] GUARD=' + a;
    if (op === 'ZN_BM83_SECURE_INVALIDATE') {
      this.memory.fill(255, 0, 8192);
      return '[BM83] SECURE_INVALIDATE=OK';
    }
    if (op === 'ZN_BM83_HASH')
      return (
        '[BM83] HASH=' +
        hash(this.memory.subarray(parseInt(a, 16), parseInt(a, 16) + parseInt(b, 16))).toString(
          'hex',
        )
      );
    if (op === 'ZN_BM83_READ')
      return (
        '[BM83] READ=' +
        Buffer.from(
          this.memory.subarray(parseInt(a, 16), parseInt(a, 16) + parseInt(b, 16)),
        ).toString('hex')
      );
    if (op === 'ZN_BM83_SECURE_BEGIN') {
      this.h = Buffer.from(a, 'hex');
      [this.enc, this.auth] = keys(this.h);
      this.next = 0;
      assert.deepEqual(
        this.h.subarray(96),
        mac(this.auth, Buffer.concat([Buffer.from('H'), this.h.subarray(0, 96)])),
      );
      return '[BM83] SECURE_BEGIN=OK';
    }
    if (op === 'ZN_BM83_SECURE_LOAD') {
      assert.equal(parseInt(a, 16), this.next);
      this.address = parseInt(b, 16);
      this.staged = Buffer.alloc(4096);
      this.used = 0;
      return '[BM83] SECURE_LOAD=OK';
    }
    if (op === 'ZN_BM83_CHUNK') {
      assert.equal(parseInt(a, 16), this.used);
      const data = Buffer.from(b, 'hex');
      data.copy(this.staged, this.used);
      this.used += data.length;
      return '[BM83] CHUNK=' + this.used;
    }
    if (op === 'ZN_BM83_SECURE_AUTH') {
      const fields = Buffer.alloc(8);
      fields.writeUInt32LE(this.next);
      fields.writeUInt32LE(this.address, 4);
      const expected = mac(
        this.auth,
        Buffer.concat([Buffer.from('B'), this.h, fields, this.staged]),
      );
      if (!expected.equals(Buffer.from(a, 'hex')))
        throw new UpdateError('BM83_BRIDGE', 'SECURE_AUTH');
      const iv = Buffer.alloc(16);
      this.h.copy(iv, 0, 64, 76);
      iv.writeUInt32BE(this.next * 256, 12);
      const d = createDecipheriv('aes-128-ctr', this.enc, iv);
      this.plain = Buffer.concat([d.update(this.staged), d.final()]);
      if (this.plain.equals(Buffer.from(this.memory.subarray(this.address, this.address + 4096)))) {
        this.next++;
        return '[BM83] SECURE_MATCH=1';
      }
      return '[BM83] SECURE_MATCH=0';
    }
    if (op === 'ZN_BM83_SECURE_APPLY') {
      this.memory.set(this.plain, this.address);
      this.applied.push(this.address);
      this.next++;
      return '[BM83] SECURE_APPLY=OK';
    }
    if (op === 'ZN_BM83_SECURE_END') {
      this.ended++;
      return '[BM83] SECURE_END=OK';
    }
    throw new Error('Unexpected ' + command);
  }
  async command(op, params) {
    assert.equal(op, 0xfca4);
    const [, read, n, ...tx] = params;
    assert.equal(n, tx.length);
    let result = [];
    if (tx[0] === 0x72) result = Array.from(this.protection);
    if (tx[0] === 5) result = [2];
    if (tx[0] === 0x42) this.protection = Uint8Array.from(tx.slice(1));
    return Uint8Array.of(tx[0], read, ...result);
  }
}
function updater(sim, notify = () => {}) {
  return new Bm83FlashUpdater({}, notify, {
    sleep: async () => {},
    bridgeFactory: () => sim,
    connect: async () => {
      sim.opened = true;
      return { flashId: 'bf2641', command: sim.command.bind(sim) };
    },
  });
}
test('encrypted Bluetooth install verifies all sectors, preserves calibration and reconnect never reflashes', async () => {
  const sim = new Sim(),
    plan = await parse(fixture(2), 2),
    events = [];
  const cal = hash(sim.memory.subarray(0x2000, 0x4000));
  const up = updater(sim, (e) => events.push(e));
  assert.equal((await up.run(plan, { automatic: true })).state, 'COMPLETE');
  assert.deepEqual(sim.applied, [0x6000, 0x10000, 0x12000, 0]);
  assert.equal(sim.ended, 1);
  assert.ok(!sim.opened);
  assert.deepEqual(hash(sim.memory.subarray(0x2000, 0x4000)), cal);
  const writes = sim.applied.length;
  assert.equal((await up.run(plan, { automatic: true })).state, 'UP_TO_DATE');
  assert.equal(sim.applied.length, writes);
  assert.equal(events.at(-1).state, 'BM83_UP_TO_DATE');
});
test('encrypted Bluetooth rejects corrupted block before apply, always closes and never reports complete', async () => {
  const sim = new Sim(),
    plan = await parse(fixture(2), 2),
    events = [];
  plan.records[0].record[5] ^= 1;
  const up = updater(sim, (e) => events.push(e));
  await assert.rejects(up.run(plan), /SECURE_AUTH/);
  assert.deepEqual(sim.applied, []);
  assert.ok(!sim.opened);
  assert.equal(sim.ended, 0);
  assert.ok(!events.some((e) => e.state === 'BM83_COMPLETE'));
  assert.equal(up.busy, false);
});
test('encrypted catalog verifies SHA/versions and routes only encrypted package to programmer', async () => {
  const raw = fixture(2),
    reference = await parse(raw, 2);
  const manifest = {
    schema: 2,
    product: 'HEADSET_BT',
    hardware: 'REV01',
    module: 'BM83',
    revision: 5,
    format: 'ZNFW2_BM83',
    filename: 'BT_REV5.znbt',
    url: './BT_REV5.znbt',
    sha256: hash(raw).toString('hex'),
    versions: reference.metadata.versions,
  };
  let received;
  const auto = new Bm83AutoUpdater(
    {
      async run(plan) {
        received = plan;
        return { state: 'COMPLETE' };
      },
      cancel() {},
    },
    () => {},
    {
      baseUrl: 'https://example.test/',
      fetch: async (url) => ({
        ok: true,
        json: async () => manifest,
        arrayBuffer: async () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
      }),
    },
  );
  await auto.run({
    product: 'HEADSET_BT',
    hardware: 'REV01',
    mode: 'application',
    bm83_bridge: 3,
    bm83_secure: 1,
  });
  assert.equal(received.format, 'ZNFW2_BM83');
  assert.equal(received.encrypted, true);
  manifest.versions = { ...manifest.versions, MCU: [9, 9, 9, 9] };
  received = null;
  await assert.rejects(
    auto.run({
      product: 'HEADSET_BT',
      hardware: 'REV01',
      mode: 'application',
      bm83_bridge: 3,
      bm83_secure: 1,
    }),
    /Versione/,
  );
  assert.equal(received, null);
});
