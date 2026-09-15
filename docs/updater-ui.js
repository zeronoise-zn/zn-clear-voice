import { inspectPackage, UpdateError } from './znfw.js';
import { SerialTransport } from './serial-transport.js';
import { FirmwareUpdater, diagnosticLine } from './fw-updater.js';

const PRODUCT_DISPLAY_NAMES = new Map([
  ['ClearVoice', 'ClearVoice Portable Unit']
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
  let language = localStorage.getItem('zn-updater-lang') || navigator.language.slice(0,2);
  if (!translations[language]) language = 'en';
  const t = key => translations[language][key] || translations.en[key] || key;
  let io = null, updater = null, pkg = null, catalog = [], target = null, fileGeneration = 0;
  let selecting = false, manifestLoading = false, selectionError = false, packageSource = null;
  let lastAttempt = null;
  let applicationDiagnostics = {};
  const log = (message, detail = '') => {
    const node = $('technicalLog'); node.textContent = (node.textContent + `\n${new Date().toISOString()} ${message} ${detail}`).slice(-524288);
    node.scrollTop = node.scrollHeight;
  };
  const busy = () => selecting || manifestLoading || updater?.busy;
  function trace(direction,detail) {
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
    out.textContent = `${value.filename}\n${value.bytes.length} bytes · Firmware ${value.version}\nPackage SHA256: ${value.packageHash}\nPayload: ${value.imageSize} bytes · SHA256 OK\nProduct: ClearVoice · HW mask 0x${value.hardwareMask.toString(16)}${value.hardwareMask & 1 ? ' (REV01 compatible)' : ''}\nMinimum bootloader: ${value.minimumBootloader >>> 24}.${(value.minimumBootloader >>> 16) & 255}.${value.minimumBootloader & 65535}\nPackage: structure / hash VALID. Signature validation pending on device.`;
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
      $('releaseBadge').textContent = catalog.length ? t('repositoryReady') : 'Select a local signed .znfw';
      $('releaseNotes').textContent = 'Only authenticated ClearVoice packages are supported.';
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
  $('connectButton').addEventListener('click', async () => {
    if (busy()) return;
    if (io?.connected) { await io.close(); io = null; updater = null; invalidateConnection(); controls(); return; }
    selecting = true; controls();
    try {
      if (io) await io.close();
      const port = await navigator.serial.requestPort({ filters: config.usbFilters });
      if (lastAttempt && lastAttempt.port !== port) {
        log('UPDATE EVIDENCE', 'Selected port differs from the update port; previous END acceptance discarded.');
        lastAttempt = null;
      }
      applicationDiagnostics = {};
      io = new SerialTransport(port, e => { log('Serial disconnected', e.message); invalidateConnection(); controls(); }, trace, config.appBaudRate);
      updater = new FirmwareUpdater(io, notify);
      await updater.connect(lastAttempt?.pkg || null, !!lastAttempt?.endAccepted);
    } catch (e) { if (io) await io.close(); error(e); }
    finally { selecting = false; controls(); }
  });
  $('updateButton').addEventListener('click', async () => {
    if (busy()) return;
    if (selectionError) { error(new UpdateError('INVALID_ZNFW', 'Select a valid .znfw package first.')); return; }
    if (!io?.connected) { error(new UpdateError('SERIAL_NOT_CONNECTED')); return; }
    try {
      if (!pkg) {
        if (!target) throw new UpdateError('INVALID_ZNFW', 'Select a signed package.');
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
  $('refreshReleaseButton').addEventListener('click', loadManifest);
  $('languageSelect').addEventListener('change', () => { language = $('languageSelect').value; localStorage.setItem('zn-updater-lang', language); applyLanguage(); });
  navigator.serial?.addEventListener('disconnect', e => {
    if ((e.port || e.target) === io?.port) io.fail(new UpdateError('SERIAL_DISCONNECTED', 'USB device removed.'));
  });
  function invalidateConnection() {
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
  void loadManifest();
}
