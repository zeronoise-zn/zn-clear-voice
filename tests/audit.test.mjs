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

// Regressioni dell'audit: i casi devono fermarsi PRIMA di una scrittura reale.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { SerialTransport } from '../docs/serial-transport.js';
import { cobsDecode } from '../docs/zn-protocol.js';
import { Bm83SpiFlash, unlockedProtection } from '../docs/bm83-flash.js';
import { Bm83Bridge } from '../docs/bm83-updater.js';
import { UpdateError } from '../docs/znfw.js';

test('Concurrent request cannot discard the incomplete response of the first request', async () => {
  const io = new SerialTransport({});
  io.mode = 'binary';
  io.buffer = [3, 1, 2];
  const pending = {};
  io.pending = pending;
  await assert.rejects(
    io.text('ZN_INFO?\n', () => true),
    (error) => error.code === 'BUSY',
  );
  await assert.rejects(io.request(2), (error) => error.code === 'BUSY');
  assert.equal(io.mode, 'binary');
  assert.deepEqual(io.buffer, [3, 1, 2]);
  assert.equal(io.pending, pending);
});

test('COBS rejects internal zero and invalid sector numbers never reach SPI or unlock', async () => {
  assert.throws(() => cobsDecode(Uint8Array.of(2, 0)), /COBS/);
  let commands = 0;
  const spi = new Bm83SpiFlash({
    async command() {
      commands++;
      throw Error('Unexpected hardware command');
    },
  });
  for (const address of [NaN, Infinity, -Infinity, 1.5, undefined, '0']) {
    await assert.rejects(
      spi.sector(address, new Uint8Array(4096)),
      (error) => error.code === 'BM83_SPI',
    );
    assert.throws(
      () => unlockedProtection(new Uint8Array(6), [address]),
      (error) => error.code === 'BM83_FLASH_PLAN',
    );
  }
  assert.equal(commands, 0);
});

test('APP baud diagnosis starts a fresh non-resetting session after a failed read', async () => {
  const bridge = new Bm83Bridge({});
  const calls = [];
  let reads = 0;
  bridge.close = async () => calls.push('CLOSE');
  bridge.open = async (mode) => calls.push('OPEN ' + mode);
  bridge.rpc = async (command) => {
    calls.push(command);
    return '[BM83] BAUD=OK';
  };
  bridge.version = async () => {
    if (++reads === 1) throw new UpdateError('BM83_PROTOCOL');
    return '2.09';
  };
  assert.deepEqual(await bridge.detectAppBaud(), { baud: 921600, version: '2.09' });
  assert.deepEqual(calls, [
    'ZN_BM83_APP_BAUD 115200',
    'CLOSE',
    'OPEN APP',
    'ZN_BM83_APP_BAUD 921600',
  ]);
});

test('Catalog adapter forwards the UI cancellation signal to its GitHub request', async () => {
  const requests = [];
  const window = {
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => [] };
    },
  };
  const document = { readyState: 'loading', querySelector: () => null, addEventListener() {} };
  const context = vm.createContext({
    window,
    document,
    Response,
    queueMicrotask() {},
    setTimeout() {},
  });
  vm.runInContext(
    await readFile(new URL('../docs/version-selector.js', import.meta.url), 'utf8'),
    context,
  );
  const controller = new AbortController();
  const response = await window.fetch('firmware-manifest.json', { signal: controller.signal });
  assert.equal(response.status, 200);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.signal, controller.signal);
});
