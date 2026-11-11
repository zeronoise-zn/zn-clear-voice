import { inspectPackage, UpdateError } from './znfw.js';
import { SerialTransport } from './serial-transport.js';
import { FirmwareUpdater, diagnosticLine } from './fw-updater.js';
import { profileByName } from './product-profiles.js';
import { inspectBm83Image } from './bm83-image.js';
import { Bm83Updater } from './bm83-updater.js';
import { Bm83FlashUpdater,planBm83Flash } from './bm83-flash.js';
import {latestBm83Backup} from './bm83-backup.js';
import {Bm83AutoUpdater} from './bm83-auto.js';

const PRODUCT_DISPLAY_NAMES = new Map([
  ['ClearVoice', 'ClearVoice Portable Unit'],
  ['HEADSET_BT', 'HEADSET_BT']
]);

export function startUi(translations, config) {
  const $ = id => document.getElementById(id);
  const localText = {
    en: ['Signed firmware (.znfw)', 'Device firmware will be updated. Do not disconnect USB or power during the operation. Continue?', 'Structure and SHA-256 checked; the bootloader verifies the signature.', 'ClearVoice recovery (not STM32 ROM)', 'Select a signed .znfw package or a compatible release.'],
    it: ['Firmware firmato (.znfw)', 'Il firmware del dispositivo sarà aggiornato. Non scollegare USB o alimentazione durante l’operazione. Continuare?', 'Struttura e SHA-256 controllati; il bootloader verifica la firma.', 'Recovery ClearVoice (non ROM STM32)', 'Seleziona un package .znfw firmato o una release compatibile.'],
    de: ['Signierte Firmware (.znfw)', 'Die Firmware wird aktualisiert. USB und Stromversorgung nicht trennen. Fortfahren?', 'Struktur und SHA-256 geprüft; der Bootloader prüft die Signatur.', 'ClearVoice Recovery (nicht STM32 ROM)', 'Signiertes .znfw-Paket oder kompatible Version auswählen.'],
    fr: ['Firmware signé (.znfw)', 'Le firmware sera mis à jour. Ne débranchez ni USB ni alimentation. Continuer ?', 'Structure et SHA-256 contrôlés ; le bootloader vérifie la signature.', 'Recovery ClearVoice (pas ROM STM32)', 'Sélectionnez un package .znfw signé ou une version compatible.'],
    es: ['Firmware firmado (.znfw)', 'Se actualizará el firmware. No desconectes USB ni alimentación. ¿Continuar?', 'Estructura y SHA-256 comprobados; el bootloader verifica la firma.', 'Recovery ClearVoice (no ROM STM32)', 'Selecciona un paquete .znfw firmado o una versión compatible.']
  };
  for (const [language, a] of Object.entries(localText)) Object.assign(translations[language], {
    localFirmware: a[0], confirmUpdate: a[1], advancedWarning: a[2], alreadyBootloader: a[3], subtitle: a[4],
    shaVerified: 'Authenticated .znfw', stepFlashSub: '.znfw transport', stepVerifySub: 'Bootloader SHA-256 / Ed25519'
  });
  // Shared copy covers both policies. Package details show the actual policy.
  const sharedCopy = {
    en:['Firmware (.znfw)','Select a .znfw package or compatible release.','Structure and SHA-256 checked. ClearVoice requires a signature; HEADSET_BT uses unsigned packages.'],
    it:['Firmware (.znfw)','Seleziona un pacchetto .znfw o una release compatibile.','Struttura e SHA-256 controllati. ClearVoice richiede la firma; HEADSET_BT usa pacchetti senza firma.'],
    de:['Firmware (.znfw)','Ein .znfw-Paket oder eine kompatible Version auswählen.','Struktur und SHA-256 geprüft. ClearVoice erfordert eine Signatur; HEADSET_BT verwendet unsignierte Pakete.'],
    fr:['Firmware (.znfw)','Sélectionnez un paquet .znfw ou une version compatible.','Structure et SHA-256 vérifiés. ClearVoice exige une signature ; HEADSET_BT utilise des paquets non signés.'],
    es:['Firmware (.znfw)','Selecciona un paquete .znfw o una versión compatible.','Estructura y SHA-256 comprobados. ClearVoice requiere firma; HEADSET_BT usa paquetes sin firma.']
  };
  for (const [language, a] of Object.entries(sharedCopy)) Object.assign(translations[language], {
    localFirmware:a[0],subtitle:a[1],advancedWarning:a[2],shaVerified:'.znfw / SHA-256',stepVerifySub:'SHA-256 / device policy'
  });
  let language = localStorage.getItem('zn-updater-lang') || navigator.language.slice(0,2);
  if (!translations[language]) language = 'en';
  const t = key => translations[language][key] || translations.en[key] || key;
  let io = null, updater = null, pkg = null, catalog = [], target = null, fileGeneration = 0;
  let selecting = false, manifestLoading = false, selectionError = false, packageSource = null;
  let lastAttempt = null;
  let applicationDiagnostics = {};
  let bm83=null, bm83Flash=null, bm83Image=null, bm83FlashImage=null, bm83Selecting=false, bm83UsbBlock=0;
  let bm83Auto=null,bm83AutoAttempted=false,manualDisconnected=false;
  $('bm83AutoEnable').checked=localStorage.getItem('zn-bm83-auto')!=='0';
  const bm83Log=[];let bm83LogBytes=0,bm83LogDropped=0,bm83LogRender=0;
  function bm83Record(event) {
    const record={time:new Date().toISOString(),...event,error:event.error instanceof Error?event.error.message:event.error};
    const line=JSON.stringify(record);bm83Log.push(line);bm83LogBytes+=line.length;
    while(bm83LogBytes>8*1024*1024){bm83LogBytes-=bm83Log.shift().length;bm83LogDropped++;}
    if(!bm83LogRender)bm83LogRender=setTimeout(()=>{
      bm83LogRender=0;const node=$('bm83Log');
      node.textContent=bm83Log.slice(-140).join('\n');node.scrollTop=node.scrollHeight;
    },100);
  }
  const log = (message, detail = '') => {
    const node = $('technicalLog'); node.textContent = (node.textContent + `\n${new Date().toISOString()} ${message} ${detail}`).slice(-524288);
    node.scrollTop = node.scrollHeight;
  };
  const busy = () => selecting || manifestLoading || updater?.busy || bm83?.busy || bm83Flash?.busy || bm83Auto?.busy || bm83Selecting;
  function trace(direction,detail) {
    if(bm83Flash?.busy && /^(?:ZN_BM83_(?:TX |RX\?|READ |CHUNK )|\[BM83\] (?:DATA=|READ=|TX=OK|CHUNK=))/.test(detail))return;
    log(direction,detail);
    if (direction === 'TX' && detail.includes('ZN_STATS?')) {
      applicationDiagnostics = {};
      $('diagnosticInfo').textContent = 'Waiting for a fresh runtime snapshot...';
    }
    if (direction === 'RX') {
      const parsed = diagnosticLine(detail);
      if (parsed) {
        applicationDiagnostics[parsed.section] = parsed.fields;
        $('diagnosticInfo').textContent = JSON.stringify(applicationDiagnostics,null,2);
      }
    }
  }
  function controls() {
    const connected = !!io?.connected, locked = !!busy();
    $('connectButton').disabled = locked || !navigator.serial || !isSecureContext;
    $('updateButton').disabled = !connected || locked || selectionError || (pkg && !pkg.identity) || (!pkg && !target);
    $('refreshReleaseButton').disabled = locked;
    $('localFirmwareInput').disabled = locked;
    const versionSelect = $('firmwareVersionSelect'); if (versionSelect) versionSelect.disabled = locked || !target;
    $('abortButton').disabled = !connected || (!['BEGIN_UPDATE','SENDING'].includes(updater?.state) &&
      (locked || updater?.info?.mode !== 'bootloader' || updater?.bootState !== 3));
    $('restartButton').disabled = !connected || locked || updater?.info?.mode !== 'bootloader' || [3,4].includes(updater?.bootState);
    $('diagnosticsButton').disabled = !connected || locked;
    const headset=updater?.info?.product==='HEADSET_BT' && updater?.info?.mode==='application';
    $('bm83Panel').hidden=!headset;
    $('bm83File').disabled=locked;
    $('bm83Probe').disabled=!connected || locked || !headset;
    const bridgeReady=[1,2,3].includes(updater?.info?.bm83_bridge);
    $('bm83Reset').disabled=!connected || locked || !headset || !bridgeReady;
    const testMode=$('bm83Protocol').value==='TEST';
    $('bm83Update').disabled=!connected || locked || !headset || !bm83Image || !bridgeReady || testMode && (!bm83FlashImage || updater?.info?.bm83_bridge!==3);
    $('bm83FastProbe').disabled=!connected || locked || !headset || ![2,3].includes(updater?.info?.bm83_bridge);
    $('bm83Protocol').disabled=locked;
    $('bm83Cancel').disabled=!bm83Flash?.busy&&!bm83Auto?.busy;
    $('bm83AutoEnable').disabled=locked;
    $('bm83AutoRun').disabled=!connected||locked||!headset;
    $('bm83Baud').disabled=locked;
    $('connectionPill').classList.toggle('online', connected); $('connectionPill').classList.toggle('offline', !connected);
    $('deviceIcon').classList.toggle('online', connected);
    $('connectionPill').querySelector('[data-i18n]').textContent = connected ? 'Connected: USB serial device' : t('usbDisconnected');
    $('connectButton').querySelector('[data-i18n]').textContent = connected ? t('disconnect') : t('connect');
    const wasLocked = window.__ZN_UPDATER_BUSY__;
    window.__ZN_UPDATER_BUSY__ = locked; window.__ZN_UPDATER_LOCAL__ = packageSource === 'local';
    if (wasLocked && !locked) queueMicrotask(() => window.__ZN_REFRESH_VERSIONS__?.());
  }
  function renderInfo(info) {
    $('productValue').textContent = PRODUCT_DISPLAY_NAMES.get(info?.product) || info?.product || '—';
    $('mcuValue').textContent = profileByName(info?.product)?.mcu || '—';
    $('hardwareValue').textContent = info?.hardware || '—';
    $('installedValue').textContent = $('currentVersionValue').textContent = info?.displayId || info?.version || (info?.mode === 'bootloader' ? 'Recovery' : '—');
    $('serialValue').textContent = 'Not reported';
    if (info?.bootBuildId) log('Bootloader identity (not application)', info.bootBuildId);
    evaluateTarget();
  }
  function notify(event) {
    const label = {COMPLETE:'UPDATE COMPLETE',TRANSFER_COMPLETE:'TRANSFER COMPLETE',VERIFYING:'BOOTLOADER VERIFYING',
      FINALIZING:'REBOOTING',FAILED_RECOVERY:'UPDATE NOT CONFIRMED'}[event.state] || event.state;
    $('progressLabel').textContent = label;
    $('progressDetail').textContent = event.error?.message || event.notice || (event.info?.displayId ?? '');
    // A previous success is historical, never the current device state.
    $('releaseBadge').textContent = label;
    $('releaseBadge').className = `release-badge ${event.state === 'COMPLETE' ? 'current' : event.state.startsWith('FAILED') ? 'error' : 'neutral'}`;
    if (event.state === 'BEGIN_UPDATE') $('transferStatus').textContent = 'TRANSFER IN PROGRESS';
    if (event.state === 'TRANSFER_COMPLETE') $('transferStatus').textContent = 'TRANSFER COMPLETE — boot verification pending';
    if (event.state === 'FINALIZING' && lastAttempt) lastAttempt.endAccepted = true;
    if (event.state !== 'COMPLETE') $('installationStatus').textContent = 'UPDATE NOT CONFIRMED';
    if (event.diagnostics) {
      $('diagnosticInfo').textContent = JSON.stringify(event.diagnostics,null,2);
      log('RECOVERY DIAGNOSTICS', JSON.stringify(event.diagnostics));
    }
    if (event.runtime) {
      $('diagnosticInfo').textContent = JSON.stringify({...applicationDiagnostics,RUNTIME:event.runtime},null,2);
      log('RUNTIME SNAPSHOT', JSON.stringify(event.runtime));
    }
    if (event.total) {
      const p = Math.floor(event.offset * 100 / event.total);
      $('progressPercent').textContent = `${p}%`; $('progressBar').style.width = `${p}%`;
      $('progressBytes').textContent = `${event.offset} / ${event.total} bytes`;
      $('progressDetail').textContent = `Acknowledged image offset ${event.offset}`;
    }
    if (event.state === 'COMPLETE') {
      $('progressPercent').textContent = '100%'; $('progressBar').style.width = '100%';
      $('releaseBadge').textContent = 'UPDATE COMPLETE'; $('releaseBadge').className = 'release-badge current';
      $('transferStatus').textContent = 'TRANSFER COMPLETE — END accepted';
      $('installationStatus').textContent = 'UPDATE COMPLETE — installed identity matched, BootConfirm observed';
      $('progressDetail').textContent = `${event.info.displayId} — full identity matched; CONFIRMED=1 observed.`;
    }
    if (event.info) renderInfo(event.info);
    if (event.info?.mode === 'bootloader' || event.state === 'FAILED_RECOVERY') {
      $('releaseBadge').textContent = 'UPDATE NOT CONFIRMED'; $('releaseBadge').className = 'release-badge error';
      $('installationStatus').textContent = 'UPDATE NOT CONFIRMED — device is in recovery mode';
      $('progressDetail').textContent = event.error?.message || 'Recovery detected. Application boot is not verified.';
    }
    if (event.bootState === 3) $('progressDetail').textContent = 'Interrupted transfer: use Abort before a new update.';
    if (event.bootState === 5) $('progressDetail').textContent = 'Package committed: use Restart device. Abort cannot undo commit.';
    const current = ['BEGIN_UPDATE','SENDING'].includes(event.state) ? 2 : event.state === 'VERIFYING' ? 3 :
      ['FINALIZING','WAITING_FOR_APPLICATION','VERIFYING_INSTALLED_VERSION','WAITING_BOOT_CONFIRM','COMPLETE'].includes(event.state) ? 4 : event.state === 'CONNECTED' ? 1 : 0;
    document.querySelectorAll('.step').forEach((el,i) => { el.classList.toggle('active', i === current); el.classList.toggle('done', i < current || event.state === 'COMPLETE'); });
    if (!event.total) log(event.state, event.error?.message || '');
    controls();
  }
  function error(e) {
    const label = e.code === 'APPLICATION_DID_NOT_START' ? 'UPDATE NOT CONFIRMED' : 'FAILED';
    $('progressLabel').textContent = label; $('progressDetail').textContent = e.message;
    $('releaseBadge').textContent = label; $('releaseBadge').className = 'release-badge error';
    $('installationStatus').textContent = `UPDATE NOT CONFIRMED — ${e.message}`;
    log('Error', e.message); controls();
  }
  function showPackage(value) {
    const out = $('packageInfo');
    if (!value) { out.textContent = 'No package selected.'; return; }
    out.textContent = `${value.filename}\n${value.bytes.length} bytes · Firmware ${value.version}\nPackage SHA256: ${value.packageHash}\nPayload: ${value.imageSize} bytes · SHA256 OK\nProduct: ${value.productName} · HW mask 0x${value.hardwareMask.toString(16)}${value.hardwareMask & 1 ? ' (REV01 compatible)' : ''}\nMinimum bootloader: ${value.minimumBootloader >>> 24}.${(value.minimumBootloader >>> 16) & 255}.${value.minimumBootloader & 65535}\nPackage: structure / hash VALID. ${value.signatureRequired ? 'Signature validation pending on device.' : 'HEADSET_BT unsigned package; SHA-256 checked.'}`;
    out.textContent += value.identity ? `\nCompiled identity: ${value.identity.buildId}\nGit: ${value.identity.git}` : '\nCompiled identity UNKNOWN: current ABI not uniquely recognized; update disabled.';
    $('latestVersionValue').textContent = value.version;
  }
  function evaluateTarget() {
    const info = updater?.info;
    const compatible = catalog.filter(x => x.product === info?.product && (!x.hardware || x.hardware === '*' ||
      (Array.isArray(x.hardware) ? x.hardware.includes(info.hardware) : x.hardware === info.hardware)));
    const selected = sessionStorage.getItem('zn-updater-fw-version');
    target = compatible.find(x => x.version === selected) || compatible[0] || null;
    if (!pkg) $('latestVersionValue').textContent = target?.version || '—';
    controls();
  }
  async function loadManifest() {
    if (busy()) return;
    if (packageSource === 'release') { pkg = null; packageSource = null; showPackage(null); }
    manifestLoading = true; target = null; controls();
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
    try {
      const r = await fetch(`${config.manifestUrl}?v=${Date.now()}`, { cache: 'no-store', signal: controller.signal });
      if (!r.ok) throw new Error(`Manifest HTTP ${r.status}`);
      const data = await r.json();
      catalog = (data.targets || []).filter(x => x.format === 'znfw' && /\.znfw(?:$|[?#])/i.test(x.url || '') && /^[a-f0-9]{64}$/i.test(x.sha256 || ''));
      $('releaseBadge').textContent = catalog.length ? t('repositoryReady') : 'Select a local .znfw';
      $('releaseNotes').textContent = 'Select a package for the detected product. ClearVoice requires a signature; HEADSET_BT uses SHA-256.';
      evaluateTarget();
    } catch (e) { log('Manifest unavailable', e.message); catalog = []; evaluateTarget(); }
    finally { clearTimeout(timer); manifestLoading = false; controls(); }
  }
  $('localFirmwareInput').addEventListener('change', async () => {
    const generation = ++fileGeneration, file = $('localFirmwareInput').files[0];
    pkg = null; packageSource = null; selectionError = false; selecting = true; showPackage(null); controls();
    try {
      if (file) {
        if (file.size > 0x37800 + 128) throw new UpdateError('INVALID_ZNFW', 'Package exceeds device maximum.');
        const checked = await inspectPackage(await file.arrayBuffer(), file.name);
        if (generation === fileGeneration) { pkg = checked; packageSource = 'local'; showPackage(pkg); }
      }
    } catch (e) { selectionError = true; $('packageInfo').textContent = e.message; error(e); }
    finally { selecting = false; evaluateTarget(); }
  });
  async function openConnection(port) {
      if (io) await io.close();
      if (lastAttempt && lastAttempt.port !== port) {
        log('UPDATE EVIDENCE', 'Selected port differs from the update port; previous END acceptance discarded.');
        lastAttempt = null;
      }
      applicationDiagnostics = {};
      io = new SerialTransport(port, e => { log('Serial disconnected', e.message); invalidateConnection(); controls(); }, trace, config.appBaudRate);
      updater = new FirmwareUpdater(io, notify);
      bm83 = new Bm83Updater(io,bm83Notify);
      bm83Flash = new Bm83FlashUpdater(io,bm83Notify);
      bm83Auto=new Bm83AutoUpdater(bm83Flash,bm83Notify);
      bm83AutoAttempted=false;
      await updater.connect(lastAttempt?.pkg || null, !!lastAttempt?.endAccepted);
  }
  async function automaticBm83(force=false) {
    if(busy()||!io?.connected||!bm83Auto||updater?.info?.product!=='HEADSET_BT'||updater.info.mode!=='application'||
       (!force&&(!$('bm83AutoEnable').checked||bm83AutoAttempted)))return;
    bm83AutoAttempted=true;
    try {const pending=bm83Auto.run(updater.info);controls();await pending;}
    catch(e){bm83Notify({state:'BM83_AUTO_FAILED',error:e});}
    finally {controls();}
  }
  async function automaticConnection() {
    if(busy()||io?.connected||manualDisconnected||!$('bm83AutoEnable').checked||!navigator.serial?.getPorts||!isSecureContext)return;
    try {
      const ports=(await navigator.serial.getPorts()).filter(p=>{const v=p.getInfo();return v.usbVendorId===0xcafe&&v.usbProductId===0x4011;});
      if(ports.length!==1||busy()||io?.connected)return;
      selecting=true;controls();
      try {await openConnection(ports[0]);}
      finally {selecting=false;controls();}
      await automaticBm83();
    } catch(e){if(io)await io.close();invalidateConnection();log('Auto connection',e.message);controls();}
  }
  $('connectButton').addEventListener('click', async () => {
    if (busy()) return;
    if (io?.connected) { manualDisconnected=true;await io.close();io=null;updater=null;invalidateConnection();controls();return; }
    selecting = true; controls();
    try {
      const port=await navigator.serial.requestPort({filters:config.usbFilters});
      manualDisconnected=false;await openConnection(port);
    } catch (e) { if (io) await io.close(); error(e); }
    finally { selecting = false; controls(); }
    await automaticBm83();
  });
  $('updateButton').addEventListener('click', async () => {
    if (busy()) return;
    if (selectionError) { error(new UpdateError('INVALID_ZNFW', 'Select a valid .znfw package first.')); return; }
    if (!io?.connected) { error(new UpdateError('SERIAL_NOT_CONNECTED')); return; }
    try {
      if (!pkg) {
        if (!target) throw new UpdateError('INVALID_ZNFW', 'Select a .znfw package.');
        const release = target; selecting = true; controls();
        try {
          const r = await fetch(release.url, { cache: 'no-store' });
          if (!r.ok) throw new Error(`Download HTTP ${r.status}`);
          const blob = await r.blob();
          if (blob.size > 0x37800 + 128) throw new UpdateError('INVALID_ZNFW', 'Package exceeds device maximum.');
          const checked = await inspectPackage(await blob.arrayBuffer(), new URL(release.url, location.href).pathname.split('/').pop());
          if (checked.packageHash !== release.sha256.toLowerCase()) throw new UpdateError('INVALID_ZNFW', 'Release SHA256 mismatch');
          pkg = checked; packageSource = 'release'; showPackage(pkg);
        } finally { selecting = false; controls(); }
      }
      if (!confirm(t('confirmUpdate'))) return;
      lastAttempt = {pkg,endAccepted:false,port:io.port};
      log('UPDATE ATTEMPT', `package=${pkg.packageHash} identity=${pkg.identity?.buildId || 'UNKNOWN'}`);
      await updater.run(pkg);
      await automaticBm83();
    } catch (e) { error(e); }
    finally { controls(); }
  });
  $('abortButton').addEventListener('click', async () => {
    if (updater?.busy) { updater.cancel(); $('progressDetail').textContent = 'Abort requested; waiting for the current command acknowledgement.'; return; }
    try { await updater.abort(); } catch (e) { error(e); }
  });
  $('restartButton').addEventListener('click', async () => { try { await updater.restart(); } catch (e) { error(e); } });
  $('diagnosticsButton').addEventListener('click', async () => { try { await updater.readDiagnostics(); } catch (e) { error(e); } });
  $('downloadLogButton').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([$('technicalLog').textContent],{type:'text/plain;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = `clearvoice-update-${new Date().toISOString().replace(/[:.]/g,'-')}.txt`;
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  function bm83Notify(event) {
    bm83Record(event);
    if(event.kind==='SESSION')bm83UsbBlock=0;
    if(event.kind==='TRANSFER_MODE')bm83UsbBlock=event.usbBlock;
    if(event.state==='BM83_LOG')return;
    const version=v=>v?.join('.')||'assente / non leggibile';
    if(event.state==='BM83_ONLINE_REFERENCE')$('bm83Online').textContent=`Web REV${event.revision}: MCU ${version(event.versions.MCU)} · DSP ${version(event.versions.DSP)}`;
    if(event.state==='BM83_INSTALLED')$('bm83Installed').textContent=event.validHeader?`Flash installata: MCU ${version(event.mcu)} · DSP ${version(event.dsp)}. Confronto configurazione in corso.`:'Immagine assente o incompleta: prima installazione / recupero.';
    log(event.state,event.error?.message || event.part || '');
    const p=event.total?Math.floor(100*event.offset/event.total):null;
    if(p!==null)$('bm83Progress').value=p;
    const states={BM83_CATALOG_LOADING:'Ricerca firmware BM83 sul web...',BM83_IMAGE_DOWNLOADING:'Download firmware BM83...',
      BM83_ONLINE_REFERENCE:'Riferimento web verificato; confronto con la Flash BM83...',BM83_INSTALLED:'Lettura firmware installato; confronto dati...',
      BM83_UP_TO_DATE:'BM83 gia aggiornato al riferimento web: nessuna riscrittura.',BM83_AUTO_FAILED:'Verifica/aggiornamento automatico interrotto.',
      BM83_CONNECTING:'Collegamento al BM83...',BM83_START:'Avvio aggiornamento BM83...',
      BM83_POWERING_ON:'Accensione BM83 via UART e attesa standby...',BM83_LEAVING_PAIRING:'Uscita dal pairing e attesa standby...',
      BM83_COMPARING:`Confronto settori ${event.part || ''}: ${p ?? 0}%`,BM83_FLASHING:`Scrittura ${event.part || ''}: ${p ?? 0}%`,
      BM83_FLASH_VERIFY:`Confronto dati riletti ${event.part || ''}: ${p ?? 0}%`,
      BM83_SENDING:`Invio ${event.part || ''}: ${p ?? 0}%`,BM83_VALIDATING:`Verifica CRC ${event.part || ''} sul BM83...`,
      BM83_REBOOTING:'Riavvio BM83...',BM83_COMPLETE:'Immagini validate dal BM83; versioni MCU/DSP corrispondenti dopo il riavvio.',
      BM83_REBOOT_UNVERIFIED:'Trasferimento terminato; riavvio BM83 non verificato.',BM83_FAILED:'Aggiornamento BM83 non completato.'};
    $('bm83Status').textContent=event.error?.message || (event.state==='BM83_COMPLETE' && event.readbackVerified?'Flash verificata; calibrazione conservata. TEST flottante, Q1 spento. Avvio Embedded: accendi con MFB e verifica Bluetooth/audio.':states[event.state]) || event.state;
    if(event.state==='BM83_COMPLETE'){
      $('bm83Progress').value=100;
      if(event.readbackVerified)$('bm83Installed').textContent=`Flash verificata: MCU ${version(event.expectedVersions?.MCU)} ? DSP ${version(event.expectedVersions?.DSP)}. Configurazione aggiornata.`;
    }
    if(event.state==='BM83_UP_TO_DATE'){$('bm83Progress').value=100;$('bm83Installed').textContent='Firmware e configurazione installati corrispondono al riferimento web.';}
    if(event.bytesPerSecond!==undefined)$('bm83Rate').textContent=`UART MCU DFU: 115.200 baud · velocità media utile ${event.bytesPerSecond} byte/s · tempo ${(event.elapsedMs/1000).toFixed(1)} s`;
    else if(event.baud)$('bm83Rate').textContent=`UART TEST: ${event.baud.toLocaleString('it-IT')} baud${bm83UsbBlock?' · blocchi '+bm83UsbBlock+' byte · gestione '+(bm83UsbBlock===4096?'STM32':'browser'):''} · tempo ${(event.elapsedMs/1000).toFixed(1)} s`;
    controls();
  }
  $('bm83File').addEventListener('change',async()=>{
    if(busy())return;
    bm83Image=null;bm83FlashImage=null;bm83Selecting=true;$('bm83Progress').value=0;controls();
    try {
      const file=$('bm83File').files[0];
      if(!file){$('bm83Status').textContent='Seleziona un file Rehex BM83 General Use (.hex).';return;}
      if(file.size>8*1024*1024)throw new Error('File BM83 troppo grande.');
      const text=await file.text();
      bm83Image=await inspectBm83Image(text,file.name);
      bm83FlashImage=await planBm83Flash(text,file.name);
      $('bm83Status').textContent=`${file.name}: ${bm83Image.images.map(i=>i.name).join(' + ')}; ${bm83Image.total} byte. Checksum HEX verificati; CRC da validare sul BM83. SHA-256: ${bm83Image.sha256}`;
    } catch(e) { $('bm83Status').textContent=e.message;log('BM83 FILE',e.message);bm83Record({kind:'FILE_ERROR',error:e}); }
    finally {bm83Selecting=false;controls();}
  });
  $('bm83Probe').addEventListener('click',async()=>{
    if(busy() || !bm83)return;
    try {
      const pending=bm83.probe();controls();
      const version=await pending;
      $('bm83Status').textContent=`BM83 risponde. Protocollo UART ${version}. Questo valore non identifica il firmware audio installato.`;
    } catch(e) {$('bm83Status').textContent=e.message;log('BM83 PROBE',e.message);bm83Record({kind:'PROBE_ERROR',error:e});}
    finally {controls();}
  });
  $('bm83Update').addEventListener('click',async()=>{
    if(busy() || !bm83Image || !bm83)return;
    if(!confirm('Aggiornare il firmware audio BM83? Interrompi chiamate e riproduzione, mantieni il modulo alimentato e non scollegare USB.'))return;
    $('bm83Progress').value=0;
    try {const pending=$('bm83Protocol').value==='TEST'?bm83Flash.run(bm83FlashImage,{baud:Number($('bm83Baud').value)}):bm83.run(bm83Image);controls();await pending;}
    catch(e) {$('bm83Status').textContent=e.message;log('BM83 UPDATE',e.message);}
    finally {controls();}
  });
  $('bm83Protocol').addEventListener('change',()=>{
    $('bm83Rate').textContent=$('bm83Protocol').value==='TEST'?`Programmazione TEST: UART ${Number($('bm83Baud').value).toLocaleString('it-IT')} baud; richiede bridge v3.`:'MCU DFU: UART 115.200 baud. Il precedente collaudo ha segnalato un rifiuto CONFIG.';
    controls();
  });
  $('bm83Baud').addEventListener('change',()=>{
    if($('bm83Protocol').value==='TEST')$('bm83Rate').textContent=`Programmazione TEST: UART ${Number($('bm83Baud').value).toLocaleString('it-IT')} baud.`;
  });
  $('bm83Cancel').addEventListener('click',()=>bm83Auto?.busy?bm83Auto.cancel():bm83Flash?.cancel());
  $('bm83AutoRun').addEventListener('click',()=>automaticBm83(true));
  $('bm83AutoEnable').addEventListener('change',()=>{
    localStorage.setItem('zn-bm83-auto',$('bm83AutoEnable').checked?'1':'0');
    if($('bm83AutoEnable').checked){manualDisconnected=false;void(io?.connected?automaticBm83(true):automaticConnection());}
  });
  $('bm83BackupDownload').addEventListener('click',async()=>{
    try {
      const backup=await latestBm83Backup();
      if(!backup)throw new Error('Nessun backup BM83 salvato in questo browser.');
      const url=URL.createObjectURL(new Blob([backup.bytes],{type:'application/octet-stream'}));
      const a=document.createElement('a');a.href=url;a.download=`bm83-backup-${backup.metadata.calibrationSha256.slice(0,12)}-${backup.id}.bin`;a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(e){$('bm83Status').textContent=e.message;}
  });
  $('bm83Reset').addEventListener('click',async()=>{
    if(busy() || !bm83)return;
    try {
      const pending=bm83.recover();controls();
      const version=await pending;
      $('bm83Status').textContent=`BM83 riavviato; protocollo UART ${version}.`;
    } catch(e) {$('bm83Status').textContent=e.message;log('BM83 RESET',e.message);}
    finally {controls();}
  });
  $('bm83FastProbe').addEventListener('click',async()=>{
    if(busy() || !bm83)return;
    if(!confirm('La prova interrompe audio e Bluetooth e riavvia il BM83. Procedere?'))return;
    try {
      const pending=bm83.testUart(Number($('bm83Baud').value));controls();
      const result=await pending;
      $('bm83Status').textContent=`UART TEST verificata a ${result.baud} baud: ${result.identificationRounds} letture ROM/Flash, ID ${result.flashId}. ${result.guarded?'BM83 protetto in reset: ripeti il caricamento per recuperarlo.':'BM83 tornato in modalità normale.'} Nessuna Flash scritta durante questa prova.`;
    }catch(e){$('bm83Status').textContent=e.message;bm83Record({kind:'FAST_UART_ERROR',error:e});}
    finally{controls();}
  });
  $('bm83DownloadLog').addEventListener('click',()=>{
    const content=JSON.stringify({kind:'LOG_HEADER',format:1,exportedAt:new Date().toISOString(),droppedRecords:bm83LogDropped,
      source:location.origin+location.pathname})+'\n'+bm83Log.join('\n')+'\n';
    const url=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=`headset-bm83-${new Date().toISOString().replace(/[:.]/g,'-')}.jsonl`;
    a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  $('refreshReleaseButton').addEventListener('click', loadManifest);
  $('languageSelect').addEventListener('change', () => { language = $('languageSelect').value; localStorage.setItem('zn-updater-lang', language); applyLanguage(); });
  navigator.serial?.addEventListener('disconnect', e => {
    if ((e.port || e.target) === io?.port) io.fail(new UpdateError('SERIAL_DISCONNECTED', 'USB device removed.'));
  });
  navigator.serial?.addEventListener('connect',()=>void automaticConnection());
  function invalidateConnection() {
    bm83Auto?.cancel();
    $('releaseBadge').textContent = 'DEVICE DISCONNECTED'; $('releaseBadge').className = 'release-badge neutral';
    $('installationStatus').textContent = 'UPDATE NOT CURRENTLY VERIFIED — reconnect to read device state';
    $('progressLabel').textContent = 'DISCONNECTED';
    $('installedValue').textContent = $('currentVersionValue').textContent = '—';
  }
  function applyLanguage() {
    document.documentElement.lang = language; $('languageSelect').value = language;
    document.querySelectorAll('[data-i18n]').forEach(el => {
      if (!['releaseBadge','progressLabel','progressDetail'].includes(el.id)) el.textContent = t(el.dataset.i18n);
    }); controls();
  }
  applyLanguage();
  if (!navigator.serial || !isSecureContext) { $('browserWarning').classList.remove('hidden'); $('connectButton').disabled = true; }
  void loadManifest().finally(()=>automaticConnection());
}
