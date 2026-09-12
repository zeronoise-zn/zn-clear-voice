(() => {
  'use strict';

  const STORAGE_KEY = 'zn-updater-fw-version';
  const MANIFEST_NAME = 'firmware-manifest.json';
  const nativeFetch = window.fetch.bind(window);
  let catalog = [];
  let syncGuard = false;

  const TEXT = {
    en: {
      choose: 'Firmware version', automatic: 'Automatic — latest', connect: 'Connect the device to choose a compatible version', none: 'No compatible versions available',
      latest: 'Latest', installed: 'Installed', older: 'Older', newer: 'Newer', target: 'Selected version', latestLabel: 'Latest version',
      downgrade: 'Downgrade selected', downgradeNote: 'You selected an older firmware version. Compatibility checks and firmware verification remain mandatory.',
      same: 'Installed version selected', selectHint: 'The latest compatible release is selected by default. You can choose another signed compatible release.',
      downgradeConfirm: 'You are about to install an older firmware version. This is a firmware downgrade. Continue?'
    },
    it: {
      choose: 'Versione firmware', automatic: 'Automatica — ultima disponibile', connect: 'Collega il dispositivo per scegliere una versione compatibile', none: 'Nessuna versione compatibile disponibile',
      latest: 'Ultima', installed: 'Installata', older: 'Precedente', newer: 'Più recente', target: 'Versione selezionata', latestLabel: 'Ultima versione',
      downgrade: 'Downgrade selezionato', downgradeNote: 'Hai selezionato una versione firmware precedente. I controlli di compatibilità e la verifica del firmware restano obbligatori.',
      same: 'Versione installata selezionata', selectHint: 'Di default viene scelta l’ultima release compatibile. Puoi selezionare anche un’altra release firmata e compatibile.',
      downgradeConfirm: 'Stai per installare una versione firmware precedente. Si tratta di un downgrade. Continuare?'
    },
    de: {
      choose: 'Firmware-Version', automatic: 'Automatisch — neueste', connect: 'Gerät verbinden, um eine kompatible Version auszuwählen', none: 'Keine kompatiblen Versionen verfügbar',
      latest: 'Neueste', installed: 'Installiert', older: 'Älter', newer: 'Neuer', target: 'Ausgewählte Version', latestLabel: 'Neueste Version',
      downgrade: 'Downgrade ausgewählt', downgradeNote: 'Sie haben eine ältere Firmware-Version ausgewählt. Kompatibilitäts- und Firmware-Prüfungen bleiben obligatorisch.',
      same: 'Installierte Version ausgewählt', selectHint: 'Standardmäßig wird die neueste kompatible Version gewählt. Eine andere signierte, kompatible Version kann ausgewählt werden.',
      downgradeConfirm: 'Sie installieren eine ältere Firmware-Version. Dies ist ein Downgrade. Fortfahren?'
    },
    fr: {
      choose: 'Version du firmware', automatic: 'Automatique — dernière version', connect: 'Connectez l’appareil pour choisir une version compatible', none: 'Aucune version compatible disponible',
      latest: 'Dernière', installed: 'Installée', older: 'Antérieure', newer: 'Plus récente', target: 'Version sélectionnée', latestLabel: 'Dernière version',
      downgrade: 'Downgrade sélectionné', downgradeNote: 'Vous avez sélectionné une ancienne version du firmware. Les contrôles de compatibilité et la vérification restent obligatoires.',
      same: 'Version installée sélectionnée', selectHint: 'La dernière version compatible est sélectionnée par défaut. Vous pouvez choisir une autre version signée et compatible.',
      downgradeConfirm: 'Vous allez installer une ancienne version du firmware. Il s’agit d’un downgrade. Continuer ?'
    },
    es: {
      choose: 'Versión de firmware', automatic: 'Automática — última versión', connect: 'Conecta el dispositivo para elegir una versión compatible', none: 'No hay versiones compatibles disponibles',
      latest: 'Última', installed: 'Instalada', older: 'Anterior', newer: 'Más reciente', target: 'Versión seleccionada', latestLabel: 'Última versión',
      downgrade: 'Downgrade seleccionado', downgradeNote: 'Has seleccionado una versión anterior del firmware. Las comprobaciones de compatibilidad y verificación siguen siendo obligatorias.',
      same: 'Versión instalada seleccionada', selectHint: 'Por defecto se selecciona la última versión compatible. También puedes elegir otra versión firmada y compatible.',
      downgradeConfirm: 'Vas a instalar una versión anterior del firmware. Esto es un downgrade. ¿Continuar?'
    }
  };

  function language() {
    const value = document.getElementById('languageSelect')?.value || document.documentElement.lang || 'en';
    return TEXT[value] ? value : 'en';
  }
  function tr(key) { return TEXT[language()][key] || TEXT.en[key] || key; }

  function normalizeVersion(value = '') {
    return String(value).trim().replace(/^v/i, '').split(/[+-]/)[0];
  }

  function compareVersions(a, b) {
    const pa = normalizeVersion(a).split('.').map(n => Number.parseInt(n, 10) || 0);
    const pb = normalizeVersion(b).split('.').map(n => Number.parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return Math.sign(d);
    }
    return 0;
  }

  function hardwareMatches(infoHw, rule) {
    if (!rule || rule === '*') return true;
    if (Array.isArray(rule)) return rule.some(x => String(x).toLowerCase() === String(infoHw).toLowerCase());
    return String(rule).toLowerCase() === String(infoHw).toLowerCase();
  }

  function sortTargets(targets) {
    const selected = sessionStorage.getItem(STORAGE_KEY) || '';
    return [...targets].sort((a, b) => {
      const aSelected = selected && normalizeVersion(a.version) === normalizeVersion(selected);
      const bSelected = selected && normalizeVersion(b.version) === normalizeVersion(selected);
      if (aSelected !== bSelected) return aSelected ? -1 : 1;
      return -compareVersions(a.version, b.version);
    });
  }

  // app.js chooses the first compatible target from the manifest. We keep that
  // behavior, but order the manifest so "latest" is first by default and the
  // explicitly selected version is first when the user chooses one.
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const response = await nativeFetch(input, init);
    if (!url.includes(MANIFEST_NAME) || !response.ok) return response;

    try {
      const data = await response.clone().json();
      if (Array.isArray(data.targets)) {
        catalog = [...data.targets];
        data.targets = sortTargets(data.targets);
        window.__ZN_FW_CATALOG__ = catalog;
        queueMicrotask(refreshSelector);
        setTimeout(syncSelectionState, 100);
        setTimeout(syncSelectionState, 400);
      }
      const headers = new Headers(response.headers);
      headers.set('content-type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers });
    } catch (_) {
      return response;
    }
  };

  function injectUi() {
    if (document.getElementById('firmwareVersionSelect')) return;
    const versionCompare = document.querySelector('.version-compare');
    if (!versionCompare) return;

    const wrap = document.createElement('div');
    wrap.className = 'firmware-version-picker';
    wrap.innerHTML = `
      <div class="firmware-version-picker-head">
        <label for="firmwareVersionSelect" id="firmwareVersionSelectLabel"></label>
        <span class="firmware-version-auto">GitHub Releases</span>
      </div>
      <div class="firmware-version-select-wrap">
        <select id="firmwareVersionSelect" disabled></select>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>
      </div>
      <p id="firmwareVersionHint" class="firmware-version-hint"></p>`;
    versionCompare.insertAdjacentElement('afterend', wrap);

    const style = document.createElement('style');
    style.textContent = `
      .firmware-version-picker{margin:-3px 0 18px;padding:14px 15px;border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.018)}
      .firmware-version-picker-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:9px}
      .firmware-version-picker-head label{font-size:11px;font-weight:850;color:var(--muted);letter-spacing:.02em}
      .firmware-version-auto{font-size:9px;font-weight:850;letter-spacing:.08em;text-transform:uppercase;color:var(--muted-2)}
      .firmware-version-select-wrap{position:relative}
      .firmware-version-select-wrap select{width:100%;appearance:none;border:1px solid var(--line-strong);border-radius:12px;background:#0d1117;color:var(--text);padding:12px 42px 12px 13px;outline:none;font-size:13px;font-weight:750;cursor:pointer;transition:border-color .18s ease,box-shadow .18s ease}
      .firmware-version-select-wrap select:hover:not(:disabled),.firmware-version-select-wrap select:focus{border-color:rgba(255,204,0,.42);box-shadow:0 0 0 3px rgba(255,204,0,.06)}
      .firmware-version-select-wrap select:disabled{opacity:.45;cursor:not-allowed}
      .firmware-version-select-wrap svg{position:absolute;right:13px;top:50%;width:17px;height:17px;transform:translateY(-50%);fill:none;stroke:var(--muted);stroke-width:1.8;pointer-events:none}
      .firmware-version-hint{margin:8px 2px 0;color:var(--muted-2);font-size:10px;line-height:1.45}
      .firmware-version-hint.downgrade{color:#ffd28a}
    `;
    document.head.appendChild(style);

    document.getElementById('firmwareVersionSelect').addEventListener('change', onVersionChange);
    document.getElementById('languageSelect')?.addEventListener('change', () => setTimeout(refreshSelector, 0));

    ['productValue', 'hardwareValue', 'installedValue'].forEach(id => {
      const node = document.getElementById(id);
      if (node) new MutationObserver(() => scheduleSync()).observe(node, { childList: true, characterData: true, subtree: true });
    });

    document.getElementById('updateButton')?.addEventListener('click', event => {
      if (!isDowngradeSelected()) return;
      if (!window.confirm(tr('downgradeConfirm'))) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);

    refreshSelector();
  }

  function deviceIdentity() {
    return {
      product: document.getElementById('productValue')?.textContent?.trim() || '',
      hardware: document.getElementById('hardwareValue')?.textContent?.trim() || '',
      installed: document.getElementById('installedValue')?.textContent?.trim() || ''
    };
  }

  function compatibleTargets() {
    const { product, hardware } = deviceIdentity();
    if (!product || product === '—') return [];
    return catalog
      .filter(x => String(x.product || '').toLowerCase() === product.toLowerCase() && hardwareMatches(hardware, x.hardware))
      .sort((a, b) => -compareVersions(a.version, b.version));
  }

  function uniqueVersions(targets) {
    const seen = new Set();
    return targets.filter(x => {
      const key = normalizeVersion(x.version);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function refreshSelector() {
    const select = document.getElementById('firmwareVersionSelect');
    const label = document.getElementById('firmwareVersionSelectLabel');
    const hint = document.getElementById('firmwareVersionHint');
    if (!select || !label || !hint) return;

    label.textContent = tr('choose');
    const compatible = uniqueVersions(compatibleTargets());
    const installed = deviceIdentity().installed;
    const selected = sessionStorage.getItem(STORAGE_KEY) || '';

    select.innerHTML = '';
    if (!compatible.length) {
      const option = new Option(deviceIdentity().product && deviceIdentity().product !== '—' ? tr('none') : tr('connect'), '');
      select.add(option);
      select.disabled = true;
      hint.textContent = tr('selectHint');
      hint.classList.remove('downgrade');
      updateTargetLabel(false);
      return;
    }

    const latest = compatible[0].version;
    select.add(new Option(`${tr('automatic')} · v${normalizeVersion(latest)}`, ''));
    compatible.forEach(item => {
      const version = item.version;
      const flags = [];
      if (compareVersions(version, latest) === 0) flags.push(tr('latest'));
      if (installed && installed !== '—' && compareVersions(version, installed) === 0) flags.push(tr('installed'));
      else if (installed && installed !== '—') flags.push(compareVersions(version, installed) < 0 ? tr('older') : tr('newer'));
      select.add(new Option(`v${normalizeVersion(version)}${flags.length ? ` — ${flags.join(' · ')}` : ''}`, version));
    });
    select.disabled = false;

    const validSelected = compatible.some(x => normalizeVersion(x.version) === normalizeVersion(selected));
    if (selected && validSelected) select.value = compatible.find(x => normalizeVersion(x.version) === normalizeVersion(selected)).version;
    else {
      if (selected) sessionStorage.removeItem(STORAGE_KEY);
      select.value = '';
    }

    hint.textContent = tr('selectHint');
    hint.classList.remove('downgrade');
    syncSelectionState();
  }

  function onVersionChange(event) {
    const value = event.target.value;
    if (value) sessionStorage.setItem(STORAGE_KEY, value);
    else sessionStorage.removeItem(STORAGE_KEY);

    // Reload only the manifest through the existing updater refresh action.
    // The serial connection stays open.
    document.getElementById('refreshReleaseButton')?.click();
    setTimeout(syncSelectionState, 80);
    setTimeout(syncSelectionState, 300);
    setTimeout(syncSelectionState, 800);
  }

  function selectedTarget() {
    const selected = sessionStorage.getItem(STORAGE_KEY);
    if (!selected) return null;
    return compatibleTargets().find(x => normalizeVersion(x.version) === normalizeVersion(selected)) || null;
  }

  function updateTargetLabel(selected) {
    const label = document.querySelector('.version-block.accent span');
    if (!label) return;
    const desired = selected ? tr('target') : tr('latestLabel');
    if (label.textContent !== desired) label.textContent = desired;
  }

  function isDowngradeSelected() {
    const item = selectedTarget();
    const installed = deviceIdentity().installed;
    return !!(item && installed && installed !== '—' && compareVersions(item.version, installed) < 0);
  }

  function scheduleSync() {
    if (syncGuard) return;
    syncGuard = true;
    requestAnimationFrame(() => {
      syncGuard = false;
      refreshSelector();
    });
  }

  function syncSelectionState() {
    const item = selectedTarget();
    const hint = document.getElementById('firmwareVersionHint');
    const update = document.getElementById('updateButton');
    const badge = document.getElementById('releaseBadge');
    const notes = document.getElementById('releaseNotes');
    const latestValue = document.getElementById('latestVersionValue');
    const installed = deviceIdentity().installed;
    const connected = document.getElementById('connectionPill')?.classList.contains('online');

    updateTargetLabel(!!item);
    if (!item) return;

    if (latestValue && latestValue.textContent !== (item.version || '—')) latestValue.textContent = item.version || '—';
    const cmp = installed && installed !== '—' ? compareVersions(item.version, installed) : null;

    if (cmp !== null && cmp < 0) {
      if (badge) { badge.className = 'release-badge available'; badge.textContent = tr('downgrade'); }
      if (notes) notes.textContent = `${tr('downgradeNote')}${item.changelog ? ` ${item.changelog}` : ''}`;
      if (hint) { hint.textContent = tr('downgradeNote'); hint.classList.add('downgrade'); }
      if (update) update.disabled = !(connected && item.url);
    } else if (cmp === 0) {
      if (badge) { badge.className = 'release-badge current'; badge.textContent = tr('same'); }
      if (hint) { hint.textContent = tr('selectHint'); hint.classList.remove('downgrade'); }
      if (update) update.disabled = true;
    } else {
      if (hint) { hint.textContent = tr('selectHint'); hint.classList.remove('downgrade'); }
      if (update && connected && item.url) update.disabled = false;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectUi, { once: true });
  else injectUi();
})();
