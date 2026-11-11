/**
 * Adattatore del catalogo pubblicato BM83. Controlla prodotto/hardware,
 * percorso stessa origine, hash e versioni PRIMA di aprire la programmazione.
 * Il confronto col firmware installato e responsabilita di Bm83FlashUpdater.
 * Il catalogo General Use non deve essere usato come catalogo OTA Android.
 */
import { UpdateError } from './znfw.js';
import { planBm83Flash, sha256 } from './bm83-flash.js';

const fail = (message) => {
  throw new UpdateError('BM83_CATALOG', message);
};
export class Bm83AutoUpdater {
  constructor(
    flash,
    notify = () => {},
    {
      fetch = globalThis.fetch,
      manifestUrl = './bm83/manifest.json',
      baseUrl = globalThis.location?.href || 'https://localhost/',
    } = {},
  ) {
    this.flash = flash;
    this.notify = notify;
    this.fetch = fetch;
    this.manifestUrl = manifestUrl;
    this.baseUrl = baseUrl;
    this.busy = false;
  }
  cancel() {
    this.cancelled = true;
    this.controller?.abort();
    this.flash.cancel();
  }
  /**
   * Scarica e controlla il riferimento, poi confronta/installazione. busy impedisce due flussi simultanei.
   */
  async run(info) {
    if (this.busy) throw new UpdateError('BUSY');
    if (info?.product !== 'HEADSET_BT' || info.mode !== 'application')
      return { state: 'NOT_APPLICABLE' };
    if (info.bm83_bridge !== 3)
      throw new UpdateError(
        'BM83_BRIDGE_REQUIRED',
        'Aggiorna prima il firmware STM32 con bridge BM83 v3.',
      );
    this.busy = true;
    this.cancelled = false;
    this.controller = new AbortController();
    const timer = setTimeout(() => this.controller.abort(), 60000);
    try {
      this.notify({ state: 'BM83_CATALOG_LOADING' });
      const manifestUrl = new URL(this.manifestUrl, this.baseUrl);
      const response = await this.fetch(manifestUrl.href + '?v=' + Date.now(), {
        cache: 'no-store',
        signal: this.controller.signal,
      });
      if (!response.ok) fail('Catalogo BM83 non disponibile: HTTP ' + response.status + '.');
      const manifest = await response.json();
      if (
        manifest.schema !== 1 ||
        manifest.product !== info.product ||
        manifest.hardware !== info.hardware ||
        manifest.module !== 'BM83' ||
        typeof manifest.url !== 'string' ||
        !manifest.url ||
        !Number.isInteger(manifest.revision) ||
        manifest.revision < 1 ||
        !/^.+\.hex$/i.test(manifest.filename || '') ||
        !/^[a-f\d]{64}$/i.test(manifest.sha256 || '') ||
        manifest.format !== 'BM83_GENERAL_USE'
      )
        fail('Catalogo BM83 incompatibile.');
      const imageUrl = new URL(manifest.url, manifestUrl);
      if (
        imageUrl.origin !== manifestUrl.origin ||
        !imageUrl.pathname.startsWith(
          manifestUrl.pathname.slice(0, manifestUrl.pathname.lastIndexOf('/') + 1),
        )
      )
        fail('Percorso immagine BM83 non consentito.');
      this.notify({
        state: 'BM83_IMAGE_DOWNLOADING',
        revision: manifest.revision,
        filename: manifest.filename,
      });
      const image = await this.fetch(imageUrl.href, {
        cache: 'no-store',
        signal: this.controller.signal,
      });
      if (!image.ok) fail('Download BM83: HTTP ' + image.status + '.');
      const bytes = new Uint8Array(await image.arrayBuffer());
      if (bytes.length > 8 * 1024 * 1024 || (await sha256(bytes)) !== manifest.sha256.toLowerCase())
        fail('SHA-256 immagine BM83 non corrispondente.');
      const plan = await planBm83Flash(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        manifest.filename,
      );
      for (const part of plan.images.filter((p) => p.version))
        if (JSON.stringify(part.version) !== JSON.stringify(manifest.versions?.[part.name]))
          fail('Versione immagine diversa dal catalogo.');
      if (this.cancelled) throw new UpdateError('BM83_CANCELLED');
      clearTimeout(timer);
      this.notify({
        state: 'BM83_ONLINE_REFERENCE',
        revision: manifest.revision,
        filename: manifest.filename,
        versions: manifest.versions,
        sha256: manifest.sha256,
      });
      return await this.flash.run(plan, { baud: 921600, automatic: true });
    } catch (error) {
      if (this.cancelled)
        throw new UpdateError('BM83_CANCELLED', 'Verifica/aggiornamento BM83 interrotto.');
      throw error;
    } finally {
      clearTimeout(timer);
      this.controller = null;
      this.busy = false;
    }
  }
}
