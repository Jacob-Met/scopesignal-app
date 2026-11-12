import {renderMarkdownDocument} from './markdown-document.mjs';
import {recordedFiles} from './review-file-references.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function recipientVersions(report){
 const versions=[];
 for(const cp of report.checkpoints??[]){
  for(const file of recordedFiles({checkpoints:[cp]})){
   for(const decision of file.decisions.filter(d=>d.checkpointId===cp.id)){
    const accepted=decision.decision==='Accepted delivery';
    const recordedAt=accepted?(cp.acceptedAt??cp.approvedAt):decision.decision.split(' · ').slice(1).join(' · ');
    const latest=(cp.reviewHistory??[]).at(-1);
    const current=accepted||(!(cp.acceptedAt??cp.approvedAt)&&decision.decision==='Revision request '+(cp.reviewHistory??[]).length+' · '+latest?.at);
    versions.push({key:cp.id+'|'+file.sha256+'|'+decision.decision,checkpointId:cp.id,title:cp.title,
      name:file.name,sha256:file.sha256,bytes:file.bytes,decision:decision.decision,recordedAt:recordedAt??null,current});
   }
  }
 }
 return versions;
}
const projectIdentity=state=>state.projectId??state.id??state.project?.id;
const validText=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
export function normalizeImagePoint(value){
 if(value===undefined||value===null)return null;
 if(typeof value!=='object'||Array.isArray(value)||!Number.isFinite(value.x)||!Number.isFinite(value.y)||value.x<0||value.x>1||value.y<0||value.y>1)throw Error('The image location must be inside the selected image.');
 return {x:value.x,y:value.y};
}
export function previewRecipientFeedback(state,input){
 if(input?.schema!=='scopesignal.recipient-feedback'||![1,2,3].includes(input.version))throw Error('Choose a ScopeSignal client feedback file.');
 if(!projectIdentity(state)||input.projectId!==projectIdentity(state))throw Error('This feedback belongs to a different project. Open its original project before importing.');
 if(!Array.isArray(input.comments)||input.comments.length<1||input.comments.length>20)throw Error('A feedback file must contain 1–20 comments.');
 const versions=new Map(recipientVersions(state).map(v=>[v.key,v]));
 const existing=state.recipientFeedback??[],seen=new Set();
 const comments=input.comments.map(item=>{
  if(!item||!validText(item.id,100)||!/^[a-zA-Z0-9-]+$/.test(item.id)||seen.has(item.id))throw Error('The feedback contains an invalid or repeated comment identity.');
  seen.add(item.id);
  if(!validText(item.comment,2000)||!validText(item.author,120))throw Error('Each comment needs a name and up to 2,000 characters of feedback.');
  if(typeof item.authoredAt!=='string'||!Number.isFinite(Date.parse(item.authoredAt)))throw Error('A feedback comment has an invalid date.');
  const version=versions.get(item.versionKey);
  if(!version)throw Error('A commented delivery version is not in this project’s recorded review history. No comments were imported.');
  const imagePoint=normalizeImagePoint(item.imagePoint);
  if(imagePoint&&input.version<2)throw Error('Image locations require the current feedback format. Download the feedback again from the current reader.');
  if(imagePoint&&!/\.(png|jpe?g|webp|gif)$/i.test(version.name))throw Error('An image location needs a recorded image version.');
  let replyTo;
  if(item.replyTo!==undefined&&item.replyTo!==null){
   if(input.version!==3)throw Error('Replies require the current feedback format. Download the feedback again from the current reader.');
   if(!validText(item.replyTo,100)||!/^[a-zA-Z0-9-]+$/.test(item.replyTo)||item.replyTo===item.id)throw Error('The original comment identity is invalid.');
   const parent=existing.find(c=>c.id===item.replyTo),previousIndex=existing.findIndex(c=>c.id===item.id);
   if(!parent||parent.versionKey!==version.key)throw Error('The original comment is not saved on this exact version. No comments were imported.');
   if(previousIndex>=0&&existing.indexOf(parent)>=previousIndex)throw Error('A saved reply must follow its original comment.');
   replyTo=parent.id;
  }
  const normalized={...(replyTo?{replyTo}:{}),id:item.id,versionKey:version.key,comment:item.comment.trim(),author:item.author.trim(),authoredAt:item.authoredAt,...(imagePoint?{imagePoint}:{})};
  const previous=existing.find(c=>c.id===item.id);
  if(previous&&JSON.stringify([previous.versionKey,previous.comment,previous.author,previous.authoredAt,previous.imagePoint??null,previous.replyTo??null])!==JSON.stringify([normalized.versionKey,normalized.comment,normalized.author,normalized.authoredAt,normalized.imagePoint??null,normalized.replyTo??null]))throw Error('A saved comment has the same identity but different contents. No comments were imported.');
  return {...normalized,version,duplicate:Boolean(previous)};
 });
 if(existing.length+comments.filter(c=>!c.duplicate).length>500)throw Error('This project already has too many feedback comments to import this file.');
 return {comments,newCount:comments.filter(c=>!c.duplicate).length};
}
export function appendRecipientFeedback(state,input,importedAt=new Date().toISOString()){
 const preview=previewRecipientFeedback(state,input);
 return [...(state.recipientFeedback??[]),...preview.comments.filter(c=>!c.duplicate).map(({duplicate,...c})=>({...c,importedAt}))];
}

export function recipientResponseHistory(comment){
 const responses=comment.responses??[];
 if(!Array.isArray(responses)||responses.length>20)throw Error('A comment can retain up to 20 operator responses.');
 const ids=new Set();
 return responses.map(r=>{
  if(!r||!validText(r.id,100)||! /^[a-zA-Z0-9-]+$/.test(r.id)||ids.has(r.id)||!validText(r.text,2000)||!['open','addressed'].includes(r.state)||typeof r.recordedAt!=='string'||!Number.isFinite(Date.parse(r.recordedAt)))throw Error('A saved operator response is invalid.');
  ids.add(r.id);return {id:r.id,text:r.text,state:r.state,recordedAt:r.recordedAt};
 });
}
export function appendRecipientResponse(state,input,recordedAt=new Date().toISOString()){
 const comments=state.recipientFeedback??[],comment=comments.find(c=>c.id===input?.commentId);
 if(!comment)throw Error('This client comment is not in the selected project.');
 if(!validText(input.id,100)||! /^[a-zA-Z0-9-]+$/.test(input.id)||!validText(input.text,2000)||!['open','addressed'].includes(input.state))throw Error('Add a response of up to 2,000 characters and choose its follow-up state.');
 const responses=recipientResponseHistory(comment),text=input.text.trim(),previous=responses.find(r=>r.id===input.id);
 if(previous){
  if(previous.text!==text||previous.state!==input.state)throw Error('This response identity was already saved with different contents.');
  return comments;
 }
 if(!Number.isSafeInteger(input.expectedCount)||input.expectedCount!==responses.length)throw Error('The response history changed. Review the latest response before recording yours.');
 if(responses.length>=20)throw Error('This comment already has 20 recorded operator responses.');
 if(typeof recordedAt!=='string'||!Number.isFinite(Date.parse(recordedAt)))throw Error('The response date is invalid.');
 const next={id:input.id,text,state:input.state,recordedAt};
 return comments.map(c=>c===comment?{...c,responses:[...responses,next]}:c);
}

export function savedRecipientFeedback(state){
 const saved=state.recipientFeedback??[];
 if(!Array.isArray(saved)||saved.length>500)throw Error('The saved client comments could not be exported.');
 const ids=new Set(),result=[];
 for(let offset=0;offset<saved.length;offset+=20){
  const preview=previewRecipientFeedback(state,{schema:'scopesignal.recipient-feedback',version:3,projectId:projectIdentity(state),comments:saved.slice(offset,offset+20)});
  for(const {duplicate,...comment} of preview.comments){
   if(ids.has(comment.id))throw Error('The saved client comments contain a repeated identity.');
   ids.add(comment.id);result.push({...comment,responses:recipientResponseHistory(saved.find(c=>c.id===comment.id))});
  }
 }
 return result;
}
export function restoreRecipientDraft(input,data,normalizePoint=normalizeImagePoint){
 if(!input||input.schema!=='scopesignal.recipient-draft'||input.version!==1||input.projectId!==data.projectId)return null;
 const known=new Set(data.versions.map(v=>v.key));
 const text=(v,max)=>typeof v==='string'&&v.length<=max;
 if(!known.has(input.versionKey)||!text(input.author,120)||!text(input.comment,2000)||!Array.isArray(input.comments)||input.comments.length>20)return null;
 const ids=new Set();
 const replyFor=(value,key,id)=>{
  if(value===undefined||value===null)return null;
  const parent=(data.savedComments??[]).find(c=>c.id===value);
  if(typeof value!=='string'||! /^[a-zA-Z0-9-]{1,100}$/.test(value)||value===id||!parent||parent.versionKey!==key)throw Error('Known original comment on this version required');
  return parent.id;
 };
 let replyTo;try{replyTo=replyFor(input.replyTo,input.versionKey);}catch{return null;}
 const pointFor=(value,key)=>{const point=normalizePoint(value);if(point&&!/\.(png|jpe?g|webp|gif)$/i.test(data.versions.find(v=>v.key===key)?.name??''))throw Error('Image version required');return point;};
 let imagePoint;try{imagePoint=pointFor(input.imagePoint,input.versionKey);}catch{return null;}
 for(const c of input.comments){
  if(!c||typeof c.id!=='string'||! /^[a-zA-Z0-9-]{1,100}$/.test(c.id)||ids.has(c.id)||!known.has(c.versionKey)||!text(c.author,120)||!c.author.trim()||!text(c.comment,2000)||!c.comment.trim()||typeof c.authoredAt!=='string'||!Number.isFinite(Date.parse(c.authoredAt)))return null;
  try{pointFor(c.imagePoint,c.versionKey);replyFor(c.replyTo,c.versionKey,c.id);}catch{return null;}
  ids.add(c.id);
 }
 let versionComments;
 if(input.versionComments!==undefined){
  if(!Array.isArray(input.versionComments)||input.versionComments.length>known.size)return null;
  const seen=new Set();
  for(const d of input.versionComments){
   if(!d||!known.has(d.versionKey)||seen.has(d.versionKey)||!text(d.comment,2000))return null;
   try{pointFor(d.imagePoint,d.versionKey);replyFor(d.replyTo,d.versionKey);}catch{return null;}
   seen.add(d.versionKey);
  }
  versionComments=input.versionComments.map(d=>({versionKey:d.versionKey,comment:d.comment,...(replyFor(d.replyTo,d.versionKey)?{replyTo:d.replyTo}:{}),...(normalizePoint(d.imagePoint)?{imagePoint:normalizePoint(d.imagePoint)}:{})}));
 }
 let readingOrigin=null;
 const current=data.versions.find(v=>v.key===input.versionKey),original=(data.savedComments??[]).find(c=>c.id===input.readingOrigin);
 if(current?.current&&typeof current.checkpointId==='string'&&typeof input.readingUrl==='string'&&input.readingUrl.length>0&&input.readingUrl.length<=4000&&original&&original.versionKey!==current.key&&data.versions.some(v=>v.key===original.versionKey&&v.checkpointId===current.checkpointId)){
  try{if(pointFor(original.imagePoint,original.versionKey)&&/\.(png|jpe?g|webp|gif)$/i.test(current.name??''))readingOrigin=original.id;}catch{}
 }
 return {schema:input.schema,version:1,projectId:data.projectId,...(readingOrigin?{readingOrigin,readingUrl:input.readingUrl,readingOpen:input.readingOpen===true}:{}),...(replyTo?{replyTo}:{}),versionKey:input.versionKey,author:input.author,comment:input.comment,...(imagePoint?{imagePoint}:{}),comments:input.comments.map(c=>({...(replyFor(c.replyTo,c.versionKey,c.id)?{replyTo:c.replyTo}:{}),id:c.id,versionKey:c.versionKey,author:c.author,comment:c.comment,authoredAt:c.authoredAt,...(normalizePoint(c.imagePoint)?{imagePoint:normalizePoint(c.imagePoint)}:{})})),...(versionComments?{versionComments}:{})};
}

export function groupRecipientConversations(comments){
 const byId=new Map(comments.map(c=>[c.id,c])),groups=new Map();
 for(const comment of comments){
  let root=comment;const seen=new Set([root.id]);
  while(root.replyTo&&byId.has(root.replyTo)&&!seen.has(root.replyTo)){
   const parent=byId.get(root.replyTo);
   if(parent.versionKey!==comment.versionKey)break;
   seen.add(parent.id);root=parent;
  }
  if(!groups.has(root.id))groups.set(root.id,{id:root.id,comments:[]});
  groups.get(root.id).comments.push(comment);
 }
 return [...groups.values()];
}

function recipientPage(data,restoreDraft,normalizePoint,groupConversations){
 const commentId=()=>{
  if(typeof crypto.randomUUID==='function')return crypto.randomUUID();
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
 };

 const byId=id=>document.getElementById(id),select=byId('feedback-version'),comments=[],identity=byId('version-identity'),status=byId('feedback-status');
 const text=(tag,value)=>{const e=document.createElement(tag);e.textContent=value;return e;};
 const appendResponses=(parent,responses=[])=>{
  if(!responses.length)return;
  const renderResponse=(response,latest=false)=>{
   const reply=document.createElement('section');reply.className='operator-response';
   if(latest)reply.dataset.latestResponse='true';
   reply.append(text('strong',(latest&&responses.length>1?'Latest operator response':'Operator response')+' · '+(response.state==='addressed'?'Addressed':'Needs follow-up')),text('small',new Date(response.recordedAt).toLocaleString()),text('p',response.text));
   return reply;
  };
  parent.append(renderResponse(responses.at(-1),true));
  if(responses.length>1){
   const history=document.createElement('details');history.className='response-history';
   history.append(text('summary','Earlier operator responses · '+(responses.length-1)));
   for(const response of responses.slice(0,-1))history.append(renderResponse(response));
   parent.append(history);
  }
 };

 let pendingReplyTo=null,pendingPoint=null,drawPoint=()=>{},openMarkedImage=()=>{},disposeImage=()=>{};
 const draftStatus=byId('feedback-draft-status'),storageKey='scopesignal.recipient-draft.v1:'+JSON.stringify([data.projectId,data.versions.map(v=>v.key).sort()]);
 const versionComments=new Map(),versionPoints=new Map(),versionReplies=new Map();
 let activeVersionKey=data.versions[Number(select.value)].key,requestedVersionMissing=false,restoredReadingOrigin=null,restoredReadingOpen=false;
 const saveDraft=()=>{
  if(requestedVersionMissing)return;
  versionComments.set(activeVersionKey,byId('feedback-comment').value);versionPoints.set(activeVersionKey,pendingPoint);versionReplies.set(activeVersionKey,pendingReplyTo);
  const draft={schema:'scopesignal.recipient-draft',version:1,...(readingOrigin?{readingOrigin:readingOrigin.id,readingUrl:location.href,readingOpen:Boolean(document.querySelector('.selected-reader.expanded'))}:{}),...(pendingReplyTo?{replyTo:pendingReplyTo}:{}),projectId:data.projectId,versionKey:data.versions[Number(select.value)].key,author:byId('feedback-name').value,comment:byId('feedback-comment').value,...(pendingPoint?{imagePoint:pendingPoint}:{}),comments,versionComments:[...versionComments].map(([versionKey,comment])=>({versionKey,comment,...(versionReplies.get(versionKey)?{replyTo:versionReplies.get(versionKey)}:{}),...(versionPoints.get(versionKey)?{imagePoint:versionPoints.get(versionKey)}:{})}))};
  try{history.replaceState({...history.state,[storageKey]:draft},'');draftStatus.textContent=data.liveSubmitUrl?'Draft kept in this tab. Send it before closing.':'Draft kept in this tab. Download your comments before closing it.';}
  catch{draftStatus.textContent='This browser cannot save the draft. Copy your words before leaving this page.';}
 };
 try{
  const raw=history.state?.[storageKey];
  if(raw){const draft=restoreDraft(raw,data,normalizePoint);if(!draft)throw Error('Invalid saved draft');
   select.value=String(data.versions.findIndex(v=>v.key===draft.versionKey));byId('feedback-name').value=draft.author;byId('feedback-comment').value=draft.comment;pendingReplyTo=draft.replyTo??null;pendingPoint=draft.imagePoint??null;comments.push(...draft.comments);
   for(const d of draft.versionComments??[]){versionComments.set(d.versionKey,d.comment);versionPoints.set(d.versionKey,d.imagePoint??null);versionReplies.set(d.versionKey,d.replyTo??null);}
   restoredReadingOrigin=draft.readingUrl===location.href?draft.readingOrigin??null:null;restoredReadingOpen=Boolean(restoredReadingOrigin&&draft.readingOpen);
   activeVersionKey=draft.versionKey;versionReplies.set(activeVersionKey,pendingReplyTo);versionComments.set(activeVersionKey,draft.comment);versionPoints.set(activeVersionKey,pendingPoint);
   draftStatus.textContent='Draft restored in this tab.';
  }
 }catch{draftStatus.textContent='The saved draft could not be restored. Download new comments before leaving.';}
 byId('feedback-name').addEventListener('input',saveDraft);byId('feedback-comment').addEventListener('input',saveDraft);
 byId('clear-feedback-draft').onclick=()=>{
  try{const next={...history.state};delete next[storageKey];history.replaceState(next,'');}catch{draftStatus.textContent='The saved draft could not be cleared. Browser storage is unavailable.';return;}
  comments.splice(0);versionComments.clear();versionPoints.clear();versionReplies.clear();pendingReplyTo=null;replySummary();pendingPoint=null;drawPoint();pointSummary();byId('feedback-name').value='';byId('feedback-comment').value='';render();draftStatus.textContent='Saved draft cleared.';status.textContent='Start a new comment when ready.';byId('feedback-name').focus();
 };
 const pointSummary=()=>{
  const area=byId('feedback-point');area.replaceChildren();if(!pendingPoint)return;
  area.append(text('span','Image location selected · '+Math.round(pendingPoint.x*100)+'% across, '+Math.round(pendingPoint.y*100)+'% down. '));
  const clear=text('button','Remove image location');clear.type='button';clear.onclick=()=>{pendingPoint=null;drawPoint();pointSummary();saveDraft();};area.append(clear);
 };
 const replySummary=()=>{
  const area=byId('feedback-reply-context');area.replaceChildren();area.hidden=!pendingReplyTo;
  const parent=data.savedComments.find(c=>c.id===pendingReplyTo);
  if(!parent)return;
  area.dataset.replyTo=parent.id;
  area.append(text('strong','Replying to '+parent.author),text('blockquote',parent.comment));
  const separate=text('button','Make this a separate comment');separate.type='button';
  separate.onclick=()=>{pendingReplyTo=null;replySummary();saveDraft();};area.append(separate);
 };
 const startReply=(comment,focus=true)=>{
  if(comment.versionKey!==activeVersionKey)return;
  if(byId('feedback-comment').value.trim()&&pendingReplyTo!==comment.id){
   status.textContent='Your unfinished comment is kept. Add it or clear it before replying to a different comment.';return;
  }
  pendingReplyTo=comment.id;replySummary();saveDraft();
  if(focus){byId('feedback-comment').scrollIntoView({block:'center'});byId('feedback-comment').focus();}
 };
 const imageViews=new Map(),textViews=new Map();
 const accept=byId('accept-version');let pendingDecisionId=null,sending=false;
 if(accept)accept.onchange=()=>render();
 let closeReading=()=>{},readingOrigin=(data.savedComments??[]).find(c=>c.id===restoredReadingOrigin)??null;
 const agreedWorkFor=v=>{
  if(!v.agreedWork)return null;
  const details=document.createElement('details');details.className='agreed-work';
  details.append(text('summary','Agreed work'),text('p',v.agreedWork));return details;
 };
 const currentImageFor=comment=>{
  const original=data.versions.find(v=>v.key===comment.versionKey);
  const current=data.versions.filter(v=>v.current&&v.checkpointId===original?.checkpointId&&v.key!==original?.key&&v.path&&v.previewKind==='image');
  return current.length===1?current[0]:null;
 };
 const readCurrentImage=comment=>{
  const current=currentImageFor(comment);if(!current)return;
  closeReading();readingOrigin=comment;select.value=String(data.versions.indexOf(current));select.onchange();
  byId('version-material').querySelector('.selected-reader .reader-controls > button')?.click();
 };
 const returnToMarkedRequest=comment=>{
  const index=data.versions.findIndex(v=>v.key===comment.versionKey);if(index<0)return;
  closeReading();readingOrigin=null;select.value=String(index);select.onchange();openMarkedImage(comment);
 };
 const showCommentPoint=c=>{
  closeReading();
  const previous=select.value,previousPoint=pendingPoint;
  const index=data.versions.findIndex(v=>v.key===c.versionKey);if(index<0)return;
  select.value=String(index);showVersion();
  openMarkedImage(c,()=>{select.value=previous;pendingPoint=previousPoint;showVersion();pointSummary();});
 };
 const pointLink=(parent,c)=>{if(!c.imagePoint)return;const button=text('button','Show image location');button.type='button';button.className='point-link';button.onclick=()=>showCommentPoint(c);parent.append(button);};
 document.addEventListener('keydown',event=>{if(event.key==='Escape'){const keepReading=Boolean(readingOrigin);closeReading();if(keepReading)saveDraft();}});
 const showVersion=()=>{
  closeReading();disposeImage();disposeImage=()=>{};drawPoint=()=>{};openMarkedImage=()=>{};
  const v=data.versions[Number(select.value)];
  const agreed=agreedWorkFor(v);byId('feedback-agreed-work').replaceChildren(...(agreed?[agreed]:[]));
  if(accept){const prior=data.decisions?.some(d=>d.versionKey===v.key&&d.action==='accept');accept.checked=false;accept.disabled=!v.current||!v.path||prior;byId('acceptance-note').textContent=prior?'Your acceptance is already recorded for this exact version.':!v.current?'Earlier versions can be commented on but not accepted.':!v.path?'The original file must be present before acceptance.':'This records your acceptance of the exact file shown, not a payment instruction.';}
  identity.replaceChildren(text('strong',v.title),text('p',v.name),text('p',(v.current?'Current recorded version':'Earlier recorded version')+' · '+v.decision.split(' · ')[0]+' · '+(v.recordedAt?new Date(v.recordedAt).toLocaleString():'Date unavailable')),text('small',v.bytes+' bytes'));
  const material=byId('version-material');material.replaceChildren();
  if(v.path){
   const open=text('a',v.name+' ↗');open.setAttribute('aria-label','Open selected file');open.href=v.path;open.target='_blank';open.rel='noopener';identity.children[1].replaceWith(open);
   let preview,image,documentToggle;
   if(v.previewKind==='text'){
    const source=text('pre',v.previewText);source.tabIndex=0;source.setAttribute('aria-label',v.name+' selected version text');preview=source;
    if(v.documentHtml){
     preview=document.createElement('div');preview.className='markdown-reading';
     const documentView=document.createElement('div');documentView.innerHTML=v.documentHtml;source.hidden=true;
     preview.append(documentView,source);documentToggle=text('button','Show source');documentToggle.type='button';documentToggle.setAttribute('aria-pressed','false');
     documentToggle.onclick=()=>{source.hidden=!source.hidden;documentView.hidden=!source.hidden;documentToggle.textContent=source.hidden?'Show source':'Read document';documentToggle.setAttribute('aria-pressed',String(!source.hidden));preview.scrollTop=0;};
    }
   }
   else if(v.previewKind==='pdf'){preview=document.createElement('object');preview.data=v.path+'#navpanes=0&view=FitH';preview.type='application/pdf';preview.setAttribute('aria-label',v.name+' selected version PDF');preview.append(text('p','Use Open selected file to read this PDF.'));}
   else if(v.previewKind==='image'){preview=document.createElement('div');preview.className='image-reading-surface';preview.tabIndex=0;preview.setAttribute('aria-label',v.name+' selected version image');image=document.createElement('img');image.src=v.path;image.alt=v.name;preview.append(image);}
   if(preview){
    const reader=document.createElement('section'),bar=document.createElement('div'),toggle=text('button','Read full screen');
    preview.classList.add('reader-content');reader.className='selected-reader';reader.setAttribute('aria-label','Read selected delivery');bar.className='reader-controls';
    toggle.type='button';toggle.setAttribute('aria-expanded','false');
    const caption=text('span',(v.current?'Current':'Earlier')+' · '+v.decision.split(' · ')[0]+' — '+v.name);
    bar.append(toggle,caption);if(documentToggle)bar.append(documentToggle);
    const currentFiles=data.versions.filter(file=>file.current&&file.path),filePosition=currentFiles.findIndex(file=>file.key===v.key);
    if(currentFiles.length>1&&filePosition>=0){
     const navigation=document.createElement('nav');navigation.className='reader-file-navigation';navigation.setAttribute('aria-label','Current delivery files');
     const previous=text('button','←'),next=text('button','→');previous.setAttribute('aria-label','Previous file');next.setAttribute('aria-label','Next file');
     previous.type=next.type='button';previous.disabled=filePosition===0;next.disabled=filePosition===currentFiles.length-1;
     const move=position=>{
      const target=currentFiles[position];if(!target)return;
      closeReading();readingOrigin=null;
      const url=new URL(location.href);url.searchParams.delete('comment');url.searchParams.delete('reply');url.hash=new URLSearchParams({version:target.key}).toString();history.replaceState(history.state,'',url);
      select.value=String(data.versions.indexOf(target));select.onchange();
      const open=byId('version-material').querySelector('.selected-reader .reader-controls > button');
      if(open)open.click();else byId('version-identity').scrollIntoView({block:'start'});
     };
     previous.onclick=()=>move(filePosition-1);next.onclick=()=>move(filePosition+1);
     previous.title=previous.disabled?'First current file':currentFiles[filePosition-1].title;
     next.title=next.disabled?'Last current file':currentFiles[filePosition+1].title;
     navigation.append(previous,text('span',(filePosition+1)+' / '+currentFiles.length),next);bar.append(navigation);
    }

    const readingRequest=readingOrigin&&currentImageFor(readingOrigin)?.key===v.key?readingOrigin:null;
    if(v.previewKind==='text'){
     const quote=text('button','Comment on selected text');quote.type='button';quote.hidden=true;
     let selectedText='';
     const updateSelection=()=>{
      const selection=window.getSelection();
      selectedText=selection?.rangeCount&&preview.contains(selection.anchorNode)&&preview.contains(selection.focusNode)?selection.toString().trim():'';
      quote.hidden=!selectedText;
     };
     document.addEventListener('selectionchange',updateSelection);
     const previousDispose=disposeImage;
     disposeImage=()=>{previousDispose();document.removeEventListener('selectionchange',updateSelection);};
     quote.onpointerdown=event=>event.preventDefault();
     quote.onclick=()=>{
      const input=byId('feedback-comment'),quoted='“'+selectedText+'”\n\n',next=quoted+input.value;
      if(!selectedText)return;
      const message=byId('reader-comment-status')||status;
      if(next.length>input.maxLength){message.textContent='Select a shorter passage or shorten your comment. Your draft is unchanged.';return;}
      input.value=next;input.dispatchEvent(new Event('input',{bubbles:true}));
      message.textContent='Selected wording added to your comment on this version.';
      window.getSelection()?.removeAllRanges();selectedText='';quote.hidden=true;input.focus();
     };
     bar.append(quote);
    }

    let applyImageZoom=()=>{},captureImageView=()=>{},restoreImageView=()=>{},stopImagePan=()=>{},captureTextView=()=>{},restoreTextView=()=>{};
    if(v.previewKind==='image'){
     const rememberedView=imageViews.get(v.key);let savedView=rememberedView?.center??null,reopeningView=null;const center=()=>({x:Math.max(0,Math.min(1,(preview.scrollLeft+preview.clientWidth/2-image.offsetLeft)/(image.clientWidth||1))),y:Math.max(0,Math.min(1,(preview.scrollTop+preview.clientHeight/2-image.offsetTop)/(image.clientHeight||1)))});
     captureImageView=()=>{if(!shownPoint){savedView=center();imageViews.set(v.key,{center:savedView,zoom:size.value});}};restoreImageView=()=>{if(!shownPoint)reopeningView=savedView;};
     const size=document.createElement('select');size.className='image-size';size.setAttribute('aria-label','Image zoom');
     for(const [value,label] of [['fit','Fit image'],['0.25','25%'],['0.5','50%'],['0.75','75%'],['1','100% (actual)'],['1.5','150%'],['2','200%']]){const option=text('option',label);option.value=value;size.append(option);}
     size.value=rememberedView?.zoom??'fit';
     applyImageZoom=()=>{
      const focus=reopeningView??shownPoint??pendingPoint??center();reopeningView=null;
      const actual=size.value!=='fit'&&reader.classList.contains('expanded');preview.classList.toggle('actual-size',actual);
      image.style.width=actual&&image.naturalWidth?(image.naturalWidth*Number(size.value))+'px':'';drawPoint();
      if(actual)requestAnimationFrame(()=>{if(!expanded)return;preview.scrollTo({left:image.offsetLeft+focus.x*image.clientWidth-preview.clientWidth/2,top:image.offsetTop+focus.y*image.clientHeight-preview.clientHeight/2});});else preview.scrollTo(0,0);
     };
     size.onchange=applyImageZoom;image.addEventListener('load',applyImageZoom);bar.append(size);
    }
    const context=document.createElement('details');context.className='reader-comment';context.hidden=true;reader.append(bar,preview,context);material.append(reader);
    let expanded=false,previousOverflow='',outside=[],afterReading=null,shownPoint=null,shownCommentId=null,mark=null,composerHome=null,composerNext=null;
    if(v.previewKind==='text'){
     captureTextView=()=>{textViews.set(v.key,{top:preview.scrollTop,left:preview.scrollLeft,source:documentToggle?.getAttribute('aria-pressed')==='true'});};
     restoreTextView=()=>{
      const saved=textViews.get(v.key);if(!saved)return;
      if(documentToggle&&(documentToggle.getAttribute('aria-pressed')==='true')!==saved.source)documentToggle.click();
      requestAnimationFrame(()=>{if(expanded)preview.scrollTo({top:saved.top,left:saved.left});});
     };
    }
    const restoreComposer=()=>{if(!composerHome)return;const composer=context.querySelector('.feedback-composer');if(composer)composerHome.insertBefore(composer,composerNext);composerHome=null;composerNext=null;context.classList.remove('composing');};
    if(image){
     const commentMarkers=[];
     const marker=text('button','+');marker.type='button';marker.className='image-point-marker';marker.setAttribute('aria-label','Selected image location');preview.append(marker);
     mark=text('button','Mark a point');mark.type='button';mark.setAttribute('aria-pressed','false');bar.append(mark);
     let marking=false;
     const updateMark=()=>{mark.textContent=marking?'Click image to place point':'Mark a point';mark.setAttribute('aria-pressed',String(marking));image.style.cursor=marking?'crosshair':'';preview.classList.toggle('placing-point',marking);};
     mark.onclick=()=>{marking=!marking;updateMark();};
     image.draggable=false;
     let drag=null;
     stopImagePan=()=>{if(!drag)return;const id=drag.id;drag=null;preview.classList.remove('panning');if(image.hasPointerCapture(id))image.releasePointerCapture(id);};
     image.onpointerdown=event=>{if(event.pointerType!=='mouse'||event.button!==0||!expanded||marking||(preview.scrollWidth<=preview.clientWidth&&preview.scrollHeight<=preview.clientHeight))return;drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:preview.scrollLeft,top:preview.scrollTop};image.setPointerCapture(event.pointerId);preview.classList.add('panning');image.focus({preventScroll:true});event.preventDefault();};
     image.onpointermove=event=>{if(!drag||drag.id!==event.pointerId)return;preview.scrollTo(drag.left+drag.x-event.clientX,drag.top+drag.y-event.clientY);event.preventDefault();};
     image.onpointerup=image.onpointercancel=image.onlostpointercapture=stopImagePan;

     drawPoint=()=>{
      const point=shownPoint??pendingPoint,marked=[...data.savedComments,...comments].filter(c=>c.versionKey===v.key&&c.imagePoint);
      marker.hidden=!point;marker.textContent=shownCommentId?String(marked.findIndex(c=>c.id===shownCommentId)+1):'+';
      const place=(button,p)=>{button.style.left=(image.offsetLeft+p.x*image.clientWidth)+'px';button.style.top=(image.offsetTop+p.y*image.clientHeight)+'px';};
      if(point&&image.complete)place(marker,point);
      for(const button of commentMarkers)button.remove();commentMarkers.length=0;
      if(!image.complete)return;
      marked.forEach((c,index)=>{if(c.id===shownCommentId)return;const button=text('button',String(index+1));button.type='button';button.className='image-comment-marker';button.setAttribute('aria-label','Comment '+(index+1)+': '+c.comment.slice(0,100));button.title=c.author+' — '+c.comment;button.onclick=()=>showCommentPoint(c);place(button,c.imagePoint);preview.append(button);commentMarkers.push(button);});
     };
     const choose=(x,y)=>{pendingPoint=normalizePoint({x:Math.max(0,Math.min(1,Math.round(x*1000000)/1000000)),y:Math.max(0,Math.min(1,Math.round(y*1000000)/1000000))});shownPoint=null;marking=false;updateMark();drawPoint();pointSummary();saveDraft();if(expanded&&context.classList.contains('composing')){context.open=true;requestAnimationFrame(applyImageZoom);}};
     image.tabIndex=0;image.onclick=event=>{if(!marking)return;const r=image.getBoundingClientRect();choose((event.clientX-r.left)/r.width,(event.clientY-r.top)/r.height);};
     image.onkeydown=event=>{if(marking&&['Enter',' '].includes(event.key)){event.preventDefault();choose(.5,.5);}};
     marker.onkeydown=event=>{if(shownPoint||!pendingPoint)return;const step={ArrowLeft:[-.01,0],ArrowRight:[.01,0],ArrowUp:[0,-.01],ArrowDown:[0,.01]}[event.key];if(step){event.preventDefault();choose(pendingPoint.x+step[0],pendingPoint.y+step[1]);}};
     const observer=new ResizeObserver(drawPoint);observer.observe(image);observer.observe(preview);image.addEventListener('load',drawPoint);disposeImage=()=>{stopImagePan();observer.disconnect();};drawPoint();
     openMarkedImage=(comment,onClose)=>{shownPoint=normalizePoint(comment.imagePoint);shownCommentId=comment.id;context.replaceChildren(text('summary',comment.author+' · Comment at this point'),text('p',comment.comment));const related=[...data.savedComments,...comments].filter(c=>c.versionKey===v.key&&c.imagePoint),position=related.findIndex(c=>c.id===comment.id);if(related.length>1){const navigation=document.createElement('nav');navigation.className='image-comment-navigation';navigation.setAttribute('aria-label','Image comment navigation');const previous=text('button','Previous comment'),next=text('button','Next comment');previous.type=next.type='button';previous.disabled=position<=0;next.disabled=position>=related.length-1;previous.onclick=()=>showCommentPoint(related[position-1]);next.onclick=()=>showCommentPoint(related[position+1]);navigation.append(previous,text('span',String(position+1)+' of '+related.length),next);context.insertBefore(navigation,context.children[1]);}if(currentImageFor(comment)){const current=text('button','Read current version');current.type='button';current.onclick=()=>readCurrentImage(comment);context.append(current);}appendResponses(context,comment.responses);const agreed=agreedWorkFor(v);if(agreed)context.append(agreed);context.hidden=false;context.open=true;reader.classList.add('with-comment');afterReading=onClose;mark.hidden=true;if(!expanded)toggle.click();const size=bar.querySelector('.image-size');size.value='1';applyImageZoom();const requestedPoint=shownPoint;const reveal=()=>requestAnimationFrame(()=>{if(!expanded||shownPoint!==requestedPoint)return;drawPoint();preview.scrollTo({left:image.offsetLeft+shownPoint.x*image.clientWidth-preview.clientWidth/2,top:image.offsetTop+shownPoint.y*image.clientHeight-preview.clientHeight/2});marker.focus({preventScroll:true});});if(image.complete&&image.naturalWidth)reveal();else image.addEventListener('load',reveal,{once:true});};
    }
    closeReading=()=>{if(!expanded)return;captureImageView();captureTextView();stopImagePan();expanded=false;restoreComposer();context.hidden=true;reader.classList.remove('expanded','with-comment');if(image)image.style.width='';reader.removeAttribute('role');reader.removeAttribute('aria-modal');toggle.textContent='Read full screen';toggle.setAttribute('aria-expanded','false');document.body.style.overflow=previousOverflow;outside.forEach(([e,was])=>e.inert=was);outside=[];shownPoint=null;shownCommentId=null;if(mark)mark.hidden=false;drawPoint();toggle.focus({preventScroll:true});const restore=afterReading;afterReading=null;if(restore)restore();};
    toggle.onclick=()=>{
     if(expanded){if(readingRequest)returnToMarkedRequest(readingRequest);else closeReading();return;}
     expanded=true;previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
     if((image||v.previewKind==='text'||v.previewKind==='pdf')&&!shownPoint){const composer=document.querySelector('.feedback-composer');composerHome=composer.parentNode;composerNext=composer.nextSibling;const message=text('p','');message.id='reader-comment-status';message.setAttribute('role','status');context.replaceChildren(text('summary',image?'Comment on this image':'Comment on this document'),composer,message);context.hidden=false;context.open=!(image&&matchMedia('(max-width:760px)').matches&&!byId('feedback-comment').value.trim()&&!pendingPoint&&!pendingReplyTo&&!byId('feedback-agreed-work').querySelector('details[open]'));context.classList.add('composing');reader.classList.add('with-comment');}
     for(let node=reader;node.parentElement;node=node.parentElement){for(const sibling of node.parentElement.children){if(sibling!==node){outside.push([sibling,sibling.inert]);sibling.inert=true;}}}
     reader.classList.add('expanded');reader.setAttribute('role','dialog');reader.setAttribute('aria-modal','true');toggle.textContent=readingRequest?'Return to marked request':'Return to feedback';toggle.setAttribute('aria-expanded','true');restoreImageView();applyImageZoom();restoreTextView();toggle.focus({preventScroll:true});if(readingRequest)saveDraft();
    };
   }
  }else material.append(text('p','This version’s file is not included. Ask the project operator for its original delivery before reviewing it.'));
  const saved=byId('saved-version-comments');saved.replaceChildren();
  const prior=data.savedComments.filter(c=>c.versionKey===v.key);
  saved.hidden=prior.length===0;
  if(prior.length){
   saved.append(text('h2','Comments already returned'));
   const conversations=new Map(),roots=new Map();
   for(const conversation of groupConversations(prior)){
    const rootId=conversation.id,root=conversation.comments.find(c=>c.id===rootId)||conversation.comments[0];
    const group=document.createElement('section');group.className='saved-conversation';group.dataset.threadRoot=rootId;group.setAttribute('aria-label','Conversation '+(conversations.size+1)+' · '+root.author);conversations.set(rootId,group);saved.append(group);
    for(const c of conversation.comments)roots.set(c.id,rootId);
   }
   const rootFor=c=>roots.get(c.id);
   prior.forEach(c=>{const article=document.createElement('article');article.dataset.commentId=c.id;article.className=c.id===rootFor(c)?'conversation-start':'conversation-reply';article.tabIndex=-1;const versionLabel=text('small',v.name+' · '+(v.current?'Current recorded version':'Earlier recorded version')+' · '+v.decision.split(' · ')[0]);versionLabel.className='comment-version';article.append(versionLabel,text('strong',c.author),text('small',new Date(c.authoredAt).toLocaleString()),text('p',c.comment));
    if(c.replyTo){const parent=data.savedComments.find(p=>p.id===c.replyTo);if(parent){const context=text('section','');context.dataset.replyTo=parent.id;context.append(text('strong','Reply to '+parent.author),text('blockquote',parent.comment));article.append(context);}}
    appendResponses(article,c.responses);
    const reply=text('button','Reply to this comment');reply.type='button';reply.onclick=()=>startReply(c);article.append(reply);pointLink(article,c);conversations.get(rootFor(c)).append(article);});
  }
  if(v.changes){material.append(text('h2','Requested changes'),text('p',v.changes));}
  if(v.findings){const findings=document.createElement('details');findings.className='recorded-findings';findings.append(text('summary','Recorded review findings'),text('p',v.findings));material.append(findings);}
   const fingerprint=document.createElement('details');fingerprint.className='file-identity';fingerprint.append(text('summary','Version details'),identity.children[2],identity.children[3],text('small','SHA-256 '+v.sha256));identity.append(fingerprint);
 };
 const render=()=>{
  byId('feedback-list').replaceChildren();
  comments.forEach((c,i)=>{const v=data.versions.find(v=>v.key===c.versionKey),li=document.createElement('li');li.append(text('strong',v.title+' — '+v.name),text('small',v.decision.split(' · ')[0]+' · '+(v.recordedAt?new Date(v.recordedAt).toLocaleString():'')),text('p',c.comment));if(c.replyTo){const parent=data.savedComments.find(p=>p.id===c.replyTo);if(parent)li.append(text('strong','Reply to '+parent.author),text('blockquote',parent.comment));}const remove=text('button','Remove comment');remove.type='button';remove.onclick=()=>{comments.splice(i,1);render();saveDraft();};pointLink(li,c);li.append(remove);byId('feedback-list').append(li)});
  byId('download-feedback').disabled=comments.length===0&&!(accept?.checked);drawPoint();
 };
 select.onchange=event=>{
  if(event)readingOrigin=null;
  requestedVersionMissing=false;byId('feedback-form').querySelector('button[type=submit]').disabled=false;
  versionComments.set(activeVersionKey,byId('feedback-comment').value);versionPoints.set(activeVersionKey,pendingPoint);versionReplies.set(activeVersionKey,pendingReplyTo);
  activeVersionKey=data.versions[Number(select.value)].key;
  byId('feedback-comment').value=versionComments.get(activeVersionKey)??'';
  pendingReplyTo=versionReplies.get(activeVersionKey)??null;pendingPoint=versionPoints.get(activeVersionKey)??null;
  showVersion();pointSummary();replySummary();saveDraft();
  status.textContent=byId('feedback-comment').value?'Unfinished comment restored for this version.':'Write a comment for this version. Comments on other versions are kept separately.';
 };
 byId('feedback-form').onsubmit=e=>{
  e.preventDefault();if(requestedVersionMissing){status.textContent='Choose a recorded delivery version before commenting.';select.focus();return;}const author=byId('feedback-name').value.trim(),comment=byId('feedback-comment').value.trim();
  if(!author||!comment){status.textContent='Add your name and feedback before keeping this comment.';return;}
  if(comments.length>=20){status.textContent='Download these 20 comments before starting another feedback file.';const readerStatus=byId('reader-comment-status');if(readerStatus)readerStatus.textContent=status.textContent;return;}
  comments.push({...(pendingReplyTo?{replyTo:pendingReplyTo}:{}),id:commentId(),versionKey:data.versions[Number(select.value)].key,author,comment,authoredAt:new Date().toISOString(),...(pendingPoint?{imagePoint:pendingPoint}:{})});
  byId('feedback-comment').value='';pendingReplyTo=null;replySummary();pendingPoint=null;drawPoint();pointSummary();render();saveDraft();status.textContent=data.liveSubmitUrl?'Comment added. Send it when ready.':'Comment added. Download the feedback file when you are ready to return it.';const readerStatus=byId('reader-comment-status');if(readerStatus)readerStatus.textContent=data.liveSubmitUrl?'Comment added. Return to feedback to send it.':'Comment added. Return to feedback to download your comments.';byId('feedback-comment').focus();
 };
 byId('download-feedback').onclick=async()=>{
  if(data.liveSubmitUrl){
   if(sending)return;
   const selected=data.versions[Number(select.value)],author=byId('feedback-name').value.trim();
   if(accept?.checked&&!author){status.textContent='Enter your name before accepting this exact version.';byId('feedback-name').focus();return;}
   if(!comments.length&&!accept?.checked){status.textContent='Add a comment or accept the exact file before sending.';return;}
   const decision=accept?.checked?{id:pendingDecisionId??(pendingDecisionId=commentId()),versionKey:selected.key,author,note:'',action:'accept'}:null;
   sending=true;byId('download-feedback').disabled=true;status.textContent='Sending to the project operator…';
   try{
    const response=await fetch(data.liveSubmitUrl,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({comments,decision})});
    const result=await response.json();if(!response.ok)throw Error(result.error||'The submission was not saved.');
    try{const next={...history.state};delete next[storageKey];history.replaceState(next,'');}catch{}
    status.textContent='Saved in the project. Your operator can read the response now.';
    location.reload();
   }catch(error){status.textContent=error.message+' Your unfinished comments remain here for retry.';sending=false;render();}
   return;
  }
  const file={schema:'scopesignal.recipient-feedback',version:comments.some(c=>c.replyTo)?3:comments.some(c=>c.imagePoint)?2:1,projectId:data.projectId,projectLabel:data.projectLabel,comments};
  const url=URL.createObjectURL(new Blob([JSON.stringify(file,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='scopesignal-client-feedback.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
  status.textContent='Feedback downloaded. Send that file to the project operator using your usual channel. Nothing was sent automatically.';
 };
 showVersion();render();pointSummary();replySummary();
 const openRequestedVersion=()=>{
  const hadReadingOrigin=Boolean(readingOrigin);readingOrigin=null;
  const key=new URLSearchParams(location.hash.slice(1)).get('version');
  if(!key)return;
  const index=data.versions.findIndex(v=>v.key===key);
  if(index<0){
   closeReading();
   requestedVersionMissing=true;
   let unavailable=select.querySelector('option[data-unavailable]');
   if(!unavailable){unavailable=new Option('Choose a recorded version','');unavailable.disabled=true;unavailable.dataset.unavailable='true';select.prepend(unavailable);}
   select.value='';
   identity.replaceChildren(text('strong','Linked version unavailable'));
   byId('version-material').replaceChildren();
   byId('saved-version-comments').hidden=true;
   byId('feedback-form').querySelector('button[type=submit]').disabled=true;
   status.textContent='This linked version is not in the delivery. Choose a recorded version before commenting.';
   return;
  }
  if(activeVersionKey!==key||requestedVersionMissing){select.value=String(index);select.onchange();}
  else if(hadReadingOrigin){showVersion();pointSummary();replySummary();saveDraft();}
 };
 if(!readingOrigin)openRequestedVersion();
 window.addEventListener('hashchange',openRequestedVersion);
 const params=new URLSearchParams(location.search),requested=params.get('comment');
 const savedComment=data.savedComments.find(c=>c.id===requested);
 // An earlier invitation may remain in the address bar while a different
 // same-version reply draft is being continued. Keep focus with that draft.
 const draftParent=params.get('reply')===savedComment?.id&&byId('feedback-comment').value.trim()
  ?data.savedComments.find(c=>c.id===pendingReplyTo&&c.versionKey===savedComment.versionKey):null;
 const arrivalComment=readingOrigin?null:draftParent||savedComment;
 if(arrivalComment?.imagePoint)showCommentPoint(arrivalComment);
 else if(arrivalComment){
  const index=data.versions.findIndex(v=>v.key===arrivalComment.versionKey);
  if(index>=0){
   if(activeVersionKey!==arrivalComment.versionKey||requestedVersionMissing){select.value=String(index);select.onchange();}
   const thread=[...byId('saved-version-comments').querySelectorAll('[data-comment-id]')].find(e=>e.dataset.commentId===arrivalComment.id);
   if(thread)requestAnimationFrame(()=>{thread.scrollIntoView({block:'start'});thread.focus({preventScroll:true});});
  }
 }
 if(savedComment&&params.get('reply')===savedComment.id&&arrivalComment===savedComment)startReply(savedComment,false);
 if(readingOrigin&&restoredReadingOpen)byId('version-material').querySelector('.selected-reader .reader-controls > button')?.click();
}
export function renderRecipientFeedbackHtml(report,deliveryFiles=[],liveMode=null){
 const online=liveMode?.liveSubmitUrl==='submit';
 const findings=value=>String(value??'').replace(/File reviewed: .*? \(\d+ bytes; SHA-256 [a-f0-9]{64}\)\.\s*/g,'').trim();
 const versions=recipientVersions(report).map(v=>{
  const cp=report.checkpoints.find(cp=>cp.id===v.checkpointId);
  const revision=/^Revision request (\d+) · /.exec(v.decision);
  const review=revision?cp.reviewHistory?.[Number(revision[1])-1]:null;
  const file=deliveryFiles.find(file=>file.sha256===v.sha256&&file.bytes===v.bytes&&file.included);
  const path=file&&typeof file.path==='string'&&file.path.startsWith('files/'+v.sha256+'/')&&/^files\/[a-f0-9]{64}\/[a-zA-Z0-9._-]+$/.test(file.path)?file.path:null;
  return {...v,agreedWork:typeof cp.plannedEvidence==='string'?cp.plannedEvidence:'',changes:review?.changes??'',findings:findings(review?.evidence??cp.acceptedEvidence),path,
   documentHtml:path&&file.previewKind==='text'&&/\.md$/i.test(v.name)?renderMarkdownDocument(file.previewText):null,
   previewKind:path&&(file.previewKind!=='image'||['image/png','image/jpeg','image/webp','image/gif'].includes(file.previewMime))?file.previewKind:null,previewText:path&&file.previewKind==='text'?file.previewText:null};
 }),id=projectIdentity(report);
 if(!id||!versions.length)return null;
 const data=JSON.stringify({projectId:id,projectLabel:report.project.label,versions,savedComments:savedRecipientFeedback(report),...(online?{liveSubmitUrl:'submit',decisions:liveMode.decisions??[]}: {})}).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Feedback — '+esc(report.project.label)+'</title><style>body{margin:0;background:#12306b;color:#eef7ff;font:16px/1.5 system-ui,sans-serif}main{max-width:1160px;margin:auto;padding:28px 24px}h1{font-size:32px;line-height:1.15}a{color:#c1ebff}label{display:block;font-weight:650;margin:20px 0 6px}input,textarea,select,button{font:inherit;box-sizing:border-box;max-width:100%}input,textarea,select{display:block;width:100%;padding:10px;border:1px solid #7d8eaa;background:white;color:#152a4d}textarea{min-height:150px}button{padding:10px 16px;background:#c1ebff;color:#12306b;border:0;cursor:pointer}button:disabled{opacity:.45}#version-identity{padding:16px 0;border-bottom:1px solid #becbdf}#version-identity p{margin:5px 0}small{display:block;font-size:12px;overflow-wrap:anywhere}#feedback-list{padding:0;list-style:none}#feedback-list li{padding:18px 0;border-top:1px solid #becbdf}#feedback-list p{white-space:pre-wrap;overflow-wrap:anywhere}#feedback-list button{background:transparent;color:#c1ebff;padding:4px 0;text-decoration:underline}#feedback-status{min-height:3em}#feedback-draft-status{font-size:13px;color:#c1d3eb}#clear-feedback-draft{background:transparent;color:#c1ebff;text-decoration:underline;padding:10px 8px}.agreed-work{margin:0 0 16px}.agreed-work summary{cursor:pointer;font-weight:650}.agreed-work p{white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0 0}.response-history{margin-top:16px}.response-history>summary{cursor:pointer;font-size:14px;font-weight:650}.reader-comment .operator-response{margin-left:0;padding-left:0;border-left:0}.operator-response{margin:16px 0 0 12px;padding-left:16px;border-left:3px solid #9ed5ee}#saved-version-comments{margin-top:24px;border-top:1px solid #7d8eaa}#saved-version-comments h2{font-size:21px}#saved-version-comments article{scroll-margin-top:12px;padding:14px 0;border-top:1px solid #7d8eaa}#saved-version-comments p{white-space:pre-wrap;overflow-wrap:anywhere}#version-material h2{font-size:18px;margin:18px 0 6px}#version-material p{white-space:pre-wrap;overflow-wrap:anywhere}#version-material pre{max-height:560px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#fff;color:#152a4d;padding:16px;font:15px/1.6 system-ui,sans-serif}#version-material object{display:block;width:100%;height:560px;margin-top:14px}#version-material>a{display:inline-block;margin:12px 0}*:focus-visible{outline:3px solid #b36d00;outline-offset:3px}.feedback-workspace{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(280px,1fr);gap:32px;align-items:start}.feedback-composer{position:sticky;top:20px;padding-top:16px}.feedback-composer h2{font-size:21px;margin:0}.selected-delivery{min-width:0}@media(max-width:760px){.feedback-workspace{display:block}.feedback-composer{position:static;padding-top:24px}#version-material pre{max-height:360px}#version-material object{height:400px}}@media(max-width:480px){main{padding:20px 16px}h1{font-size:28px}}#version-material .selected-reader{margin-top:14px;min-width:0}.reader-controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#e3f3fa;color:#12306b;padding:10px 12px}.reader-controls button{font-weight:650;padding:8px 10px}.reader-controls span{font-size:13px;overflow-wrap:anywhere;flex:1;min-width:160px}#version-material .selected-reader pre{margin:0}#version-material .selected-reader object{margin:0}.selected-reader.expanded{position:fixed;inset:0;z-index:1000;background:white;display:flex;flex-direction:column;margin:0!important}.selected-reader.expanded .reader-controls{flex:none}#version-material .selected-reader.expanded pre{flex:1;min-height:0;max-height:none;box-sizing:border-box;margin:0;width:100%;padding:24px max(20px,calc((100vw - 90ch)/2));font:16px/1.7 ui-monospace,monospace}#version-material .selected-reader.expanded object{flex:1;min-height:0;height:0;width:100%}.image-reading-surface{overflow:auto;background:#e9edf3;max-height:560px;box-sizing:border-box}.image-reading-surface img{display:block;width:100%;height:auto}.reader-file-navigation{display:none}.expanded .reader-file-navigation{display:flex;align-items:center;gap:4px;order:10;margin-left:auto}.reader-controls .reader-file-navigation span{flex:none;min-width:0;text-align:center}.reader-controls .reader-file-navigation button{background:transparent;padding:6px;width:44px;min-height:44px;text-align:center}@media(max-width:760px){.reader-controls .image-size{width:130px;padding:7px;font-size:14px}}.reader-controls .image-size{display:none}.selected-reader.expanded .image-size{display:block}.selected-reader.expanded .image-reading-surface{flex:1;min-height:0;max-height:none;display:flex;justify-content:center;align-items:flex-start;padding:12px}.selected-reader.expanded .image-reading-surface img{width:auto;height:auto;max-width:100%;max-height:100%;object-fit:contain}.selected-reader.expanded .image-reading-surface.actual-size{display:block}.selected-reader.expanded .image-reading-surface.actual-size img{max-width:none;max-height:none}@media(max-width:760px){.image-reading-surface{max-height:400px}}#version-identity>a{display:block;margin:4px 0}.file-identity{margin:7px 0 0}.file-identity summary{cursor:pointer;font-size:13px;color:#c1d3eb}.feedback-heading{margin:18px 0 20px}.feedback-heading h1{font-size:30px;margin:0 0 6px}.feedback-heading p{margin:0;color:#c1d3eb}.recorded-findings{margin:16px 0}.recorded-findings summary{cursor:pointer;font-weight:650}.recorded-findings p{font-size:15px}.feedback-composer h2{font-size:20px}.feedback-composer textarea{min-height:130px}@media(max-width:760px){main{padding:16px}.feedback-heading{margin:12px 0 14px}.feedback-heading h1{font-size:25px}.feedback-heading p{font-size:14px}label{margin:12px 0 5px;font-size:14px}#feedback-version{font-size:14px;padding:9px}#version-identity{padding:12px 0 10px;font-size:14px}#version-identity p{margin:3px 0}#version-identity small{font-size:11px}#version-material>a{font-size:14px;margin:9px 0}#version-material .selected-reader{margin-top:6px}.reader-controls{padding:7px;gap:8px}.reader-controls button{font-size:14px;padding:7px 9px}.reader-controls span{font-size:11px;min-width:140px}.recorded-findings{margin:12px 0;font-size:14px}.feedback-composer{padding-top:12px}.feedback-composer h2{font-size:18px}.feedback-composer input{padding:8px}.feedback-composer textarea{min-height:110px}.feedback-composer p{margin:12px 0}}.image-reading-surface{position:relative}.image-point-marker,.image-comment-marker{position:absolute;transform:translate(-50%,-50%);width:30px;height:30px;border:2px solid white;border-radius:50%;padding:0;background:#b44400;color:white;font-weight:750;box-shadow:0 1px 5px #0009;z-index:2}.image-point-marker[hidden]{display:none}.image-comment-marker{background:#00627b}#feedback-reply-context{padding:12px;border-left:3px solid #9ed5ee;background:#ffffff0b;margin:12px 0}#feedback-reply-context[hidden]{display:none}#feedback-reply-context blockquote{margin:8px 0;max-height:8em;overflow:auto;white-space:pre-wrap}#feedback-reply-context button{font-size:13px;background:transparent;color:#c1ebff;padding:4px 0;text-decoration:underline}#feedback-point{font-size:13px}#feedback-point button,.point-link{font-size:13px;padding:5px 8px}.point-link{display:block;margin:8px 0}#feedback-list .point-link{background:#c1ebff;color:#12306b;padding:6px 10px;text-decoration:none}.reader-comment[hidden]{display:none}.reader-comment{box-sizing:border-box;background:#f2f8fc;color:#152a4d;padding:16px;overflow:auto;min-height:0;border-left:1px solid #b9cddb}.reader-comment summary{cursor:pointer;font-size:14px;font-weight:700}.reader-comment p{font-size:16px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0}.reader-comment section{border-top:1px solid #b9cddb;margin-top:16px;padding-top:12px}.selected-reader.expanded.with-comment{display:grid;grid-template-columns:minmax(0,1fr) 320px;grid-template-rows:auto minmax(0,1fr)}.with-comment .reader-controls{grid-column:1/-1}.with-comment>.reader-content{grid-column:1;grid-row:2;min-width:0}#version-material .selected-reader.expanded.with-comment>object.reader-content{height:100%}.with-comment .reader-comment{grid-column:2;grid-row:2}@media(max-width:760px){.selected-reader.expanded.with-comment{display:flex}.with-comment .reader-comment{flex:none;max-height:32vh;border-left:0;border-top:1px solid #b9cddb;padding:12px 16px}.with-comment .reader-comment:not([open]){max-height:64px}}.reader-comment .feedback-composer{position:static;padding-top:0}.reader-comment .feedback-composer h2{display:none}.reader-comment .feedback-composer label{margin-top:12px}.reader-comment .feedback-composer textarea{min-height:120px}.reader-comment #reader-comment-status{font-size:13px}.reader-comment #reader-comment-status:empty{display:none}@media(max-width:760px){.with-comment .reader-comment.composing{max-height:48vh}.reader-comment .feedback-composer textarea{min-height:96px}.with-comment .reader-comment.composing:not([open]){max-height:64px}}@media(max-width:760px){.selected-reader:not(.expanded) .image-reading-surface img{width:auto;max-width:100%;max-height:150px;margin:auto}.selected-reader:not(.expanded) .reader-controls span{order:3;flex-basis:100%;min-width:0}.selected-reader:not(.expanded) .reader-controls{gap:5px}}.image-point-marker{z-index:3}.image-comment-navigation{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin:12px 0}.image-comment-navigation button{font-size:13px;padding:8px}.image-comment-navigation span{font-size:13px}.placing-point .image-comment-marker,.placing-point .image-point-marker{pointer-events:none}.reader-controls .image-size{width:auto;max-width:160px;padding:8px;background:white;color:#12306b;border:1px solid #7d8eaa;font-weight:650}.selected-reader.expanded .image-reading-surface.actual-size img{margin:0 auto}.selected-reader.expanded .image-reading-surface.actual-size img{cursor:grab}.selected-reader.expanded .image-reading-surface.panning img{cursor:grabbing}.markdown-reading{max-height:560px;overflow:auto;background:white;color:#172a30}.markdown-reading .markdown-document{padding:24px;font:16px/1.75 system-ui,sans-serif}#version-material .markdown-document h2{font-size:25px;line-height:1.25;margin:0 0 22px}#version-material .markdown-document h3{font-size:21px;margin:28px 0 12px}#version-material .markdown-document p{margin:12px 0;white-space:normal}.markdown-document li{margin:7px 0}.markdown-document :not(pre)>code{font:0.9em ui-monospace,monospace;background:#edf3f6;padding:2px 4px;overflow-wrap:anywhere}#version-material .markdown-document pre{font:13px/1.6 ui-monospace,monospace;white-space:pre;overflow:auto;padding:16px;background:#eef4f7;border-left:3px solid #adc9d7;max-height:none}.selected-reader.expanded .markdown-reading{flex:1;min-height:0;max-height:none}#version-material .selected-reader.expanded .markdown-document pre{padding:16px;width:auto;flex:none;font:13px/1.6 ui-monospace,monospace}.selected-reader.expanded .markdown-document{padding:32px max(24px,calc((100vw - 78ch)/2))}.selected-reader.expanded.with-comment .markdown-document{padding:24px;max-width:78ch;margin:auto;box-sizing:border-box}#version-material .selected-reader.expanded.with-comment>pre{padding:24px}.markdown-reading>[hidden]{display:none}@media(max-width:760px){.markdown-reading{max-height:400px}.markdown-reading .markdown-document{padding:18px}#version-material .markdown-document h2{font-size:23px}}#client-acceptance{border:1px solid #9eb6d0;padding:10px 14px;margin-top:16px}#client-acceptance label{margin:0;font-weight:700}#client-acceptance input{display:inline-block;width:auto;margin-right:8px}#client-acceptance small{color:#c1d3eb}.saved-conversation{margin:18px 0 26px;padding-left:14px;border-left:2px solid #7298c4}.saved-conversation .conversation-start{border-top:0!important;padding-top:0!important}.saved-conversation .conversation-reply{margin-left:14px}.saved-conversation blockquote{margin:8px 0;font-size:14px;white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:760px){.saved-conversation{padding-left:10px}.saved-conversation .conversation-reply{margin-left:8px}}</style></head><body><main><a href="review.html" target="_blank" rel="noopener">Open delivery report ↗</a><header class="feedback-heading"><h1>Review &amp; comment</h1><p>'+esc(report.project.label)+'</p></header><form id="feedback-form"><label for="feedback-version">Delivery version</label><select id="feedback-version">'+versions.map((v,i)=>'<option value="'+i+'">'+esc((v.current?'Current':'Earlier')+' · '+v.decision.split(' · ')[0]+' — '+v.title+' — '+v.name)+'</option>').join('')+'</select><div class="feedback-workspace"><div class="selected-delivery"><section id="version-identity" aria-live="polite"></section><section id="version-material" aria-label="Selected delivery and review"></section><section id="saved-version-comments" aria-label="Comments already returned on selected version" hidden></section></div><div class="feedback-composer"><div id="feedback-agreed-work"></div><h2>Your comment on this version</h2><section id="feedback-reply-context" hidden aria-live="polite"></section><label for="feedback-name">Your name</label><input id="feedback-name" maxlength="120" required autocomplete="name"><label for="feedback-comment">Your feedback</label><textarea id="feedback-comment" maxlength="2000" required></textarea>'+(online?'<fieldset id="client-acceptance"><label><input type="checkbox" id="accept-version"> Accept this exact file version</label><small id="acceptance-note"></small></fieldset>':'')+'<p id="feedback-point" role="status"></p><p><button type="submit">Add comment</button></p></div></div></form><p id="feedback-draft-status" role="status">Drafts stay in this tab. '+(online?'Send before closing.':'Download your comments before closing it.')+'</p><h2>Comments to return</h2><ul id="feedback-list"></ul><button id="download-feedback" disabled>'+(online?'Send feedback and acceptance':'Download feedback file')+'</button><button id="clear-feedback-draft" type="button">Clear saved draft</button><p id="feedback-status" role="status">'+(online?'Send your comments or exact-file acceptance to the operator.':'Download your comments to return them to the project operator.')+'</p></main><script>('+recipientPage.toString()+')('+data+','+restoreRecipientDraft.toString()+','+normalizeImagePoint.toString()+','+groupRecipientConversations.toString()+')</script></body></html>';
}
