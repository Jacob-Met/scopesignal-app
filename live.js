import {unrepresentedNamedOutputs} from './src/named-output-review.mjs';
import {mountRetainedGuideEntry} from './src/retained-guide-entry.mjs';
import {resolveBuyerReturn,clearBuyerReturnUrl} from './src/buyer-return.mjs';
import {serializeProposalDraft,restoreProposalDraft,reviseProposalBrief} from './src/proposal-draft.mjs';
import { mountProposalGrouping } from './src/proposal-grouping-editor.mjs';
import {quotedUnresolvedRequirements, appendGroupingSourceToDraft, exactSourceRequirementCount, seedExplicitDeliverables, createProposalGrouping, materializeProposalGrouping } from './src/proposal-grouping.mjs';
import { mountLocalModelConnection } from './src/local-model-connection.mjs';
import { resolveLocalScopeGroups, splitScopeClauses } from './src/local-scope-ai.mjs';
import {createReviewFileBinding,splitReviewFileDraft} from './src/review-file-binding.mjs';
import { mountCorrectionReview } from './src/live-correction-review.mjs';
import { mountRecipientFeedback } from './src/recipient-feedback-ui.mjs';
let recipientFeedbackPanel,deliveryBundlePanel;
const clientTurn=document.createElement('section');clientTurn.className='client-turn';clientTurn.hidden=true;
const shareManage=document.createElement('details');shareManage.className='client-share-manage';shareManage.hidden=true;
const clientTurnAnchor=document.getElementById('summary');
clientTurnAnchor.after(clientTurn,shareManage);
function renderClientTurn(){
 clientTurn.replaceChildren();shareManage.replaceChildren();
 clientTurn.hidden=!state?.project||(state?.clientDecisions??[]).length===0;
 shareManage.hidden=!state?.project||(state?.clientShares??[]).length===0;
 if(!state?.project)return;
 const decisions=state.clientDecisions??[];
 if(decisions.length){
  clientTurn.append(text('strong','Client responses · '+decisions.length+' accepted file'+(decisions.length===1?'':'s')));
  for(const d of decisions.slice(-5).reverse()){
   const item=text('p',d.author+' accepted '+d.file.title+' / '+d.file.name+' · '+new Date(d.at).toLocaleString());
   item.title='Recorded version: '+d.file.sha256;
   clientTurn.append(item);
  }
 }
 const shares=state.clientShares??[];
 if(shares.length){
  shareManage.append(text('summary','Shared reviews · '+shares.filter(s=>!s.revokedAt&&Date.parse(s.expiresAt)>Date.now()).length+' active'));
  for(const link of shares.slice().reverse()){
   const row=text('div','','client-share-row'),expires=link.revokedAt?'Revoked':Date.parse(link.expiresAt)>Date.now()?'Expires '+new Date(link.expiresAt).toLocaleDateString():'Expired';
   row.append(text('span','Client review · '+expires));
   if(!link.revokedAt&&Date.parse(link.expiresAt)>Date.now()){
    const stop=text('button','Revoke link','quiet');stop.type='button';
    stop.onclick=async()=>{stop.disabled=true;const result=await act('/api/client-share/revoke',{shareId:link.id,confirm:true});if(!result)stop.disabled=false;};
    row.append(stop);
   }
   shareManage.append(row);
  }
 }
}

import { mountDeliveryBundle } from './src/delivery-bundle.mjs';
import { mountArtifactInspection } from './src/artifact-inspection.mjs';
import { readSandboxTransfer, SANDBOX_TRANSFER_KEY } from './src/sandbox-transfer.mjs';
import { buildLiveReview, renderLiveReviewHtml } from './src/live-review-export.mjs';
import { createReviewDrafts } from './src/live-review-drafts.mjs';
import { createMilestoneNavigation, createDraftMilestoneNavigation } from './src/live-milestone-navigation.mjs';
const reviewDrafts=createReviewDrafts();
const get=id=>document.getElementById(id), rows=get('rows'), list=get('milestones'), notice=get('notice');
const guideEntry=mountRetainedGuideEntry(get('retained-guide-entry'));
const milestoneNavigation=createMilestoneNavigation(list,{isBuyerApproved:id=>verifiedBuyer.has(id)});
const draftNavigation=createDraftMilestoneNavigation(get('composer'));
rows.addEventListener('focusin',event=>draftNavigation.select(event.target.closest('.draft')));
let token='', state=null, busy=false, refreshBusy=false, needsRefresh=true;
let draftTracking=false;
let suggestionAbort=null, suggestionContext=null, suggestionCoverage=null, sourceUnresolvedCount=0;
let suggestionEditing=false;
let suggestionDraft=null,pendingProposalDraft=null,previousSuggestionDraft=null,pausedProposalDraft=null,replacedSuggestionDraft=null;
const UNSENT_KEY='scopesignal:sandbox:unsent-scope:v1';
let draftId=crypto.randomUUID();
const modelConnection=mountLocalModelConnection(get('model-connection'),{
 getToken:()=>token,getState:()=>state,refresh:refreshState,
 onSelected:result=>{
  state.configured=result.configured;state.localModel=result.localModel;
  get('ai-connection').textContent=result.configured.localAi?result.localModel.model:result.configured.ai?'Configured':'Not configured';
  controls();
 }
});
get('choose-model').onclick=()=>modelConnection.open();
const verifiedBuyer=new Set();
const text=(tag,value,cls='')=>{const e=document.createElement(tag);e.textContent=value;e.className=cls;return e;};
function status(s,bad=false){notice.textContent=s;notice.className=bad?'bad':'';if(bad&&document.body.dataset.mode==='compose'){notice.focus({preventScroll:true});notice.scrollIntoView({block:'nearest'});}}
function field(label,value,kind='input'){const l=text('label',label),e=document.createElement(kind);e.value=value;if(kind==='textarea'){e.rows=2;e.maxLength=5000;}else e.maxLength=160;l.append(e);return l;}
function add(row=['','',''],rowId=crypto.randomUUID(),sourceClauses=[],persist=true,sourceBrief=get('brief').value){
 if(rows.children.length===12)return;
 const s=text('section','','draft');s.dataset.draftRowId=rowId;
 s.sourceClauses=Array.isArray(sourceClauses)&&sourceClauses.length&&sourceBrief.trim()?splitScopeClauses(sourceBrief).filter(clause=>sourceClauses.includes(clause.text)).map(clause=>clause.text):[];
 s.append(text('strong','Milestone '+(rows.children.length+1)));
 const remove=text('button','Remove','quiet');remove.type='button';
 remove.onclick=()=>{
  s.remove();releaseAdoptedRow(s.dataset.draftRowId);
  Array.from(rows.children).forEach((x,i)=>x.querySelector('strong').textContent='Milestone '+(i+1));
  if(notice.classList.contains('bad')&&notice.textContent.startsWith('Not enough room for all '))status('');
  saveUnsentDraft();
 };
 const title=field('Deliverable',row[0]),amount=field('USD',row[1]);
 title.querySelector('input').required=true;amount.querySelector('input').required=true;
 amount.querySelector('input').inputMode='decimal';
 const criteria=document.createElement('details');criteria.className='draft-criteria';criteria.open=!row[2].trim();
 const criteriaSummary=value=>{
  const content=value.trim();if(!content)return 'Set acceptance criteria';
  const originals=s.sourceClauses;
  const count=exactSourceRequirementCount(originals,content,get('brief').value);
  return count!==null?count+' source requirement'+(count===1?'':'s'):content;
 };
 const summary=text('summary'),preview=text('span',criteriaSummary(row[2]));summary.append(preview);
 const condition=field('Ready when',row[2],'textarea');
 condition.querySelector('textarea').required=true;
 condition.querySelector('textarea').addEventListener('input',event=>{preview.textContent=criteriaSummary(event.target.value);});
 criteria.append(summary,condition);s.append(remove,title,amount,criteria);rows.append(s);if(persist)saveUnsentDraft();return s;
}
function isReviewOnlyDraft(){return get('project-kind').value==='review';}
function syncProjectKind(){
 get('composer').classList.toggle('review-only',isReviewOnlyDraft());
 const only=isReviewOnlyDraft(),cap=get('cap');cap.disabled=only;cap.required=!only;cap.closest('label').hidden=only;
 get('review-only-note').hidden=!only;
 if(only)get('project-kind').setAttribute('aria-describedby','review-only-note');else get('project-kind').removeAttribute('aria-describedby');
 for(const row of rows.children){const amount=row.querySelectorAll('input')[1];amount.disabled=only;amount.required=!only;amount.closest('label').hidden=only;}
}
function updateDraftSummary(){
 syncProjectKind();
 const authored=Array.from(rows.children).filter(row=>Array.from(row.querySelectorAll('input,textarea')).some(input=>input.value.trim()));
 const amounts=authored.map(r=>r.querySelectorAll('input')[1]?.value.trim()||'');
 const valid=amounts.length>0&&amounts.every(v=>/^\d+(\.\d{1,2})?$/.test(v));
 const total=valid?amounts.reduce((sum,v)=>sum+Math.round(Number(v)*100),0):null;
 get('draft-total').textContent=isReviewOnlyDraft()?'Review only':total===null?'Set prices':money(total);
 get('draft-count').textContent=authored.length+' deliverable'+(authored.length===1?'':'s');
 syncStartReviewAction();
 draftNavigation.update(authored.map(row=>{
  const fields=row.querySelectorAll('input'),value=fields[1].value.trim();
  return {row,number:Array.from(rows.children).indexOf(row)+1,title:fields[0].value.trim()||'Name this deliverable',
   amount:isReviewOnlyDraft()?'Review only':/^\d+(\.\d{1,2})?$/.test(value)?money(Math.round(Number(value)*100)):'Set price'};
 }));
 get('start-own-scope').hidden=!authored.length&&!['project','brief','cap'].some(id=>get(id).value.trim());
}
function draft(){return {...(isReviewOnlyDraft()?{reviewOnly:true}:{}),label:get('project').value,brief:get('brief').value,cap:get('cap').value,checkpoints:Array.from(rows.children,r=>({title:r.querySelectorAll('input')[0].value,amount:r.querySelectorAll('input')[1].value,evidence:r.querySelector('textarea').value}))}}
const money=v=>'$'+(v/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

// A tab-local safety net for *unsent* operator work only. This is not a server
// scope, approval, payment receipt, or promise that the tab survives closing.
function draftNote(message){
  get('draft-recovery-note').textContent=message;
  get('draft-recovery-note').parentElement.hidden=!message;
}
function discardUnsentDraft(){
  pendingProposalDraft=null;pausedProposalDraft=null;replacedSuggestionDraft=null;
  try{sessionStorage.removeItem(UNSENT_KEY);}catch{}
}
function saveUnsentDraft(){
  updateDraftSummary();
  const identity={...draft(),draftId};
  if((suggestionContext&&(suggestionContext.draftId!==draftId||suggestionContext.brief!==identity.brief))||pausedProposalDraft){
    const paused=pausedProposalDraft;
    const previous=suggestionDraft??previousSuggestionDraft??(paused?restoreProposalDraft(paused,{...identity,brief:paused.brief}):null);
    const previousRecovery=replacedSuggestionDraft??(paused?.previousProposalPreview?restoreProposalDraft(paused.previousProposalPreview,{...identity,brief:paused.previousProposalPreview.brief}):null);
    // Clearing a field is an intermediate edit, not permission to discard named work.
    const retained=!identity.brief.trim()&&previous
      ?serializeProposalDraft(previous,{...identity,brief:previous.context.brief}):null;
    if(retained&&previousRecovery)retained.previousProposalPreview=serializeProposalDraft(previousRecovery,{...identity,brief:previousRecovery.context.brief});
    const revised=identity.brief.trim()?reviseProposalBrief(previous,identity):null;
    const revisedPrevious=identity.brief.trim()?reviseProposalBrief(previousRecovery,identity):null;
    retireSuggestions(true,false);
    replacedSuggestionDraft=revisedPrevious;
    pausedProposalDraft=retained;
    if(revised){
      const clauses=splitScopeClauses(revised.context.brief);
      suggestionCoverage={conditions:clauses.filter(c=>revised.context.conditionIds.includes(c.id)).map(c=>c.text)};
      showSuggestions(revised.proposals,revised.context,revised.editor,{preserveFocus:true,deferEditor:true});
      get('suggest-status').textContent='Review updated brief';
    }else if(retained)get('suggest-status').textContent='Pending deliverables kept while you edit the brief';
  }
  updateSuggestionCoverage();
  persistUnsentDraft();
}
function persistUnsentDraft(){
  if(!draftTracking||state?.project)return;
  try{
    const authored=draft();
    const proposalPreview=serializeProposalDraft(suggestionDraft??previousSuggestionDraft,{...authored,draftId});
    const previousProposalPreview=serializeProposalDraft(replacedSuggestionDraft,{...authored,draftId});
    const choiceList=get('suggestion-missing');
    const sourceChoices=choiceList.sourceChoiceContext===JSON.stringify([draftId,authored.brief])
      ?Array.from(choiceList.children,item=>[item.sourceChoiceKey,item.querySelector('select')?.value]).filter(pair=>pair.every(value=>typeof value==='string'))
      :[];
    const storedDraft={...authored,checkpoints:authored.checkpoints.map((checkpoint,index)=>({...checkpoint,rowId:rows.children[index].dataset.draftRowId,sourceClauses:rows.children[index].sourceClauses}))};
    sessionStorage.setItem(UNSENT_KEY,JSON.stringify({version:1,draftId,draft:storedDraft,proposalPreview,previousProposalPreview,pausedProposalDraft,sourceCoverage:suggestionCoverage,sourceChoices}));
    draftNote('Draft saved in this tab');
  }catch{
    draftNote('Draft could not be saved. Keep a copy before reloading.');
  }
}
function loadUnsentDraft(){
  try{
    const saved=JSON.parse(sessionStorage.getItem(UNSENT_KEY)||'null');
    const d=saved?.draft;
    if(saved?.version!==1||!d||typeof d.label!=='string'||typeof d.brief!=='string'||
       typeof d.cap!=='string'||!Array.isArray(d.checkpoints)||d.checkpoints.length>12||
       d.label.length>120||d.brief.length>8000||d.cap.length>160||
       !d.checkpoints.every(cp=>cp&&typeof cp.title==='string'&&cp.title.length<=160&&
         typeof cp.amount==='string'&&cp.amount.length<=160&&
         typeof cp.evidence==='string'&&cp.evidence.length<=5000))return false;
    if(typeof saved.draftId==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(saved.draftId))draftId=saved.draftId;
    get('project').value=d.label;
    get('brief').value=d.brief;
    get('cap').value=d.cap;
    get('project-kind').value=d.reviewOnly===true?'review':'priced';
    const paused=saved.pausedProposalDraft;
    pausedProposalDraft=!d.brief.trim()&&paused&&typeof paused.brief==='string'&&
      restoreProposalDraft(paused,{...d,draftId,brief:paused.brief})?paused:null;
    rows.replaceChildren();
    d.checkpoints.forEach(cp=>add([cp.title,cp.amount,cp.evidence],typeof cp.rowId==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(cp.rowId)?cp.rowId:undefined,cp.sourceClauses,true,pausedProposalDraft?.brief??d.brief));
    pendingProposalDraft=saved.proposalPreview??null;
    replacedSuggestionDraft=restoreProposalDraft(saved.previousProposalPreview,{...d,draftId});

    // Coverage belongs to the authored brief even after its suggestion preview is retired.
    if(Array.isArray(saved.sourceCoverage?.conditions)){
      suggestionCoverage={conditions:splitScopeClauses(d.brief).filter(clause=>saved.sourceCoverage.conditions.includes(clause.text)).map(clause=>clause.text)};
      updateSuggestionCoverage();
    }
    // Restore pending controls only; their explicit Assign action still owns mutation.
    const choiceList=get('suggestion-missing');
    const currentKeys=new Set(Array.from(choiceList.children,item=>item.sourceChoiceKey));
    const savedChoices=new Map((Array.isArray(saved.sourceChoices)?saved.sourceChoices:[])
      .filter(pair=>Array.isArray(pair)&&pair.length===2&&typeof pair[0]==='string'&&typeof pair[1]==='string'&&currentKeys.has(pair[0])));
    for(const item of choiceList.children){
      const choice=item.querySelector('select'),value=savedChoices.get(item.sourceChoiceKey);
      if(choice&&savedChoices.has(item.sourceChoiceKey)&&Array.from(choice.options).some(option=>option.value===value))choice.value=value;
    }
    draftNote('Recovered your draft');
    return true;
  }catch{return false;}
}
function startOwnScope(){
  if(state?.project||busy||needsRefresh)return;
  if(!window.confirm('Clear this draft and start a new project?'))return;
  retireSuggestions();
  draftTracking=false;draftId=crypto.randomUUID();
  for(const id of ['project','brief','cap'])get(id).value='';
  get('project-kind').value='priced';
  rows.replaceChildren();
  add();
  get('suggestion-preview').hidden=true;
  get('suggestion-list').replaceChildren();
  draftTracking=true;
  discardUnsentDraft();
  draftNote('');
  get('project').focus();
}
function clearUnsentDraft(){startOwnScope();}

let pendingScope=null, incomingPresented=false;
function showIncomingScope(){
  const box=get('incoming-scope');
  box.hidden=true;pendingScope=null;
  let data;
  try { data=sessionStorage.getItem(SANDBOX_TRANSFER_KEY); }
  catch { return; }
  if(!data)return;
  try{
    pendingScope=readSandboxTransfer(data);
    get('incoming-summary').textContent=pendingScope.label+' · '+pendingScope.checkpoints.length+
      ' planned milestones · '+pendingScope.cap+' USD project cap.';
    const lines=get('incoming-lines');
    lines.replaceChildren();
    pendingScope.checkpoints.forEach(cp=>{
      const item=text('li',cp.title+' · '+cp.amount+' USD — '+cp.evidence);
      lines.append(item);
    });

    box.hidden=false;
    if(!incomingPresented){
      incomingPresented=true;
      if(location.hash==='#import-scope' && document.activeElement===document.body){
        get('incoming-title').focus({preventScroll:true});
        box.scrollIntoView({block:'start'});
      }
    }
    const locked=Boolean(state?.project);
    get('incoming-apply').disabled=locked||busy||refreshBusy||needsRefresh;
    if(locked)status('An existing Sandbox scope is locked. Transferring a new draft cannot replace it.',true);
  }catch(error){
    status('The incoming scope could not be opened: '+error.message,true);
    try{sessionStorage.removeItem(SANDBOX_TRANSFER_KEY)}catch{}
  }
}
get('incoming-discard').onclick=()=>{
  try{sessionStorage.removeItem(SANDBOX_TRANSFER_KEY)}catch{}
  pendingScope=null;get('incoming-scope').hidden=true;
  status('Import discarded');
};
get('incoming-apply').onclick=()=>{
  if(!pendingScope||!state||state.project||busy||refreshBusy||needsRefresh)return;
  draftTracking=false;draftId=crypto.randomUUID();
  get('project').value=pendingScope.label;
  get('brief').value=pendingScope.brief;
  get('cap').value=pendingScope.cap;
  get('project-kind').value='priced';
  rows.replaceChildren();
  pendingScope.checkpoints.forEach(cp=>add([cp.title,cp.amount,cp.evidence]));
  draftTracking=true;saveUnsentDraft();
  try{sessionStorage.removeItem(SANDBOX_TRANSFER_KEY)}catch{}
  pendingScope=null;get('incoming-scope').hidden=true;
  status('Draft imported');
  get('project').focus();
};


// Re-render only authoritative state. Preserve unsent evidence on unchanged checkpoints.
function scopeIdentity(value){
 if(!value?.project)return null;
 return JSON.stringify([value.projectId,value.project.label,value.project.brief,value.project.cap,Boolean(value.project.reviewOnly),value.checkpoints.map(cp=>[cp.id,cp.title,cp.amount,cp.proposedEvidence])]);
}
function applyState(next){
 const oldIdentity=scopeIdentity(state), edits=new Map();
 if(oldIdentity)state.checkpoints.forEach((cp,i)=>{
  if(!['unapproved','changes_requested'].includes(cp.status))return;
  const inputs=list.children[i]?.querySelectorAll('textarea');
  if(inputs?.length)edits.set(cp.id,{revision:cp.reviewHistory?.length||0,values:Array.from(inputs,e=>e.value)});
 });
 state=next;
 const destination=new URL(location.href);
 destination.searchParams.set('project',next.projectId||'new');
 history.replaceState(null,'',destination);
 if(next.project&&next.draftId===draftId)discardUnsentDraft();
 render();
 if(oldIdentity&&oldIdentity===scopeIdentity(next))next.checkpoints.forEach((cp,i)=>{
  if(['unapproved','changes_requested'].includes(cp.status)&&edits.has(cp.id)){
   const saved=edits.get(cp.id);
   if(saved.revision===(cp.reviewHistory?.length||0))list.children[i]?.querySelectorAll('textarea').forEach((input,j)=>{input.value=saved.values[j]||'';});
  }
 });
 milestoneNavigation.update(next);
 controls();
 restorePendingSuggestions();
}
// After an ambiguous write, previously rendered statuses are historical, not current.
function markUnverified() {
 document.body.dataset.ready='false';
 if(!state?.project)return;
 milestoneNavigation.markUnverified();
 get('summary').textContent='Current checkpoint and payment totals are unverified. Refresh verified state before relying on them.';
 get('summary').classList.add('unverified');
 list.querySelectorAll('.milestone .state').forEach(badge=>{
  badge.textContent='UNVERIFIED';
  badge.classList.add('unverified');
 });
 // Do not leave a stale buyer link or earlier capture consent visible.
 list.querySelectorAll('.buyer-confirm, a[href]').forEach(element=>{element.hidden=true;});
 list.querySelectorAll('.payment-status').forEach(badge=>{badge.textContent='Status pending';});
}
// A verified response rebuilds each milestone. Keep keyboard focus attached to
// the same checkpoint rather than dropping the operator back to document.body.
function focusedMilestone(){
 const active=document.activeElement;
 const card=active?.closest?.('.milestone');
 if(!card||!list.contains(card))return null;
 const index=Array.from(list.children).indexOf(card);
 const checkpointId=state?.checkpoints[index]?.id;
 if(!checkpointId)return null;
 const input=active.matches('textarea')?active:null;
 return {checkpointId,editing:!!input,
  label:active.matches('button,a')?active.textContent.trim():null,
  start:input?.selectionStart,end:input?.selectionEnd};
}
function restoreMilestoneFocus(saved,preferConsent=false){
 if(!saved)return;
 // Unknown payment outcomes require an explicit verified read, not another
 // capture. Move focus off the now-disabled action to that safe recovery.
 if(needsRefresh){
  if(document.activeElement===document.body||
     document.activeElement===document.documentElement||
     document.activeElement.disabled)
   get('refresh-state').focus({preventScroll:true});
  return;
 }
 // Never steal focus from a different destination chosen during an async call.
 if(document.activeElement!==document.body&&
    document.activeElement!==document.documentElement)return;
 const index=state?.checkpoints.findIndex(cp=>cp.id===saved.checkpointId);
 if(index<0)return;
 const card=list.children[index];
 if(!card)return;
 const input=saved.editing?card.querySelector('textarea:not(:disabled)'):null;
 const consent=preferConsent?card.querySelector('.buyer-confirm input[type=checkbox]'):null;
 const former=saved.label?Array.from(card.querySelectorAll('button:not(:disabled),a[href]')).find(
  el=>el.textContent.trim()===saved.label):null;
 const finished=state.checkpoints[index].status==='captured';
 const paymentAction=Array.from(card.querySelectorAll('.milestone-settlement button:not(:disabled),.milestone-settlement a[href]')).find(el=>el.getClientRects().length);
 const target=input||consent||former||(finished?null:paymentAction||Array.from(card.querySelectorAll('button:not(:disabled),a[href]')).find(el=>el.getClientRects().length));
 if(target){
  target.focus({preventScroll:true});
  if(input&&Number.isInteger(saved.start)&&Number.isInteger(saved.end))
   input.setSelectionRange(saved.start,saved.end);
 }else{
  // Payment is complete; keep focus on its outcome before optional file controls.
  card.tabIndex=-1;
  card.focus({preventScroll:true});
 }
}
function showUnresolvedRequirements(){
 const remaining=get('suggestion-coverage');remaining.open=true;
 get('suggest-status').textContent='Assign every original requirement or keep it as a project term before starting review.';
 const summary=get('suggestion-coverage-summary');summary.setAttribute('tabindex','-1');
 const row=get('suggestion-missing').querySelector('.source-unresolved');
 const target=row?.querySelector('select')||summary;
 (row||remaining).scrollIntoView({block:'center',behavior:'instant'});
 target.focus({preventScroll:true});
}
function pendingReviewedDeliverables(){
 const preview=[suggestionDraft,previousSuggestionDraft,replacedSuggestionDraft].find(value=>
  value?.context.local&&(value.context.manual||value.context.humanReviewed)&&
  value.context.draftId===draftId&&value.context.brief===get('brief').value);
 if(!preview)return null;
 const liveIds=new Set(Array.from(rows.children,row=>row.dataset.draftRowId));
 const context=preview.context;
 const names=preview.proposals.filter((proposal,index)=>!(context.addedIndices||[]).includes(index)||
  !liveIds.has(context.adoptedRowIds?.[index])).map(proposal=>proposal.title);
 return names.length?{preview,names}:null;
}
function showPendingReviewedDeliverables(){
 const pending=pendingReviewedDeliverables();if(!pending)return;
 get('suggest-status').textContent='Add the remaining reviewed deliverables or dismiss this grouping before starting review: '+pending.names.join(' · ');
 const available=control=>control&&!control.hidden&&!control.disabled&&control.getClientRects().length;
 const current=pending.preview===suggestionDraft;
 const candidates=suggestionAbort?[get('suggest')]:current
  ?[get('add-all-suggestions'),get('adjust-suggestions'),...get('suggestion-list').querySelectorAll('button'),get('dismiss-suggestions')]
  :[get('restore-suggestions'),get('dismiss-suggestions')];
 const target=candidates.find(available)||get('suggestion-heading');
 target.scrollIntoView({block:'center',behavior:'instant'});target.focus({preventScroll:true});
}
function syncStartReviewAction(){
 const button=get('plan').querySelector('button[type="submit"],button[data-review-action]');
 const hasDeliverable=Array.from(rows.children).some(row=>
  Array.from(row.querySelectorAll('input,textarea')).some(input=>input.value.trim()));
 if(!hasDeliverable&&suggestionContext?.reviewRequired){
  button.dataset.reviewAction='true';button.type='button';button.textContent='Review deliverables →';
  button.disabled=busy||refreshBusy||needsRefresh||suggestionEditing;
  button.onclick=()=>get('adjust-suggestions').click();
  return;
 }
 const needsAssignment=Boolean(hasDeliverable&&suggestionCoverage&&sourceUnresolvedCount);
 const pending=hasDeliverable?pendingReviewedDeliverables():null;
 button.dataset.reviewAction='true';
 // Native amount validation belongs to final review, not missing-source correction.
 button.type=hasDeliverable&&!needsAssignment&&!pending?'submit':'button';
 button.textContent=hasDeliverable
  ? needsAssignment
    ? 'Resolve '+sourceUnresolvedCount+' requirement'+(sourceUnresolvedCount===1?'':'s')+' →'
    : pending?'Finish '+pending.names.length+' deliverable'+(pending.names.length===1?'':'s')+' →':'Start review →'
  : 'Choose a deliverable ↑';
 button.disabled=busy||refreshBusy||needsRefresh||suggestionEditing;
 button.onclick=needsAssignment?()=>{
  saveUnsentDraft();
  showUnresolvedRequirements();
 }:pending?showPendingReviewedDeliverables:hasDeliverable?null:()=>{
  const suggestion=Array.from(get('suggestion-list').querySelectorAll('button')).find(
   control=>control.textContent.trim()==='Add deliverable'&&!control.disabled);
  const target=suggestion||get('add');
  target.scrollIntoView({block:'center'});
  target.focus({preventScroll:true});
 };
}

function controls(){
 const disabled=busy||refreshBusy||needsRefresh;
 get('project-kind').disabled=disabled;
 get('incoming-apply').disabled=disabled||!pendingScope||Boolean(state?.project);
 get('incoming-discard').disabled=busy||refreshBusy;
 get('refresh-state').disabled=busy||refreshBusy;
 get('project-directory').inert=busy||refreshBusy;
 for(const id of ['new-project','archive-project','reopen-project'])get(id).disabled=disabled;
 get('download-review').disabled=disabled||!state?.project;
 syncStartReviewAction();
 get('plan').classList.toggle('grouping-active',suggestionEditing);
 const aiConfigured=state?.configured.localAi||state?.configured.ai;
 get('suggest').disabled=!suggestionAbort&&(disabled||suggestionEditing);
 get('restore-suggestions').hidden=!replacedSuggestionDraft||Boolean(state?.project)||Boolean(suggestionContext?.adopted);
 get('restore-suggestions').disabled=disabled||suggestionEditing||Boolean(suggestionAbort);
 const previousNames=replacedSuggestionDraft?.editor
   ?replacedSuggestionDraft.editor.state.groups.map(group=>replacedSuggestionDraft.editor.names[group.id]||group.title)
   :(replacedSuggestionDraft?.proposals||[]).map(proposal=>proposal.title);
 get('previous-grouping-names').textContent=previousNames.filter(name=>name.trim()).join(' · ')||'Saved source assignments';
 get('previous-grouping').hidden=get('restore-suggestions').hidden||suggestionEditing;
 get('organize-brief').disabled=disabled||suggestionEditing||Boolean(suggestionAbort)||Boolean(suggestionContext?.adopted);
 get('organize-brief').className=aiConfigured?'quiet':'secondary';
 get('organize-brief').style.order=aiConfigured?'1':'-1';
 get('suggest').className=aiConfigured?'secondary':'quiet';
 get('suggest').textContent=suggestionAbort?'Cancel suggestions':aiConfigured?'Suggest milestones':'Choose a model';
 get('suggest').title=suggestionAbort?'Cancel this request':aiConfigured?'Suggest milestones from your brief':'Connect AI to suggest milestones';
 get('suggest-extended-label').hidden=!state?.configured.localAi;
 get('suggest-extended').disabled=Boolean(suggestionAbort);
 modelConnection.update(state,disabled||suggestionEditing||Boolean(suggestionAbort));
 list.querySelectorAll('button').forEach(button=>{button.disabled=disabled||button.dataset.captureConsent==='pending'||(button.dataset.paypal==='required'&&!state?.configured.paypal);});
}
async function post(path,body){
 let r,j;
 try{
  r=await fetch(path,{method:'POST',headers:{'content-type':'application/json','x-scopesignal-token':token},body:JSON.stringify(body)});
  j=await r.json();
 }catch(e){
  const failure=Error('Server response could not be verified: '+(e?.message||'network error'));
  failure.uncertain=true;
  throw failure;
 }
 if(!r.ok){
  const failure=Error(j?.error||'Operation refused');
  failure.uncertain=r.status>=500;
  throw failure;
 }
 return j;
}
async function act(path,body){
 if(busy||refreshBusy||needsRefresh){status('Refresh verified state before requesting another operation.',true);return null;}
 const focusBefore=focusedMilestone();
 let preferConsent=false;
 busy=true;controls();
 status('Checking and recording the operation…');
 try{
  const j=await post(path,{...body,projectId:state?.projectId??null});
  if(j.buyerApproval){
    if(j.buyerApproval.approved){
     verifiedBuyer.add(j.buyerApproval.checkpointId);
     preferConsent=true;
    }
    else verifiedBuyer.delete(j.buyerApproval.checkpointId);
  }
  if(path==='/api/capture')verifiedBuyer.delete(body.checkpointId);
  if(j.state)applyState(j.state);
  status(({'/api/setup':'Project ready','/api/approve':'Delivery accepted','/api/request-changes':'Changes requested','/api/projects/archive':'Project archived','/api/projects/reopen':'Project reopened'})[path]||j.guidance||'Saved');
  return j;
 }catch(e){
  if(path==='/api/capture')verifiedBuyer.delete(body.checkpointId);
  if(e.uncertain){
   needsRefresh=true;
   markUnverified();
   status('The operation outcome may be unknown. Do not repeat it. Refresh verified state before continuing. '+e.message,true);
  }else status(e.message,true);
  return null;
 }finally{busy=false;controls();restoreMilestoneFocus(focusBefore,preferConsent);}
}
// This GET cannot create an order or capture. It is the only recovery after an unknown response.
async function refreshState(){
 if(busy||refreshBusy)return;
 refreshBusy=true;controls();
 status('Refreshing…');
 try{
  const selected=new URL(location.href).searchParams.get('project');
  const query=new URLSearchParams();
  if(selected){query.set('project',selected);if(selected==='new')query.set('draft',draftId);}
  const r=await fetch('/api/state'+(query.size?'?'+query:''),{cache:'no-store'});
  if(!r.ok)throw Error('Server not available');
  const j=await r.json();
  if(typeof j?.token!=='string'||!j.state?.configured||!Array.isArray(j.state.checkpoints))throw Error('Invalid server state');
  token=j.token;
  // A status refresh is not proof that an earlier buyer check is still current.
  verifiedBuyer.clear();
  applyState(j.state);
  needsRefresh=false;
  status('');
  showIncomingScope();
  return true;
 }catch(e){
  needsRefresh=true;
  markUnverified();
  status('Unable to verify current state. Payment actions remain disabled; retry Refresh verified state. '+e.message,true);
  return false;
 }finally{refreshBusy=false;controls();}
}

const buyerReturnHref=location.href;
let buyerReturnHandled=false;
async function resumeBuyerReturn(){
 if(buyerReturnHandled||busy||refreshBusy||needsRefresh)return;
 const returned=resolveBuyerReturn(buyerReturnHref,state);
 buyerReturnHandled=true;
 if(!returned)return;
 history.replaceState(null,'',clearBuyerReturnUrl(location.href));
 if(returned.kind==='invalid'){status(returned.message,true);return;}
 const payment=()=>state?.projectId===returned.projectId
   ? state.checkpoints.find(cp=>cp.id===returned.checkpointId&&cp.orderId===returned.orderId):null;
 const focusPayment=()=>{
  const cp=payment();if(!cp)return;
  const card=Array.from(list.children).find(card=>card.dataset.checkpointId===cp.id);
  // A user may choose another milestone while the provider lookup is pending.
  if(!card||card.hidden)return;
  const pane=card.querySelector('.payment-card');if(!pane)return;
  const target=pane.querySelector('.buyer-confirm input, a.payment-approval, button:not(:disabled)')||pane;
  target.tabIndex=target.matches('input,a,button')?target.tabIndex:-1;
  target.focus({preventScroll:true});pane.scrollIntoView({block:'center'});
 };
 milestoneNavigation.go(returned.checkpointId,false);
 focusPayment();
 const cp=payment();if(!cp)return;
 if(cp.status==='captured'){status('Payment already captured.');return;}
 if(returned.kind==='cancel'){status('PayPal checkout closed. This payment remains open.');return;}
 if(cp.status!=='awaiting_buyer'||state.archivedAt){
  status('Check payment status to continue this order.');return;
 }
 if(!state.configured.paypal){status('Connect PayPal to check this payment.',true);return;}
 const outcome=await act('/api/buyer-status',{checkpointId:cp.id});
 if(!outcome||!payment())return;
 if(outcome.buyerApproval?.checkpointId===cp.id){
  status(outcome.buyerApproval.approved
   ? 'Buyer approved '+money(cp.amount)+'. Confirm payment below.'
   : 'PayPal has not approved this payment yet.');
 }
 focusPayment();
}

function button(label,path,cp,extra){const b=text('button',label,'primary');b.type='button';b.dataset.paypal='required';b.dataset.action=path.slice(5);b.onclick=()=>act(path,{checkpointId:cp.id,...extra});return b}
function render(){if(!state)return;recipientFeedbackPanel?.render();deliveryBundlePanel?.syncSharing();renderClientTurn();document.body.dataset.ready='true';document.body.dataset.mode=state.project?'review':'compose';get('workspace-title').textContent=state.project?.label||'New project';get('paypal-connection').textContent=state.configured.paypal?'Connected':'Not connected';get('ai-connection').textContent=state.configured.localAi?'Local model configured':state.configured.ai?'Configured':'Not configured';renderProjects();reviewDrafts.sync(state);get('composer').hidden=Boolean(state.project);get('audit').hidden=!state.project;get('agreed-project').hidden=!state.project;const summary=get('summary');summary.classList.remove('unverified');list.replaceChildren();guideEntry.update(state);if(!state.project){summary.textContent='Author a scope to begin.';return}
const approved=state.checkpoints.filter(x=>x.approvedAt).length,captured=state.checkpoints.filter(x=>x.status==='captured'),total=captured.reduce((s,x)=>s+x.amount,0);
summary.textContent=approved+' of '+state.checkpoints.length+' accepted · '+(state.project.reviewOnly?'Review only':money(total)+' paid');
get('agreed-project-name').textContent=state.project.label;
get('agreed-project-brief').textContent=state.project.brief;
get('agreed-project').querySelector('summary').textContent=state.project.reviewOnly?'Brief & criteria':'Brief & budget';
get('agreed-project').querySelector('dl').hidden=Boolean(state.project.reviewOnly);
get('agreed-project-cap').textContent=money(state.project.cap);
get('agreed-project-allocated').textContent=money(state.checkpoints.reduce((sum,cp)=>sum+cp.amount,0));

const trail=get('events');
trail.replaceChildren(...(state.events||[]).slice().reverse().map(e=>{
 const li=text('li','');
 const checkpoint=state.checkpoints.find(cp=>cp.id===e.checkpointId);
 const detail=text('div','','trail-detail');
 detail.append(text('strong',e.type.replaceAll('.',' / ')));
 if(checkpoint){
  const link=text('button',checkpoint.title,'trail-milestone');link.type='button';
  link.onclick=()=>milestoneNavigation.go(checkpoint.id);detail.append(link);
 }
 li.append(detail,text('small',e.at||''));return li;
}));
state.checkpoints.forEach((cp,i)=>{const card=text('article','','milestone');card.dataset.status=cp.status;card.dataset.checkpointId=cp.id;const head=text('div','','actions');head.append(text('h3',(i+1)+'. '+cp.title),text('span',(cp.status==='awaiting_buyer'&&verifiedBuyer.has(cp.id)?'Ready to capture':({unapproved:'Ready for review',changes_requested:'Changes requested',approved:'Accepted',captured:'Paid'})[cp.status]||cp.status.replaceAll('_',' ')),'state'));const identity=text('div','','milestone-identity');identity.append(head,text('p',state.project.reviewOnly?'Review only':money(cp.amount),'milestone-amount'));card.append(identity);const criteria=text('div','','milestone-criteria');card.append(criteria);
let history=null;
if(cp.reviewHistory?.length){
 history=document.createElement('details');
 history.className='revision-history';
 history.append(text('summary','Changes requested · '+cp.reviewHistory.length+' review'+(cp.reviewHistory.length===1?'':'s')));
 cp.reviewHistory.forEach((review,index)=>{
  const entry=text('section','','revision-entry');
  entry.append(text('strong','Review '+(index+1)+' · '+review.at),text('p','Inspected: '+splitReviewFileDraft(review.evidence).text,'evidence'),text('p','Changes needed: '+review.changes,'evidence'));
  history.append(entry);
 });
}
if(['unapproved','changes_requested'].includes(cp.status)&&!state.archivedAt){
 criteria.append(text('p','Agreed work','overline'),text('p',cp.proposedEvidence,'evidence'));
 card.classList.add('is-reviewing');
 const workspace=text('div','','delivery-review-workspace');card.append(workspace);
 const review=text('div','','milestone-review review-writing-panel');workspace.append(review);
 const correctionContext=mountCorrectionReview(cp);if(correctionContext)review.append(correctionContext);
 const criteriaDetails=document.createElement('details');criteriaDetails.className='review-criteria-details';criteriaDetails.append(text('summary','Agreed work & history'),criteria);review.append(criteriaDetails);
 const l=field('Your review','','textarea');
 l.querySelector('textarea').placeholder='What did you check?';
 review.append(l);
 const evidence=createReviewFileBinding(l.querySelector('textarea'));
 const actions=text('div','','actions');
 const b=text('button','Accept delivery','primary');b.dataset.action='accept-delivery';
 b.onclick=()=>act('/api/approve',{checkpointId:cp.id,evidence:evidence.read(),reviewRevision:cp.reviewHistory?.length||0});
 const revision=document.createElement('details');
 revision.className='revision-request';
 revision.append(text('summary','Request changes'));
 const changes=field('What needs to change?','','textarea');
 changes.querySelector('textarea').placeholder='Describe the changes needed.';
 const request=text('button','Save changes request','secondary');request.dataset.action='request-changes';
 request.onclick=()=>act('/api/request-changes',{checkpointId:cp.id,evidence:evidence.read(),changes:changes.querySelector('textarea').value,reviewRevision:cp.reviewHistory?.length||0});
 revision.append(changes,request);
 actions.append(b);review.append(actions,revision);
 const inspection=mountArtifactInspection(workspace,l.querySelector('textarea'),cp,{workspaceId:location.origin,projectId:state.projectId});
 inspection.open=true;workspace.prepend(inspection);
 const reviewJump=text('button','Review & decide','review-decision-jump');reviewJump.type='button';
 reviewJump.onclick=()=>{l.querySelector('textarea').focus({preventScroll:true});review.scrollIntoView({block:'start'});};
 identity.append(reviewJump);
 const backToFile=text('button','Back to file ↑','quiet review-file-return');backToFile.type='button';
 backToFile.onclick=()=>{inspection.open=true;inspection.querySelector('summary').focus({preventScroll:true});inspection.scrollIntoView({block:'start'});};
 l.before(backToFile);
 reviewDrafts.bind(l.querySelector('textarea'),cp,'text',evidence);reviewDrafts.bind(changes.querySelector('textarea'),cp,'changes');
 review.append(evidence.element);
}else{
 const accepted=document.createElement('details');accepted.className='accepted-review';
 accepted.open=!!cp.approvedAt&&matchMedia('(min-width:960px)').matches;
 accepted.append(text('summary',cp.approvedAt?'Accepted work':'Agreed criteria'),text('p',cp.approvedAt?splitReviewFileDraft(cp.acceptedEvidence).text:cp.proposedEvidence,'evidence'));
 criteria.append(accepted);
}
if(history)criteria.append(history);
let recordedReview;
if(cp.approvedAt){recordedReview=text('div','','milestone-review');mountArtifactInspection(recordedReview,null,cp,{workspaceId:location.origin,projectId:state.projectId});}
const settlement=text('div','','milestone-settlement payment-card');
const hasPayment=!state.project.reviewOnly&&!['unapproved','changes_requested'].includes(cp.status);
if(hasPayment){
 card.classList.add('has-payment');
 const paymentJump=text('button',cp.status==='captured'?'View payment ↓':'Continue to payment ↓','quiet accepted-payment-jump');paymentJump.type='button';
 settlement.tabIndex=-1;
 paymentJump.onclick=()=>{settlement.focus({preventScroll:true});settlement.scrollIntoView({block:'start'});};
 if(cp.status!=='approved'||state.configured.paypal||cp.orderId)identity.append(paymentJump);
 card.append(settlement);
 const buyerReady=cp.status==='awaiting_buyer'&&verifiedBuyer.has(cp.id);
 const label=cp.status==='captured'?'Paid':buyerReady?'Ready to capture':cp.status==='awaiting_buyer'?'Awaiting buyer':cp.status==='approved'?'Ready for payment':'Status pending';
 const heading=text('div','','payment-heading');
 heading.append(text('span','Payment','payment-eyebrow'),text('span',label,'payment-status'));
 settlement.append(heading,text('p',money(cp.amount),'payment-total'));
 if(!state.configured.paypal&&cp.status!=='captured')settlement.append(text('p','PayPal not connected','payment-connection'));
 if(cp.status==='approved'&&!state.archivedAt)settlement.append(button('Create payment','/api/order',cp));
 if(cp.status==='awaiting_buyer'&&!state.archivedAt){
  if(buyerReady){
   const pane=text('div','','buyer-confirm');
   const label=text('label','','capture-label');
   const checkbox=document.createElement('input');checkbox.type='checkbox';
   label.append(checkbox,document.createTextNode(' Confirm '+money(cp.amount)+' payment'));
   const capture=button('Capture '+money(cp.amount),'/api/capture',cp,{confirm:true});
   capture.dataset.captureConsent='pending';
   checkbox.addEventListener('change',()=>{capture.dataset.captureConsent=checkbox.checked?'confirmed':'pending';controls();});
   pane.append(label,capture);settlement.append(pane);
  }else{
   const link=text('a','Open PayPal approval ↗','primary payment-approval');
   link.href=cp.approvalUrl;link.target='_blank';link.rel='noopener noreferrer';
   const check=button('Check buyer approval','/api/buyer-status',cp);check.className='quiet payment-check';
   if(cp.approvalUrl)settlement.append(link);
   settlement.append(check);
  }
 }
 if(cp.status==='capture_unknown'||cp.status==='order_unknown'||(state.archivedAt&&cp.status==='awaiting_buyer')){
  if(cp.orderId)settlement.append(button('Check payment status','/api/reconcile',cp));
  else settlement.append(text('p','Awaiting order reference','payment-connection'));
 }
 if(cp.status==='captured')settlement.classList.add('payment-complete');
 if(cp.orderId||cp.captureId){
  const details=document.createElement('details');details.className='payment-details';
  details.append(text('summary','Transaction details'));
  const refs=text('dl','');
  if(cp.orderId)refs.append(text('dt','Order'),text('dd',cp.orderId));
  if(cp.captureId)refs.append(text('dt','Capture'),text('dd',cp.captureId));
  details.append(refs);settlement.append(details);
 }
 card.append(criteria);
}
if(recordedReview){
 const workspace=text('div','','accepted-delivery-workspace');
 const context=text('aside','','accepted-delivery-context');
 card.classList.add('has-accepted-workspace');
 context.append(criteria);
 if(hasPayment)context.append(settlement);
 workspace.append(recordedReview,context);card.append(workspace);
}else if(!criteria.parentElement)card.append(criteria);

list.append(card)})}

function renderProjects(){
 const projects=state.projects||[], query=get('project-search').value.trim().toLowerCase();
 get('project-toolbar').hidden=!state.project&&!projects.length;
 get('selected-project-name').textContent=state.project?.label||'New project';
 get('project-directory-count').textContent=String(projects.length);
 get('archive-project').hidden=!state.project||!!state.archivedAt;
 get('reopen-project').hidden=!state.archivedAt;
 const archived=get('archived-project-note');
 archived.hidden=!state.archivedAt;
 archived.textContent=state.archivedAt?'Archived':'';
 const items=get('project-list');
 items.replaceChildren();
 const showArchived=get('show-archived-projects').checked;
 const shown=projects.filter(project=>(showArchived||!project.archivedAt||project.unresolvedCount||project.awaitingBuyerCount)&&project.label.toLowerCase().includes(query));
 shown.sort((a,b)=>Number(Boolean(b.unresolvedCount))-Number(Boolean(a.unresolvedCount))||Number(Boolean(a.archivedAt))-Number(Boolean(b.archivedAt)));
 for(const project of shown){
  const li=text('li','','project-row'), link=text('a','','project-choice');
  link.href='./live.html?project='+encodeURIComponent(project.id);
  if(project.id===state.projectId)link.setAttribute('aria-current','page');
  const name=text('strong',project.label);
  const detail=text('span',project.acceptedCount+'/'+project.checkpointCount+' accepted · '+(project.reviewOnly?'Review only':money(project.capturedAmount)+' captured'),'project-progress');
  if(project.archivedAt)detail.prepend(document.createTextNode('Archived · '));
  link.append(name,detail);
  if(project.unresolvedCount)link.append(text('span',project.unresolvedCount+' unresolved payment'+(project.unresolvedCount===1?'':'s'),'project-alert'));
  else if(project.awaitingBuyerCount)link.append(text('span',project.awaitingBuyerCount+' open buyer order'+(project.awaitingBuyerCount===1?'':'s'),'project-alert'));
  li.append(link);items.append(li);
 }
 get('no-projects').hidden=shown.length>0;
 get('no-projects').textContent=projects.length?'No projects match this view.':'No projects yet.';
 get('project-archive-count').textContent='Show archived ('+projects.filter(p=>p.archivedAt).length+')';
}
get('project-search').addEventListener('input',()=>{if(state)renderProjects();});
get('show-archived-projects').addEventListener('change',()=>{if(state)renderProjects();});
get('new-project').onclick=()=>{
 if(busy||refreshBusy||needsRefresh)return;
 if(guideEntry.visible){guideEntry.compose();return;}
 if(!state?.project){get('project-directory').open=false;get('project').focus();return;}
 location.href='./live.html?project=new';
};
get('archive-project').onclick=async()=>{
 if(!state?.project||busy||refreshBusy||needsRefresh)return;
 if(!window.confirm('Archive “'+state.project.label+'”? Its review and payment history will be retained. Existing PayPal orders are not cancelled, and unresolved outcomes will remain visible.'))return;
 const result=await act('/api/projects/archive',{confirm:true});
 if(result)status('Project archived');
};
get('reopen-project').onclick=async()=>{
 const result=await act('/api/projects/reopen',{});
 if(result)status('Project reopened');
};

get('refresh-state').onclick=async()=>{if(await refreshState())await resumeBuyerReturn();};
recipientFeedbackPanel=mountRecipientFeedback(get('agreed-project'),{getState:()=>state,refresh:refreshState,act});
deliveryBundlePanel=mountDeliveryBundle(get('handoff-tools').querySelector('.handoff-menu'),async()=>{if(busy||refreshBusy)return null;if(!await refreshState()||!state?.project)return null;return buildLiveReview(state,new Date().toISOString());},()=>({workspaceId:location.origin,projectId:state?.projectId}),act,()=>state?.clientReview);
get('download-review').onclick=async()=>{
  if(busy||refreshBusy)return;
  // Re-read the server before exporting. No payment operation is retried.
  if(!await refreshState()||!state?.project)return;
  try{
    const report=buildLiveReview(state,new Date().toISOString());
    const html=renderLiveReviewHtml(report);
    const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));
    const anchor=document.createElement('a');
    anchor.href=url;
    anchor.download='scopesignal-sandbox-review-v1.html';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2500);
    status('Review ready to download');
  }catch(e){status('Review could not be prepared: '+e.message,true)}
};
get('add').onclick=()=>add();
get('project-kind').onchange=saveUnsentDraft;
get('export').onclick=()=>{
 if(!state?.project)return;
 const {projects,configured,localModel,...projectRecord}=state;
 const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),...projectRecord},null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob);
 const link=document.createElement('a');
 link.href=url;link.download='ScopeSignal-Sandbox-operator-record.json';link.click();
 setTimeout(()=>URL.revokeObjectURL(url),1500);
};get('plan').onsubmit=async event=>{
 event.preventDefault();
 saveUnsentDraft();
 // A source-organized brief is not ready while original requirements are
 // missing. An ordinary author-written scope without source organization
 // remains available; it has no claimed automated source coverage.
 if(suggestionCoverage&&sourceUnresolvedCount){
  showUnresolvedRequirements();
  return;
 }
 if(pendingReviewedDeliverables()){showPendingReviewedDeliverables();return;}
 const result=await act('/api/setup',{draft:draft(),draftId});
 if(!result?.state?.project)return;
 retireSuggestions();
 // The long editor has disappeared. Start the new review at its first heading,
 // unless the person deliberately moved to another control while setup ran.
 const focused=document.activeElement;
 if(focused!==document.body&&!get('composer').contains(focused))return;
 const heading=get('review-heading');
 heading.focus({preventScroll:true});
 heading.scrollIntoView({block:'start'});
};
const suggestionPreview=get('suggestion-preview'), suggestionList=get('suggestion-list');
const suggestionActionHome=get('adjust-suggestions').parentElement;
function retireSuggestions(keepCoverage=false,persist=true){
  suggestionDraft=null;pendingProposalDraft=null;previousSuggestionDraft=null;pausedProposalDraft=null;replacedSuggestionDraft=null;
  suggestionEditing=false;get('suggestion-adjustment').replaceChildren();get('suggestion-adjustment').hidden=true;get('adjust-suggestions').hidden=true;get('suggestion-list').hidden=false;
  suggestionAbort?.abort();suggestionAbort=null;suggestionContext=null;
  suggestionPreview.hidden=true;suggestionList.replaceChildren();
  get('suggest-status').textContent='';
  if(!keepCoverage)suggestionCoverage=null;
  updateSuggestionCoverage();controls();if(persist)saveUnsentDraft();
}
function updateSuggestionCoverage(){
  const box=get('suggestion-coverage');
  if(!suggestionCoverage){
    get('suggestion-missing').sourceChoiceContext=null;
    sourceUnresolvedCount=0;syncStartReviewAction();
    box.hidden=true;get('suggestion-conditions').hidden=true;get('suggestion-condition-list').replaceChildren();return;
  }
  const current=draft();
  const clauses=current.brief.trim()&&current.brief.length<=8000?splitScopeClauses(current.brief):[];
  const conditions=clauses.filter(clause=>suggestionCoverage.conditions.includes(clause.text));
  const assignedMissing=Array.from(rows.children).flatMap(row=>
    clauses.filter(clause=>!conditions.includes(clause)&&row.sourceClauses?.includes(clause.text)&&!row.querySelector('textarea').value.includes(clause.text))
      .map(clause=>({clause,rowId:row.dataset.draftRowId,label:row.querySelector('input').value.trim()||'Unnamed deliverable'})));
  const missing=clauses.filter(clause=>!conditions.includes(clause)&&!assignedMissing.some(item=>item.clause===clause)&&!current.checkpoints.some(cp=>cp.evidence.includes(clause.text)));
  const fragments=[...assignedMissing,...missing.map(clause=>({clause,label:''}))];
  const retainedTargets=Object.fromEntries(clauses.map(clause=>[clause.id,Array.from(rows.children).filter(row=>row.sourceClauses?.includes(clause.text)).map(row=>row.dataset.draftRowId)]));
  const viewState={clauses,groups:[],excludedClauseIds:conditions.map(clause=>clause.id)};
  const unresolved=quotedUnresolvedRequirements(viewState,current.brief,fragments,{retainedTargets});
  sourceUnresolvedCount=unresolved.length;
  const destination=()=>Array.from(rows.children).filter(row=>row.querySelector('input').value.trim());
  const missingList=get('suggestion-missing');
  const choiceContext=JSON.stringify([draftId,current.brief]);
  const previousChoices=missingList.sourceChoiceContext===choiceContext
    ?new Map(Array.from(missingList.children,item=>[item.sourceChoiceKey,item.querySelector('select')?.value]))
    :new Map();
  missingList.sourceChoiceContext=choiceContext;
  missingList.replaceChildren(...unresolved.map(({clause,label,rowId})=>{
    const item=text('li','','source-unresolved');
    item.sourceChoiceKey=JSON.stringify([rowId??'',clause.clauseIds]);
    item.append(text('p',(label?label+': ':'')+clause.text));
    const choice=document.createElement('select');
    choice.setAttribute('aria-label','Assign original requirement: '+clause.text);
    // Choosing a destination is provisional; the form input listener would rebuild it.
    choice.addEventListener('input',event=>{event.stopPropagation();persistUnsentDraft();});
    choice.append(new Option('Choose destination',''));
    destination().forEach(row=>{
      const option=new Option(row.querySelector('input').value.trim(),row.dataset.draftRowId);
      choice.append(option);
    });
    choice.append(new Option('Project term · no price','__terms__'));
    // Retain the author's existing destination; choosing it does not add text.
    if(rowId&&destination().some(row=>row.dataset.draftRowId===rowId))choice.value=rowId;
    const previousChoice=previousChoices.get(item.sourceChoiceKey);
    if(previousChoices.has(item.sourceChoiceKey)&&Array.from(choice.options).some(option=>option.value===previousChoice))choice.value=previousChoice;
    const assignmentError=text('p','','bad source-assignment-error');assignmentError.hidden=true;assignmentError.setAttribute('role','alert');
    const assign=text('button','Assign','secondary');assign.type='button';
    assign.onclick=()=>{
      if(!choice.value){choice.focus();return;}
      if(choice.value==='__terms__'){
        suggestionCoverage.conditions=[...new Set([...suggestionCoverage.conditions,...clauses.filter(item=>clause.clauseIds.includes(item.id)).map(item=>item.text)])];
        if(suggestionDraft?.context?.local){
          suggestionDraft.context.conditionIds=[...new Set([...(suggestionDraft.context.conditionIds||[]),...clause.clauseIds])];
        }
      }else{
        const row=Array.from(rows.children).find(row=>row.dataset.draftRowId===choice.value);
        if(!row){choice.focus();return;}
        const input=row.querySelector('textarea');
        let updated;
        try{updated=appendGroupingSourceToDraft(current.brief,clause.clauseIds,input.value,row.sourceClauses||[]);}
        catch(error){assignmentError.textContent=error.message;assignmentError.hidden=false;return;}
        input.value=updated.text;row.sourceClauses=updated.sourceClauses;
        input.dispatchEvent(new Event('input',{bubbles:true}));
      }
      saveUnsentDraft();
      updateSuggestionCoverage();
      const next=missingList.querySelector('select');
      if(next){
        next.closest('.source-unresolved').scrollIntoView({block:'center',behavior:'instant'});
        next.focus({preventScroll:true});
      }else{
        const status=get('suggest-status');
        if(status.textContent==='Assign every original requirement or keep it as a project term before starting review.')
          status.textContent='All source requirements are kept in this review.';
        get('plan').querySelector('[data-review-action]').focus({preventScroll:true});
      }
    };
    item.append(choice,assign,assignmentError);return item;
  }));
  const missingCount=sourceUnresolvedCount;
  syncStartReviewAction();
  get('suggestion-condition-list').replaceChildren(...conditions.map(clause=>text('li',clause.text)));
  get('suggestion-conditions').hidden=!conditions.length;
  get('suggestion-coverage-summary').textContent=missingCount
    ? missingCount+' requirement'+(missingCount===1?'':'s')+' not yet added to review'
    : 'Source requirements kept'+(conditions.length?' · '+conditions.length+' project term'+(conditions.length===1?'':'s'):'');
  box.hidden=!clauses.length;
}
function restorePendingSuggestions(){
  if(pendingProposalDraft===null||state?.project)return;
  const saved=pendingProposalDraft;pendingProposalDraft=null;
  const restored=restoreProposalDraft(saved,{...draft(),draftId});
  if(!restored){draftNote('Draft recovered; suggestions could not be restored');return;}
  const clauses=splitScopeClauses(restored.context.brief);
  suggestionCoverage={conditions:clauses.filter(clause=>restored.context.conditionIds.includes(clause.id)).map(clause=>clause.text)};
  showSuggestions(restored.proposals,restored.context,restored.editor);
  get('suggest-status').textContent=restored.editor?'Recovered grouping edits':restored.context.manual?'Your deliverables':restored.proposals.length?'Recovered suggestions':'No deliverables suggested. Create them from your brief.';
  draftNote('Recovered your draft');
}
function restorePreviousSuggestions(previous){
  if(!previous||state?.project||previous.context.draftId!==draftId||previous.context.brief!==get('brief').value)return false;
  if(previous.context.local){
    const clauses=splitScopeClauses(previous.context.brief);
    suggestionCoverage={conditions:clauses.filter(clause=>(previous.context.conditionIds||[]).includes(clause.id)).map(clause=>clause.text)};
    updateSuggestionCoverage();
  }
  showSuggestions(previous.proposals,previous.context,previous.editor);
  return true;
}
function releaseAdoptedRow(rowId){
  for(const preview of new Set([suggestionDraft,previousSuggestionDraft].filter(Boolean))){
    const context=preview.context,bindings=context.adoptedRowIds||{};
    const removed=(context.addedIndices||[]).filter(index=>bindings[index]===rowId);
    if(!removed.length)continue;
    context.addedIndices=context.addedIndices.filter(index=>!removed.includes(index));
    for(const index of removed)delete bindings[index];
    context.adopted=context.addedIndices.length>0;
    if(preview===suggestionDraft)showSuggestions(preview.proposals,context,preview.editor,{preserveFocus:true,deferEditor:true});
  }
}
function showSuggestions(proposals,context,editorDraft=null,{preserveFocus=false,deferEditor=false}={}){
  const outputReview=context.local&&!context.manual&&!context.humanReviewed&&proposals.length?unrepresentedNamedOutputs(proposals,context.brief):null;
  if(outputReview)context.reviewRequired=true;
  const focus=preserveFocus?document.activeElement:null,selection=focus&&typeof focus.selectionStart==='number'?[focus.selectionStart,focus.selectionEnd]:null;
  const scroll=preserveFocus?[window.scrollX,window.scrollY]:null;
  context.addedIndices??=[];
  const bindings=context.adoptedRowIds||{},liveRows=Array.from(rows.children),liveIds=new Set(liveRows.map(row=>row.dataset.draftRowId));
  const retained=[],used=new Set(Object.values(bindings).filter(id=>liveIds.has(id)));
  for(const index of context.addedIndices){
    if(!Object.hasOwn(bindings,index)){
      // Recover old unedited drafts only when the original row is unambiguous.
      const proposal=proposals[index],matches=liveRows.filter(row=>!used.has(row.dataset.draftRowId)&&row.querySelector('input').value===proposal?.title&&row.querySelector('textarea').value===proposal?.evidence);
      if(matches.length===1){bindings[index]=matches[0].dataset.draftRowId;used.add(bindings[index]);}
    }
    if(liveIds.has(bindings[index]))retained.push(index);
  }
  context.addedIndices=retained;context.adopted=retained.length>0;
  context.adoptedRowIds=Object.fromEntries(retained.map(index=>[index,bindings[index]]));
  // Existing previews can recover exact source assignments for older saved rows.
  const sourceClauses=splitScopeClauses(context.brief);
  for(const index of retained){
    const row=liveRows.find(row=>row.dataset.draftRowId===bindings[index]);
    if(!row.sourceClauses?.length)row.sourceClauses=sourceClauses.filter(clause=>proposals[index]?.clauseIds?.includes(clause.id)).map(clause=>clause.text);
  }
  suggestionDraft={proposals,context,editor:editorDraft};
  let outputNotice=get('named-output-review');
  if(!outputNotice){outputNotice=text('p','','named-output-review');outputNotice.id='named-output-review';suggestionPreview.querySelector('.suggestion-toolbar').after(outputNotice);}
  outputNotice.hidden=!outputReview;
  outputNotice.textContent=outputReview?'Your brief names '+outputReview.expected.length+' separate deliverables: '+outputReview.expected.join('; ')+'. These suggestions do not represent them all separately. Review the deliverables before adding this reading.':'';
  suggestionContext=context;
  get('suggestion-heading').textContent=context.manual?'Your deliverables':'Suggested work';
  suggestionEditing=false;controls();
  const adjustment=get('suggestion-adjustment'),adjust=get('adjust-suggestions');
  adjustment.replaceChildren();adjustment.hidden=true;suggestionList.hidden=false;
  if(context.local&&!proposals.length)get('suggest-status').after(adjust);else suggestionActionHome.prepend(adjust);
  adjust.hidden=!context.local||context.adopted;
  adjust.textContent=outputReview?'Review deliverables':context.reviewRequired?'Review changes':proposals.length?'Adjust':'Create deliverables';
  adjust.setAttribute('aria-label',outputReview?'Review separately named deliverables':context.reviewRequired?'Review changed brief':proposals.length?'Adjust suggested deliverables':'Create deliverables');
  adjust.onclick=()=>{
    if(state?.project||context.draftId!==draftId||context.brief!==get('brief').value){retireSuggestions(true);return;}
    suggestionEditing=true;controls();suggestionList.hidden=true;adjust.hidden=true;adjustment.hidden=false;
    const startingEditor=suggestionDraft.editor;
    const cancel=()=>{
      if(suggestionContext!==context)return;
      suggestionDraft.editor=context.reviewRequired?startingEditor:null;
      suggestionEditing=false;adjustment.replaceChildren();adjustment.hidden=true;suggestionList.hidden=false;adjust.hidden=false;controls();
      get('suggestion-heading').focus({preventScroll:true});suggestionPreview.scrollIntoView({block:'start',behavior:'instant'});saveUnsentDraft();
    };
    try{
      mountProposalGrouping(adjustment,{proposals,brief:context.brief,retainedAssignments:Array.from(rows.children).flatMap(row=>(row.sourceClauses||[]).filter(source=>row.querySelector('textarea').value.includes(source)).map(source=>({source,rowId:row.dataset.draftRowId,title:row.querySelector('input').value.trim()||'Unnamed deliverable'}))),draftTargets:Array.from(rows.children).filter(row=>row.querySelector('input').value.trim()).map(row=>({id:row.dataset.draftRowId,title:row.querySelector('input').value.trim()})),
      onAddToDraft:(clauseId,rowId)=>{
        if(state?.project||context.draftId!==draftId||context.brief!==get('brief').value)throw Error('The brief changed. Reopen its requirements.');
        const row=Array.from(rows.children).find(row=>row.dataset.draftRowId===rowId);
        if(!row)throw Error('This draft is no longer available.');
        const input=row.querySelector('textarea');
        const updated=appendGroupingSourceToDraft(context.brief,clauseId,input.value,row.sourceClauses||[]);
        input.value=updated.text;row.sourceClauses=updated.sourceClauses;
        input.dispatchEvent(new Event('input',{bubbles:true}));saveUnsentDraft();
        return row.querySelector('input').value.trim()||'Unnamed deliverable';
      },excludedClauseIds:context.conditionIds||[],initialDraft:suggestionDraft.editor,onDraftChange:editor=>{
        if(!suggestionEditing||suggestionContext!==context||state?.project||context.draftId!==draftId||context.brief!==get('brief').value)return;
        suggestionDraft.editor=editor;saveUnsentDraft();
      },onCancel:cancel,onApply:(updated,termIds)=>{
        if(state?.project||context.draftId!==draftId||context.brief!==get('brief').value){retireSuggestions(true);return;}
        context.reviewRequired=false;context.humanReviewed=true;context.conditionIds=termIds;const clauses=splitScopeClauses(context.brief);suggestionCoverage={conditions:clauses.filter(clause=>termIds.includes(clause.id)).map(clause=>clause.text)};updateSuggestionCoverage();
        showSuggestions(updated,context);get('suggest-status').textContent='Grouping updated';
      }});
      adjustment.scrollIntoView({block:'start',behavior:'instant'});
    }catch(error){cancel();get('suggest-status').textContent=error.message;}
  };
  suggestionList.replaceChildren();
  const bulk=get('add-all-suggestions');
  const sourceText=new Map(splitScopeClauses(context.brief).map(clause=>[clause.id,clause.text]));
  const requirementsFor=proposal=>{
    const evidence=proposal.clauseIds?.map(id=>sourceText.get(id));
    return evidence?.length&&evidence.every(Boolean)?evidence:[];
  };
  const unadopted=()=>proposals.map((_,index)=>index).filter(index=>!context.addedIndices.includes(index));
  const blankPlaceholder=()=>rows.children.length===1&&Array.from(rows.firstElementChild.querySelectorAll('input,textarea')).every(input=>!input.value.trim());
  function refreshBulkAction(){
    const remaining=unadopted();
    bulk.hidden=context.manual!==true||context.reviewRequired||!remaining.length;
    if(!bulk.hidden){
      bulk.textContent=(context.addedIndices.length?'Add remaining ':'Add all ')+remaining.length+' to draft';
      bulk.setAttribute('aria-label','Add '+remaining.length+' remaining reviewed deliverable'+(remaining.length===1?'':'s')+' to the draft');
    }
  }
  bulk.onclick=()=>{
    if(context.reviewRequired||context.manual!==true)return;
    if(state?.project||context.draftId!==draftId||context.brief!==get('brief').value){retireSuggestions(true);return;}
    const remaining=unadopted();
    if(!remaining.length)return;
    const occupied=rows.children.length-(blankPlaceholder()?1:0);
    if(occupied+remaining.length>12){
      return status('Not enough room for all '+remaining.length+' deliverables. The draft has '+occupied+' of 12 places in use; remove a draft or add individually.',true);
    }
    // Check every row before changing any: the batch is all-or-nothing.
    const entries=remaining.map(index=>({index,proposal:proposals[index],requirements:requirementsFor(proposals[index])}));
    if(entries.some(({proposal})=>!proposal.title?.trim()||!proposal.evidence?.trim())){
      return status('A deliverable needs a name and acceptance criteria before it can join the draft.',true);
    }
    if(blankPlaceholder())rows.replaceChildren();
    const created=[];
    for(const {index,proposal,requirements} of entries){
      const row=add([proposal.title,'',proposal.evidence],undefined,requirements,false);
      created.push({index,row});
      context.addedIndices.push(index);
      context.adoptedRowIds[index]=row.dataset.draftRowId;
    }
    context.adopted=true;replacedSuggestionDraft=null;adjust.hidden=true;controls();
    for(const {index} of created){
      const item=suggestionList.children[index];item.hidden=true;
      const button=item.querySelector('button');
      button.disabled=true;button.textContent='Added to draft';
    }
    refreshBulkAction();
    suggestionPreview.hidden=unadopted().length===0;
    if(notice.classList.contains('bad')&&notice.textContent.startsWith('Not enough room for all '))status('');
    saveUnsentDraft();
    updateSuggestionCoverage();
    get('suggest-status').textContent=isReviewOnlyDraft()
      ? created.length+' deliverables added to review'
      : created.length+' deliverables added — enter their prices';
    if(created[0]){
      const first=created[0].row;
      first.querySelectorAll('input')[isReviewOnlyDraft()?0:1].focus({preventScroll:true});
      first.scrollIntoView({block:'center',behavior:'instant'});
    }
  };
  proposals.forEach((proposal,index)=>{
    const item=text('article','','suggestion');item.hidden=context.addedIndices.includes(index);
    item.append(text('h4',(index+1)+'. '+proposal.title));
    const sourceRequirements=requirementsFor(proposal);
    if(sourceRequirements.length){
      const requirements=text('ul','','suggestion-requirements');
      requirements.append(...sourceRequirements.map(requirement=>text('li',requirement)));
      item.append(requirements);
    }else item.append(text('p',proposal.evidence,'evidence'));
    const insert=text('button','Add deliverable','secondary');
    insert.type='button';
    insert.disabled=context.reviewRequired||context.addedIndices.includes(index);if(context.addedIndices.includes(index))insert.textContent='Added to draft';
    insert.onclick=()=>{
      if(context.reviewRequired||context.addedIndices.includes(index))return;
      if(state?.project||context.draftId!==draftId||context.brief!==get('brief').value){retireSuggestions(true);return;}
      if(rows.children.length>=12)return status('The plan already has 12 checkpoints. Remove one before adding another.',true);
      if(blankPlaceholder())rows.replaceChildren();
      context.addedIndices.push(index);context.adopted=true;replacedSuggestionDraft=null;adjust.hidden=true;controls();
      const added=add([proposal.title,'',proposal.evidence],undefined,sourceRequirements||[]);
      context.adoptedRowIds[index]=added.dataset.draftRowId;saveUnsentDraft();
      updateSuggestionCoverage();
      insert.disabled=true;insert.textContent='Added to draft';item.hidden=true;refreshBulkAction();
      suggestionPreview.hidden=unadopted().length===0;
      get('suggest-status').textContent=isReviewOnlyDraft()?'Deliverable added to review':'Deliverable added — enter its price';
      added.querySelectorAll('input')[isReviewOnlyDraft()?0:1].focus();
    };
    item.append(insert);suggestionList.append(item);
  });
  refreshBulkAction();
  suggestionPreview.hidden=proposals.length>0&&unadopted().length===0;
  if(!suggestionPreview.hidden&&!preserveFocus&&context.local&&!proposals.length){
    adjust.focus({preventScroll:true});adjust.scrollIntoView({block:'center',behavior:'instant'});
  }else if(!suggestionPreview.hidden&&!preserveFocus){
    get('suggestion-heading').focus({preventScroll:true});
    suggestionPreview.scrollIntoView({block:'start',behavior:'instant'});
  }
  saveUnsentDraft();
  if(editorDraft&&!context.adopted&&!deferEditor)adjust.click();
  if(focus?.isConnected){focus.focus({preventScroll:true});if(selection)focus.setSelectionRange(...selection);window.scrollTo(...scroll);}
}
get('restore-suggestions').onclick=()=>{
  if(busy||refreshBusy||needsRefresh||suggestionAbort||suggestionEditing||state?.project)return;
  const previous=replacedSuggestionDraft;
  retireSuggestions(true,false);
  if(restorePreviousSuggestions(previous)){get('suggest-status').textContent='Previous grouping restored';saveUnsentDraft();}
};
get('dismiss-suggestions').onclick=()=>{
  retireSuggestions(true);get('suggest').focus();
};
get('brief').addEventListener('input',()=>{
  if(get('suggest-status').textContent==='Enter a brief first')get('suggest-status').textContent='';
});
get('organize-brief').onclick=()=>{
  if(busy||refreshBusy||needsRefresh||state?.project||suggestionAbort||suggestionEditing||suggestionContext?.adopted)return;
  const brief=get('brief').value;
  if(!brief.trim()||brief.length>8000){get('suggest-status').textContent='Enter a brief first';get('brief').focus();return;}
  // Reopen existing human edits instead of replacing a usable reading.
  if(suggestionDraft&&suggestionContext?.draftId===draftId&&suggestionContext.brief===brief){
    get('adjust-suggestions').click();return;
  }
  const context={brief,draftId,local:true,manual:true,conditionIds:[]};
  const clauses=splitScopeClauses(brief),seeded=seedExplicitDeliverables(brief);
  const assigned=new Set(seeded.flatMap(proposal=>proposal.clauseIds));
  const blank=rows.children.length===1&&Array.from(rows.firstElementChild.querySelectorAll('input,textarea')).every(field=>!field.value.trim());
  suggestionCoverage={conditions:[]};updateSuggestionCoverage();
  if(blank&&seeded.length&&clauses.every(clause=>assigned.has(clause.id))){
    // When the entire original source has named destinations, its editable
    // deliverables are the useful result. Do not ask the author to approve
    // the same literal grouping twice before the work even reaches the draft.
    // No price, acceptance or external operation is inferred here.
    const proposals=materializeProposalGrouping(createProposalGrouping(seeded,brief));
    showSuggestions(proposals,context);
    get('add-all-suggestions').click();
    return;
  }
  showSuggestions([],context);
  get('suggest-status').textContent='Assign requirements from your brief';
  get('adjust-suggestions').click();
};
get('suggest').onclick=async()=>{
  if(suggestionAbort){
    const previous=previousSuggestionDraft,backup=replacedSuggestionDraft;
    retireSuggestions(true,false);replacedSuggestionDraft=backup;
    if(!restorePreviousSuggestions(previous))saveUnsentDraft();
    get('suggest-status').textContent='Suggestions cancelled';return;
  }
  if(busy||refreshBusy||needsRefresh||state?.project)return;
  const local=Boolean(state?.configured.localAi);
  if(!local&&!state?.configured.ai){await modelConnection.open();return;}
  const brief=get('brief').value;
  if(!brief.trim()||brief.length>8000){get('suggest-status').textContent='Enter a brief first';get('brief').focus();return;}
  const previous=suggestionDraft,backup=replacedSuggestionDraft;
  retireSuggestions(true,false);replacedSuggestionDraft=backup;
  previousSuggestionDraft=previous;
  const controller=new AbortController(),context={brief,draftId};
  suggestionAbort=controller;suggestionContext=context;controls();
  // Keep corrected work recoverable until a replacement reading succeeds.
  saveUnsentDraft();
  const extended=local&&get('suggest-extended').checked;
  get('suggest-status').textContent=local
    ? 'Reading your brief · up to '+(extended?'90':'60')+' seconds'
    : 'Reading your brief…';
  try{
    const response=await fetch(local?'/api/local-suggestions':'/api/suggest',{
      method:'POST',cache:'no-store',headers:{'content-type':'application/json','x-scopesignal-token':token},
      body:JSON.stringify(extended?{brief,wait:'extended'}:{brief}),signal:controller.signal
    });
    const result=await response.json();
    if(suggestionAbort!==controller||state?.project||draftId!==context.draftId||get('brief').value!==brief)return;
    if(!response.ok)throw new Error(result?.error||'Suggestions unavailable. Try again.');
    const proposals=local?resolveLocalScopeGroups(result,brief):result.suggestions;
    if(!Array.isArray(proposals?.checkpoints))throw new Error('Suggestions unavailable. Try again.');
    if(!proposals.checkpoints.length&&restorePreviousSuggestions(previousSuggestionDraft)){
      get('suggest-status').textContent='No deliverables suggested. Previous work kept.';return;
    }
    if((!replacedSuggestionDraft||previousSuggestionDraft?.context.humanReviewed)&&previousSuggestionDraft?.context.local){
      const identity={...draft(),draftId};
      replacedSuggestionDraft=restoreProposalDraft(serializeProposalDraft(previousSuggestionDraft,identity),identity);
    }
    if(local)suggestionCoverage={conditions:proposals.scopeConditions.flatMap(group=>group.clauses.map(clause=>clause.text))};
    context.local=local;context.conditionIds=local?proposals.scopeConditions.flatMap(group=>group.clauses.map(clause=>clause.id)):[];
    updateSuggestionCoverage();
    showSuggestions(proposals.checkpoints,context);
    const termCount=local?proposals.scopeConditions.reduce((count,group)=>count+group.clauses.length,0):0;
    get('suggest-status').textContent=proposals.checkpoints.length
      ? proposals.checkpoints.length+' suggested deliverable'+(proposals.checkpoints.length===1?'':'s')+(termCount?' · '+termCount+' project term'+(termCount===1?'':'s'):'')
      : local?'No deliverables suggested. Create them from your brief.':'No deliverables suggested. Add a deliverable or try again.';
  }catch(error){
    if(suggestionAbort!==controller||controller.signal.aborted||state?.project||draftId!==context.draftId||get('brief').value!==brief)return;
    if(restorePreviousSuggestions(previousSuggestionDraft)){
      get('suggest-status').textContent='Reading failed. Previous work kept.';
    }else if(local){
      // A failed reading must not strand the exact brief behind another model call.
      // Reuse the human grouping editor without inventing model suggestions or terms.
      context.local=true;context.conditionIds=[];
      suggestionCoverage={conditions:[]};updateSuggestionCoverage();
      showSuggestions([],context);
      get('suggest-status').textContent='Reading failed. Create deliverables from your brief.';
    }else get('suggest-status').textContent=error.message||'Suggestions unavailable. Try again.';
  }finally{
    if(suggestionAbort===controller){suggestionAbort=null;previousSuggestionDraft=null;controls();}
  }
};
add();
loadUnsentDraft();
draftTracking=true;
get('plan').addEventListener('input',saveUnsentDraft);
get('start-own-scope').addEventListener('click',startOwnScope);
get('clear-unsent-draft').addEventListener('click',clearUnsentDraft);
refreshState().then(ok=>{if(ok)return resumeBuyerReturn();});
