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

// Esegue il vero adattatore con un catalogo misto. Nessuna porta USB reale.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

test('Firmware selector uses only the live board, never all products or stale HTML', async () => {
  const folder = new URL('../docs/firmware/', import.meta.url);
  const names = (await readdir(folder)).filter((n) =>
    /^(?:HEADSET_BT_.*_USB|ClearVoice_.*_PROD)\.znfw$/.test(n),
  );
  assert.ok(names.some((n) => n.startsWith('HEADSET_BT_')));
  assert.ok(names.some((n) => n.startsWith('ClearVoice_')));
  const queue = [],
    store = new Map(),
    nodes = new Map();
  const element = () => ({
    textContent: '',
    value: '',
    disabled: false,
    options: [],
    set innerHTML(value) {
      this.options = [];
    },
    add(option) {
      this.options.push(option);
    },
    classList: { toggle() {} },
  });
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  get('languageSelect').value = 'en';
  // Un testo lasciato sullo schermo non costituisce identita della porta.
  get('productValue').textContent = 'ClearVoice Portable Unit';
  get('hardwareValue').textContent = 'REV01';
  get('installedValue').textContent = '1.1.0.72';
  const document = {
    readyState: 'loading',
    documentElement: { lang: 'en' },
    querySelector: () => null,
    addEventListener() {},
    getElementById: get,
  };
  const window = {
    __ZN_UPDATER_DEVICE__: null,
    fetch: async (url) => {
      if (url.includes('api.github.com'))
        return {
          ok: true,
          json: async () => names.map((name) => ({ name, type: 'file', sha: name })),
        };
      const name = decodeURIComponent(url.split('/').pop().split('?')[0]);
      const bytes = await readFile(new URL(name, folder));
      return {
        ok: true,
        arrayBuffer: async () =>
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      };
    },
  };
  const source = (
    await readFile(new URL('../docs/version-selector.js', import.meta.url), 'utf8')
  ).replace(
    "import('./znfw.js')",
    `import(${JSON.stringify(new URL('../docs/znfw.js', import.meta.url).href)})`,
  );
  // Cambiamo solo la risoluzione dell'import nel contesto Node; parsing,
  // confronto, filtri e aggiornamento del DOM sono il codice di produzione.
  new Function(
    'window',
    'document',
    'sessionStorage',
    'queueMicrotask',
    'setTimeout',
    'Option',
    source,
  )(
    window,
    document,
    {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
    (fn) => queue.push(fn),
    () => {},
    function Option(label, value) {
      return { label, value };
    },
  );
  await window.fetch('firmware-manifest.json');
  window.__ZN_REFRESH_VERSIONS__();
  assert.equal(get('firmwareVersionSelect').options.length, 0);
  assert.equal(get('firmwareVersionSelect').disabled, true);
  assert.equal(get('latestVersionValue').textContent, '');
  assert.equal(get('releaseBadge').textContent, '');

  window.__ZN_UPDATER_DEVICE__ = { product: 'HEADSET_BT', hardware: 'REV01', installed: '1.0.1' };
  window.__ZN_REFRESH_VERSIONS__();
  assert.ok(get('firmwareVersionSelect').options.length > 0);
  assert.ok(get('firmwareVersionSelect').options.every((o) => o.value.startsWith('1.0.')));
  assert.ok(get('latestVersionValue').textContent.startsWith('1.0.'));

  window.__ZN_UPDATER_DEVICE__ = {
    product: 'ClearVoice',
    hardware: 'REV01',
    installed: '1.1.0.72',
  };
  window.__ZN_REFRESH_VERSIONS__();
  assert.ok(get('firmwareVersionSelect').options.length > 0);
  assert.ok(get('firmwareVersionSelect').options.every((o) => o.value.startsWith('1.1.')));
  assert.ok(get('latestVersionValue').textContent.startsWith('1.1.'));

  window.__ZN_UPDATER_DEVICE__.hardware = 'REV32';
  window.__ZN_REFRESH_VERSIONS__();
  assert.equal(get('firmwareVersionSelect').disabled, true);
  assert.equal(get('latestVersionValue').textContent, '\u2014');
  assert.notEqual(get('releaseBadge').textContent, 'Official firmware available');

  window.__ZN_UPDATER_DEVICE__ = null;
  // Una risposta catalogo accodata prima dello scollegamento non ripopola UI.
  for (const fn of queue) fn();
  assert.equal(get('firmwareVersionSelect').options.length, 0);
  assert.equal(get('latestVersionValue').textContent, '');
});
