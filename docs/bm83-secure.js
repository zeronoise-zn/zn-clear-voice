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

/** Caricamento USB di settori cifrati: il browser non apre il firmware.
 * Lo STM32 autentica header e ogni blocco; confronta/scrive/rilegge in locale.
 * La calibrazione resta protetta e TEST/RESET sono rilasciati anche su errore.
 */
import { UpdateError } from './znfw.js';
import { Bm83SpiFlash, readBm83FlashIdentity, unlockedProtection } from './bm83-flash.js';
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fail = (code, message) => {
  throw new UpdateError(code, message);
};
const compare = (a, b) => {
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  return 0;
};
const addressAllowed = (a) =>
  Number.isInteger(a) &&
  a % 4096 === 0 &&
  ((a >= 0 && a < 0x2000) ||
    (a >= 0x4000 && a < 0x8000) ||
    (a >= 0x10000 && a < 0x90000) ||
    (a >= 0x110000 && a < 0x150000));

async function flashHash(bridge, address, count) {
  const reply = await bridge.rpc(
    `ZN_BM83_HASH ${address.toString(16).padStart(8, '0')} ${count.toString(16).padStart(4, '0')}`,
    'HASH',
    15000,
  );
  const match = /^\[BM83\] HASH=([a-f\d]{64})$/i.exec(reply.trim());
  if (!match) fail('BM83_FLASH_VERIFY', 'Digest della Flash non valido.');
  return match[1].toLowerCase();
}

export function validateEncryptedPlan(plan) {
  const m = plan.metadata;
  if (
    !plan.encrypted ||
    plan.header[76] !== 2 ||
    m?.schema !== 1 ||
    !Array.isArray(m.sectors) ||
    m.sectors.length !== plan.records.length ||
    !Number.isInteger(m.config?.length) ||
    m.config.length < 3 ||
    m.config.length > 8191 ||
    !/^[a-f\d]{64}$/.test(m.config.sha256 || '') ||
    !['MCU', 'DSP'].every(
      (name) =>
        Array.isArray(m.versions?.[name]) &&
        m.versions[name].length === 4 &&
        m.versions[name].every((v) => Number.isInteger(v) && v >= 0 && v <= 255),
    )
  )
    fail('BM83_ENCRYPTED_PLAN', 'Metadati del firmware non validi.');
  const seen = new Set();
  for (const [i, r] of plan.records.entries()) {
    const s = m.sectors[i];
    if (
      !addressAllowed(r.address) ||
      seen.has(r.address) ||
      r.address !== s.address ||
      !['HEADER', 'RUNTIME', 'CONFIG', 'MCU', 'DSP'].includes(s.name) ||
      (i < plan.records.length - 2
        ? r.address < 0x4000
        : r.address !== (plan.records.length - 1 - i) * 4096)
    )
      fail('BM83_ENCRYPTED_PLAN', 'Ordine o indirizzi dei settori non validi.');
    seen.add(r.address);
  }
}

export async function runEncryptedBm83(owner, plan, { baud = 921600, automatic = false } = {}) {
  if (owner.busy) fail('BUSY', 'Aggiornamento in corso.');
  validateEncryptedPlan(plan);
  owner.busy = true;
  owner.cancelled = false;
  const bridge = owner.bridgeFactory(owner.io),
    started = Date.now();
  const notify = (e) => owner.notify(e);
  const check = () => {
    if (owner.cancelled)
      fail('BM83_CANCELLED', 'Aggiornamento interrotto; ripetere per recuperare il modulo.');
  };
  let flash,
    protection,
    unlocked = false,
    installed;
  try {
    const link = await owner.connect(bridge, baud, { sleep: owner.sleep });
    if (bridge.info?.bm83_secure !== 1 || link.flashId !== 'bf2641')
      fail('BM83_BRIDGE_REQUIRED', 'Installa prima il firmware STM32 con caricamento cifrato.');
    const capabilities = await bridge.rpc('ZN_BM83_INFO?', 'BRIDGE');
    if (!/\bSECURE=1\b/.test(capabilities))
      fail('BM83_BRIDGE_REQUIRED', 'Bridge cifrato non disponibile.');
    flash = new Bm83SpiFlash(link, { sleep: owner.sleep, check, bridge });
    await bridge.rpc('ZN_BM83_GUARD ON', 'GUARD');
    // Il dispositivo verifica il MAC prima di consentire la prima scrittura.
    await bridge.rpc('ZN_BM83_SECURE_BEGIN ' + hex(plan.header), 'SECURE_BEGIN');
    installed = await readBm83FlashIdentity(flash);
    notify({ state: 'BM83_INSTALLED', ...installed });
    const versions = plan.metadata.versions;
    if (automatic && installed.validHeader) {
      if (
        ['MCU', 'DSP'].some(
          (n) => installed[n.toLowerCase()] && compare(installed[n.toLowerCase()], versions[n]) > 0,
        )
      )
        fail('BM83_NEWER_FIRMWARE', 'Il dispositivo contiene una versione piu recente.');
      const configHash = await flashHash(bridge, 0x6001, plan.metadata.config.length);
      const matches =
        installed.mcu &&
        installed.dsp &&
        compare(installed.mcu, versions.MCU) === 0 &&
        compare(installed.dsp, versions.DSP) === 0 &&
        configHash === plan.metadata.config.sha256;
      if (matches) {
        check();
        await bridge.rpc('ZN_BM83_GUARD OFF', 'GUARD');
        await bridge.close();
        notify({ state: 'BM83_UP_TO_DATE', versionVerified: true, configurationVerified: true });
        return { state: 'UP_TO_DATE', installed, expectedVersions: versions };
      }
    }
    const calibration = await flashHash(bridge, 0x2000, 8192);
    protection = await flash.protection();
    await flash.setProtection(
      unlockedProtection(
        protection,
        plan.records.map((r) => r.address),
      ),
    );
    unlocked = true;
    await bridge.rpc('ZN_BM83_SECURE_INVALIDATE', 'SECURE_INVALIDATE', 30000);
    let changed = 0;
    for (const r of plan.records) {
      check();
      await bridge.rpc(
        `ZN_BM83_SECURE_LOAD ${r.index.toString(16).padStart(8, '0')} ${r.address.toString(16).padStart(8, '0')}`,
        'SECURE_LOAD',
      );
      for (let offset = 0; offset < 4096; offset += 512) {
        check();
        const reply = await bridge.rpc(
          `ZN_BM83_CHUNK ${offset.toString(16).padStart(4, '0')} ${hex(r.record.subarray(offset, offset + 512))}`,
          'CHUNK',
        );
        if (reply.trim() !== '[BM83] CHUNK=' + (offset + 512))
          fail('BM83_SPI', 'Offset del blocco non confermato.');
      }
      check();
      const match = (
        await bridge.rpc(
          'ZN_BM83_SECURE_AUTH ' + hex(r.record.subarray(4096)),
          'SECURE_MATCH',
          15000,
        )
      ).trim();
      if (match === '[BM83] SECURE_MATCH=0') {
        check();
        const applied = await bridge.rpc('ZN_BM83_SECURE_APPLY', 'SECURE_APPLY', 15000);
        if (applied.trim() !== '[BM83] SECURE_APPLY=OK')
          fail('BM83_FLASH_VERIFY', 'Scrittura non confermata.');
        changed++;
      } else if (match !== '[BM83] SECURE_MATCH=1')
        fail('BM83_FLASH_VERIFY', 'Confronto non confermato.');
      notify({
        state: 'BM83_FLASHING',
        part: plan.metadata.sectors[r.index].name,
        offset: r.end,
        total: plan.imageSize,
        baud,
        elapsedMs: Date.now() - started,
      });
    }
    const end = await bridge.rpc('ZN_BM83_SECURE_END', 'SECURE_END');
    if (end.trim() !== '[BM83] SECURE_END=OK')
      fail('BM83_FLASH_VERIFY', 'Verifica completa mancante.');
    if ((await flashHash(bridge, 0x2000, 8192)) !== calibration)
      fail('BM83_CALIBRATION', 'Calibrazione diversa dalla lettura iniziale.');
    await flash.setProtection(protection);
    unlocked = false;
    await flash.spi([4]);
    check();
    await bridge.rpc('ZN_BM83_GUARD OFF', 'GUARD');
    await bridge.close();
    notify({ state: 'BM83_REBOOTING' });
    await owner.sleep(3000);
    notify({
      state: 'BM83_COMPLETE',
      encrypted: true,
      authenticatedByDevice: true,
      readbackVerified: true,
      calibrationPreserved: true,
      runtimeVerified: false,
      applicationMode: 'EMBEDDED',
      expectedVersions: versions,
      changedSectors: changed,
      elapsedMs: Date.now() - started,
    });
    return {
      state: 'COMPLETE',
      installed,
      expectedVersions: versions,
      firstInstall: !installed.validHeader,
    };
  } catch (error) {
    notify({ state: 'BM83_FAILED', error, elapsedMs: Date.now() - started });
    throw error;
  } finally {
    // Ripristino best effort senza nascondere l'errore originale. Se UART e
    // interrotta, CLOSE rilascia comunque TEST e RESET nel firmware STM32.
    if (unlocked && flash && protection) {
      try {
        await flash.setProtection(protection);
      } catch {}
    }
    try {
      await bridge.close();
    } finally {
      owner.busy = false;
    }
  }
}
