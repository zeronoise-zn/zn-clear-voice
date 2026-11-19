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

/** Flusso guidato DFU -> stessa scheda CDC -> Bluetooth. Le credenziali
 * aprono il contenitore di provisioning, non sostituiscono il login sul device.
 * Nessun prompt USB al caricamento pagina, nessuna Flash senza azione esplicita.
 */
import { Stm32Dfu, DFU_FILTER } from './stm32-dfu.js';
import { fetchFactoryPackage, openFactoryPackage } from './factory-package.js';

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export function assertProvisionedApplication(info, expected) {
  if (
    info?.product !== 'HEADSET_BT' ||
    info?.usb_serial !== expected.uid ||
    info?.version !== expected.version ||
    info?.bm83_secure !== 1
  )
    throw new Error('FACTORY_WRONG_DEVICE');
}
const copy = {
  it: {
    title: 'Cuffia nuova? Prima installazione',
    help: 'Configura una HEADSET_BT nuova. Accedi con le credenziali assistenza: installeremo prima il firmware della scheda, poi il firmware Bluetooth.',
    user: 'Utente assistenza',
    password: 'Password',
    start: 'Configura cuffia',
    next: 'Collega la cuffia riavviata',
    READY: 'Collega la cuffia nuova via USB per iniziare.',
    DETECTED: 'Rilevato un dispositivo per la prima installazione. Accedi per verificarlo.',
    AUTHORIZING: 'Autorizza il collegamento USB nella finestra del browser.',
    OPENING_PACKAGE: 'Preparazione del firmware protetto…',
    OPENING_DFU: 'Apertura del collegamento DFU…',
    IDENTIFYING_MCU: 'Identificazione della scheda…',
    CHECKING_BLANK: 'Verifica della scheda collegata…',
    INSTALLING_MCU: 'Installazione firmware della scheda…',
    VERIFYING_MCU: 'Verifica firmware della scheda…',
    RESTARTING_MCU: 'Riavvio della scheda…',
    WAITING_SERIAL:
      'Firmware scheda installato. Autorizza la porta USB della cuffia riavviata per completare il Bluetooth.',
    INSTALLING_BLUETOOTH: 'Verifica e installazione firmware Bluetooth…',
    COMPLETE: 'Cuffia configurata: firmware scheda e Bluetooth verificati.',
    unsupported:
      'La prima installazione richiede Chrome o Edge su computer, con accesso USB disponibile.',
    credentials: 'Credenziali assistenza non corrette. Reinserisci la password.',
    notBlank:
      'La scheda contiene già un firmware o dati diversi. Usa il normale collegamento per gli aggiornamenti.',
    partial:
      'La scheda contiene un’installazione parziale di un altro file. Serve il recupero USB con CubeProgrammer.',
    device: 'La scheda selezionata non è compatibile con questa prima installazione.',
    driver:
      'Impossibile aprire USB. Chiudi CubeProgrammer e gli altri programmi USB. Su Windows serve il driver WinUSB per il dispositivo DFU.',
    wrong: 'È stata selezionata un’altra cuffia. Scegli la porta della scheda appena configurata.',
    failed:
      'Installazione non completata. Mantieni la cuffia collegata e riprova; se resta in DFU è disponibile il recupero con CubeProgrammer.',
    detail: 'Fase: {phase}. Codice: {code}.',
    download: 'Impossibile scaricare il firmware. Verifica la connessione Internet e riprova.',
    package:
      'Il pacchetto firmware non è valido o non coincide con il catalogo. Nessuna installazione avviata.',
  },
  en: {
    title: 'New headset? First installation',
    help: 'Set up a new HEADSET_BT. Sign in with service credentials to install the board firmware first, followed by Bluetooth firmware.',
    user: 'Service username',
    password: 'Password',
    start: 'Set up headset',
    next: 'Connect restarted headset',
    READY: 'Connect the new headset over USB to start.',
    DETECTED: 'A first-installation USB device was detected. Sign in to check it.',
    AUTHORIZING: 'Authorize USB access in the browser dialog.',
    OPENING_PACKAGE: 'Preparing protected firmware…',
    OPENING_DFU: 'Opening the DFU connection…',
    IDENTIFYING_MCU: 'Identifying the board…',
    CHECKING_BLANK: 'Checking the connected board…',
    INSTALLING_MCU: 'Installing board firmware…',
    VERIFYING_MCU: 'Verifying board firmware…',
    RESTARTING_MCU: 'Restarting the board…',
    WAITING_SERIAL:
      'Board firmware installed. Authorize the restarted headset USB port to complete Bluetooth setup.',
    INSTALLING_BLUETOOTH: 'Checking and installing Bluetooth firmware…',
    COMPLETE: 'Headset configured: board and Bluetooth firmware verified.',
    unsupported: 'First installation requires Chrome or Edge on a computer with USB access.',
    credentials: 'Incorrect service credentials. Enter the password again.',
    notBlank:
      'The board already contains firmware or different data. Use the normal connection to update it.',
    partial:
      'The board contains a partial installation of a different file. USB recovery with CubeProgrammer is required.',
    device: 'The selected board is incompatible with this first installation.',
    driver:
      'Cannot open USB. Close CubeProgrammer and other USB tools. Windows requires the WinUSB driver for the DFU device.',
    wrong: 'A different headset was selected. Choose the port of the board just configured.',
    failed:
      'Installation not completed. Keep the headset connected and retry; CubeProgrammer recovery remains available while the device is in DFU.',
    detail: 'Phase: {phase}. Code: {code}.',
    download: 'Cannot download firmware. Check the Internet connection and retry.',
    package:
      'The firmware package is invalid or does not match the catalog. Installation has not started.',
  },
};

export function mountFirstInstall({
  language,
  externalBusy,
  connected,
  changed,
  connectApplication,
  usb = globalThis.navigator?.usb,
  serial = globalThis.navigator?.serial,
  fetcher = globalThis.fetch,
  createDfu = (device, notify) => new Stm32Dfu(device, notify),
  sleep = pause,
  document = globalThis.document,
} = {}) {
  const $ = (id) => document.getElementById(id),
    panel = $('firstInstallPanel');
  if (!panel) return null;
  let phase = 'idle',
    state = 'READY',
    progress = 0,
    expected = null,
    connecting = false,
    message = null,
    failureDetail = null,
    inFlight = false;
  const api = {
    get busy() {
      return inFlight || ['running', 'waiting', 'bluetooth'].includes(phase);
    },
    render,
  };
  const t = () => copy[language() === 'it' ? 'it' : 'en'];
  const supported =
    !!usb?.requestDevice && !!serial?.requestPort && globalThis.isSecureContext !== false;
  function render() {
    const c = t();
    panel.hidden = connected() && phase === 'idle';
    $('firstInstallTitle').textContent = c.title;
    $('firstInstallHelp').textContent = c.help;
    $('firstInstallUserLabel').textContent = c.user;
    $('firstInstallPasswordLabel').textContent = c.password;
    $('firstInstallStart').textContent = c.start;
    $('firstInstallContinue').textContent = c.next;
    const status = !supported ? c.unsupported : message ? c[message] : c[state];
    // Mostra solo identificativi controllati, mai e.message arbitrario: un
    // errore esterno potrebbe contenere password o contenuti del pacchetto.
    $('firstInstallStatus').textContent =
      failureDetail && supported
        ? status +
          ' ' +
          c.detail.replace('{phase}', c[failureDetail.state]).replace('{code}', failureDetail.code)
        : status;
    $('firstInstallProgress').value = progress;
    $('firstInstallForm').hidden = ['waiting', 'bluetooth', 'complete'].includes(phase);
    $('firstInstallStart').disabled = !supported || api.busy || externalBusy() || connected();
    $('firstInstallUser').disabled = api.busy;
    $('firstInstallPassword').disabled = api.busy;
    $('firstInstallContinue').hidden = phase !== 'waiting';
    $('firstInstallContinue').disabled = connecting;
  }
  function update(next, value = progress) {
    state = next;
    progress = value;
    message = null;
    failureDetail = null;
    render();
    changed();
  }
  function failure(e, waiting = false) {
    phase = waiting ? 'waiting' : 'idle';
    const code = e?.message || '';
    const safeCode =
      /^(DFU_(?:DEVICE|DESCRIPTOR|TRANSFER|TIMEOUT|STATE|RANGE|VERIFY|NOT_BLANK|PARTIAL_IMAGE|STATUS_\d{1,3})|FACTORY_(?:CREDENTIALS|FORMAT|DOWNLOAD|WRONG_DEVICE|BOOT_UNCONFIRMED))$/.test(
        code,
      )
        ? code
        : [
              'NetworkError',
              'SecurityError',
              'NotSupportedError',
              'InvalidStateError',
              'NotFoundError',
              'AbortError',
              'TimeoutError',
              'TypeError',
            ].includes(e?.name)
          ? e.name
          : 'INSTALL_FAILED';
    failureDetail = { state, code: safeCode };
    message =
      code === 'FACTORY_CREDENTIALS'
        ? 'credentials'
        : code === 'FACTORY_DOWNLOAD' ||
            (state === 'OPENING_PACKAGE' &&
              ['TypeError', 'AbortError', 'TimeoutError'].includes(e?.name))
          ? 'download'
          : code === 'FACTORY_FORMAT'
            ? 'package'
            : code === 'DFU_NOT_BLANK'
              ? 'notBlank'
              : code === 'DFU_PARTIAL_IMAGE'
                ? 'partial'
                : code === 'DFU_DEVICE'
                  ? 'device'
                  : code === 'FACTORY_WRONG_DEVICE'
                    ? 'wrong'
                    : [
                          'NetworkError',
                          'SecurityError',
                          'NotSupportedError',
                          'InvalidStateError',
                        ].includes(e?.name) && state === 'OPENING_DFU'
                      ? 'driver'
                      : 'failed';
    render();
    changed();
  }
  async function finish(port) {
    if (!expected || phase !== 'waiting') return;
    phase = 'bluetooth';
    update('INSTALLING_BLUETOOTH', 90);
    try {
      await connectApplication(port, expected);
      phase = 'complete';
      expected = null;
      update('COMPLETE', 100);
    } catch (e) {
      failure(e, true);
    }
  }
  async function reuseAuthorized() {
    // getPorts non apre finestre: riusa il permesso soltanto se non c'e ambiguita.
    for (let i = 0; i < 20 && phase === 'waiting'; i++) {
      if (connecting) return;
      const ports = (await serial.getPorts()).filter((p) => {
        const info = p.getInfo();
        return info.usbVendorId === 0xcafe && info.usbProductId === 0x4011;
      });
      if (connecting || phase !== 'waiting') return;
      if (ports.length === 1) {
        connecting = true;
        render();
        try {
          await finish(ports[0]);
        } finally {
          connecting = false;
          render();
        }
        return;
      }
      await sleep(250);
    }
  }
  $('firstInstallForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!supported || api.busy || externalBusy() || connected()) return;
    const username = $('firstInstallUser').value.trim(),
      password = $('firstInstallPassword').value;
    $('firstInstallPassword').value = '';
    if (!username || !password) {
      message = 'credentials';
      failureDetail = null;
      render();
      return;
    }
    phase = 'running';
    inFlight = true;
    panel.open = true;
    update('AUTHORIZING', 0);
    let dfu, opened;
    try {
      // Deve essere la PRIMA chiamata asincrona del click: WebUSB richiede user gesture.
      const device = await usb.requestDevice({ filters: [DFU_FILTER] });
      update('OPENING_PACKAGE', 1);
      const download = await fetchFactoryPackage(fetcher);
      opened = await openFactoryPackage(download.raw, username, password);
      if (opened.version !== download.manifest.version) throw new Error('FACTORY_FORMAT');
      dfu = createDfu(device, (e) => update(e.state, e.progress));
      update('OPENING_DFU', 1);
      await dfu.open();
      const result = await dfu.install(opened.image);
      expected = { uid: result.uid, version: opened.version };
      phase = 'waiting';
      update('WAITING_SERIAL', 85);
    } catch (e) {
      if (e?.name === 'NotFoundError' && state === 'AUTHORIZING') {
        phase = 'idle';
        update('READY', 0);
      } else failure(e);
    } finally {
      opened?.image.fill(0);
      await dfu?.close();
      inFlight = false;
      render();
      changed();
    }
    if (phase === 'waiting') void reuseAuthorized().catch((e) => failure(e, true));
  });
  $('firstInstallContinue').addEventListener('click', async () => {
    if (phase !== 'waiting' || connecting) return;
    connecting = true;
    render();
    try {
      const port = await serial.requestPort({
        filters: [{ usbVendorId: 0xcafe, usbProductId: 0x4011 }],
      });
      await finish(port);
    } catch (e) {
      if (e?.name !== 'NotFoundError') failure(e, true);
    } finally {
      connecting = false;
      render();
    }
  });
  async function detect() {
    if (!supported || api.busy || connected() || !usb.getDevices) return;
    const devices = await usb.getDevices();
    if (api.busy || connected() || externalBusy()) return;
    if (
      devices.some(
        (d) => d.vendorId === DFU_FILTER.vendorId && d.productId === DFU_FILTER.productId,
      )
    ) {
      panel.open = true;
      update('DETECTED');
    }
  }
  usb?.addEventListener?.('connect', () => {
    void detect().catch(() => {});
  });
  void detect().catch(() => {});
  render();
  return api;
}
