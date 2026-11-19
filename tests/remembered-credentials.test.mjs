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
import {
  createRememberedCredentials,
  browserCredentialRecords,
} from '../docs/remembered-credentials.js';
function fixture() {
  const data = new Map();
  const records = {
    get: async (id) => structuredClone(data.get(id)),
    put: async (id, value) => {
      data.set(id, structuredClone(value));
    },
    delete: async (id) => {
      data.delete(id);
    },
  };
  const store = (scope) => createRememberedCredentials({ records, crypto: webcrypto, scope });
  return { data, store };
}

test('Remembered operator credentials survive a new instance without a plaintext record or exportable key', async () => {
  const { data, store } = fixture(),
    first = store('/headset/');
  await first.save('test-operator', 'synthetic-operator-password');
  const record = [...data.values()][0];
  assert.equal(record.key.extractable, false);
  await assert.rejects(webcrypto.subtle.exportKey('raw', record.key));
  assert.ok(!JSON.stringify(record).includes('test-operator'));
  assert.ok(!JSON.stringify(record).includes('synthetic-operator-password'));
  assert.deepEqual(await store('/headset/').load(), {
    username: 'test-operator',
    password: 'synthetic-operator-password',
  });
});
test('Each replacement uses fresh encryption; forget removes the record and its key', async () => {
  const { data, store } = fixture(),
    saved = store('/headset/');
  await saved.save('test', 'synthetic-password');
  const first = [...data.values()][0];
  await saved.save('test', 'synthetic-password');
  const second = [...data.values()][0];
  assert.notDeepEqual(first.iv, second.iv);
  assert.notDeepEqual(first.ciphertext, second.ciphertext);
  await saved.forget();
  assert.equal(data.size, 0);
  assert.equal(await store('/headset/').load(), null);
});
test('Tampered credentials and copying a record to another application path fail authentication', async () => {
  const { data, store } = fixture();
  await store('/headset/').save('test', 'synthetic-password');
  assert.equal(await store('/other/').load(), null);
  data.set('first-install:/other/', structuredClone(data.get('first-install:/headset/')));
  await assert.rejects(store('/other/').load());
  const record = data.get('first-install:/headset/');
  new Uint8Array(record.ciphertext)[0] ^= 1;
  await assert.rejects(store('/headset/').load());
});

test('IndexedDB adapter waits for commit and reports an aborted transaction instead of success', async () => {
  for (const abort of [false, true]) {
    let transaction,
      closed = 0,
      completed = false;
    const indexedDB = {
      open() {
        const request = {
          result: {
            close() {
              closed++;
            },
            transaction() {
              transaction = { objectStore: () => ({ get: () => ({ result: 'record' }) }) };
              return transaction;
            },
          },
        };
        queueMicrotask(() => request.onsuccess());
        return request;
      },
    };
    const pending = browserCredentialRecords(indexedDB)
      .get('test')
      .then((value) => {
        completed = true;
        return value;
      });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(completed, false, 'Request success alone is not a committed transaction');
    if (abort) {
      transaction.onabort();
      await assert.rejects(pending, /CREDENTIAL_STORAGE/);
    } else {
      transaction.oncomplete();
      assert.equal(await pending, 'record');
    }
    assert.equal(closed, 1);
  }
});
