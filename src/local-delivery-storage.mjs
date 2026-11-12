// Explicit, bounded storage of operator-selected files on this browser origin.
// Authoritative review and payment state never lives here.
export const MAX_LOCAL_DELIVERY_BYTES = 20 * 1024 * 1024;
export const MAX_LOCAL_FILE_BYTES = 10 * 1024 * 1024;

// Reuse the current tab's already-inspected files without persistent storage.
const openDeliveryFiles=new Map();
export function openDeliveryKey(context){
 const values=['workspaceId','projectId','checkpointId','termsKey'].map(key=>context?.[key]);
 return values.every(value=>typeof value==='string'&&value)?JSON.stringify(values):null;
}
export function retainOpenDeliveryFile(key,file,inspection){
 if(!key||file.size>MAX_LOCAL_DELIVERY_BYTES)return;
 const versionKey=JSON.stringify([key,inspection.sha,inspection.size]);
 openDeliveryFiles.delete(versionKey);
 openDeliveryFiles.set(versionKey,{key,file,sha:inspection.sha,bytes:inspection.size});
 let bytes=Array.from(openDeliveryFiles.values()).reduce((sum,item)=>sum+item.bytes,0);
 while(bytes>MAX_LOCAL_DELIVERY_BYTES){const oldest=openDeliveryFiles.keys().next().value;bytes-=openDeliveryFiles.get(oldest).bytes;openDeliveryFiles.delete(oldest);}
}
export function getOpenDeliveryFiles(key){
 if(!key)return [];
 return Array.from(openDeliveryFiles.values()).filter(item=>item.key===key).map(({file,sha,bytes})=>({file,sha,bytes}));
}
export function getOpenDeliveryFile(key){return getOpenDeliveryFiles(key).at(-1)||null;}
export function forgetOpenDeliveryFile(key){
 for(const [versionKey,item] of openDeliveryFiles)if(item.key===key)openDeliveryFiles.delete(versionKey);
}

const DATABASE = 'scopesignal-local-deliveries-v1';
const STORE = 'checkpoints';

function identity(context) {
  for (const key of ['workspaceId','projectId','checkpointId','termsKey','revisionKey'])
    if (typeof context?.[key] !== 'string' || !context[key]) throw Error('A verified workspace, project, checkpoint and review context is required.');
  return JSON.stringify([context.workspaceId,context.projectId,context.checkpointId]);
}
const limits = () => Error('Saved delivery files are limited to 20 MiB in this browser. Forget saved files before keeping more.');

export function createLocalDeliveryStorage(options = {}) {
  const databaseApi = options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB;
  const cryptoApi = options.crypto === undefined ? globalThis.crypto : options.crypto;
  let opening = null;
  function open() {
    if (!databaseApi) return Promise.reject(Error('This browser cannot keep delivery files. Choose them again when needed.'));
    if (!opening) opening = new Promise((resolve,reject)=>{
      let request;
      try { request=databaseApi.open(DATABASE,1); }
      catch { opening=null;reject(Error('Browser storage is unavailable. Your files have not been saved.'));return; }
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:'id'});};
      request.onerror=()=>{opening=null;reject(Error('Browser storage is unavailable. Your files have not been saved.'));};
      request.onblocked=()=>{opening=null;reject(Error('Close other ScopeSignal tabs before opening saved delivery files.'));};
      request.onsuccess=()=>{
        const database=request.result;
        database.onversionchange=()=>{database.close();opening=null;};
        resolve(database);
      };
    });
    const pending=opening;
    return pending.catch(error=>{if(opening===pending)opening=null;throw error;});
  }
  async function transact(mode, action) {
    const database=await open();
    return new Promise((resolve,reject)=>{
      let transaction, value, explicitError;
      try { transaction=database.transaction(STORE,mode); }
      catch { opening=null;reject(Error('Browser storage is unavailable. Please try again.'));return; }
      transaction.oncomplete=()=>resolve(value);
      transaction.onerror=transaction.onabort=()=>reject(explicitError || Error('The browser could not save or read these files. Existing saved files were left unchanged.'));
      const fail=error=>{explicitError=error;try{transaction.abort();}catch{reject(error);}};
      try { action(transaction.objectStore(STORE),next=>{value=next;},fail); }
      catch(error){fail(error);}
    });
  }
  async function digest(file) {
    if(!file || typeof file.name!=='string' || typeof file.arrayBuffer!=='function' || !Number.isSafeInteger(file.size) || file.size<0 || file.size>MAX_LOCAL_FILE_BYTES)
      throw Error('Choose a file up to 10 MiB for local retention.');
    if(!cryptoApi?.subtle)throw Error('This browser cannot verify saved file bytes.');
    const bytes=await file.arrayBuffer();
    if(bytes.byteLength!==file.size)throw Error('The selected file changed while it was being read. Choose it again.');
    const hash=await cryptoApi.subtle.digest('SHA-256',bytes);
    return Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join('');
  }
  async function remember(context, selected) {
    const id=identity(context);
    const files=[];
    for(const role of ['delivered','earlier']) {
      const file=selected?.[role];
      if(file)files.push({role,file,sha256:await digest(file),bytes:file.size});
    }
    if(!files.length)throw Error('Choose a delivery file before keeping files in this browser.');
    const bytes=files.reduce((sum,file)=>sum+file.bytes,0);
    if(bytes>MAX_LOCAL_DELIVERY_BYTES)throw limits();
    const record={id,workspaceId:context.workspaceId,projectId:context.projectId,checkpointId:context.checkpointId,
      termsKey:context.termsKey,revisionKey:context.revisionKey,files,bytes,savedAt:new Date().toISOString()};
    return transact('readwrite',(store,done,fail)=>{
      const request=store.getAll();
      request.onsuccess=()=>{
        const otherBytes=request.result.filter(item=>item.id!==id).reduce((sum,item)=>sum+item.bytes,0);
        if(otherBytes+bytes>MAX_LOCAL_DELIVERY_BYTES){fail(limits());return;}
        try { store.put(record);done({bytes,totalBytes:otherBytes+bytes,maxBytes:MAX_LOCAL_DELIVERY_BYTES,savedAt:record.savedAt}); }
        catch { fail(Error('These file objects could not be saved. Existing saved files were left unchanged.')); }
      };
    });
  }
  async function load(context) {
    const id=identity(context);
    const record=await transact('readonly',(store,done)=>{const request=store.get(id);request.onsuccess=()=>done(request.result);});
    if(!record)return {pending:null,recorded:[],hasSavedFiles:false,bytes:0};
    const result={pending:null,recorded:[],hasSavedFiles:true,bytes:record.bytes,savedAt:record.savedAt};
    // Changed terms cannot silently revive an older agreement's selections.
    if(record.termsKey!==context.termsKey)return result;
    for(const value of record.files) {
      if(await digest(value.file)!==value.sha256 || value.file.size!==value.bytes)
        throw Error('Saved file bytes could not be verified. Forget the saved files and choose the originals again.');
    }
    if(record.revisionKey===context.revisionKey) {
      result.pending={delivered:null,earlier:null};
      for(const value of record.files)result.pending[value.role]=value.file;
    }
    for(const value of record.files) {
      const matches=(context.recorded||[]).filter(ref=>typeof ref.sha256==='string'&&ref.sha256.toLowerCase()===value.sha256&&ref.bytes===value.bytes);
      if(matches.length)result.recorded.push({file:value.file,sha256:value.sha256,bytes:value.bytes,roles:[value.role],matches:matches.map(ref=>({...ref}))});
    }
    return result;
  }
  async function forget(context) {
    const id=identity(context);
    await transact('readwrite',(store,done)=>{store.delete(id);done(true);});
  }
  async function forgetAll() { await transact('readwrite',(store,done)=>{store.clear();done(true);}); }
  async function usage() {
    return transact('readonly',(store,done)=>{
      const request=store.getAll();
      request.onsuccess=()=>done({bytes:request.result.reduce((sum,item)=>sum+item.bytes,0),checkpoints:request.result.length,maxBytes:MAX_LOCAL_DELIVERY_BYTES});
    });
  }
  return {remember,load,forget,forgetAll,usage};
}
