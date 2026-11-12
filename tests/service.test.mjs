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
import { createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import {
  serviceLogin,
  serviceStatus,
  serviceLogout,
  supportsService,
  mountServiceAccess,
} from '../docs/service-access.js';
import { CMD } from '../docs/zn-protocol.js';
import { SerialTransport } from '../docs/serial-transport.js';

const password = 'TEST-password-only-2026';
const mac = (key, bytes) => createHmac('sha256', key).update(bytes).digest();
class ServiceDevice {
  connected = true;
  authenticated = false;
  calls = [];
  info = { product: 'HEADSET_BT', mode: 'application', service_auth: 1 };
  challenge() {
    const salt = Buffer.from([...Array(16).keys()]),
      uid = randomBytes(12),
      nonce = randomBytes(32);
    this.challengeBytes = Buffer.concat([salt, nonce, uid, Buffer.from([0xc0, 0x27, 9, 0])]);
    const verifier = pbkdf2Sync(password, salt, 600000, 32, 'sha256');
    this.expected = mac(
      mac(verifier, Buffer.concat([Buffer.from('DEVICE'), uid])),
      Buffer.concat([Buffer.from('LOGIN'), nonce, Buffer.from('test')]),
    );
    return {
      service: 'challenge',
      salt: salt.toString('hex'),
      uid: uid.toString('hex'),
      nonce: nonce.toString('hex'),
      iterations: 600000,
    };
  }
  accept(user, proof) {
    this.authenticated = user === 'test' && this.expected?.equals(Buffer.from(proof));
    this.expected = null;
    return this.authenticated;
  }
  async text(line) {
    this.calls.push(line.split(' ')[0].trim());
    if (line.startsWith('ZN_SERVICE_CHALLENGE ')) return JSON.stringify(this.challenge());
    if (line.startsWith('ZN_SERVICE_LOGIN ')) {
      const [, user, proof] = line.trim().split(' ');
      return this.accept(user, Buffer.from(proof, 'hex')) ? '[SERVICE] OK' : '[SERVICE] DENIED';
    }
    if (line.startsWith('ZN_SERVICE_LOGOUT')) this.authenticated = false;
    return this.authenticated ? '[SERVICE] OK' : '[SERVICE] LOCKED';
  }
  async request(id, payload) {
    this.calls.push(id);
    if (id === CMD.SERVICE_CHALLENGE) {
      this.challenge();
      return { payload: Buffer.concat([Buffer.alloc(8), this.challengeBytes]) };
    }
    if (
      id === CMD.SERVICE_LOGIN &&
      !this.accept(new TextDecoder().decode(payload.slice(0, -32)), payload.slice(-32))
    )
      throw Error('Denied');
    if (id === CMD.SERVICE_LOGOUT) this.authenticated = false;
    return { payload: Buffer.concat([Buffer.alloc(8), Buffer.from([+this.authenticated])]) };
  }
}

test('Service proof agrees with independent PBKDF2/HMAC for application and recovery', async () => {
  for (const mode of ['application', 'bootloader']) {
    const io = new ServiceDevice();
    io.info.mode = mode;
    io.info.capabilities = 0x08000000;
    assert.equal(await serviceLogin(io, io.info, 'test', password), true);
    assert.equal(await serviceStatus(io, io.info), true);
    await serviceLogout(io, io.info);
    assert.equal(await serviceStatus(io, io.info), false);
    assert.ok(!io.calls.join('').includes(password));
  }
});
test('Wrong credentials and legacy products never unlock service controls', async () => {
  const io = new ServiceDevice();
  await assert.rejects(serviceLogin(io, io.info, 'test', 'wrong-password'));
  await assert.rejects(serviceLogin(io, io.info, 'other', password));
  assert.equal(io.authenticated, false);
  assert.equal(supportsService({ ...io.info, product: 'ClearVoice' }), false);
  io.info.service_auth = 0;
  io.calls = [];
  await assert.rejects(serviceLogin(io, io.info, 'test', password));
  assert.equal(io.calls.length, 0);
});
test('Malformed challenge is rejected before a login proof is sent', async () => {
  const io = new ServiceDevice();
  io.text = async () =>
    '{"service":"challenge","salt":"00","nonce":"00","uid":"00","iterations":1}';
  await assert.rejects(
    serviceLogin(io, io.info, 'test', password),
    /SERVICE_CHALLENGE|Invalid service/,
  );
  assert.equal(io.authenticated, false);
});
test('Service UI remains closed until device confirmation, clears password, locks on disconnect', async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const nodes = new Map();
  const get = (id) => {
    if (!nodes.has(id))
      nodes.set(id, {
        value: '',
        events: {},
        addEventListener(event, fn) {
          this.events[event] = fn;
        },
      });
    return nodes.get(id);
  };
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { getElementById: get },
  });
  const io = new ServiceDevice();
  let controller;
  try {
    controller = mountServiceAccess({
      getIo: () => io,
      getInfo: () => io.info,
      busy: () => controller.busy,
      language: () => 'it',
      changed: () => controller.render(),
    });
    controller.render();
    assert.equal(get('serviceTools').hidden, true);
    assert.equal(get('serviceTools').disabled, true);
    get('serviceUser').value = 'test';
    get('servicePassword').value = password;
    await get('serviceForm').events.submit({ preventDefault() {} });
    assert.equal(get('servicePassword').value, '');
    assert.equal(controller.authorized, true);
    assert.equal(get('serviceTools').hidden, false);
    io.connected = false;
    controller.render();
    assert.equal(get('serviceTools').hidden, true);
    assert.equal(controller.authorized, false);
  } finally {
    controller?.lock();
    if (saved) Object.defineProperty(globalThis, 'document', saved);
    else delete globalThis.document;
  }
});
test('Serial trace redacts service challenges, username and proof', async () => {
  const lines = [],
    io = new SerialTransport(
      {},
      () => {},
      (dir, line) => lines.push(line),
    );
  io.exchange = async () => '[SERVICE] OK';
  await io.text('ZN_SERVICE_LOGIN test deadbeef\n', () => true);
  io.ingest(new TextEncoder().encode('{"service":"challenge","nonce":"sensitive"}\n'));
  assert.ok(lines.length >= 2);
  assert.ok(lines.every((line) => !/deadbeef|sensitive|test/.test(line)));
});
