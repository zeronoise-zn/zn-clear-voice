import {sha256} from './bm83-flash.js';
const database=()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('headset-bm83-backups',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('backups',{keyPath:'id'});
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  request.onblocked=()=>reject(new Error('Database backup occupato.'));
});
export async function saveBm83Backup(bytes,metadata) {
  const db=await database(),id=Date.now()+'-'+crypto.randomUUID();
  try {
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('backups','readwrite');
      tx.objectStore('backups').add({id,bytes,metadata});
      tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error || new Error('Backup annullato.'));
      tx.onerror=()=>reject(tx.error);
    });
    const saved=await new Promise((resolve,reject)=>{
      const request=db.transaction('backups').objectStore('backups').get(id);
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    if(!saved || await sha256(saved.bytes)!==metadata.flashSha256)throw new Error('Verifica backup salvato fallita.');
    return {stored:true,id};
  }finally{db.close();}
}
export async function latestBm83Backup() {
  const db=await database();
  try{return await new Promise((resolve,reject)=>{
    const request=db.transaction('backups').objectStore('backups').openCursor(null,'prev');
    request.onsuccess=()=>resolve(request.result?.value || null);request.onerror=()=>reject(request.error);
  });}finally{db.close();}
}
