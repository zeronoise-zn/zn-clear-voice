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

/** Credenziali di prima installazione ricordate sul PC dell'operatore.
 * IndexedDB conserva un record AES-GCM e la CryptoKey non esportabile.
 * La pagina autorizzata puo comunque decifrarlo: non e una protezione contro
 * codice dello stesso origin o chi puo usare questo profilo del browser.
 * Non memorizzare firmware, credenziali in chiaro, o chiavi di prodotto qui.
 */
export function browserCredentialRecords(indexedDB = globalThis.indexedDB) {
  async function operation(mode, action) {
    if (!indexedDB) throw new Error('CREDENTIAL_STORAGE');
    const db = await new Promise((resolve, reject) => {
      let abandoned = false;
      const request = indexedDB.open('zn-headset-operator-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('credentials');
      request.onsuccess = () => {
        if (abandoned) request.result.close();
        else resolve(request.result);
      };
      request.onerror = () => reject(new Error('CREDENTIAL_STORAGE'));
      request.onblocked = () => {
        abandoned = true;
        reject(new Error('CREDENTIAL_STORAGE'));
      };
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('credentials', mode);
        const request = action(transaction.objectStore('credentials'));
        // Una richiesta riuscita non prova il commit: attendere oncomplete.
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = transaction.onerror = () => reject(new Error('CREDENTIAL_STORAGE'));
      });
    } finally {
      db.close();
    }
  }
  return {
    get: (id) => operation('readonly', (store) => store.get(id)),
    put: (id, record) => operation('readwrite', (store) => store.put(record, id)),
    delete: (id) => operation('readwrite', (store) => store.delete(id)),
  };
}

export function createRememberedCredentials({
  records = browserCredentialRecords(),
  crypto = globalThis.crypto,
  scope = globalThis.location ? new URL('.', globalThis.location.href).pathname : '/',
} = {}) {
  const id = 'first-install:' + scope;
  const aad = new TextEncoder().encode('ZN_OPERATOR_CREDENTIALS_V1\0' + id);
  const valid = (value) =>
    value &&
    /^[A-Za-z0-9._-]{1,32}$/.test(value.username) &&
    typeof value.password === 'string' &&
    value.password.length > 0 &&
    value.password.length <= 256;
  return {
    async load() {
      const record = await records.get(id);
      if (!record) return null;
      if (
        record.schema !== 1 ||
        record.key?.extractable !== false ||
        record.key.algorithm?.name !== 'AES-GCM' ||
        record.iv?.byteLength !== 12 ||
        !record.ciphertext ||
        record.ciphertext.byteLength > 2048
      )
        throw new Error('CREDENTIAL_STORAGE');
      let plain;
      try {
        plain = new Uint8Array(
          await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: record.iv, additionalData: aad },
            record.key,
            record.ciphertext,
          ),
        );
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
        if (!valid(value)) throw new Error('CREDENTIAL_STORAGE');
        return value;
      } finally {
        plain?.fill(0);
      }
    },
    async save(username, password) {
      if (!valid({ username, password })) throw new Error('CREDENTIAL_STORAGE');
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt',
      ]);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const plain = new TextEncoder().encode(JSON.stringify({ username, password }));
      try {
        const ciphertext = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv, additionalData: aad },
          key,
          plain,
        );
        // Record unico: chiave, nonce e cifrato cambiano atomicamente insieme.
        await records.put(id, { schema: 1, key, iv, ciphertext });
      } finally {
        plain.fill(0);
      }
    },
    forget: () => records.delete(id),
  };
}
