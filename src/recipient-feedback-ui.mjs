import {openDeliveryKey,retainOpenDeliveryFile} from './local-delivery-storage.mjs';
import {renderMarkdownDocument} from './markdown-document.mjs';
import {createFeedbackImageReader} from './feedback-image-reader.mjs';
import {previewRecipientFeedback,recipientVersions,groupRecipientConversations} from './recipient-feedback.mjs';
import {readInspectionFile} from './artifact-comparison.mjs';
import {retainedDeliveryFiles} from './delivery-bundle.mjs';
import {buildLiveReview} from './live-review-export.mjs';
export function mountRecipientFeedback(anchor,{getState,refresh,act}){
 const element=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
 const panel=element('details');panel.className='client-feedback';
 const heading=element('summary','Client feedback');panel.append(heading);
 const note=element('p','Import the feedback file returned with a delivery. Review its version before saving the comments.');
 const label=element('label','Feedback file'),input=element('input');input.type='file';input.accept='.json,application/json';input.setAttribute('aria-label','Client feedback file');label.append(input);
 const preview=element('section'),save=element('button','Save client comments');save.type='button';save.hidden=true;
 const status=element('p');status.setAttribute('role','status');
 const saved=element('section');saved.setAttribute('aria-label','Saved client feedback');
 panel.append(note,label,preview,save,status,saved);anchor.after(panel);
 const responseDrafts=new Map(),imageUrls=new Set(),openReaders=new Set();
 const closeReaders=()=>{for(const close of [...openReaders])close();};
 let candidate=null,project=null,generation=0;
 const retainSelectedFile=(version,file,inspection)=>{
  const state=getState(),cp=state?.checkpoints.find(cp=>cp.id===version.checkpointId);
  if(cp)retainOpenDeliveryFile(openDeliveryKey({workspaceId:location.origin,projectId:state.projectId,checkpointId:cp.id,termsKey:JSON.stringify([cp.title,cp.amount,cp.proposedEvidence])}),file,inspection);
 };
 const row=(c,version,imported=false,threadReply=false)=>{
  let responseEditor=null;
  const attribution=element('p');attribution.className='feedback-attribution';
  if(imported){
   const author=element('strong',c.author);author.setAttribute('aria-label','Name supplied: '+c.author);
   attribution.append(author,element('small',new Date(c.authoredAt).toLocaleString()));
  }else attribution.textContent='Name supplied: '+c.author;
  const article=element('article');article.dataset.commentId=c.id;article.tabIndex=-1;
  const fileContext=imported?element('details'):article;
  if(imported){
   fileContext.className=threadReply?'reply-file-context':'conversation-file-context';
   fileContext.append(element('summary',threadReply?'File details':version.name+' · '+(version.current?'Current version':'Earlier version')));
   article.append(attribution);
  }
  fileContext.append(element('h3',version.title),element('strong',version.name),
   element('p',(version.current?'Current recorded version':'Earlier recorded version')+' · '+version.decision.split(' · ')[0]),
   element('small','Reviewed '+(version.recordedAt?new Date(version.recordedAt).toLocaleString():'date unavailable')));
  if(!imported)article.append(attribution);
  const fingerprint=element('details');fingerprint.append(element('summary','File fingerprint'),element('small','SHA-256 '+version.sha256));fileContext.append(fingerprint);
  if(c.replyTo){
   const parent=getState()?.recipientFeedback?.find(parent=>parent.id===c.replyTo);
   if(parent){
    const context=element(threadReply?'details':'section');context.dataset.replyTo=parent.id;context.className='reply-parent';
    const quote=element('blockquote',parent.comment);quote.style.cssText='margin:8px 0;white-space:pre-wrap;max-height:8em;overflow:auto';
    const jump=element('button','Go to original comment');jump.type='button';jump.dataset.originalComment=parent.id;
    jump.onclick=()=>{const original=[...saved.querySelectorAll('article[data-comment-id]')].find(e=>e.dataset.commentId===parent.id);if(original){original.scrollIntoView({block:'center'});original.focus({preventScroll:true});}};
    context.append(element(threadReply?'summary':'strong','Reply to '+parent.author),quote,jump);article.append(context);
   }
  }
  const comment=element('p',c.comment);comment.className='feedback-comment';article.append(comment);if(imported)article.append(fileContext);
  if(c.imagePoint){
   const view=element('details'),summary=element('summary','View marked image'),message=element('p'),viewer=element('div');
   viewer.className='feedback-point-viewer';viewer.style.cssText='overflow:auto;max-height:560px;background:#e9edf3;position:relative';
   const choice=element('label','Choose the recorded image'),file=element('input');file.type='file';file.accept='image/png,image/jpeg,image/webp,image/gif';choice.append(file);
   const size=element('button','Actual size');size.type='button';
   const sizing=element('div'),zoomLabel=element('label','Zoom '),zoom=element('select');
   sizing.className='feedback-image-size-controls';sizing.hidden=true;zoom.setAttribute('aria-label','Marked image zoom');
   for(const [value,label] of [['fit','Fit image'],['0.25','25%'],['0.5','50%'],['0.75','75%'],['1','100% (actual)'],['1.5','150%'],['2','200%']]){const option=element('option',label);option.value=value;zoom.append(option);}
   zoomLabel.append(zoom);sizing.append(size,zoomLabel);
   view.append(summary,message,choice,sizing,viewer);article.append(view);
   let prepareReading=()=>{};
   const reader=createFeedbackImageReader({article,view,viewer,size:sizing,prepareOpen:()=>prepareReading(),comment,attribution,title:version.name+' · '+(version.current?'Current recorded version':version.decision.split(' · ')[0]),getEditor:()=>responseEditor,onOpen:close=>openReaders.add(close),onClose:close=>openReaders.delete(close)});
   const projectId=getState()?.projectId;let loaded=false,url=null,selection=0;
   const display=async(selected,own)=>{
    if(own!==selection)return;
    reader.setReady(false);viewer.replaceChildren();sizing.hidden=true;if(url){URL.revokeObjectURL(url);imageUrls.delete(url);url=null;}
    const checked=await readInspectionFile(selected);
    if(checked.kind!=='image'||checked.sha!==version.sha256||checked.size!==version.bytes)throw Error('Choose the exact image recorded for this comment. This file does not match.');
    if(own!==selection||getState()?.projectId!==projectId||!article.isConnected)return;
    retainSelectedFile(version,selected,checked);
    const stage=element('div'),image=element('img'),marker=element('span','1');
    stage.style.cssText='position:relative;display:inline-block;vertical-align:top;max-width:100%';
    image.alt=version.name+' — marked client location';image.style.cssText='display:block;width:auto;max-width:100%;height:auto';
    marker.className='feedback-image-point';marker.setAttribute('aria-label','Client marked location');marker.style.cssText='position:absolute;transform:translate(-50%,-50%);border:2px solid white;border-radius:50%;background:#b44400;color:white;width:28px;height:28px;text-align:center;line-height:24px;box-shadow:0 1px 5px #0009;left:'+c.imagePoint.x*100+'%;top:'+c.imagePoint.y*100+'%';
    stage.append(image,marker);viewer.append(stage);url=URL.createObjectURL(selected);imageUrls.add(url);
    image.onload=()=>{if(own!==selection)return;sizing.hidden=false;reader.setReady(true);message.textContent='Exact recorded image · marked client location';};image.onerror=()=>{if(own!==selection)return;message.textContent='This browser could not display the recorded image.';};image.src=url;
    zoom.value='fit';size.textContent='Actual size';
    let explicitZoom=false,opened=false;
    const applyZoom=()=>{
     const fit=zoom.value==='fit',scale=Number(zoom.value);
     stage.style.maxWidth=fit?'100%':'none';stage.style.width=fit?'':image.naturalWidth*scale+'px';
     image.style.maxWidth=fit?'100%':'none';image.style.width=fit?'auto':'100%';
     size.textContent=fit?'Actual size':'Fit image';
     requestAnimationFrame(()=>viewer.scrollTo({left:c.imagePoint.x*image.clientWidth-viewer.clientWidth/2,top:c.imagePoint.y*image.clientHeight-viewer.clientHeight/2}));
    };
    prepareReading=()=>{if(opened)return;opened=true;if(!explicitZoom){zoom.value='1';applyZoom();}};
    zoom.onchange=()=>{explicitZoom=true;applyZoom();};size.onclick=()=>{explicitZoom=true;zoom.value=zoom.value==='fit'?'1':'fit';applyZoom();};
   };
   file.onchange=async()=>{if(!file.files[0])return;loaded=true;const own=++selection;try{await display(file.files[0],own);}catch(error){if(own===selection)message.textContent=error.message;}};
   view.addEventListener('toggle',async()=>{if(!view.open||loaded)return;loaded=true;const own=++selection;message.textContent='Looking for the recorded image in this browser…';try{const state=getState();const kept=await retainedDeliveryFiles(buildLiveReview(state),{workspaceId:location.origin,projectId:state.projectId});for(const selected of kept.files){if(own!==selection)return;const checked=await readInspectionFile(selected);if(checked.sha===version.sha256&&checked.size===version.bytes){await display(selected,own);return;}}if(own===selection)message.textContent='Choose the recorded image to see this location.';}catch{if(own===selection)message.textContent='Choose the recorded image to see this location.';}});
  }

  else {
   const view=element('details'),summary=element('summary','Read recorded file'),message=element('p'),viewer=element('div');
   viewer.className='feedback-point-viewer feedback-document-viewer';
   const choice=element('label','Choose the recorded file'),file=element('input');file.type='file';choice.append(file);
   const tools=element('div');tools.className='feedback-document-tools';tools.hidden=true;
   view.append(summary,message,choice,tools,viewer);article.append(view);
   const reader=createFeedbackImageReader({article,view,viewer,size:tools,comment,attribution,title:version.name+' · '+(version.current?'Current recorded version':version.decision.split(' · ')[0]),getEditor:()=>responseEditor,onOpen:close=>openReaders.add(close),onClose:close=>openReaders.delete(close),readLabel:'Read recorded file full screen',dialogLabel:'Recorded client file'});
   const projectId=getState()?.projectId;let loaded=false,url=null,selection=0;
   const display=async(selected,own)=>{
    if(own!==selection)return;
    reader.setReady(false);viewer.replaceChildren();tools.replaceChildren();tools.hidden=true;
    if(url){URL.revokeObjectURL(url);imageUrls.delete(url);url=null;}
    const checked=await readInspectionFile(selected);
    if(checked.sha!==version.sha256||checked.size!==version.bytes)throw Error('Choose the exact file recorded for this comment. This file does not match.');
    if(own!==selection||getState()?.projectId!==projectId||!article.isConnected)return;
    retainSelectedFile(version,selected,checked);
    url=URL.createObjectURL(selected);imageUrls.add(url);
    const original=element('a','Download original');original.href=url;original.download=version.name;tools.append(original);tools.hidden=false;
    if(checked.kind==='text'){
     const source=element('pre',checked.text);source.tabIndex=0;
     const markdown=!checked.truncated&&/\.md$/i.test(version.name)?renderMarkdownDocument(checked.text):null;
     if(markdown){
      const document=element('div');document.innerHTML=markdown;source.hidden=true;viewer.append(document,source);
      const toggle=element('button','Show source');toggle.type='button';toggle.onclick=()=>{source.hidden=!source.hidden;document.hidden=!source.hidden;toggle.textContent=source.hidden?'Show source':'Read document';};tools.prepend(toggle);
     }else viewer.append(source);
     if(checked.truncated)viewer.prepend(element('p','Partial preview: this file is larger than the inline reading limit. Download the original to read all of it.'));
    }else if(checked.kind==='pdf'){
     const frame=element('iframe');frame.title=version.name+' · exact recorded PDF';frame.src=url+'#view=FitH&navpanes=0';viewer.append(frame);
     const open=element('a','Open PDF');open.href=url;open.target='_blank';open.rel='noopener';tools.prepend(open);
    }else if(checked.kind==='image'){
     const image=element('img');image.alt=version.name+' · exact recorded image';image.src=url;viewer.append(image);
    }else viewer.append(element('p','This file has no inline preview. Download the exact original to inspect it in its normal application.'));
    message.textContent='Exact recorded file · this client comment';reader.setReady(checked.kind!=='other');
   };
   file.onchange=async()=>{if(!file.files[0])return;loaded=true;const own=++selection;try{await display(file.files[0],own);}catch(error){if(own===selection)message.textContent=error.message;}};
   view.addEventListener('toggle',async()=>{if(!view.open||loaded)return;loaded=true;const own=++selection;message.textContent='Looking for the recorded file in this browser…';try{const state=getState();const kept=await retainedDeliveryFiles(buildLiveReview(state),{workspaceId:location.origin,projectId:state.projectId});for(const selected of kept.files){if(own!==selection)return;const checked=await readInspectionFile(selected);if(checked.sha===version.sha256&&checked.size===version.bytes){await display(selected,own);return;}}if(own===selection)message.textContent='Choose the recorded file to read it beside this comment.';}catch{if(own===selection)message.textContent='Choose the recorded file to read it beside this comment.';}});
  }

  if(c.duplicate)article.append(element('small','Already saved — this comment will not be added again.'));
  if(imported)fileContext.append(element('small','Saved '+new Date(c.importedAt).toLocaleString()));

  if(imported){
   const history=c.responses??[];
   const responseRow=(r,latest)=>{
    const reply=element('section');reply.className='operator-response';
    if(latest)reply.classList.add('latest-response');
    reply.append(element('strong','Operator response · '+(r.state==='addressed'?'Addressed':'Needs follow-up')),element('small',new Date(r.recordedAt).toLocaleString()));
    const content=element('p',r.text);content.className='feedback-comment';reply.append(content);return reply;
   };
   if(history.length){
    article.append(responseRow(history.at(-1),true));
    if(history.length>1){
     const earlier=element('details');earlier.className='earlier-operator-responses';
     earlier.append(element('summary',history.length-1+' earlier operator response'+(history.length===2?'':'s')));
     for(const response of history.slice(0,-1))earlier.append(responseRow(response,false));
     article.append(earlier);
    }
   }
   const projectId=getState()?.projectId,key='scopesignal.response-draft.v1:'+JSON.stringify([projectId,c.id,c.versionKey]);
   let storageFailed=false;
   const forget=()=>{responseDrafts.delete(key);try{sessionStorage.removeItem(key);}catch{storageFailed=true;}};
   let draft=responseDrafts.get(key);
   if(!draft)try{
    const raw=sessionStorage.getItem(key);
    if(raw&&raw.length<=20000){
     const saved=JSON.parse(raw);
     if(saved?.version===1&&typeof saved.text==='string'&&saved.text.length<=2000&&['open','addressed'].includes(saved.state)
       &&(saved.id===null||typeof saved.id==='string'&&saved.id.length<=128)
       &&(saved.expectedCount===null||Number.isInteger(saved.expectedCount)&&saved.expectedCount>=0&&saved.expectedCount<=20))draft=saved;
    }
   }catch{storageFailed=true;}
   if(draft?.id&&history.some(response=>response.id===draft.id)){forget();draft=null;}
   draft??={version:1,text:'',state:history.at(-1)?.state??'open',id:null,expectedCount:null};
   const editor=element('details'),legend=element('summary',history.length?'Add a response':'Respond to this comment');
   const label=element('label','Your response'),area=element('textarea');area.maxLength=2000;area.rows=4;area.value=draft.text;label.append(area);
   const followLabel=element('label','Follow-up'),select=element('select');select.setAttribute('aria-label','Follow-up');
   for(const [value,title]of [['open','Needs follow-up'],['addressed','Addressed by operator']]){const option=element('option',title);option.value=value;select.append(option);}
   select.value=draft.state;followLabel.append(select);
   const draftNote=element('p');draftNote.className='response-draft-note';draftNote.setAttribute('role','status');
   const showDraftNote=()=>{draftNote.textContent=storageFailed?'This tab cannot save the draft. Copy your response before leaving or reloading.':draft.text?'Response draft saved in this tab. It has not been recorded.':'';};
   const persist=()=>{responseDrafts.set(key,draft);try{sessionStorage.setItem(key,JSON.stringify(draft));storageFailed=false;}catch{storageFailed=true;}showDraftNote();};
   const keep=()=>{draft.text=area.value;draft.state=select.value;draft.id=null;draft.expectedCount=null;persist();};
   area.addEventListener('input',keep);select.addEventListener('change',keep);
   const record=element('button','Record response');record.type='button';record.disabled=Boolean(getState()?.archivedAt);
   const message=element('p');message.setAttribute('role','status');
   const clear=element('button','Clear response draft');clear.type='button';clear.className='quiet';
   clear.onclick=()=>{forget();draft={version:1,text:'',state:history.at(-1)?.state??'open',id:null,expectedCount:null};area.value='';select.value=draft.state;showDraftNote();area.focus();};
   showDraftNote();
   responseEditor=editor;editor.open=Boolean(draft.text);editor.append(legend,label,followLabel,draftNote,record,clear,message);article.append(editor);
   record.onclick=async()=>{
    if(!area.value.trim()){message.textContent='Add your response before recording it.';area.focus();return;}
    const request={id:draft.id??crypto.randomUUID(),commentId:c.id,text:area.value,state:select.value,expectedCount:draft.expectedCount??history.length};
    draft.id=request.id;draft.text=area.value;draft.state=select.value;draft.expectedCount=request.expectedCount;persist();record.disabled=true;area.disabled=true;select.disabled=true;clear.disabled=true;
    try{
     if(!await refresh()||getState()?.projectId!==projectId)throw Error('The project changed. Return to the original comment before recording a response.');
     const outcome=await act('/api/recipient-response',{response:request,confirm:true});
     if(!outcome)throw Error('Recording was not confirmed. Refresh the project to inspect its response history.');
     forget();status.textContent=outcome.guidance;render();
    }catch(e){status.textContent=e.message;render();}
   };
  }

  return article;
 };
 const render=()=>{
  closeReaders();
  for(const url of imageUrls)URL.revokeObjectURL(url);imageUrls.clear();
  const state=getState();panel.hidden=!state?.project;
  if(project&&project!==state?.projectId){candidate=null;project=null;preview.replaceChildren();save.hidden=true;input.value='';generation++;}
  const versions=new Map(recipientVersions(state??{}).map(v=>[v.key,v]));
  saved.replaceChildren(element('h3','Saved client comments'));
  const comments=state?.recipientFeedback??[];
  if(!comments.length)saved.append(element('p','No client comments saved for this project.'));
  for(const conversation of groupRecipientConversations(comments)){
   for(const c of conversation.comments){
    const article=row(c,versions.get(c.versionKey)??{...c.version,current:false},true,c.id!==conversation.id);
    article.dataset.threadRoot=conversation.id;
    article.className=c.id===conversation.id?'saved-conversation-start':'saved-conversation-reply';
    saved.append(article);
   }
  }
 };
 input.onchange=async()=>{
  closeReaders();
  const own=++generation;candidate=null;save.hidden=true;preview.replaceChildren();status.textContent='';
  const file=input.files[0];if(!file)return;
  try{
   if(file.size>480*1024)throw Error('Choose a feedback JSON file smaller than 480 KB.');
   const selectedProject=getState()?.projectId;
   const parsed=JSON.parse(await file.text());
   if(own!==generation)return;
   if(!await refresh())throw Error('Refresh the project before importing feedback.');
   if(own!==generation||getState()?.projectId!==selectedProject)throw Error('The selected project changed. Choose the feedback file again.');
   const checked=previewRecipientFeedback(getState(),parsed);candidate=parsed;project=selectedProject;
   preview.append(element('h3','Review before saving'));
   for(const c of checked.comments)preview.append(row(c,c.version));
   status.textContent=checked.newCount+' new comment'+(checked.newCount===1?'':'s')+'. These comments do not change work acceptance or payment.';
   save.hidden=checked.newCount===0;
  }catch(e){status.textContent=e.message;candidate=null;}
 };
 save.onclick=async()=>{
  if(!candidate)return;
  const selected=candidate,selectedProject=project;save.disabled=true;
  try{
   if(!await refresh()||getState()?.projectId!==selectedProject)throw Error('The project changed. Choose the feedback file again.');
   previewRecipientFeedback(getState(),selected);
   const outcome=await act('/api/recipient-feedback',{feedback:selected,confirm:true});
   if(!outcome)throw Error('Saving was not confirmed. Refresh the project to check its saved comments.');
   candidate=null;project=null;preview.replaceChildren();save.hidden=true;input.value='';
   status.textContent=outcome.guidance;render();
  }catch(e){status.textContent=e.message;}
  finally{save.disabled=false;}
 };
 panel.addEventListener('toggle',()=>{if(panel.open)render()});
 render();return {render,panel};
}
