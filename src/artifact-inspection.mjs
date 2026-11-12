import {renderMarkdownDocument} from './markdown-document.mjs';
import {createReviewFileBinding} from './review-file-binding.mjs';
import { createLocalDeliveryStorage, openDeliveryKey, retainOpenDeliveryFile, getOpenDeliveryFile, forgetOpenDeliveryFile } from './local-delivery-storage.mjs';
import { mountPairedImageView } from './paired-image-view.mjs';
import { compareText, comparisonContext, readInspectionFile, MAX_COMPARISON_BYTES } from './artifact-comparison.mjs';
import { recordedFiles } from './delivery-bundle.mjs';

function ensureInspectionStyles() {
 if(document.getElementById('artifact-inspection-styles'))return;
 const link=document.createElement('link');
 link.id='artifact-inspection-styles';link.rel='stylesheet';
 link.href=new URL('../live-evidence.css',import.meta.url).href;
 document.head.append(link);
}
function fileSizeLabel(value) {
 if(!value)return '';
 const bytes=value.size;
 const size=bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':bytes>=1024?Math.ceil(bytes/1024)+' KB':bytes+' B';
 return value.kind.toUpperCase()+' · '+size;
}

// Local file inspection. File contents never leave this browser.
export function mountArtifactInspection(parent, findings, checkpoint={}, context={}) {
 ensureInspectionStyles();
 const make=(tag,value='',cls='')=>{const e=document.createElement(tag);e.textContent=value;e.className=cls;return e;};
 const reviews=checkpoint.reviewHistory||[];
 const readonly=!findings;
 const acceptedRefs=recordedFiles({checkpoints:[{...checkpoint,reviewHistory:[]}]});
 const storage=context.workspaceId&&context.projectId&&checkpoint.id?createLocalDeliveryStorage():null;
 const storageContext={workspaceId:context.workspaceId,projectId:context.projectId,checkpointId:checkpoint.id,
   termsKey:JSON.stringify([checkpoint.title,checkpoint.amount,checkpoint.proposedEvidence]),
   revisionKey:JSON.stringify([reviews.length,checkpoint.acceptedEvidence||'',checkpoint.approvedAt||'']),
   recorded:recordedFiles({checkpoints:[checkpoint]})};
 const openFileKey=openDeliveryKey(storageContext);
 let deliveredFile=null,earlierFile=null,saved=null,storageBusy=false,storageFailed=false;

 const panel=make('details','','artifact-inspection');
 panel.append(make('summary',readonly?'Accepted file':reviews.length?'Review revised file':'Review file'));
 const currentLabel=make('label','','artifact-pick-label');
 const picker=make('input');picker.type='file';picker.setAttribute('aria-label','Delivered file to inspect');currentLabel.append(picker);
 const currentFile=make('div','','artifact-current-file');
 const currentName=make('span');
 const changeCurrent=make('button','Change file','quiet');changeCurrent.type='button';changeCurrent.onclick=()=>picker.click();
 currentFile.append(currentName,changeCurrent);currentFile.hidden=true;
 const status=make('p','','artifact-file-status');status.setAttribute('role','status');
 const preview=make('div','','artifact-preview');
 const compareToggle=make('button','Compare versions','quiet');compareToggle.type='button';compareToggle.setAttribute('aria-expanded','false');
 const earlierPanel=make('section','','artifact-earlier artifact-file-callout');earlierPanel.hidden=true;earlierPanel.dataset.callout='1';
 const earlierHeading=make('div','','artifact-file-heading');
 const earlierRole=make('span','Earlier file','artifact-file-role'),earlierSize=make('span','','artifact-file-size');
 earlierHeading.append(earlierRole,earlierSize);earlierPanel.append(earlierHeading);
 const earlierLabel=make('label','','artifact-pick-label');
 const earlierPicker=make('input');earlierPicker.type='file';earlierPicker.setAttribute('aria-label','Earlier delivered file to compare');earlierLabel.append(earlierPicker);
 const earlierFileRow=make('div','','artifact-current-file');
 const earlierName=make('span');
 const changeEarlier=make('button','Change earlier file','quiet');changeEarlier.type='button';changeEarlier.onclick=()=>earlierPicker.click();
 earlierFileRow.append(earlierName,changeEarlier);earlierFileRow.hidden=true;
 const reviewChoice=make('select');reviewChoice.setAttribute('aria-label','Earlier saved review');
 reviews.forEach((review,i)=>{const option=make('option','Review '+(i+1)+' · '+review.at);option.value=String(i);reviewChoice.append(option);});
 reviewChoice.value=String(Math.max(0,reviews.length-1));
 const referenceHint=make('p','','artifact-reference-hint');
 const earlierStatus=make('p','','artifact-file-status');earlierStatus.setAttribute('role','status');
 const filesMenu=make('details','','artifact-files-menu');filesMenu.open=true;
 const filesSummary=make('summary','Choose delivered file');filesMenu.append(filesSummary);
 const fileInputs=make('div','','artifact-file-inputs');
 const deliveredPanel=make('section','','artifact-delivered artifact-file-callout');deliveredPanel.dataset.callout='1';
 const deliveredHeading=make('div','','artifact-file-heading');
 const deliveredRole=make('span',readonly?'Accepted file':'Delivered file','artifact-file-role'),deliveredSize=make('span','','artifact-file-size');
 deliveredHeading.append(deliveredRole,deliveredSize);deliveredPanel.append(deliveredHeading,currentLabel,currentFile,status);
 fileInputs.append(deliveredPanel,earlierPanel);
 const comparison=make('section','','artifact-comparison');comparison.setAttribute('aria-label','Delivery version comparison');
 const include=make('button','Add file to review');include.type='button';include.className='quiet';include.disabled=true;include.dataset.action='attach-reviewed-file';
 const reviewedFiles=findings?createReviewFileBinding(findings):null;
 let selected=null, earlier=null, generation=0, earlierGeneration=0, comparing=false;
 let currentUrl=null, earlierUrl=null;
 function updateAttachment(){
   const attached=reviewedFiles?.has(selected);
   include.textContent=attached?'File attached · Review':'Add file to review';
   include.setAttribute('aria-label',attached?'File attached. Return to your review':'Add file to review');
   include.disabled=!selected;
   include.hidden=!selected;
 }
 findings?.addEventListener('reviewfileschange',updateAttachment);
 function references(){
   const review=reviews[Number(reviewChoice.value)];
   return review?recordedFiles({checkpoints:[{id:checkpoint.id||'current',title:checkpoint.title||'Current milestone',reviewHistory:[review]}]}):[];
 }
 function updateReferenceHint(){
   const refs=references();
   referenceHint.textContent=refs.length?'Choose '+refs.map(r=>r.name).join(' or '):'';
   referenceHint.hidden=!refs.length;
 }
 function releaseCurrent(){deliveredFile=null;if(currentUrl)URL.revokeObjectURL(currentUrl);currentUrl=null;selected=null;}
 function releaseEarlier(){earlierFile=null;if(earlierUrl)URL.revokeObjectURL(earlierUrl);earlierUrl=null;earlier=null;}
 function filePreview(value,label,url,single=false){
   const figure=make('figure','','artifact-version');
   if(!single){
     const caption=make('figcaption',label);caption.dataset.callout=label.startsWith('Earlier')?'1':comparing?'2':'1';
     figure.append(caption,make('p',value.name,'artifact-version-name'));
   }
   if(value.kind==='image'){
     const viewport=make('div','','artifact-image-viewport');viewport.setAttribute('aria-label',label+' image');
     const img=make('img');img.src=url;img.alt=label+': '+value.name;viewport.append(img);figure.append(viewport);
     img.addEventListener('error',()=>{img.replaceWith(make('p','Cannot preview this image. Open the original file.'));},{once:true});
   }else if(value.kind==='pdf'){
     const open=make('a','Open PDF');open.href=url;open.target='_blank';open.rel='noopener noreferrer';open.className='quiet';
     figure.append(open);
     if(navigator.pdfViewerEnabled===false){
       open.textContent='Download PDF';open.download=value.name;
     }else{
       const frame=make('iframe');frame.src=url+'#view=FitH&navpanes=0';frame.title=label+' PDF';frame.width='100%';frame.height='600';frame.setAttribute('frameborder','0');frame.referrerPolicy='no-referrer';frame.className='artifact-pdf';
       frame.addEventListener('error',()=>{frame.replaceWith(make('p','This browser could not display the PDF. Open PDF to inspect it.'));},{once:true});
       figure.append(frame);
     }
   }else if(value.kind==='text'){
     const pre=make('pre',value.text);pre.className='artifact-text-source';pre.tabIndex=0;pre.setAttribute('aria-label',label+' text');figure.append(pre);
     const formatted=single&&!value.truncated&&/\.md$/i.test(value.name)?renderMarkdownDocument(value.text):null;
     if(formatted){
       const documentView=make('div','','artifact-document-view');documentView.innerHTML=formatted;documentView.tabIndex=0;documentView.setAttribute('aria-label',label+' document');
       const controls=make('div','','artifact-document-controls'),toggle=make('button','Show source','quiet');
       toggle.type='button';toggle.setAttribute('aria-pressed','false');pre.hidden=true;
       toggle.onclick=()=>{const showSource=pre.hidden;pre.hidden=!showSource;documentView.hidden=showSource;toggle.textContent=showSource?'Read document':'Show source';toggle.setAttribute('aria-pressed',String(showSource));};
       controls.append(toggle);figure.append(controls,documentView);
     }
     if(value.truncated)figure.append(make('p','Partial preview · first '+MAX_COMPARISON_BYTES.toLocaleString()+' bytes','artifact-limit'));
   }else figure.append(make('p',value.decodeProblem?'Unsupported text encoding. Open the original file.':'Preview unavailable. Open the original file.'));
   if(single&&value.kind==='image'){const controls=mountPairedImageView(figure);if(controls)figure.insertBefore(controls,figure.querySelector('.artifact-image-viewport'));}
   return figure;
 }
 function renderComparison(){
   reviewedFiles?.setDisplayed(selected);
   updateAttachment();
   const currentFocused=document.activeElement===picker,earlierFocused=document.activeElement===earlierPicker;
   const validEarlier=earlier&&(!references().length||references().some(ref=>ref.sha256===earlier.sha&&ref.bytes===earlier.size));
   const complete=Boolean(selected&&(!comparing||validEarlier));
   if(filesMenu.dataset.complete!==String(complete))filesMenu.open=!complete;
   filesMenu.dataset.complete=String(complete);
   filesSummary.textContent=selected?(comparing?selected.name+' · 2 versions':selected.name):'Choose delivered file';
   deliveredPanel.dataset.callout=comparing?'2':'1';
   deliveredRole.textContent=comparing?'Revised file':readonly?'Accepted file':'Delivered file';
   deliveredSize.textContent=fileSizeLabel(selected);earlierSize.textContent=fileSizeLabel(earlier);
   currentLabel.hidden=Boolean(selected);currentFile.hidden=!selected;
   currentName.textContent=selected?selected.name:'';
   earlierLabel.hidden=Boolean(earlier);earlierFileRow.hidden=!earlier;
   earlierName.textContent=earlier?earlier.name:'';
   if(selected&&currentFocused)(filesMenu.open?changeCurrent:filesSummary).focus();
   if(earlier&&earlierFocused)(filesMenu.open?changeEarlier:filesSummary).focus();
   referenceHint.hidden=Boolean(earlier)||!references().length;
   comparison.replaceChildren();preview.replaceChildren();comparison.hidden=!comparing;
   if(selected&&!comparing){preview.append(filePreview(selected,'Delivered file',currentUrl,true));return;}
   if(!comparing)return;
   if(!selected||!earlier){
     if(selected)preview.append(filePreview(selected,'Revised file',currentUrl,true));
     comparison.append(make('p',selected?'Choose an earlier file.':'Choose the delivered and earlier files.'));return;
   }
   const refs=references();
   const matched=refs.find(ref=>ref.sha256===earlier.sha&&ref.bytes===earlier.size);
   const identity=make('p','','artifact-comparison-identity');
   identity.setAttribute('role','status');
   if(refs.length&&!matched){
     identity.classList.add('warning');
     identity.textContent='Wrong earlier file. Choose '+refs.map(r=>r.name).join(' or ')+' from review '+(Number(reviewChoice.value)+1)+'.';
     comparison.append(identity,filePreview(selected,'Revised file',currentUrl,true));return;
   }
   identity.textContent=matched?'Review '+(Number(reviewChoice.value)+1)+' matched'
     :'Selected versions';
   comparison.append(identity);
   if(selected.sha===earlier.sha){
     comparison.append(make('h4','No file changes'),filePreview(selected,'Delivered file',currentUrl,true));return;
   }
   if(selected.kind==='text'&&earlier.kind==='text'&&!selected.truncated&&!earlier.truncated){
     const diff=compareText(earlier.text,selected.text);
     if(!diff.limited){
       const heading=make('div','','artifact-comparison-heading');heading.append(make('h4','Changes'),make('p',diff.removed+' line'+(diff.removed===1?'':'s')+' removed · '+diff.added+' line'+(diff.added===1?'':'s')+' added','artifact-diff-count'));comparison.append(heading);
       const legend=make('p','− Earlier / + Revised','artifact-diff-legend');comparison.append(legend);
       const changedEndings=new Map();
       for(const row of diff.rows){
         if(row.kind==='same')continue;
         const body=row.text.replace(/\r\n$|\r$|\n$/,'');
         const endings=changedEndings.get(body)||new Set();endings.add(row.text.slice(body.length));changedEndings.set(body,endings);
       }
       const detail=make('div','','artifact-diff');detail.tabIndex=0;detail.setAttribute('aria-label','Exact text changes');
       for(const row of comparisonContext(diff.rows,1)){
         if(row.kind==='gap'){detail.append(make('p',row.count+' unchanged line'+(row.count===1?'':'s'),'artifact-diff-gap'));continue;}
         const line=make('div','','artifact-diff-row '+row.kind);
         const numbers=make('span',(row.oldLine??'–')+' / '+(row.newLine??'–'),'artifact-line-numbers');
         numbers.setAttribute('aria-label','Earlier line '+(row.oldLine??'none')+', revised line '+(row.newLine??'none'));
         const marker=make('span',row.kind==='added'?'+':row.kind==='removed'?'−':' ','artifact-diff-marker');
         marker.setAttribute('aria-label',row.kind==='same'?'Unchanged':row.kind==='added'?'Added':'Removed');
         const code=make('code',row.text.replace(/\r\n$|\r$|\n$/,'')||' ');
         line.append(numbers,marker,code);
         if(row.kind!=='same'&&(!/[\r\n]$/.test(row.text)||changedEndings.get(row.text.replace(/\r\n$|\r$|\n$/,''))?.size>1)){
           const ending=make('span',row.text.endsWith('\r\n')?'CRLF':row.text.endsWith('\r')?'CR':row.text.endsWith('\n')?'LF':'no final newline','artifact-line-ending');
           line.append(ending);
         }
         detail.append(line);
       }
       comparison.append(detail);
       const originals=make('details','','artifact-full-versions');originals.append(make('summary','Full versions'));
       const pair=make('div','','artifact-version-pair');pair.append(filePreview(earlier,'Earlier file',earlierUrl),filePreview(selected,'Revised file',currentUrl));originals.append(pair);comparison.append(originals);
       return;
     }
     comparison.append(make('p',diff.reason+' Both files remain available below.','artifact-limit'));
   }else if(selected.truncated||earlier.truncated){
     comparison.append(make('p','Full text comparison is limited to '+MAX_COMPARISON_BYTES.toLocaleString()+' bytes per file. These previews may be partial; inspect the complete files in their normal application.','artifact-limit'));
   }
   const pair=make('div','','artifact-version-pair');pair.append(filePreview(earlier,'Earlier file',earlierUrl),filePreview(selected,'Revised file',currentUrl));
   const imageControls=mountPairedImageView(pair);if(imageControls)comparison.append(imageControls);
   comparison.append(pair);
 }
 picker.onchange=async()=>{
   const current=++generation;releaseCurrent();include.disabled=true;renderComparison();updateStorageButtons();
   const file=picker.files?.[0];if(!file){if(openFileKey)forgetOpenDeliveryFile(openFileKey);status.textContent='No file selected.';return;}
   status.textContent='Reading delivered file…';
   try{
     const value=await readInspectionFile(file);if(current!==generation||!panel.isConnected)return;
     if(readonly&&!acceptedRefs.some(ref=>ref.sha256===value.sha&&ref.bytes===value.size))throw Error('Choose the file recorded in the accepted review.');
     deliveredFile=file;selected=value;retainOpenDeliveryFile(openFileKey,file,value);if(value.kind==='image'||value.kind==='pdf')currentUrl=URL.createObjectURL(value.kind==='pdf'?new Blob([file],{type:'application/pdf'}):file);
     status.textContent='';
     include.disabled=false;renderComparison();updateStorageButtons();
   }catch(error){if(current===generation){status.textContent=error.message||'Unable to read this file. Choose it again.';renderComparison();}}
 };
 earlierPicker.onchange=async()=>{
   const current=++earlierGeneration;releaseEarlier();renderComparison();updateStorageButtons();
   const file=earlierPicker.files?.[0];if(!file){earlierStatus.textContent='No earlier file selected.';return;}
   earlierStatus.textContent='Reading earlier file…';
   try{
     const value=await readInspectionFile(file);if(current!==earlierGeneration||!panel.isConnected)return;
     earlierFile=file;earlier=value;retainOpenDeliveryFile(openFileKey,file,value);if(deliveredFile&&selected)retainOpenDeliveryFile(openFileKey,deliveredFile,selected);if(value.kind==='image'||value.kind==='pdf')earlierUrl=URL.createObjectURL(value.kind==='pdf'?new Blob([file],{type:'application/pdf'}):file);
     earlierStatus.textContent='';
     renderComparison();updateStorageButtons();
   }catch(error){if(current===earlierGeneration){earlierStatus.textContent=error.message||'Unable to read this earlier file. Choose it again.';renderComparison();}}
 };
 reviewChoice.onchange=()=>{updateReferenceHint();renderComparison();};
 function setComparison(value,focus=false){
   comparing=value;panel.classList.toggle('is-comparing',comparing);earlierPanel.hidden=!comparing;compareToggle.setAttribute('aria-expanded',String(comparing));
   compareToggle.textContent=comparing?'Close comparison':'Compare versions';
   fileInputs.prepend(comparing?earlierPanel:deliveredPanel);renderComparison();
   if(focus&&comparing)(earlier?changeEarlier:earlierPicker).focus();
   if(focus&&!comparing&&selected){filesMenu.open=false;filesSummary.focus({preventScroll:true});}
 }
 compareToggle.onclick=()=>setComparison(!comparing,true);
 include.onclick=()=>{
   if(!selected||!findings)return;
   try{reviewedFiles.attach(selected);}
   catch(error){status.textContent=error.message;return;}
   findings.focus();findings.scrollIntoView({block:'center'});status.textContent='';
 };
 if(reviews.length>1){const label=make('label','Compare against saved review');label.append(reviewChoice);earlierPanel.append(label);}
 earlierPanel.append(earlierLabel,earlierFileRow,earlierStatus,referenceHint);
 const toolbar=make('div','','artifact-toolbar');if(!readonly)toolbar.append(include);
 const retained=make('details','','artifact-retention');
 const retainedSummary=make('summary','Keep files in this browser');
 const retainedControls=make('div','','artifact-toolbar');
 const keep=make('button','Keep selected files','quiet'),reopen=make('button','Reopen saved files','quiet'),forget=make('button','Forget saved files','quiet');
 for(const button of [keep,reopen,forget])button.type='button';
 const storageStatus=make('p','','artifact-file-status');storageStatus.setAttribute('role','status');
 retainedControls.append(keep,reopen,forget);retained.append(retainedSummary,retainedControls,storageStatus);
 function restorable(){
   const files={delivered:null,earlier:null};
   if(!readonly&&saved?.pending)Object.assign(files,saved.pending);
   const items=saved?.recorded||[];
   if(readonly)files.delivered=items.find(item=>acceptedRefs.some(ref=>ref.sha256===item.sha256&&ref.bytes===item.bytes))?.file||null;
   if(!files.earlier)files.earlier=items.find(item=>references().some(ref=>ref.sha256===item.sha256&&ref.bytes===item.bytes))?.file||null;
   return files;
 }
 function updateStorageButtons(){
   keep.disabled=storageBusy||!deliveredFile&&!earlierFile;
   const files=restorable();reopen.hidden=!files.delivered&&!files.earlier;reopen.disabled=storageBusy;
   forget.hidden=!saved?.hasSavedFiles&&!storageFailed;forget.disabled=storageBusy;
   retainedSummary.textContent=saved?.hasSavedFiles?'Saved files in this browser':'Keep files in this browser';
 }
 async function storageAction(action){
   if(storageBusy)return;storageBusy=true;updateStorageButtons();storageStatus.textContent='';
   try{await action();storageFailed=false;}catch(error){storageFailed=true;storageStatus.textContent=error.message||'Browser files unavailable. Try again.';retained.open=true;}
   finally{storageBusy=false;updateStorageButtons();}
 }
 keep.onclick=()=>storageAction(async()=>{
   await storage.remember(storageContext,{delivered:deliveredFile,earlier:earlierFile});
   saved=await storage.load(storageContext);storageStatus.textContent='Files saved.';
 });
 async function restoreSavedFiles(files,automatic=false){
   if(!panel.isConnected)return false;
   // A late IndexedDB reply must not replace a file selected while the page was opening.
   if(automatic&&(generation||earlierGeneration||picker.files?.length||earlierPicker.files?.length))return false;
   const initialGeneration=generation,initialEarlierGeneration=earlierGeneration;
   const choose=async(input,file)=>{
     if(!file||!panel.isConnected)return;
     const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;await input.onchange();
   };
   await choose(picker,files.delivered);
   if(automatic&&(generation!==initialGeneration+(files.delivered?1:0)||earlierGeneration!==initialEarlierGeneration))return false;
   if(files.delivered&&!selected)return false;
   await choose(earlierPicker,files.earlier);
   if(files.earlier&&!comparing)setComparison(true,!automatic);
   if(automatic&&selected)panel.open=true;
   return !!(files.delivered||files.earlier);
 }
 reopen.onclick=()=>storageAction(async()=>{
   saved=await storage.load(storageContext);
   const restored=await restoreSavedFiles(restorable());
   storageStatus.textContent=restored?'Saved files reopened.':'No saved files match this review.';
 });
 forget.onclick=()=>storageAction(async()=>{await storage.forget(storageContext);saved=null;storageStatus.textContent='Saved files forgotten.';});
 filesMenu.append(fileInputs);toolbar.prepend(compareToggle);
 const inspectionTools=make('div','','artifact-inspection-tools');inspectionTools.append(filesMenu,toolbar);
 panel.append(inspectionTools,preview,comparison);if(storage)panel.append(retained);parent.append(panel);
 updateStorageButtons();
 const openFile=getOpenDeliveryFile(openFileKey);
 const restoreAccepted=async(file)=>{
   if(!file||selected||!panel.isConnected)return;
   const transfer=new DataTransfer();transfer.items.add(file);picker.files=transfer.files;
   await picker.onchange();
   if(selected)panel.open=true;
 };
 const restoringOpen=Promise.resolve().then(()=>{
   if(readonly&&openFile&&acceptedRefs.some(ref=>ref.sha256===openFile.sha&&ref.bytes===openFile.bytes))return restoreAccepted(openFile.file);
 });
 if(storage)storageAction(async()=>{
   saved=await storage.load(storageContext);
   if(readonly){
     await restoringOpen;
     // The accepted file may already survive the same-tab rerender in memory.
     // Recover its exact recorded earlier version without replacing that file.
     if(selected){
       const file=restorable().earlier;
       if(file&&!earlier&&!earlierGeneration&&!earlierPicker.files?.length){
         const transfer=new DataTransfer();transfer.items.add(file);
         earlierPicker.files=transfer.files;
         await earlierPicker.onchange();
         if(earlier&&!comparing)setComparison(true,false);
       }
       return;
     }
   }
   // Only a file the user explicitly kept, with the same review context, comes back.
   // After a decision changes, only exact recorded file identities may be restored.
   if(!readonly&&!saved?.pending)return;
   await restoreSavedFiles(restorable(),true);
 });

 updateReferenceHint();renderComparison();
 const observer=new MutationObserver(()=>{
   if(!panel.isConnected){generation++;earlierGeneration++;releaseCurrent();releaseEarlier();observer.disconnect();}
 });
 observer.observe(document.body,{childList:true,subtree:true});
 return panel;
}
