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

/** WebUSB / ST AN3156. Percorso limitato alla PRIMA installazione C071G8.
 * Non invia MAI mass erase, read-unprotect o scritture agli Option Bytes.
 * Un errore/timeout ferma il flusso: le mutazioni non vengono ritrasmesse.
 */
import { validateFactoryImage } from './factory-package.js';
export const DFU_FILTER = { vendorId: 0x0483, productId: 0xdf11 };
const BASE = 0x08000000,
  SIZE = 65536;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (s) => {
  throw new Error(s);
};
const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

export class Stm32Dfu {
  constructor(device, notify = () => {}, { sleep = pause } = {}) {
    this.device = device;
    this.notify = notify;
    this.sleep = sleep;
    this.interface = null;
    this.closed = false;
    this.transferSize = 0;
  }
  async timed(operation) {
    let timer;
    try {
      return await Promise.race([
        operation,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('DFU_TIMEOUT')), 10000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  setup(request, value = 0) {
    return { requestType: 'class', recipient: 'interface', request, value, index: this.interface };
  }
  async input(request, value, length) {
    const r = await this.timed(this.device.controlTransferIn(this.setup(request, value), length));
    if (r.status !== 'ok' || !r.data || r.data.byteLength !== length) fail('DFU_TRANSFER');
    return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength).slice();
  }
  async output(request, value, bytes = new Uint8Array()) {
    const r = await this.timed(this.device.controlTransferOut(this.setup(request, value), bytes));
    if (r.status !== 'ok' || r.bytesWritten !== bytes.length) fail('DFU_TRANSFER');
  }
  async status() {
    const b = await this.input(3, 0, 6);
    if (b[0] !== 0) fail('DFU_STATUS_' + b[0]);
    return { state: b[4], wait: b[1] | (b[2] << 8) | (b[3] << 16) };
  }
  async idle() {
    await this.output(6, 0); // ABORT resetta SOLO lo stato del protocollo.
    if ((await this.status()).state !== 2) fail('DFU_STATE');
  }
  async completeDownload() {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const s = await this.status();
      if (s.state === 5) return;
      if (![3, 4].includes(s.state) || s.wait > 5000) fail('DFU_STATE');
      await this.sleep(Math.max(1, s.wait));
    }
    fail('DFU_TIMEOUT');
  }
  async address(value) {
    await this.idle();
    await this.output(1, 0, Uint8Array.from([0x21, ...le32(value)]));
    await this.completeDownload();
  }
  async open() {
    if (
      this.device.vendorId !== DFU_FILTER.vendorId ||
      this.device.productId !== DFU_FILTER.productId
    )
      fail('DFU_DEVICE');
    await this.timed(this.device.open());
    if (!this.device.configuration) await this.timed(this.device.selectConfiguration(1));
    const intf = this.device.configuration.interfaces.find((i) =>
      i.alternates.some(
        (a) =>
          a.alternateSetting === 0 &&
          a.interfaceClass === 0xfe &&
          a.interfaceSubclass === 1 &&
          a.interfaceProtocol === 2,
      ),
    );
    if (!intf) fail('DFU_DEVICE');
    this.interface = intf.interfaceNumber;
    await this.timed(this.device.claimInterface(this.interface));
    await this.timed(this.device.selectAlternateInterface(this.interface, 0));
    // Leggi wTransferSize dal descrittore DFU, non da una costante del browser.
    const descriptor = (length) =>
      this.timed(
        this.device.controlTransferIn(
          { requestType: 'standard', recipient: 'device', request: 6, value: 0x0200, index: 0 },
          length,
        ),
      );
    const head = await descriptor(9);
    if (head.status !== 'ok' || head.data?.byteLength !== 9) fail('DFU_DESCRIPTOR');
    const length = head.data.getUint16(2, true);
    if (length < 18 || length > 4096) fail('DFU_DESCRIPTOR');
    const raw = await descriptor(length);
    if (raw.status !== 'ok' || raw.data?.byteLength !== length) fail('DFU_DESCRIPTOR');
    let active = false;
    for (let at = 0; at < length; ) {
      const n = raw.data.getUint8(at),
        type = raw.data.getUint8(at + 1);
      if (n < 2 || at + n > length) fail('DFU_DESCRIPTOR');
      if (type === 4)
        active =
          n >= 9 && raw.data.getUint8(at + 2) === this.interface && raw.data.getUint8(at + 3) === 0;
      if (type === 0x21 && active && n === 9) this.transferSize = raw.data.getUint16(at + 5, true);
      at += n;
    }
    if (this.transferSize < 8 || this.transferSize > 2048 || this.transferSize % 8)
      fail('DFU_DESCRIPTOR');
    await this.idle();
  }
  async read(address, length) {
    const allowed = [
      [BASE, BASE + SIZE],
      [0x1fff7550, 0x1fff755c],
      [0x1fff75a0, 0x1fff75a2],
      [0x40015800, 0x40015804],
    ];
    if (
      !Number.isInteger(address) ||
      !Number.isInteger(length) ||
      length < 2 ||
      !allowed.some(([a, b]) => address >= a && address + length <= b)
    )
      fail('DFU_RANGE');
    const data = new Uint8Array(length);
    for (let offset = 0; offset < length; offset += this.transferSize) {
      const n = Math.min(this.transferSize, length - offset);
      await this.address(address + offset);
      await this.idle();
      data.set(await this.input(2, 2, n), offset);
      if ((await this.status()).state !== 9) fail('DFU_STATE');
    }
    await this.idle();
    return data;
  }
  async identify() {
    const id = await this.read(0x40015800, 4),
      size = await this.read(0x1fff75a0, 2);
    if (
      (new DataView(id.buffer).getUint32(0, true) & 0xfff) !== 0x493 ||
      new DataView(size.buffer).getUint16(0, true) !== 64
    )
      fail('DFU_DEVICE');
    const uid = await this.read(0x1fff7550, 12);
    if (uid.every((b) => b === 0) || uid.every((b) => b === 255)) fail('DFU_DEVICE');
    return Array.from(uid, (b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }
  async write(address, bytes) {
    if (
      address < BASE ||
      address + bytes.length > BASE + SIZE ||
      address % 8 ||
      bytes.length % 8 ||
      !bytes.length ||
      bytes.length > this.transferSize
    )
      fail('DFU_RANGE');
    await this.address(address);
    await this.output(1, 2, bytes);
    await this.completeDownload();
  }
  async install(image) {
    await validateFactoryImage(image);
    const uid = await this.identify();
    this.notify({ state: 'CHECKING_BLANK', progress: 2 });
    const old = await this.read(BASE, SIZE);
    // Ripresa ammessa solo se i vettori iniziali sono ancora vuoti e OGNI
    // double-word esistente coincide gia con questo stesso file autorizzato.
    // Un'app installata o un'immagine diversa non autorizza mai cancellazioni.
    if (!old.subarray(0, 8).every((b) => b === 255)) {
      old.fill(0);
      fail('DFU_NOT_BLANK');
    }
    for (let at = 8; at < SIZE; at += 8) {
      const word = old.subarray(at, at + 8);
      if (!word.every((b) => b === 255) && !same(word, image.subarray(at, at + 8))) {
        old.fill(0);
        fail('DFU_PARTIAL_IMAGE');
      }
    }
    // Nessun erase: la verginità e appena stata provata sui 64 KiB reali.
    // Le prime 8 byte (MSP/Reset) si programmano SOLO dopo il readback completo
    // del resto. Fino ad allora la prima parola resta FF e conserva l'empty check.
    const chunks = [];
    for (let at = 8; at < SIZE; at += 8) {
      if (image.subarray(at, at + 8).every((b) => b === 255)) continue;
      if (same(old.subarray(at, at + 8), image.subarray(at, at + 8))) continue;
      const previous = chunks[chunks.length - 1];
      if (previous && previous.at + previous.size === at && previous.size + 8 <= this.transferSize)
        previous.size += 8;
      else chunks.push({ at, size: 8 });
    }
    old.fill(0);
    let written = 0;
    for (const chunk of chunks) {
      await this.write(BASE + chunk.at, image.subarray(chunk.at, chunk.at + chunk.size));
      this.notify({
        state: 'INSTALLING_MCU',
        progress: 5 + Math.floor((++written * 65) / chunks.length),
      });
    }
    this.notify({ state: 'VERIFYING_MCU', progress: 75 });
    const check = await this.read(BASE, SIZE);
    const valid =
      check.subarray(0, 8).every((b) => b === 255) && same(check.subarray(8), image.subarray(8));
    check.fill(0);
    if (!valid) fail('DFU_VERIFY');
    await this.write(BASE, image.subarray(0, 8));
    const vectors = await this.read(BASE, 8);
    if (!same(vectors, image.subarray(0, 8))) fail('DFU_VERIFY');
    this.notify({ state: 'RESTARTING_MCU', progress: 85 });
    await this.address(BASE);
    await this.output(1, 0, new Uint8Array()); // Leave DFU: AN3156 5.5.
    try {
      const state = (await this.status()).state;
      if (![6, 7, 8].includes(state)) fail('DFU_STATE');
    } catch (e) {
      // La scomparsa USB e ammessa SOLO dopo Leave e TUTTA la verifica.
      // Il completamento sara provato dall'applicazione sulla stessa UID.
      if (!['NetworkError', 'NotFoundError'].includes(e.name)) throw e;
    }
    return { uid };
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.timed(this.device.close());
    } catch {
      /* Puo essere gia rienumerata. */
    }
  }
}
