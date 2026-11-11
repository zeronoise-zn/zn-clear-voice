// Compatibilita in sola lettura con backup salvati dalle prime versioni.
// Il flusso attuale NON crea dump o nuovi backup durante gli aggiornamenti.
const database = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open('headset-bm83-backups', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('backups', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Database backup occupato.'));
  });
export async function latestBm83Backup() {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('backups').objectStore('backups').openCursor(null, 'prev');
      request.onsuccess = () => resolve(request.result?.value || null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
