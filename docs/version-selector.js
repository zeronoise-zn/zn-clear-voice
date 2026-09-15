(() => {
  'use strict';

  const STORAGE_KEY = 'zn-updater-fw-version';
  const MANIFEST_NAME = 'firmware-manifest.json';
  const REPOSITORY = document.querySelector('meta[name="zn-firmware-repository"]')?.content || 'zeronoise-zn/zn-clear-voice';
  const BRANCH = document.querySelector('meta[name="zn-firmware-branch"]')?.content || 'feature/clearvoice-web-updater';
  const FIRMWARE_DIR = 'docs/firmware';
  const API_URL = `https://api.github.com/repos/${REPOSITORY}/contents/${FIRMWARE_DIR}?ref=${encodeURIComponent(BRANCH)}`;
  const nativeFetch = window.fetch.bind(window);

  let catalog = [];
  let catalogLoadedAt = 0;
  let catalogError = '';
  let syncGuard = false;

  const TEXT = {
    en: {
      subtitle: 'Connect your ClearVoice. The latest official firmware is selected automatically, or you can choose a previous version.',
      choose: 'Firmware version', latest: 'Latest', installed: 'Installed', older: 'Previous', newer: 'Newer',
      target: 'Selected version', latestLabel: 'Latest version', selectHint: 'Latest is selected by default. Previous official versions remain available.',
      noPublished: 'No official firmware published yet', noPublishedNote: 'Publish signed *_PROD.znfw files in the GitHub firmware folder.',
      repositoryReady: 'Official firmware available', repositoryNote: 'Firmware is read directly from the official ZeroNoise GitHub repository.',
      downgrade: 'Previous version selected', downgradeNote: 'You selected an older firmware version.',
      same: 'This version is already installed', update: 'Update available',
      downgradeConfirm: 'You are about to install an older firmware version. Continue?'
    },
    it: {
      subtitle: 'Collega il tuo ClearVoice. L’ultimo firmware ufficiale viene selezionato automaticamente, ma puoi scegliere anche una versione precedente.',
      choose: 'Versione da installare', latest: 'Ultima', installed: 'Installata', older: 'Precedente', newer: 'Più recente',
      target: 'Versione selezionata', latestLabel: 'Ultima versione', selectHint: 'Di default è selezionata l’ultima versione. Le versioni ufficiali precedenti restano disponibili.',
      noPublished: 'Nessun firmware ufficiale pubblicato', noPublishedNote: 'Pubblica i file firmati *_PROD.znfw nella cartella firmware del repository GitHub.',
      repositoryReady: 'Firmware ufficiali disponibili', repositoryNote: 'I firmware vengono letti direttamente dal repository GitHub ufficiale ZeroNoise.',
      downgrade: 'Versione precedente selezionata', downgradeNote: 'Hai selezionato una versione firmware precedente.',
      same: 'Questa versione è già installata', update: 'Aggiornamento disponibile',
      downgradeConfirm: 'Stai per installare una versione firmware precedente. Continuare?'
    },
    de: {
      subtitle: 'ClearVoice verbinden. Die neueste offizielle Firmware wird automatisch ausgewählt; ältere Versionen können ebenfalls gewählt werden.',
      choose: 'Firmware-Version', latest: 'Neueste', installed: 'Installiert', older: 'Älter', newer: 'Neuer',
      target: 'Ausgewählte Version', latestLabel: 'Neueste Version', selectHint: 'Standardmäßig ist die neueste Version ausgewählt. Frühere offizielle Versionen bleiben verfügbar.',
      noPublished: 'Noch keine offizielle Firmware veröffentlicht', noPublishedNote: 'Signierte *_PROD.znfw-Dateien im GitHub-Firmwareordner veröffentlichen.',
      repositoryReady: 'Offizielle Firmware verfügbar', repositoryNote: 'Die Firmware wird direkt aus dem offiziellen ZeroNoise GitHub-Repository gelesen.',
      downgrade: 'Ältere Version ausgewählt', downgradeNote: 'Eine ältere Firmware-Version wurde ausgewählt.',
      same: 'Diese Version ist bereits installiert', update: 'Update verfügbar',
      downgradeConfirm: 'Sie installieren eine ältere Firmware-Version. Fortfahren?'
    },
    fr: {
      subtitle: 'Connectez votre ClearVoice. Le dernier firmware officiel est sélectionné automatiquement, mais vous pouvez aussi choisir une version antérieure.',
      choose: 'Version à installer', latest: 'Dernière', installed: 'Installée', older: 'Antérieure', newer: 'Plus récente',
      target: 'Version sélectionnée', latestLabel: 'Dernière version', selectHint: 'La dernière version est sélectionnée par défaut. Les versions officielles précédentes restent disponibles.',
      noPublished: 'Aucun firmware officiel publié', noPublishedNote: 'Publiez les fichiers signés *_PROD.znfw dans le dossier firmware GitHub.',
      repositoryReady: 'Firmware officiel disponible', repositoryNote: 'Le firmware est lu directement depuis le dépôt GitHub officiel ZeroNoise.',
      downgrade: 'Version antérieure sélectionnée', downgradeNote: 'Vous avez sélectionné une version antérieure.',
      same: 'Cette version est déjà installée', update: 'Mise à jour disponible',
      downgradeConfirm: 'Vous allez installer une ancienne version du firmware. Continuer ?'
    },
    es: {
      subtitle: 'Conecta tu ClearVoice. El firmware oficial más reciente se selecciona automáticamente, pero también puedes elegir una versión anterior.',
      choose: 'Versión a instalar', latest: 'Última', installed: 'Instalada', older: 'Anterior', newer: 'Más reciente',
      target: 'Versión seleccionada', latestLabel: 'Última versión', selectHint: 'La última versión se selecciona por defecto. Las versiones oficiales anteriores siguen disponibles.',
      noPublished: 'No hay firmware oficial publicado', noPublishedNote: 'Publica los archivos firmados *_PROD.znfw en la carpeta firmware de GitHub.',
      repositoryReady: 'Firmware oficial disponible', repositoryNote: 'El firmware se lee directamente desde el repositorio oficial de ZeroNoise en GitHub.',
      downgrade: 'Versión anterior seleccionada', downgradeNote: 'Has seleccionado una versión anterior del firmware.',
      same: 'Esta versión ya está instalada', update: 'Actualización disponible',
      downgradeConfirm: 'Vas a instalar una versión anterior del firmware. ¿Continuar?'
    }
  };

  function language() {
    const value = document.getElementById('languageSelect')?.value || document.documentElement.lang || 'en';
    return TEXT[value] ? value : 'en';
  }
  function tr(key) { return TEXT[language()][key] || TEXT.en[key] || key; }
  function normalizeVersion(value = '') { return String(value).trim().replace(/^v/i, '').split(/[+-]/)[0]; }
  function compareVersions(a, b) {
    const pa = normalizeVersion(a).split('.').map(n => Number.parseInt(n, 10) || 0);
    const pb = normalizeVersion(b).split('.').map(n => Number.parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return Math.sign(d);
    }
    return 0;
  }
  function versionFromFilename(name) {
    const match = String(name).match(/(?:^|_)(\d+\.\d+\.\d+(?:\.\d+)?)(?:_|\.)/);
    return match ? match[1] : '';
  }
  async function sha256(buffer) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
    return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
  }

  async function loadGithubCatalog(force = false) {
    const now = Date.now();
    if (!force && catalogLoadedAt && now - catalogLoadedAt < 30000) return catalog;

    const listingResponse = await nativeFetch(`${API_URL}&v=${now}`, {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json' }
    });
    if (listingResponse.status === 404) {
      catalog = []; catalogError = ''; catalogLoadedAt = now; return catalog;
    }
    if (!listingResponse.ok) throw new Error(`GitHub API HTTP ${listingResponse.status}`);

    const listing = await listingResponse.json();
    if (!Array.isArray(listing)) throw new Error('Unexpected GitHub firmware directory response');

    const files = listing.filter(item => item?.type === 'file' && /_PROD\.znfw$/i.test(item.name || ''));
    const loaded = await Promise.all(files.map(async item => {
      const version = versionFromFilename(item.name);
      if (!version) return null;
      const url = `./firmware/${encodeURIComponent(item.name)}`;
      const response = await nativeFetch(`${url}?v=${encodeURIComponent(item.sha || now)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`${item.name}: HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      return {
        product: 'ClearVoice', hardware: '*', version, format: 'znfw', url,
        sha256: await sha256(bytes), filename: item.name, githubBlob: item.sha || ''
      };
    }));

    catalog = loaded.filter(Boolean).sort((a, b) => -compareVersions(a.version, b.version));
    catalogError = '';
    catalogLoadedAt = now;
    window.__ZN_FW_CATALOG__ = catalog;
    return catalog;
  }

  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!url.includes(MANIFEST_NAME)) return nativeFetch(input, init);
    try {
      const targets = await loadGithubCatalog(false);
      queueMicrotask(refreshSelector);
      setTimeout(syncSelectionState, 100);
      return new Response(JSON.stringify({
        schema: 2,
        repository: REPOSITORY,
        source: 'github-contents',
        branch: BRANCH,
        directory: FIRMWARE_DIR,
        targets
      }), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    } catch (error) {
      catalog = [];
      catalogError = error?.message || String(error);
      catalogLoadedAt = Date.now();
      queueMicrotask(refreshSelector);
      return new Response(JSON.stringify({ schema: 2, repository: REPOSITORY, targets: [] }), {
        status: 200, headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    }
  };

  function injectUi() {
    if (document.getElementById('firmwareVersionSelect')) return;
    const versionCompare = document.querySelector('.version-compare');
    if (!versionCompare) return;

    const wrap = document.createElement('div');
    wrap.className = 'firmware-version-picker';
    wrap.innerHTML = `
      <label for="firmwareVersionSelect" id="firmwareVersionSelectLabel"></label>
      <div class="firmware-version-select-wrap">
        <select id="firmwareVersionSelect" disabled></select>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>
      </div>
      <p id="firmwareVersionHint" class="firmware-version-hint"></p>`;
    versionCompare.insertAdjacentElement('afterend', wrap);

    document.getElementById('firmwareVersionSelect').addEventListener('change', onVersionChange);
    document.getElementById('languageSelect')?.addEventListener('change', () => setTimeout(() => {
      refreshPublicCopy(); refreshSelector();
    }, 0));

    ['productValue', 'hardwareValue', 'installedValue'].forEach(id => {
      const node = document.getElementById(id);
      if (node) new MutationObserver(scheduleSync).observe(node, { childList: true, characterData: true, subtree: true });
    });

    document.getElementById('refreshReleaseButton')?.addEventListener('click', event => {
      if (event.isTrusted) catalogLoadedAt = 0;
    }, true);

    document.getElementById('updateButton')?.addEventListener('click', event => {
      if (!isDowngradeSelected()) return;
      if (!window.confirm(tr('downgradeConfirm'))) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);

    refreshPublicCopy();
    refreshSelector();
  }

  function refreshPublicCopy() {
    const subtitle = document.getElementById('publicSubtitle');
    if (subtitle) subtitle.textContent = tr('subtitle');
  }

  function deviceIdentity() {
    const shownProduct = document.getElementById('productValue')?.textContent?.trim() || '';
    return {
      product: shownProduct === 'ClearVoice Portable Unit' ? 'ClearVoice' : shownProduct,
      hardware: document.getElementById('hardwareValue')?.textContent?.trim() || '',
      installed: document.getElementById('installedValue')?.textContent?.trim() || ''
    };
  }
  function hardwareMatches(infoHw, rule) {
    if (!rule || rule === '*') return true;
    if (Array.isArray(rule)) return rule.some(x => String(x).toLowerCase() === String(infoHw).toLowerCase());
    return String(rule).toLowerCase() === String(infoHw).toLowerCase();
  }
  function compatibleTargets() {
    const { product, hardware } = deviceIdentity();
    const connected = document.getElementById('connectionPill')?.classList.contains('online');
    return catalog.filter(item => {
      if (!connected) return true;
      return String(item.product || '').toLowerCase() === String(product || '').toLowerCase() && hardwareMatches(hardware, item.hardware);
    }).sort((a, b) => -compareVersions(a.version, b.version));
  }

  function refreshSelector() {
    const select = document.getElementById('firmwareVersionSelect');
    const label = document.getElementById('firmwareVersionSelectLabel');
    const hint = document.getElementById('firmwareVersionHint');
    if (!select || !label || !hint) return;

    label.textContent = tr('choose');
    const compatible = compatibleTargets();
    const installed = deviceIdentity().installed;
    const stored = sessionStorage.getItem(STORAGE_KEY) || '';
    select.innerHTML = '';

    if (!compatible.length) {
      select.add(new Option(catalogError ? 'GitHub unavailable' : '—', ''));
      select.disabled = true;
      hint.textContent = catalogError ? catalogError : tr('noPublishedNote');
      updateRepositoryState();
      return;
    }

    const latest = compatible[0];
    compatible.forEach(item => {
      const flags = [];
      if (compareVersions(item.version, latest.version) === 0) flags.push(tr('latest'));
      if (installed && installed !== '—' && compareVersions(item.version, installed) === 0) flags.push(tr('installed'));
      else if (installed && installed !== '—') flags.push(compareVersions(item.version, installed) < 0 ? tr('older') : tr('newer'));
      select.add(new Option(`v${normalizeVersion(item.version)}${flags.length ? ` — ${flags.join(' · ')}` : ''}`, item.version));
    });

    const selected = compatible.find(item => normalizeVersion(item.version) === normalizeVersion(stored)) || latest;
    if (stored && selected !== latest) sessionStorage.setItem(STORAGE_KEY, selected.version);
    else if (!stored) sessionStorage.removeItem(STORAGE_KEY);
    select.value = selected.version;
    select.disabled = false;
    hint.textContent = isDowngrade(selected, installed) ? tr('downgradeNote') : tr('selectHint');
    hint.classList.toggle('downgrade', isDowngrade(selected, installed));
    updateTargetLabel(selected.version !== latest.version);
    updateRepositoryState(selected);
  }

  function onVersionChange(event) {
    const value = event.target.value;
    if (value) sessionStorage.setItem(STORAGE_KEY, value);
    else sessionStorage.removeItem(STORAGE_KEY);
    document.getElementById('refreshReleaseButton')?.click();
    setTimeout(syncSelectionState, 80);
    setTimeout(syncSelectionState, 300);
  }

  function selectedTarget() {
    const selected = sessionStorage.getItem(STORAGE_KEY);
    const compatible = compatibleTargets();
    if (!compatible.length) return null;
    return compatible.find(x => normalizeVersion(x.version) === normalizeVersion(selected)) || compatible[0];
  }
  function isDowngrade(item, installed) {
    return !!(item && installed && installed !== '—' && compareVersions(item.version, installed) < 0);
  }
  function isDowngradeSelected() { return isDowngrade(selectedTarget(), deviceIdentity().installed); }

  function updateTargetLabel(selectedOlder) {
    const label = document.querySelector('.version-block.accent span');
    if (label) label.textContent = selectedOlder ? tr('target') : tr('latestLabel');
  }

  function updateRepositoryState(item = selectedTarget()) {
    const badge = document.getElementById('releaseBadge');
    const notes = document.getElementById('releaseNotes');
    if (!badge || !notes) return;
    if (!catalog.length) {
      badge.textContent = tr('noPublished'); badge.className = 'release-badge neutral';
      notes.textContent = catalogError || tr('noPublishedNote');
      return;
    }
    badge.textContent = tr('repositoryReady'); badge.className = 'release-badge available';
    notes.textContent = tr('repositoryNote');
    if (!item) return;
    const installed = deviceIdentity().installed;
    if (!installed || installed === '—') return;
    const cmp = compareVersions(item.version, installed);
    if (cmp === 0) { badge.textContent = tr('same'); badge.className = 'release-badge current'; }
    else if (cmp < 0) { badge.textContent = tr('downgrade'); badge.className = 'release-badge warning'; }
    else { badge.textContent = tr('update'); badge.className = 'release-badge available'; }
  }

  function syncSelectionState() {
    const item = selectedTarget();
    const latestValue = document.getElementById('latestVersionValue');
    const select = document.getElementById('firmwareVersionSelect');
    const installed = deviceIdentity().installed;
    if (item && latestValue) latestValue.textContent = item.version;
    if (select && item && select.value !== item.version) select.value = item.version;
    const hint = document.getElementById('firmwareVersionHint');
    if (hint && item) {
      const downgrade = isDowngrade(item, installed);
      hint.textContent = downgrade ? tr('downgradeNote') : tr('selectHint');
      hint.classList.toggle('downgrade', downgrade);
    }
    updateRepositoryState(item);
  }

  function scheduleSync() {
    if (syncGuard) return;
    syncGuard = true;
    requestAnimationFrame(() => { syncGuard = false; refreshSelector(); });
  }

  window.__ZN_REFRESH_VERSIONS__ = refreshSelector;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectUi, { once: true });
  else injectUi();
})();
