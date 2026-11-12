import {readInspectionFile,MAX_COMPARISON_BYTES,rasterImageType} from './artifact-comparison.mjs';
import {appendDeliverySelection} from './delivery-file-selection.mjs';
import {loadReportAssets,validateReportAssets,reportFontDataUrl} from './report-assets.mjs';
import {recordedFiles} from './review-file-references.mjs';
export {recordedFiles} from './review-file-references.mjs';
import {createLocalDeliveryStorage,openDeliveryKey,getOpenDeliveryFiles} from './local-delivery-storage.mjs';
import {renderLiveReviewHtml} from './live-review-export.mjs';
import {renderRecipientFeedbackHtml} from './recipient-feedback.mjs';
const enc=new TextEncoder();
export function storedZip(files){
 const chunks=[],central=[];let offset=0;
 const header=(n)=>{const a=new Uint8Array(n);return [a,new DataView(a.buffer)];};
 const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
 for(const file of files){
  const name=enc.encode(file.path),data=typeof file.data==='string'?enc.encode(file.data):file.data;
  const sum=crc(data),[local,v]=header(30);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,sum,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);
  chunks.push(local,name,data);
  const [entry,w]=header(46);w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(8,0x800,true);w.setUint32(16,sum,true);w.setUint32(20,data.length,true);w.setUint32(24,data.length,true);w.setUint16(28,name.length,true);w.setUint32(42,offset,true);central.push(entry,name);offset+=local.length+name.length+data.length;
 }
 const size=central.reduce((n,c)=>n+c.length,0),[end,v]=header(22);v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,size,true);v.setUint32(16,offset,true);
 return new Blob([...chunks,...central,end],{type:'application/zip'});
}
export async function prepareDeliveryBundle(report,selected,reportAssets=null){
 const assets=reportAssets===null?[]:await validateReportAssets(reportAssets);
 const refs=recordedFiles(report),matched=new Map(),rejected=[];
 if(!refs.length)throw Error('No file fingerprints in accepted findings or saved revision history. Inspect a file, include its reference, then save your review first.');
 if(selected.length>30||selected.reduce((n,f)=>n+f.size,0)>50*1024*1024)throw Error('Select at most 30 files totaling 50 MB.');
 for(const file of selected){
  const data=new Uint8Array(await file.arrayBuffer());
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
  const ref=refs.find(r=>r.sha256===hash&&r.bytes===data.length);
  if(!ref){rejected.push(file.name);continue;}
  matched.set(hash,{data,selectedName:file.name});
 }
 const entries=await Promise.all(refs.map(async ref=>{
  const entry={...ref,included:matched.has(ref.sha256),path:matched.has(ref.sha256)?'files/'+ref.sha256+'/'+ref.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120):null,previewKind:matched.has(ref.sha256)&&/\.pdf$/i.test(ref.name)&&/^%PDF-/.test(new TextDecoder('ascii').decode(matched.get(ref.sha256).data.subarray(0,5)))?'pdf':null};
  const content=matched.get(ref.sha256)?.data;
  const raster=content&&/\.(png|jpe?g|webp|gif)$/i.test(ref.name)?rasterImageType(content):null;
  if(raster){entry.previewKind='image';entry.previewMime=raster;}
  if(content&&content.length<=MAX_COMPARISON_BYTES&&!entry.previewKind){
   const inspected=await readInspectionFile(new File([content],ref.name));
   if(inspected.kind==='text'&&!inspected.truncated){entry.previewKind='text';entry.previewText=inspected.text;}
  }
  return entry;
 }));

 const manifest={schema:'scopesignal.delivery-bundle',version:1,source:'Operator-supplied files matched to recorded SHA-256; no semantic validation or independent approval.',generatedAt:report.generatedAt,project:report.project.label,files:entries.map(({previewText,...metadata})=>metadata),reportAssets:assets.map(({data,...metadata})=>metadata),excludedUnmatchedFiles:rejected};
 const feedback=renderRecipientFeedbackHtml(report,entries);
 const review=renderLiveReviewHtml(report,entries,assets.length?reportFontDataUrl(assets):null,feedback?'feedback.html':null);
 const readme=[
  'ScopeSignal delivery','',
  'Start here',
  '1. Extract the whole ZIP. Keep its files and assets folders beside review.html.',
  '2. Open review.html in your browser to read each deliverable, its decision and recorded files.',
  ...(feedback?[
   '', 'Return comments on the exact version',
   '1. Beside the intended file in review.html, follow its comment link. Current files say “Comment on this version”; earlier versions have their own links.',
   '2. Check the selected filename, decision and date. Read the file. For an image detail, choose “Read full screen”, then “Mark a point”.',
   '3. Enter your name and finding, then choose “Add comment”. Repeat for any other file or finding.',
   '4. Choose “Download feedback file” and send that JSON file back to the person who sent this delivery, using your usual channel.',
   '', 'Nothing is sent automatically. Download your feedback before closing the page. Replies appear with the same comment in the next delivery.'
  ]:[]),
  '', 'Keep this delivery',
  'Retain this ZIP and any feedback you downloaded. The report identifies missing files; ask the sender for those originals before reviewing them. manifest.json lists the recorded file fingerprints and which original bytes are included.',
  ''
 ].join('\n');
 const payload=[{path:'review.html',data:review},{path:'manifest.json',data:JSON.stringify(manifest,null,2)},{path:'READ-ME.txt',data:readme}];
 if(feedback)payload.push({path:'feedback.html',data:feedback});
 for(const asset of assets)payload.push({path:asset.path,data:asset.data});
 for(const entry of entries)if(entry.included)payload.push({path:entry.path,data:matched.get(entry.sha256).data});
 return {blob:storedZip(payload),manifest,included:matched.size,missing:entries.filter(e=>!e.included).length,rejected,shareFiles:[...matched].map(([sha256,{data}])=>({sha256,data})),shareManifest:entries};
}
export async function retainedDeliveryFiles(report,context,storage=createLocalDeliveryStorage()){
 if(!context?.workspaceId||!context?.projectId)return {files:[],unavailable:[]};
 const files=new Map(),unavailable=[];
 for(const cp of report.checkpoints){
  const refs=recordedFiles({checkpoints:[cp]});if(!refs.length)continue;
  const fileContext={workspaceId:context.workspaceId,projectId:context.projectId,checkpointId:cp.id,
   termsKey:JSON.stringify([cp.title,cp.amountCents,cp.plannedEvidence]),
   revisionKey:JSON.stringify([(cp.reviewHistory||[]).length,cp.acceptedEvidence||'',cp.acceptedAt||'']),recorded:refs};
  for(const opened of getOpenDeliveryFiles(openDeliveryKey(fileContext)))
   if(refs.some(ref=>ref.sha256===opened.sha&&ref.bytes===opened.bytes))files.set(opened.sha+':'+opened.bytes,opened.file);
  try{
   const saved=await storage.load(fileContext);
   for(const item of saved.recorded)files.set(item.sha256+':'+item.bytes,item.file);
  }catch{unavailable.push(cp.id);}
 }
 return {files:[...files.values()],unavailable};
}
export function mountDeliveryBundle(anchor,getReport,getContext=()=>null,postAction=null,getSharing=()=>({mode:'local'})){
 const panel=document.createElement('section');panel.className='delivery-bundle';panel.setAttribute('aria-label','Client delivery');
 const button=document.createElement('button');button.type='button';button.className='primary delivery-download';button.textContent='Download client delivery';
 const result=document.createElement('p');result.setAttribute('role','status');
 const shareButton=document.createElement('button');shareButton.type='button';shareButton.className='primary';shareButton.textContent='Share client review';
 const shareResult=document.createElement('p');shareResult.setAttribute('role','status');
 const invitation=document.createElement('input');invitation.type='url';invitation.readOnly=true;invitation.hidden=true;invitation.setAttribute('aria-label','Client invitation link');
 const copyLink=document.createElement('button');copyLink.type='button';copyLink.textContent='Copy invitation';copyLink.hidden=true;
 copyLink.onclick=async()=>{if(getSharing()?.mode!=='shared')return;try{await navigator.clipboard.writeText(invitation.value);shareResult.textContent='Invitation copied. Send it privately to your client.';}catch{invitation.select();shareResult.textContent='Copy the selected invitation link to share it with your client.';}};
 const openPreview=document.createElement('a');openPreview.textContent='Open client review ↗';openPreview.target='_blank';openPreview.rel='noopener';openPreview.hidden=true;
 let localReady=false,shownContext=null,shownMode=null;
 const syncActions=()=>{
  const context=JSON.stringify(getContext()),remote=getSharing()?.mode==='shared',mode=remote?'shared':'local';
  if(shownContext!==null&&(shownContext!==context||shownMode!==mode)){
   invitation.value='';invitation.hidden=true;copyLink.hidden=true;openPreview.removeAttribute('href');openPreview.hidden=true;localReady=false;shareResult.textContent='';
  }
  syncSelectionContext(context);
  shownContext=context;shownMode=mode;
  shareButton.textContent=remote?'Share client review':'Prepare client preview';
  shareButton.className=remote?'primary':'secondary';
  button.className=(remote?'secondary':'primary')+' delivery-download';
  shareButton.hidden=!postAction||(!remote&&localReady);
  openPreview.hidden=remote||!localReady;
  if(!remote){invitation.hidden=true;copyLink.hidden=true;panel.prepend(button,result);}
  else panel.prepend(shareButton,shareResult,invitation,copyLink);
 };
 const toBase64=bytes=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('Could not read a delivery file.'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(new Blob([bytes]));});
 let shareBusy=false;
 shareButton.onclick=async()=>{
  if(shareBusy||selectionBusy||!postAction)return;
  shareBusy=true;shareButton.disabled=true;invitation.hidden=true;copyLink.hidden=true;openPreview.hidden=true;localReady=false;shareResult.textContent='Checking the recorded files…';
  const selectedContext=JSON.stringify(getContext());
  try{
   const report=await getReport();if(!report)throw Error('Save a project review before sharing it.');
   if(selectedContext!==JSON.stringify(getContext()))throw Error('The selected project changed. Return to the project and share again.');
   const retained=await retainedDeliveryFiles(report,getContext());
   const prepared=await prepareDeliveryBundle(report,[...retained.files,...selectedFiles.map(entry=>entry.file)]);
   if(prepared.missing)throw Error('Add '+prepared.missing+' missing reviewed file'+(prepared.missing===1?'':'s')+' before sharing the complete review.');
   const data=await Promise.all(prepared.shareFiles.map(async f=>({sha256:f.sha256,data:await toBase64(f.data)})));
   const newReport=await getReport();
   if(!newReport||JSON.stringify([newReport.project,newReport.checkpoints])!==JSON.stringify([report.project,report.checkpoints])||selectedContext!==JSON.stringify(getContext()))
    throw Error('The review changed while preparing it. Share the current review instead.');
   const outcome=await postAction('/api/client-share',{files:data,manifest:prepared.shareManifest});
   if(!outcome?.shareUrl)throw Error('The share was not confirmed. Refresh the project before trying again.');
   if(getSharing()?.mode==='shared'){
    invitation.value=outcome.shareUrl;invitation.hidden=false;copyLink.hidden=false;
    shareResult.textContent='Client review ready. Copy its private invitation; this link expires in 30 days.';
   }else{
    openPreview.href=outcome.shareUrl;localReady=true;
    shareResult.textContent='Client preview ready.';
   }
   syncActions();
  }catch(error){shareResult.textContent=error.message||'The client review could not be shared.';}
  finally{shareBusy=false;shareButton.disabled=selectionBusy;}
 };

 const chooser=document.createElement('details');chooser.className='delivery-files';
 const title=document.createElement('summary');title.textContent='Add delivery files';
 const missing=document.createElement('ul');missing.className='delivery-missing';missing.setAttribute('aria-label','Missing delivery files');missing.hidden=true;
 const input=document.createElement('input');input.type='file';input.multiple=true;input.setAttribute('aria-label','Reviewed files to include in delivery bundle');
 const selectedList=document.createElement('ul');selectedList.setAttribute('aria-label','Selected delivery files');selectedList.hidden=true;
 const clearFiles=document.createElement('button');clearFiles.type='button';clearFiles.className='secondary';clearFiles.textContent='Clear selected files';clearFiles.hidden=true;
 let selectedFiles=[],selectionContext=JSON.stringify(getContext()),selectionBusy=false;
 const partial=document.createElement('button');partial.type='button';partial.className='secondary';partial.hidden=true;
 let prepared=null,version=0,preparedContext=null,preparedReview=null;
 const reviewKey=report=>JSON.stringify([report.project,report.checkpoints]);
 const clearPrepared=()=>{prepared=null;partial.hidden=true;};
 const renderSelection=()=>{
  selectedList.replaceChildren();selectedList.hidden=!selectedFiles.length;clearFiles.hidden=!selectedFiles.length;
  for(const entry of selectedFiles){const row=document.createElement('li');row.textContent=entry.file.name+' · '+entry.file.size.toLocaleString()+' bytes';selectedList.append(row);}
 };
 const syncSelectionContext=context=>{
  if(context===selectionContext)return;
  selectionContext=context;selectedFiles=[];input.value='';version++;clearPrepared();renderSelection();missing.replaceChildren();missing.hidden=true;result.textContent='';
 };
 clearFiles.onclick=()=>{
  if(selectionBusy)return;
  selectedFiles=[];input.value='';version++;clearPrepared();renderSelection();missing.replaceChildren();missing.hidden=true;result.textContent='Selected files cleared.';
 };
 const save=candidate=>{
  const url=URL.createObjectURL(candidate.blob),a=document.createElement('a');a.href=url;
  a.download=candidate.missing?'scopesignal-delivery-bundle-INCOMPLETE.zip':'scopesignal-delivery-bundle.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),2500);
  if(menu){menu.open=false;menu.querySelector('summary').focus();}
 };
 const confirmCurrent=async(candidate,own)=>{
  const report=await getReport();
  if(!report||own!==version||prepared!==candidate||JSON.stringify(getContext())!==preparedContext||reviewKey(report)!==preparedReview)
   throw Error('The review or file selection changed. Download the delivery again.');
 };
 input.onchange=async()=>{
  if(selectionBusy)return;
  const incoming=Array.from(input.files);if(!incoming.length)return;
  const context=JSON.stringify(getContext());syncSelectionContext(context);
  const own=++version;clearPrepared();missing.replaceChildren();missing.hidden=true;
  selectionBusy=true;input.disabled=button.disabled=shareButton.disabled=clearFiles.disabled=true;result.textContent='Adding selected files…';
  try{
   const next=await appendDeliverySelection(selectedFiles,incoming);
   if(own!==version||context!==JSON.stringify(getContext())){syncSelectionContext(JSON.stringify(getContext()));return;}
   selectedFiles=next;renderSelection();result.textContent=selectedFiles.length+' file'+(selectedFiles.length===1?'':'s')+' selected in total.';
  }catch(error){if(own===version)result.textContent=(error.message||'The selected files could not be read.')+(selectedFiles.length?' Earlier selections are kept.':'');}
  finally{selectionBusy=false;input.disabled=button.disabled=clearFiles.disabled=false;shareButton.disabled=shareBusy;}
 };
 button.onclick=async()=>{
  if(selectionBusy)return;
  syncSelectionContext(JSON.stringify(getContext()));
  const own=++version,requestedContext=JSON.stringify(getContext());clearPrepared();button.disabled=true;
  missing.replaceChildren();missing.hidden=true;result.textContent='Checking the saved review and delivery files…';
  try{
   const report=await getReport();if(!report)throw Error('Save a project review before downloading its delivery.');
   if(requestedContext!==JSON.stringify(getContext()))throw Error('The selected project changed. Download its delivery again.');
   if(!recordedFiles(report).length)throw Error('No reviewed file is attached to a saved decision. Choose Add file to review, then save the decision; a changes request can be exported without accepting the work.');
   const context=getContext(),retained=await retainedDeliveryFiles(report,context);
   const candidate=await prepareDeliveryBundle(report,[...retained.files,...selectedFiles.map(entry=>entry.file)],await loadReportAssets());
   if(own!==version)return;
   prepared=candidate;preparedContext=JSON.stringify(context);preparedReview=reviewKey(report);
   await confirmCurrent(candidate,own);
   if(candidate.missing){
    for(const file of candidate.manifest.files.filter(f=>!f.included)){const row=document.createElement('li');row.textContent=file.name;missing.append(row);}
    missing.hidden=false;chooser.open=true;
    result.textContent='Add '+candidate.missing+' missing file'+(candidate.missing===1?'':'s')+' to include the whole delivery.';
    if(candidate.rejected.length)result.textContent+=' These selections do not match the saved review: '+candidate.rejected.join(', ')+'.';
    partial.textContent='Download with '+candidate.missing+' missing file'+(candidate.missing===1?'':'s');partial.hidden=candidate.included===0;
   }else{
    save(candidate);chooser.open=false;clearPrepared();
    result.textContent='Downloaded client delivery with '+candidate.included+' file'+(candidate.included===1?'':'s')+'.';
    if(candidate.rejected.length)result.textContent+=' Unreviewed selections left out: '+candidate.rejected.join(', ')+'.';
   }
  }catch(error){if(own===version){clearPrepared();result.textContent=error.message||'The delivery could not be downloaded. Try again.';}}
  finally{button.disabled=selectionBusy;}
 };
 partial.onclick=async()=>{
  if(!prepared)return;const candidate=prepared,own=version;partial.disabled=true;
  try{await confirmCurrent(candidate,own);save(candidate);result.textContent='Downloaded with '+candidate.missing+' missing file'+(candidate.missing===1?'':'s')+' listed in the review.';}
  catch(error){clearPrepared();result.textContent=error.message||'The review changed. Download the delivery again.';}
  finally{partial.disabled=false;}
 };
 chooser.append(title,missing,input,selectedList,clearFiles);panel.append(shareButton,shareResult,invitation,copyLink,openPreview,button,result,chooser,partial);anchor.before(panel);
 const menu=panel.closest('.handoff-tools');
 if(menu){
  document.addEventListener('pointerdown',event=>{if(menu.open&&!menu.contains(event.target))menu.open=false;});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu.open){menu.open=false;menu.querySelector('summary').focus();}});
 }
 panel.syncSharing=syncActions;syncActions();
 return panel;
}
