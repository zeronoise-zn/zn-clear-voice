const CONFIG = {
  repo: 'zeronoise-zn/zn-clear-voice',
  manifestUrl: './firmware-manifest.json',
  appBaudRate: 115200,
  bootBaudRate: 115200,
  usbFilters: [{ usbVendorId: 0x0403, usbProductId: 0x6015 }], // FT234XD factory VID/PID
  appFlashBase: 0x08000000,
  applicationInfoCommand: 'ZN_INFO?\n',
  enterBootloaderCommand: 'ZN_BOOT\n',
  infoTimeoutMs: 1200,
  bootAckTimeoutMs: 2500,
  ioTimeoutMs: 9000,
  writeChunkSize: 256,
  verifyChunkSize: 256,
};

const I18N = {
  en: {
    usbDisconnected: 'USB disconnected', usbConnected: 'USB connected', title: 'Firmware Update Center',
    subtitle: 'Connect your ZeroNoise device, check the installed firmware and update safely from the official GitHub repository.',
    browserUnsupportedTitle: 'Browser not supported', browserUnsupportedText: 'Use a recent version of Google Chrome or Microsoft Edge on desktop.',
    device: 'DEVICE', deviceStatus: 'Device status', detectedProduct: 'Detected product', mcu: 'MCU', serial: 'Serial number', hardware: 'Hardware', installed: 'Installed',
    connect: 'Connect device', disconnect: 'Disconnect', connectHint: 'The browser will ask permission to access the FT234XD USB serial interface.',
    firmware: 'FIRMWARE', updateStatus: 'Update status', currentVersion: 'Current version', latestVersion: 'Latest version', checkingRepository: 'Checking repository…',
    releaseWaiting: 'Connect a device to compare firmware versions.', ready: 'Ready', waitingForDevice: 'Waiting for device', updateFirmware: 'Update firmware',
    updateProcess: 'UPDATE PROCESS', safeGuidedUpdate: 'Safe, guided update', shaVerified: 'SHA-256 verified',
    stepConnect: 'Connect', stepConnectSub: 'Detect USB device', stepCheck: 'Check', stepCheckSub: 'Compare versions', stepFlash: 'Update', stepFlashSub: 'Program flash', stepVerify: 'Verify', stepVerifySub: 'Read-back check', stepRestart: 'Restart', stepRestartSub: 'Confirm firmware',
    technicalLog: 'Technical log', advanced: 'Advanced', alreadyBootloader: 'Device is already in STM32 bootloader mode', localFirmware: 'Local firmware (.bin)',
    advancedWarning: 'Local firmware bypasses GitHub release selection. MCU and SHA checks are still performed when possible.',
    repositoryReady: 'Repository ready', noTarget: 'No compatible firmware target is configured for this product.', updateAvailable: 'Update available', upToDate: 'Device is up to date', unknownVersion: 'Version check unavailable',
    connecting: 'Connecting…', readingDevice: 'Reading device information…', deviceDetected: 'Device detected', bootloaderDetected: 'STM32 bootloader detected', appProtocolMissing: 'Device connected, but application identification did not respond.',
    updateStarting: 'Preparing update…', downloading: 'Downloading firmware…', verifyingDownload: 'Verifying firmware file…', enteringBootloader: 'Entering STM32 bootloader…', syncingBootloader: 'Synchronizing bootloader…', checkingMcu: 'Checking MCU…', erasing: 'Erasing application flash…', programming: 'Programming flash…', verifying: 'Verifying flash…', restarting: 'Restarting device…', complete: 'Update completed', failed: 'Update failed',
    selectLocal: 'Select a local firmware file first.', incompatibleMcu: 'The connected MCU is not compatible with this firmware.', hashMismatch: 'Firmware SHA-256 does not match the manifest.', confirmUpdate: 'Firmware update will erase and reprogram the STM32 application flash. Do not disconnect power or USB. Continue?',
    bootEntryHint: 'Automatic bootloader entry requires the application command ZN_BOOT to be implemented on the STM32 firmware.',
  },
  it: {
    usbDisconnected: 'USB scollegata', usbConnected: 'USB collegata', title: 'Centro Aggiornamento Firmware',
    subtitle: 'Collega il dispositivo ZeroNoise, verifica il firmware installato e aggiornalo in sicurezza dal repository GitHub ufficiale.',
    browserUnsupportedTitle: 'Browser non supportato', browserUnsupportedText: 'Usa una versione recente di Google Chrome o Microsoft Edge su desktop.',
    device: 'DISPOSITIVO', deviceStatus: 'Stato dispositivo', detectedProduct: 'Prodotto rilevato', mcu: 'MCU', serial: 'Numero seriale', hardware: 'Hardware', installed: 'Installata',
    connect: 'Collega dispositivo', disconnect: 'Disconnetti', connectHint: 'Il browser chiederà il permesso di accedere all’interfaccia seriale USB FT234XD.',
    firmware: 'FIRMWARE', updateStatus: 'Stato aggiornamento', currentVersion: 'Versione attuale', latestVersion: 'Ultima versione', checkingRepository: 'Controllo repository…',
    releaseWaiting: 'Collega un dispositivo per confrontare le versioni firmware.', ready: 'Pronto', waitingForDevice: 'In attesa del dispositivo', updateFirmware: 'Aggiorna firmware',
    updateProcess: 'PROCESSO DI AGGIORNAMENTO', safeGuidedUpdate: 'Aggiornamento sicuro e guidato', shaVerified: 'SHA-256 verificato',
    stepConnect: 'Collega', stepConnectSub: 'Rileva dispositivo USB', stepCheck: 'Verifica', stepCheckSub: 'Confronta versioni', stepFlash: 'Aggiorna', stepFlashSub: 'Programma flash', stepVerify: 'Controlla', stepVerifySub: 'Verifica lettura', stepRestart: 'Riavvia', stepRestartSub: 'Conferma firmware',
    technicalLog: 'Log tecnico', advanced: 'Avanzate', alreadyBootloader: 'Il dispositivo è già nel bootloader STM32', localFirmware: 'Firmware locale (.bin)',
    advancedWarning: 'Il firmware locale bypassa la selezione GitHub. Quando possibile vengono comunque controllati MCU e SHA.',
    repositoryReady: 'Repository pronto', noTarget: 'Nessun firmware compatibile configurato per questo prodotto.', updateAvailable: 'Aggiornamento disponibile', upToDate: 'Dispositivo aggiornato', unknownVersion: 'Impossibile verificare la versione',
    connecting: 'Connessione…', readingDevice: 'Lettura informazioni dispositivo…', deviceDetected: 'Dispositivo rilevato', bootloaderDetected: 'Bootloader STM32 rilevato', appProtocolMissing: 'Dispositivo collegato, ma il protocollo di identificazione applicativo non risponde.',
    updateStarting: 'Preparazione aggiornamento…', downloading: 'Download firmware…', verifyingDownload: 'Verifica file firmware…', enteringBootloader: 'Ingresso nel bootloader STM32…', syncingBootloader: 'Sincronizzazione bootloader…', checkingMcu: 'Verifica MCU…', erasing: 'Cancellazione flash applicativa…', programming: 'Programmazione flash…', verifying: 'Verifica flash…', restarting: 'Riavvio dispositivo…', complete: 'Aggiornamento completato', failed: 'Aggiornamento non riuscito',
    selectLocal: 'Seleziona prima un file firmware locale.', incompatibleMcu: 'La MCU collegata non è compatibile con questo firmware.', hashMismatch: 'Lo SHA-256 del firmware non coincide con il manifest.', confirmUpdate: 'L’aggiornamento cancellerà e riprogrammerà la flash applicativa dello STM32. Non scollegare alimentazione o USB. Continuare?',
    bootEntryHint: 'L’ingresso automatico nel bootloader richiede che il comando ZN_BOOT sia implementato nel firmware STM32.',
  },
  de: {
    usbDisconnected: 'USB getrennt', usbConnected: 'USB verbunden', title: 'Firmware Update Center', subtitle: 'ZeroNoise Gerät verbinden, installierte Firmware prüfen und sicher aus dem offiziellen GitHub-Repository aktualisieren.', browserUnsupportedTitle: 'Browser nicht unterstützt', browserUnsupportedText: 'Verwenden Sie eine aktuelle Desktop-Version von Google Chrome oder Microsoft Edge.', device: 'GERÄT', deviceStatus: 'Gerätestatus', detectedProduct: 'Erkanntes Produkt', mcu: 'MCU', serial: 'Seriennummer', hardware: 'Hardware', installed: 'Installiert', connect: 'Gerät verbinden', disconnect: 'Trennen', connectHint: 'Der Browser fragt nach Zugriff auf die FT234XD USB-Seriellschnittstelle.', firmware: 'FIRMWARE', updateStatus: 'Update-Status', currentVersion: 'Aktuelle Version', latestVersion: 'Neueste Version', checkingRepository: 'Repository wird geprüft…', releaseWaiting: 'Gerät verbinden, um Firmware-Versionen zu vergleichen.', ready: 'Bereit', waitingForDevice: 'Warten auf Gerät', updateFirmware: 'Firmware aktualisieren', updateProcess: 'UPDATE-ABLAUF', safeGuidedUpdate: 'Sicheres, geführtes Update', shaVerified: 'SHA-256 geprüft', stepConnect: 'Verbinden', stepConnectSub: 'USB-Gerät erkennen', stepCheck: 'Prüfen', stepCheckSub: 'Versionen vergleichen', stepFlash: 'Update', stepFlashSub: 'Flash programmieren', stepVerify: 'Prüfen', stepVerifySub: 'Rücklesen prüfen', stepRestart: 'Neustart', stepRestartSub: 'Firmware bestätigen', technicalLog: 'Technisches Protokoll', advanced: 'Erweitert', alreadyBootloader: 'Gerät ist bereits im STM32-Bootloader', localFirmware: 'Lokale Firmware (.bin)', advancedWarning: 'Lokale Firmware umgeht die GitHub-Auswahl. MCU- und SHA-Prüfungen erfolgen soweit möglich.', repositoryReady: 'Repository bereit', noTarget: 'Keine kompatible Firmware für dieses Produkt konfiguriert.', updateAvailable: 'Update verfügbar', upToDate: 'Gerät ist aktuell', unknownVersion: 'Versionsprüfung nicht verfügbar', connecting: 'Verbindung…', readingDevice: 'Geräteinformationen werden gelesen…', deviceDetected: 'Gerät erkannt', bootloaderDetected: 'STM32-Bootloader erkannt', appProtocolMissing: 'Gerät verbunden, aber die Anwendungsidentifikation antwortet nicht.', updateStarting: 'Update wird vorbereitet…', downloading: 'Firmware wird geladen…', verifyingDownload: 'Firmware-Datei wird geprüft…', enteringBootloader: 'STM32-Bootloader wird gestartet…', syncingBootloader: 'Bootloader wird synchronisiert…', checkingMcu: 'MCU wird geprüft…', erasing: 'Anwendungs-Flash wird gelöscht…', programming: 'Flash wird programmiert…', verifying: 'Flash wird geprüft…', restarting: 'Gerät wird neu gestartet…', complete: 'Update abgeschlossen', failed: 'Update fehlgeschlagen', selectLocal: 'Bitte zuerst eine lokale Firmware-Datei auswählen.', incompatibleMcu: 'Die verbundene MCU ist mit dieser Firmware nicht kompatibel.', hashMismatch: 'Firmware SHA-256 stimmt nicht mit dem Manifest überein.', confirmUpdate: 'Das Update löscht und programmiert den STM32-Anwendungs-Flash neu. Strom und USB nicht trennen. Fortfahren?', bootEntryHint: 'Der automatische Bootloader-Start erfordert den Befehl ZN_BOOT in der STM32-Firmware.'
  },
  fr: {
    usbDisconnected: 'USB déconnecté', usbConnected: 'USB connecté', title: 'Centre de Mise à Jour Firmware', subtitle: 'Connectez votre appareil ZeroNoise, vérifiez le firmware installé et mettez-le à jour depuis le dépôt GitHub officiel.', browserUnsupportedTitle: 'Navigateur non pris en charge', browserUnsupportedText: 'Utilisez une version récente de Google Chrome ou Microsoft Edge sur ordinateur.', device: 'APPAREIL', deviceStatus: 'État de l’appareil', detectedProduct: 'Produit détecté', mcu: 'MCU', serial: 'Numéro de série', hardware: 'Hardware', installed: 'Installé', connect: 'Connecter l’appareil', disconnect: 'Déconnecter', connectHint: 'Le navigateur demandera l’autorisation d’accéder à l’interface série USB FT234XD.', firmware: 'FIRMWARE', updateStatus: 'État de mise à jour', currentVersion: 'Version actuelle', latestVersion: 'Dernière version', checkingRepository: 'Vérification du dépôt…', releaseWaiting: 'Connectez un appareil pour comparer les versions.', ready: 'Prêt', waitingForDevice: 'En attente de l’appareil', updateFirmware: 'Mettre à jour', updateProcess: 'PROCESSUS DE MISE À JOUR', safeGuidedUpdate: 'Mise à jour sûre et guidée', shaVerified: 'SHA-256 vérifié', stepConnect: 'Connecter', stepConnectSub: 'Détecter l’USB', stepCheck: 'Vérifier', stepCheckSub: 'Comparer versions', stepFlash: 'Mettre à jour', stepFlashSub: 'Programmer flash', stepVerify: 'Vérifier', stepVerifySub: 'Contrôle lecture', stepRestart: 'Redémarrer', stepRestartSub: 'Confirmer firmware', technicalLog: 'Journal technique', advanced: 'Avancé', alreadyBootloader: 'L’appareil est déjà en mode bootloader STM32', localFirmware: 'Firmware local (.bin)', advancedWarning: 'Le firmware local ignore la sélection GitHub. MCU et SHA restent vérifiés si possible.', repositoryReady: 'Dépôt prêt', noTarget: 'Aucun firmware compatible configuré pour ce produit.', updateAvailable: 'Mise à jour disponible', upToDate: 'Appareil à jour', unknownVersion: 'Vérification de version indisponible', connecting: 'Connexion…', readingDevice: 'Lecture des informations…', deviceDetected: 'Appareil détecté', bootloaderDetected: 'Bootloader STM32 détecté', appProtocolMissing: 'Appareil connecté, mais l’identification applicative ne répond pas.', updateStarting: 'Préparation…', downloading: 'Téléchargement du firmware…', verifyingDownload: 'Vérification du firmware…', enteringBootloader: 'Passage au bootloader STM32…', syncingBootloader: 'Synchronisation du bootloader…', checkingMcu: 'Vérification MCU…', erasing: 'Effacement de la flash…', programming: 'Programmation…', verifying: 'Vérification flash…', restarting: 'Redémarrage…', complete: 'Mise à jour terminée', failed: 'Échec de la mise à jour', selectLocal: 'Sélectionnez d’abord un firmware local.', incompatibleMcu: 'Le MCU connecté n’est pas compatible avec ce firmware.', hashMismatch: 'Le SHA-256 du firmware ne correspond pas au manifeste.', confirmUpdate: 'La mise à jour effacera et reprogrammera la flash applicative STM32. Ne débranchez ni l’alimentation ni l’USB. Continuer ?', bootEntryHint: 'L’entrée automatique dans le bootloader exige la commande ZN_BOOT dans le firmware STM32.'
  },
  es: {
    usbDisconnected: 'USB desconectado', usbConnected: 'USB conectado', title: 'Centro de Actualización de Firmware', subtitle: 'Conecta tu dispositivo ZeroNoise, comprueba el firmware instalado y actualízalo desde el repositorio oficial de GitHub.', browserUnsupportedTitle: 'Navegador no compatible', browserUnsupportedText: 'Usa una versión reciente de Google Chrome o Microsoft Edge en escritorio.', device: 'DISPOSITIVO', deviceStatus: 'Estado del dispositivo', detectedProduct: 'Producto detectado', mcu: 'MCU', serial: 'Número de serie', hardware: 'Hardware', installed: 'Instalada', connect: 'Conectar dispositivo', disconnect: 'Desconectar', connectHint: 'El navegador pedirá permiso para acceder a la interfaz serie USB FT234XD.', firmware: 'FIRMWARE', updateStatus: 'Estado de actualización', currentVersion: 'Versión actual', latestVersion: 'Última versión', checkingRepository: 'Comprobando repositorio…', releaseWaiting: 'Conecta un dispositivo para comparar versiones.', ready: 'Listo', waitingForDevice: 'Esperando dispositivo', updateFirmware: 'Actualizar firmware', updateProcess: 'PROCESO DE ACTUALIZACIÓN', safeGuidedUpdate: 'Actualización segura y guiada', shaVerified: 'SHA-256 verificado', stepConnect: 'Conectar', stepConnectSub: 'Detectar USB', stepCheck: 'Comprobar', stepCheckSub: 'Comparar versiones', stepFlash: 'Actualizar', stepFlashSub: 'Programar flash', stepVerify: 'Verificar', stepVerifySub: 'Comprobar lectura', stepRestart: 'Reiniciar', stepRestartSub: 'Confirmar firmware', technicalLog: 'Registro técnico', advanced: 'Avanzado', alreadyBootloader: 'El dispositivo ya está en bootloader STM32', localFirmware: 'Firmware local (.bin)', advancedWarning: 'El firmware local omite la selección de GitHub. MCU y SHA se verifican cuando es posible.', repositoryReady: 'Repositorio listo', noTarget: 'No hay firmware compatible configurado para este producto.', updateAvailable: 'Actualización disponible', upToDate: 'Dispositivo actualizado', unknownVersion: 'No se puede verificar la versión', connecting: 'Conectando…', readingDevice: 'Leyendo información…', deviceDetected: 'Dispositivo detectado', bootloaderDetected: 'Bootloader STM32 detectado', appProtocolMissing: 'Dispositivo conectado, pero la identificación de aplicación no responde.', updateStarting: 'Preparando actualización…', downloading: 'Descargando firmware…', verifyingDownload: 'Verificando firmware…', enteringBootloader: 'Entrando en bootloader STM32…', syncingBootloader: 'Sincronizando bootloader…', checkingMcu: 'Comprobando MCU…', erasing: 'Borrando flash de aplicación…', programming: 'Programando flash…', verifying: 'Verificando flash…', restarting: 'Reiniciando dispositivo…', complete: 'Actualización completada', failed: 'Actualización fallida', selectLocal: 'Selecciona primero un firmware local.', incompatibleMcu: 'La MCU conectada no es compatible con este firmware.', hashMismatch: 'El SHA-256 del firmware no coincide con el manifiesto.', confirmUpdate: 'La actualización borrará y reprogramará la flash de aplicación STM32. No desconectes alimentación ni USB. ¿Continuar?', bootEntryHint: 'La entrada automática al bootloader requiere implementar el comando ZN_BOOT en el firmware STM32.'
  }
};

const $ = (id) => document.getElementById(id);
const ui = {
  connectionPill: $('connectionPill'), language: $('languageSelect'), warning: $('browserWarning'), product: $('productValue'), mcu: $('mcuValue'), serial: $('serialValue'), hardware: $('hardwareValue'), installed: $('installedValue'), current: $('currentVersionValue'), latest: $('latestVersionValue'), connect: $('connectButton'), update: $('updateButton'), refresh: $('refreshReleaseButton'), releaseBadge: $('releaseBadge'), releaseNotes: $('releaseNotes'), progressBar: $('progressBar'), progressPercent: $('progressPercent'), progressLabel: $('progressLabel'), progressDetail: $('progressDetail'), progressBytes: $('progressBytes'), deviceIcon: $('deviceIcon'), log: $('technicalLog'), localFirmware: $('localFirmwareInput'), bootToggle: $('manualBootloaderToggle'), toast: $('toast')
};

let lang = localStorage.getItem('zn-updater-lang') || ((navigator.language || 'en').slice(0,2));
if (!I18N[lang]) lang = 'en';
let port = null;
let deviceInfo = null;
let manifest = null;
let target = null;
let localFirmwareFile = null;
let operationLocked = false;

function t(key) { return I18N[lang]?.[key] ?? I18N.en[key] ?? key; }
function applyLanguage() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => { const key = el.dataset.i18n; if (t(key)) el.textContent = t(key); });
  ui.language.value = lang;
  updateConnectionUi(!!port);
}

function log(message, data) {
  const stamp = new Date().toLocaleTimeString([], { hour12: false });
  const suffix = data === undefined ? '' : ` ${typeof data === 'string' ? data : JSON.stringify(data)}`;
  ui.log.textContent += `\n[${stamp}] ${message}${suffix}`;
  ui.log.scrollTop = ui.log.scrollHeight;
  console.debug('[ZN Updater]', message, data ?? '');
}

function toast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ui.toast.classList.remove('show'), 3200);
}

function setProgress(percent, label, detail = '', bytes = '') {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  ui.progressBar.style.width = `${p}%`;
  ui.progressPercent.textContent = `${p}%`;
  if (label) ui.progressLabel.textContent = label;
  if (detail) ui.progressDetail.textContent = detail;
  ui.progressBytes.textContent = bytes || '—';
}

function setStep(name) {
  const order = ['connect','check','flash','verify','restart'];
  const activeIndex = order.indexOf(name);
  document.querySelectorAll('.step').forEach(el => {
    const idx = order.indexOf(el.dataset.step);
    el.classList.toggle('done', idx < activeIndex);
    el.classList.toggle('active', idx === activeIndex);
  });
}

function updateConnectionUi(connected) {
  ui.connectionPill.classList.toggle('online', connected);
  ui.connectionPill.classList.toggle('offline', !connected);
  const text = ui.connectionPill.querySelector('[data-i18n]');
  if (text) text.textContent = connected ? t('usbConnected') : t('usbDisconnected');
  ui.deviceIcon.classList.toggle('online', connected);
  ui.connect.querySelector('[data-i18n]').textContent = connected ? t('disconnect') : t('connect');
}

async function loadManifest() {
  try {
    const response = await fetch(`${CONFIG.manifestUrl}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
    manifest = await response.json();
    log('Firmware manifest loaded', { schema: manifest.schema, targets: manifest.targets?.length || 0 });
    if (deviceInfo) evaluateTarget();
  } catch (error) {
    manifest = null;
    log('Manifest error', error.message);
    setReleaseState('error', t('unknownVersion'), 'firmware-manifest.json');
  }
}

function normalizeVersion(v = '') { return String(v).trim().replace(/^v/i,'').split(/[+-]/)[0]; }
function compareVersions(a, b) {
  const pa = normalizeVersion(a).split('.').map(n => Number.parseInt(n,10) || 0);
  const pb = normalizeVersion(b).split('.').map(n => Number.parseInt(n,10) || 0);
  for (let i=0; i<Math.max(pa.length,pb.length); i++) { const d=(pa[i]||0)-(pb[i]||0); if (d) return Math.sign(d); }
  return 0;
}

function hardwareMatches(infoHw, rule) {
  if (!rule || rule === '*') return true;
  if (Array.isArray(rule)) return rule.some(x => String(x).toLowerCase() === String(infoHw).toLowerCase());
  return String(rule).toLowerCase() === String(infoHw).toLowerCase();
}

function evaluateTarget() {
  target = null;
  ui.latest.textContent = '—';
  ui.update.disabled = true;
  if (!manifest || !deviceInfo?.product) return;
  target = (manifest.targets || []).find(x => String(x.product).toLowerCase() === String(deviceInfo.product).toLowerCase() && hardwareMatches(deviceInfo.hardware, x.hardware));
  if (!target) {
    setReleaseState('neutral', t('noTarget'), t('releaseWaiting'));
    return;
  }
  ui.latest.textContent = target.version || '—';
  ui.current.textContent = deviceInfo.version || '—';
  if (!deviceInfo.version) {
    setReleaseState('neutral', t('unknownVersion'), target.changelog || '');
    ui.update.disabled = !target.url;
    return;
  }
  const cmp = compareVersions(deviceInfo.version, target.version);
  if (cmp < 0) {
    setReleaseState('available', t('updateAvailable'), target.changelog || `${deviceInfo.version} → ${target.version}`);
    ui.update.disabled = !target.url;
  } else {
    setReleaseState('current', t('upToDate'), target.changelog || target.version);
    ui.update.disabled = true;
  }
}

function setReleaseState(kind, label, notes) {
  ui.releaseBadge.className = `release-badge ${kind}`;
  ui.releaseBadge.textContent = label;
  ui.releaseNotes.textContent = notes || '';
}

function parseInfo(text) {
  const clean = text.trim();
  if (!clean) return null;
  try {
    const obj = JSON.parse(clean);
    return { product: obj.product || obj.PRODUCT, hardware: obj.hardware || obj.hw || obj.HW, version: obj.version || obj.fw || obj.FW, serial: obj.serial || obj.SERIAL, mcu: obj.mcu || obj.MCU || 'STM32G474CEU6' };
  } catch {}
  const map = {};
  clean.split(/[\r\n;,]+/).forEach(pair => {
    const m = pair.trim().match(/^([A-Za-z_]+)\s*[:=]\s*(.+)$/);
    if (m) map[m[1].toUpperCase()] = m[2].trim();
  });
  if (!Object.keys(map).length) return null;
  return { product: map.PRODUCT || map.MODEL, hardware: map.HW || map.HARDWARE, version: map.FW || map.VERSION, serial: map.SERIAL || map.SN, mcu: map.MCU || 'STM32G474CEU6' };
}

async function openAppPort() {
  if (!port.readable && !port.writable) await port.open({ baudRate: CONFIG.appBaudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', bufferSize: 4096 });
}
async function openBootPort() {
  if (port.readable || port.writable) await safeClosePort();
  await port.open({ baudRate: CONFIG.bootBaudRate, dataBits: 8, stopBits: 1, parity: 'even', flowControl: 'none', bufferSize: 4096 });
}
async function safeClosePort() {
  if (!port) return;
  try { if (port.readable || port.writable) await port.close(); } catch (e) { log('Port close warning', e.message); }
}

async function writeBytes(bytes) {
  const writer = port.writable.getWriter();
  try { await writer.write(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); } finally { writer.releaseLock(); }
}
async function readExactly(length, timeout = CONFIG.ioTimeoutMs) {
  const reader = port.readable.getReader();
  const out = new Uint8Array(length);
  let offset = 0;
  const deadline = Date.now() + timeout;
  try {
    while (offset < length) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`Read timeout (${offset}/${length})`);
      const readPromise = reader.read();
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Read timeout')), remaining));
      const { value, done } = await Promise.race([readPromise, timeoutPromise]);
      if (done) throw new Error('Serial stream closed');
      const take = Math.min(value.length, length - offset);
      out.set(value.subarray(0, take), offset);
      offset += take;
      // AN3155 responses in this updater are requested at exact lengths; extra bytes are not expected.
    }
    return out;
  } finally { reader.releaseLock(); }
}

async function readTextWindow(timeoutMs = CONFIG.infoTimeoutMs) {
  const reader = port.readable.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const until = Date.now() + timeoutMs;
  try {
    while (Date.now() < until) {
      const remaining = until - Date.now();
      const result = await Promise.race([reader.read(), new Promise(resolve => setTimeout(() => resolve({ timeout: true }), Math.min(220, remaining)))]);
      if (result.timeout) continue;
      if (result.done) break;
      text += decoder.decode(result.value, { stream: true });
      if (text.includes('\n') && /(PRODUCT|FW|VERSION|\{)/i.test(text)) break;
    }
  } finally { reader.releaseLock(); }
  return text;
}

async function queryApplicationInfo() {
  await writeBytes(new TextEncoder().encode(CONFIG.applicationInfoCommand));
  const response = await readTextWindow();
  log('Application info response', response.replace(/[\r\n]+/g, ' | '));
  return parseInfo(response);
}

async function connectDevice() {
  if (operationLocked) return;
  if (port) { await disconnectDevice(); return; }
  try {
    setProgress(5, t('connecting'), 'FT234XD');
    port = await navigator.serial.requestPort({ filters: CONFIG.usbFilters });
    const info = port.getInfo();
    log('Serial port selected', info);
    updateConnectionUi(true);
    setStep('connect');

    if (ui.bootToggle.checked) {
      await openBootPort();
      const id = await bootSyncAndGetId();
      deviceInfo = { product: 'Clear Voice', hardware: '—', version: null, serial: '—', mcu: stm32IdName(id) };
      renderDeviceInfo();
      setProgress(18, t('bootloaderDetected'), stm32IdHex(id));
      setStep('check');
      evaluateTarget();
      return;
    }

    await openAppPort();
    setProgress(10, t('readingDevice'), '115200 8N1');
    deviceInfo = await queryApplicationInfo();
    if (!deviceInfo) {
      deviceInfo = { product: 'Clear Voice', hardware: '—', version: null, serial: '—', mcu: 'STM32G474CEU6' };
      renderDeviceInfo();
      setProgress(12, t('appProtocolMissing'), t('bootEntryHint'));
      toast(t('appProtocolMissing'));
      log('Expected application protocol', { info: CONFIG.applicationInfoCommand.trim(), boot: CONFIG.enterBootloaderCommand.trim() });
    } else {
      renderDeviceInfo();
      setProgress(20, t('deviceDetected'), deviceInfo.product || 'ZeroNoise');
      setStep('check');
      evaluateTarget();
    }
  } catch (error) {
    log('Connection error', error.message);
    toast(error.message);
    await disconnectDevice(false);
    setProgress(0, t('ready'), t('waitingForDevice'));
  }
}

function renderDeviceInfo() {
  ui.product.textContent = deviceInfo?.product || '—';
  ui.mcu.textContent = deviceInfo?.mcu || 'STM32G474CEU6';
  ui.serial.textContent = deviceInfo?.serial || '—';
  ui.hardware.textContent = deviceInfo?.hardware || '—';
  ui.installed.textContent = deviceInfo?.version || '—';
  ui.current.textContent = deviceInfo?.version || '—';
}

async function disconnectDevice(reset = true) {
  await safeClosePort();
  port = null;
  if (reset) {
    deviceInfo = null; target = null;
    ui.product.textContent = ui.serial.textContent = ui.hardware.textContent = ui.installed.textContent = ui.current.textContent = ui.latest.textContent = '—';
    ui.mcu.textContent = 'STM32G474CEU6';
    ui.update.disabled = true;
    setReleaseState('neutral', t('repositoryReady'), t('releaseWaiting'));
    setProgress(0, t('ready'), t('waitingForDevice'));
    setStep('connect');
  }
  updateConnectionUi(false);
}

function xorChecksum(bytes) { return bytes.reduce((a,b) => a ^ b, 0); }
const ACK = 0x79;
async function expectAck(context) {
  const b = (await readExactly(1))[0];
  if (b !== ACK) throw new Error(`${context}: expected ACK 0x79, got 0x${b.toString(16).padStart(2,'0')}`);
}
async function bootSync() {
  await writeBytes([0x7F]);
  await expectAck('SYNC');
}
async function bootCommand(command) {
  await writeBytes([command, command ^ 0xFF]);
  await expectAck(`CMD 0x${command.toString(16)}`);
}
function addressPacket(address) {
  const b = new Uint8Array([address >>> 24, address >>> 16, address >>> 8, address].map(x => x & 0xFF));
  return new Uint8Array([...b, xorChecksum([...b])]);
}
async function bootGetId() {
  await bootCommand(0x02);
  const len = (await readExactly(1))[0] + 1;
  const idBytes = await readExactly(len);
  await expectAck('GET ID');
  return idBytes.reduce((n,b) => (n << 8) | b, 0);
}
async function bootSyncAndGetId() { await bootSync(); return await bootGetId(); }
function stm32IdHex(id) { return `0x${id.toString(16).toUpperCase().padStart(3,'0')}`; }
function stm32IdName(id) { return id === 0x469 ? 'STM32G474/G473/G483/G484' : `STM32 ${stm32IdHex(id)}`; }

async function bootMassErase() {
  await bootCommand(0x44); // Extended Erase
  await writeBytes([0xFF, 0xFF, 0x00]);
  await expectAck('MASS ERASE');
}
async function bootWriteMemory(address, data) {
  if (!data.length || data.length > 256) throw new Error('Invalid write length');
  await bootCommand(0x31);
  await writeBytes(addressPacket(address));
  await expectAck('WRITE ADDRESS');
  const count = data.length - 1;
  const payload = new Uint8Array(1 + data.length + 1);
  payload[0] = count;
  payload.set(data, 1);
  payload[payload.length - 1] = xorChecksum([...payload.subarray(0, payload.length - 1)]);
  await writeBytes(payload);
  await expectAck('WRITE DATA');
}
async function bootReadMemory(address, length) {
  if (length < 1 || length > 256) throw new Error('Invalid read length');
  await bootCommand(0x11);
  await writeBytes(addressPacket(address));
  await expectAck('READ ADDRESS');
  const n = length - 1;
  await writeBytes([n, n ^ 0xFF]);
  await expectAck('READ LENGTH');
  return await readExactly(length);
}
async function bootGo(address) {
  await bootCommand(0x21);
  await writeBytes(addressPacket(address));
  await expectAck('GO ADDRESS');
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('');
}

async function obtainFirmware() {
  if (localFirmwareFile) {
    const buffer = await localFirmwareFile.arrayBuffer();
    return { buffer, version: `local:${localFirmwareFile.name}`, sha256: null, mcuId: 0x469, address: CONFIG.appFlashBase };
  }
  if (!target?.url) throw new Error(t('noTarget'));
  setProgress(24, t('downloading'), target.version, '');
  const response = await fetch(target.url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Firmware download HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  return { buffer, version: target.version, sha256: target.sha256 || null, mcuId: Number(target.mcu_id || 0x469), address: Number(target.address || CONFIG.appFlashBase) };
}

async function enterBootloader() {
  if (ui.bootToggle.checked) {
    if (!port.readable) await openBootPort();
    return await bootSyncAndGetId();
  }
  if (!port?.writable) await openAppPort();
  setProgress(32, t('enteringBootloader'), 'ZN_BOOT');
  await writeBytes(new TextEncoder().encode(CONFIG.enterBootloaderCommand));
  await new Promise(r => setTimeout(r, 300));
  await openBootPort();
  setProgress(35, t('syncingBootloader'), '0x7F · 8E1');
  return await bootSyncAndGetId();
}

async function performUpdate() {
  if (operationLocked || !port) return;
  if (!target && !localFirmwareFile) { toast(t('selectLocal')); return; }
  if (!confirm(t('confirmUpdate'))) return;
  operationLocked = true;
  ui.connect.disabled = true; ui.update.disabled = true; ui.refresh.disabled = true;
  try {
    setStep('check');
    setProgress(21, t('updateStarting'));
    const fw = await obtainFirmware();
    const bytes = new Uint8Array(fw.buffer);
    const fileHash = await sha256Hex(fw.buffer);
    log('Firmware loaded', { bytes: bytes.length, version: fw.version, sha256: fileHash });
    setProgress(28, t('verifyingDownload'), fileHash.slice(0,16) + '…', `${bytes.length.toLocaleString()} B`);
    if (fw.sha256 && fileHash.toLowerCase() !== String(fw.sha256).toLowerCase()) throw new Error(t('hashMismatch'));

    const id = await enterBootloader();
    log('STM32 bootloader ID', stm32IdHex(id));
    setProgress(39, t('checkingMcu'), `${stm32IdName(id)} · ${stm32IdHex(id)}`);
    if (fw.mcuId && id !== fw.mcuId) throw new Error(`${t('incompatibleMcu')} Expected ${stm32IdHex(fw.mcuId)}, got ${stm32IdHex(id)}.`);

    setStep('flash');
    setProgress(42, t('erasing'), 'Extended Erase · Mass erase');
    await bootMassErase();
    log('Mass erase complete');

    for (let offset=0; offset<bytes.length; offset += CONFIG.writeChunkSize) {
      const chunk = bytes.subarray(offset, Math.min(offset + CONFIG.writeChunkSize, bytes.length));
      await bootWriteMemory(fw.address + offset, chunk);
      const ratio = (offset + chunk.length) / bytes.length;
      setProgress(45 + ratio * 34, t('programming'), `0x${(fw.address + offset).toString(16).toUpperCase()}`, `${offset + chunk.length} / ${bytes.length} B`);
    }

    setStep('verify');
    const verifyHasherParts = [];
    let verified = 0;
    for (let offset=0; offset<bytes.length; offset += CONFIG.verifyChunkSize) {
      const len = Math.min(CONFIG.verifyChunkSize, bytes.length - offset);
      const readback = await bootReadMemory(fw.address + offset, len);
      verifyHasherParts.push(readback);
      for (let i=0; i<len; i++) if (readback[i] !== bytes[offset+i]) throw new Error(`Verify mismatch at 0x${(fw.address + offset + i).toString(16).toUpperCase()}`);
      verified += len;
      setProgress(80 + (verified/bytes.length)*15, t('verifying'), `0x${(fw.address + offset).toString(16).toUpperCase()}`, `${verified} / ${bytes.length} B`);
    }
    log('Read-back verify complete', { bytes: verified });

    setStep('restart');
    setProgress(97, t('restarting'), `GO 0x${fw.address.toString(16).toUpperCase()}`);
    await bootGo(fw.address);
    await safeClosePort();
    await new Promise(r => setTimeout(r, 500));
    setProgress(100, t('complete'), fw.version, `${bytes.length.toLocaleString()} B`);
    document.querySelectorAll('.step').forEach(el => { el.classList.add('done'); el.classList.remove('active'); });
    setReleaseState('current', t('complete'), `${fw.version} · SHA-256 ${fileHash.slice(0,12)}…`);
    toast(t('complete'));
    log('Update completed', { version: fw.version, sha256: fileHash });
    port = null; updateConnectionUi(false);
  } catch (error) {
    log('Update failed', error.message);
    setReleaseState('error', t('failed'), error.message);
    ui.progressLabel.textContent = t('failed');
    toast(error.message);
    try { await safeClosePort(); } catch {}
    port = null; updateConnectionUi(false);
  } finally {
    operationLocked = false;
    ui.connect.disabled = false; ui.refresh.disabled = false;
    ui.update.disabled = !(port && (target?.url || localFirmwareFile));
  }
}

ui.language.addEventListener('change', () => { lang = ui.language.value; localStorage.setItem('zn-updater-lang', lang); applyLanguage(); evaluateTarget(); });
ui.connect.addEventListener('click', connectDevice);
ui.update.addEventListener('click', performUpdate);
ui.refresh.addEventListener('click', loadManifest);
ui.localFirmware.addEventListener('change', () => {
  localFirmwareFile = ui.localFirmware.files?.[0] || null;
  if (localFirmwareFile) {
    ui.latest.textContent = localFirmwareFile.name;
    setReleaseState('available', 'LOCAL', `${localFirmwareFile.name} · ${localFirmwareFile.size.toLocaleString()} B`);
    ui.update.disabled = !port;
    log('Local firmware selected', { name: localFirmwareFile.name, bytes: localFirmwareFile.size });
  } else evaluateTarget();
});

navigator.serial?.addEventListener('disconnect', async event => {
  if (event.target === port && !operationLocked) {
    log('USB serial disconnected');
    await disconnectDevice();
    toast(t('usbDisconnected'));
  }
});

window.addEventListener('DOMContentLoaded', async () => {
  applyLanguage();
  if (!('serial' in navigator)) ui.warning.classList.remove('hidden');
  setReleaseState('neutral', t('checkingRepository'), 'GitHub · ' + CONFIG.repo);
  await loadManifest();
  if ('serial' in navigator) {
    try {
      const granted = await navigator.serial.getPorts();
      log('Previously authorized serial ports', granted.length);
    } catch {}
  }
});
