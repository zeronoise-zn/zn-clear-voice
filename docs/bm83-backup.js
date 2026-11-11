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
