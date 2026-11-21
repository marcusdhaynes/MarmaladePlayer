/* Extension-side persistence: catalog + (Chromium) directory handles in the
   EXTENSION's own IndexedDB (chrome-extension:// origin). This storage is
   independent of marmaladeum.com's origin storage: clearing the site's data
   or its service-worker cache does not touch it. */

const DB_NAME = 'marmalade-extension-library:v1';
const STORE = 'libraries';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function op(db,mode,method,payload){
  return new Promise((resolve,reject)=>{
    let finished=false,result;
    const done=(error,value)=>{
      if(finished)return;
      finished=true;
      error?reject(error):resolve(value);
    };
    try{
      const tx=db.transaction(STORE,mode);
      const request=tx.objectStore(STORE)[method](payload);
      request.onsuccess=()=>{result=request.result;};
      request.onerror=()=>done(request.error||new Error('IndexedDB request failed'));
      tx.oncomplete=()=>done(null,result);
      tx.onerror=()=>done(tx.error||new Error('IndexedDB transaction failed'));
      tx.onabort=()=>done(tx.error||new Error('IndexedDB transaction aborted'));
    }catch(error){done(error);}
  });
}

export async function loadLibraries() {
  const db = await openDb();
  try { return (await op(db, 'readonly', 'getAll')) || []; }
  finally { db.close(); }
}

export async function saveLibrary(lib) {
  const db = await openDb();
  try {
    await op(db, 'readwrite', 'put', lib);
  } catch (error) {
    // A browser may reject structured cloning FileSystemHandles. Preserve
    // every catalog entry and report the degraded access honestly.
    try{
      await op(db,'readwrite','put',
        {...lib,folders:lib.folders.map(f=>({...f,handle:null}))});
    }catch(failure){
      throw new AggregateError([error,failure],
        'Extension library could not be saved. Existing catalog was not deleted.');
    }
  } finally { db.close(); }
}

export async function deleteLibrary(id) {
  const db = await openDb();
  try { await op(db, 'readwrite', 'delete', id); }
  finally { db.close(); }
}

/* Public catalog shape shared with the web app: metadata only, never handles. */
export function publicCatalog(libraries) {
  return libraries.map((lib) => ({
    id: lib.id, name: lib.name, kind: lib.kind, lastScan: lib.lastScan || 0,
    folders: (lib.folders || []).map((f) => ({
      id: f.id, name: f.name, source: f.handle ? 'extension-handle' : 'extension-session'
    })),
    items: (lib.items || []).map(({ id, folderId, path, name, size, lastModified,
      title, show, season, episode, year, type, metadataPending }) => ({
      id, folderId, path, name, size, lastModified, title, show, season,
      episode, year, type, metadataPending: !!metadataPending
    }))
  }));
}
