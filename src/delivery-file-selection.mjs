const MAX_FILES=30,MAX_BYTES=50*1024*1024;
const limitMessage='Select at most 30 files totaling 50 MB.';
export async function appendDeliverySelection(current,incoming){
 const files=Array.from(incoming);
 if(files.length>MAX_FILES||files.reduce((sum,file)=>sum+file.size,0)>MAX_BYTES)throw Error(limitMessage);
 const next=new Map(current.map(entry=>[entry.sha256,entry]));
 for(const file of files){
  const bytes=await file.arrayBuffer();
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const sha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  next.set(sha256,{file,sha256});
 }
 const selected=[...next.values()];
 if(selected.length>MAX_FILES||selected.reduce((sum,entry)=>sum+entry.file.size,0)>MAX_BYTES)throw Error(limitMessage);
 return selected;
}
