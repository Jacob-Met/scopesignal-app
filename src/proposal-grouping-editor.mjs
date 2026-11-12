import {restoreGroupingEditorDraft} from './proposal-draft.mjs';
import {createProposalGrouping,seedExplicitDeliverables,renameGroupingDeliverable,addGroupingDeliverable,removeGroupingDeliverable,setGroupingClauseTargets,quotedGroupingUnits,setGroupingUnitTargets,materializeProposalGrouping,conditionalRequirementHint} from './proposal-grouping.mjs';

export function mountProposalGrouping(container,{proposals,brief,excludedClauseIds=[],retainedAssignments=[],draftTargets=[],onAddToDraft,initialDraft=null,onDraftChange,onApply,onCancel}){
 const restored=initialDraft?restoreGroupingEditorDraft(initialDraft,brief):null;
 const initial=proposals.length?proposals:seedExplicitDeliverables(brief,excludedClauseIds);
 let state=restored?.state||createProposalGrouping(initial,brief,excludedClauseIds);
 const pendingExisting=new Map(Object.entries(restored?.pendingExisting||{}).filter(([,id])=>draftTargets.some(target=>target.id===id)));
 const clearPending=unit=>{for(const id of unit.clauseIds)pendingExisting.delete(id);};
 const retainedRecords=clause=>state.clauses.filter(current=>current.text===clause.text).length===1?retainedAssignments.filter(item=>item.source===clause.text):[];
 const retainedFor=unit=>[...new Set(retainedRecords(state.clauses.find(clause=>clause.id===unit.id)||unit).map(item=>item.title))];
 const units=()=>quotedGroupingUnits(state,brief,{retainedTargets:Object.fromEntries(state.clauses.map(clause=>[clause.id,[...new Set(retainedRecords(clause).map(item=>item.rowId||item.title))]]))});
 const unitFor=id=>units().find(unit=>unit.clauseIds.includes(id));
 const element=(tag,value,cls='')=>{const node=document.createElement(tag);node.textContent=value;node.className=cls;return node;};
 container.replaceChildren();
 const heading=element('h4','Assign requirements');heading.tabIndex=-1;
 const coverage=element('p','','regroup-coverage');coverage.setAttribute('role','status');
 const list=element('div','','regroup-requirements');
 const error=element('p','','bad regroup-error');error.setAttribute('role','status');error.tabIndex=-1;
 const names=element('details','','regroup-names'),namesTitle=element('summary','Edit deliverables'),nameFields=element('div','','regroup-name-fields');
 const nameInputs=new Map();names.append(namesTitle,nameFields);names.open=restored?.namesOpen||false;names.addEventListener('toggle',notify);
 const creation=element('div','','regroup-new'),label=element('label','New deliverable');
 const name=document.createElement('input');name.maxLength=80;name.placeholder='Deliverable name';name.value=restored?.newName||'';name.oninput=notify;label.append(name);
 const create=element('button','Add','secondary');create.type='button';create.classList.add('regroup-create');
 creation.append(label,create);
 const actions=element('div','','actions');
 const apply=element('button','Use this grouping','primary'),cancel=element('button','Cancel','quiet');
 apply.type=cancel.type='button';apply.classList.add('regroup-apply');cancel.classList.add('regroup-cancel');
 const editHere=element('button','Deliverables','secondary regroup-edit-here');editHere.type='button';
 const nextUnassigned=element('button','','quiet regroup-next-unassigned');nextUnassigned.type='button';
 actions.classList.add('regroup-actions');actions.append(nextUnassigned,apply,editHere,cancel);
 container.append(heading,coverage,names,creation,list,error,actions);
 const dialog=document.createElement('dialog');dialog.className='regroup-dialog';
 const dialogHeading=element('h3','Deliverables'),back=element('button','Back to requirements','primary');
 dialogHeading.id=(container.id||'grouping')+'-deliverable-heading';dialog.setAttribute('aria-labelledby',dialogHeading.id);
 const context=element('p','','regroup-dialog-context');context.hidden=true;
 back.type='button';back.classList.add('regroup-back');dialog.append(dialogHeading,context,back);container.append(dialog);
 let lastRequirement=null,returnScroll=0,pendingStartClauseId=null;
 list.addEventListener('focusin',event=>{const row=event.target.closest('.regroup-requirement');if(row)lastRequirement={id:row.dataset.clauseId,target:event.target.type==='checkbox'?(event.target.hasAttribute('value')?event.target.value:'__all__'):null};});
 function openDeliverablesFor(clauseId=null){
  returnScroll=window.scrollY;
  if(clauseId)lastRequirement={id:clauseId,target:null};
  context.textContent=unitFor(lastRequirement?.id)?.text||'';
  context.hidden=!context.textContent;
  dialogHeading.textContent=clauseId?'Name a deliverable':'Deliverables';
  dialog.insertBefore(nameFields,back);dialog.insertBefore(creation,back);dialog.insertBefore(error,back);
  dialog.showModal();(clauseId?name:(nameInputs.values().next().value||name)).focus();
 }
 editHere.onclick=()=>{pendingStartClauseId=null;openDeliverablesFor();};
 function returnToRequirement(){
  names.append(nameFields);container.insertBefore(creation,list);container.insertBefore(error,actions);
  const row=lastRequirement?[...list.children].find(row=>row.dataset.clauseId===lastRequirement.id):null;
  const target=lastRequirement?.target===null?row?.querySelector('select'):lastRequirement?.target==='__all__'?row?.querySelector('input[type=checkbox]'):row?.querySelector('input[value="'+lastRequirement?.target+'"]');
  window.scrollTo({top:returnScroll,behavior:'instant'});
  const returnTarget=target||row?.querySelector('select')||editHere;returnTarget.focus({preventScroll:true});
  if(row)returnTarget.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
 }
 back.onclick=()=>{pendingStartClauseId=null;dialog.close();returnToRequirement();};
 dialog.addEventListener('cancel',event=>{event.preventDefault();pendingStartClauseId=null;dialog.close();returnToRequirement();});


function notify(){
  const identities=state.groups.map(group=>group.title).join(' · ');
  const heading=state.groups.length
   ? 'Edit '+state.groups.length+' deliverable'+(state.groups.length===1?'':'s')
   : 'Add deliverables';
  namesTitle.textContent=state.groups.length<=3&&identities.length<=110?heading+' · '+identities:heading;
  onDraftChange?.({version:2,state:{groups:structuredClone(state.groups),excludedClauseIds:[...state.excludedClauseIds],nextId:state.nextId},names:Object.fromEntries([...nameInputs].map(([id,input])=>[id,input.value])),newName:name.value,namesOpen:names.open,...(pendingExisting.size?{pendingExisting:Object.fromEntries(pendingExisting)}:{})});
 }
 function renderNames(){
  for(const [id,input] of nameInputs)if(!state.groups.some(g=>g.id===id)){input.closest('.regroup-name-row').remove();nameInputs.delete(id);}
  for(const [index,group] of state.groups.entries()){
   if(nameInputs.has(group.id)){nameInputs.get(group.id).parentElement.firstChild.textContent='Deliverable '+(index+1);continue;}
   const label=element('label','Deliverable '+(index+1)),input=document.createElement('input');
   input.value=restored?.names[group.id]??group.title;input.required=true;input.maxLength=80;input.dataset.groupId=group.id;
   input.setCustomValidity(input.value.trim()?'':'Name this deliverable.');
   input.oninput=()=>{input.setCustomValidity(input.value.trim()?'':'Name this deliverable.');notify();};
   const updateName=()=>{try{state=renameGroupingDeliverable(state,group.id,input.value);input.value=state.groups.find(g=>g.id===group.id).title;input.closest('.regroup-name-row').querySelector('.regroup-remove').setAttribute('aria-label','Remove deliverable '+input.value);error.textContent='';renderRows();}catch(e){error.textContent=e.message;}notify();};
   input.onchange=updateName;input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();updateName();}};
   const row=element('div','','regroup-name-row'),remove=element('button','Remove','quiet');remove.type='button';remove.classList.add('regroup-remove');remove.setAttribute('aria-label','Remove deliverable '+group.title);
   remove.onclick=()=>{
    const removed=state.groups.find(g=>g.id===group.id);state=removeGroupingDeliverable(state,group.id);
    const unassigned=removed.clauseIds.filter(id=>!state.groups.some(g=>g.clauseIds.includes(id)));
    renderNames();renderRows();notify();
    error.textContent='Removed '+removed.title+'.'+(unassigned.length?' '+unassigned.length+' requirement'+(unassigned.length===1?' needs':'s need')+' assignment.':'');
    const next=state.groups[index]||state.groups[index-1];(next?nameInputs.get(next.id):name).focus();
   };
   label.append(input);row.append(label,remove);nameFields.append(row);nameInputs.set(group.id,input);
  }
 }

 nextUnassigned.onclick=()=>{
  const unresolved=units().filter(clause=>!state.excludedClauseIds.includes(clause.id)&&!retainedFor(clause).length&&!state.groups.some(group=>group.clauseIds.includes(clause.id)));
  if(!unresolved.length)return;
  const current=units(),after=current.findIndex(clause=>clause.clauseIds.includes(lastRequirement?.id));
  const clause=unresolved.find(clause=>current.findIndex(unit=>unit.id===clause.id)>after)||unresolved[0];
  const row=[...list.children].find(row=>row.dataset.clauseId===clause.id);
  row?.querySelector('select')?.focus({preventScroll:true});
  row?.scrollIntoView({block:'center',behavior:'instant'});
 };

 function renderRows(focusKey=null,focusTarget=null){
  if(focusKey)focusKey=unitFor(focusKey)?.id||focusKey;
  if(lastRequirement)lastRequirement.id=unitFor(lastRequirement.id)?.id||lastRequirement.id;
  const opened=new Set([...list.querySelectorAll('.regroup-sharing[open]')].map(details=>details.closest('.regroup-requirement').dataset.clauseId));
  const unresolved=units().filter(clause=>!state.excludedClauseIds.includes(clause.id)&&!retainedFor(clause).length&&!state.groups.some(group=>group.clauseIds.includes(clause.id)));
  coverage.textContent=(units().length-unresolved.length)+' of '+units().length+' original requirements placed'+(unresolved.length?' · '+unresolved.length+' still '+(unresolved.length===1?'needs':'need')+' assignment':'');
  nextUnassigned.hidden=!unresolved.length;nextUnassigned.textContent=unresolved.length+' unassigned · Next →';
  list.replaceChildren();const controls=new Map(),targetControls=new Map();
  for(const clause of units()){
   const isTerm=state.excludedClauseIds.includes(clause.id);
   const owners=state.groups.filter(g=>g.clauseIds.includes(clause.id)),held=retainedFor(clause);
   const row=element('div','','regroup-requirement');row.dataset.clauseId=clause.id;
   const original=element('p',clause.text),targetLabel=element('label','Applies to');
   const condition=conditionalRequirementHint(state,clause.text);
   if(condition){
    const callout=element('span','','regroup-condition');
    callout.append(element('span','Condition in original brief — assigning it does not confirm approval.','regroup-condition-copy'));
    if(!isTerm&&!owners.length&&!held.length){
     const choices=element('span','','regroup-condition-choices');
     const targetIds=condition.groupIds||(condition.groupId?[condition.groupId]:[]);
     if(targetIds.length){
      const titles=condition.titles||(condition.title?[condition.title]:[]);
      const readable=titles.join(' + ');
      const caption=targetIds.length===1?'Assign to '+readable:readable.length<=76?'Assign to '+readable:'Assign to '+targetIds.length+' named deliverables';
      const choose=element('button',caption,'secondary regroup-condition-assign');
      choose.type='button';choose.title=titles.join(' + ');
      choose.onclick=()=>{try{
       clearPending(clause);state=setGroupingUnitTargets(state,clause,targetIds);
       error.textContent='';renderRows(clause.id);notify();
      }catch(e){error.textContent=e.message;}};
      choices.append(choose);
     }
     const keep=element('button','Keep as project term','quiet regroup-condition-term');
     keep.type='button';
     keep.onclick=()=>{try{
      clearPending(clause);state=setGroupingUnitTargets(state,clause,[],{projectTerm:true});
      error.textContent='';renderRows(clause.id);notify();
     }catch(e){error.textContent=e.message;}};
     choices.append(keep);callout.append(choices);
    }
    original.append(callout);
   }
   if(held.length)original.append(element('span','In draft: '+held.join(', '),'regroup-retained'));
   if(!isTerm&&!owners.length&&!held.length&&!condition?.groupId&&!condition?.groupIds?.length){
    const start=element('button','Start deliverable from this requirement','quiet regroup-start');
    start.type='button';start.setAttribute('aria-label','Start deliverable using: '+clause.text);
    start.onclick=()=>{
     pendingStartClauseId=clause.id;
     openDeliverablesFor(clause.id);
    };
    original.append(start);
   }
   const select=document.createElement('select');select.setAttribute('aria-label','Deliverable for '+clause.text);
   for(const [value,label] of [['','Not assigned'],['__terms__','Project term — no price'],...(held.length?[['__draft__','Current draft · '+held.join(', ')]]:[]),...state.groups.map(g=>[g.id,g.title]),...(!isTerm&&onAddToDraft?draftTargets.map((target,index)=>['__existing__'+target.id,'Draft '+(index+1)+' · '+target.title]):[]),['__shared__','Multiple deliverables…']]){
    const option=element('option',label);option.value=value;select.append(option);
   }
   select.value=isTerm?'__terms__':owners.length>1?'__shared__':owners[0]?.id||(held.length?'__draft__':'');
   const pendingTarget=pendingExisting.get(clause.id);
   if(!isTerm&&pendingTarget&&clause.clauseIds.every(id=>pendingExisting.get(id)===pendingTarget)&&draftTargets.some(target=>target.id===pendingTarget))select.value='__existing__'+pendingTarget;
   else clearPending(clause);
   const addExisting=element('button','Add requirement to this draft','secondary regroup-add-existing');addExisting.type='button';addExisting.hidden=!select.value.startsWith('__existing__');
   addExisting.onclick=()=>{
    const target=draftTargets.find(target=>'__existing__'+target.id===select.value);
    if(!target)return;
    try{
     const title=onAddToDraft(clause.clauseIds,target.id);
     clearPending(clause);
     retainedAssignments=[...retainedAssignments,...clause.clauseIds.map(id=>({source:state.clauses.find(item=>item.id===id).text,title,rowId:target.id}))];
     error.textContent='';renderRows(clause.id);notify();
    }catch(e){error.textContent=e.message;}
   };
   targetLabel.append(select,addExisting);row.append(original,targetLabel);list.append(row);controls.set(clause.id,select);
   const sharing=element('details','','regroup-sharing');
   const summary=element('summary',owners.length>1?owners.length+' deliverables selected':'Choose deliverables');
   sharing.append(summary);sharing.open=opened.has(clause.id)||focusKey===clause.id&&focusTarget!==null;
   sharing.hidden=isTerm;
   const targets=element('div','','regroup-targets');
   const allLabel=element('label',''),all=document.createElement('input');
   all.type='checkbox';all.checked=state.groups.length>0&&owners.length===state.groups.length;
   all.indeterminate=owners.length>0&&owners.length<state.groups.length;all.disabled=!state.groups.length;
   all.setAttribute('aria-label','All deliverables — '+clause.text);
   allLabel.append(all,document.createTextNode('All deliverables'));targets.append(allLabel);
   targetControls.set(clause.id+':__all__',all);
   all.onchange=()=>{
    try{clearPending(clause);state=setGroupingUnitTargets(state,clause,all.checked?state.groups.map(g=>g.id):[]);error.textContent='';renderRows(clause.id,'__all__');notify();}
    catch(e){error.textContent=e.message;all.checked=owners.length===state.groups.length;all.indeterminate=owners.length>0&&owners.length<state.groups.length;}
   };
   for(const group of state.groups){
    const label=element('label',''),checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=group.id;checkbox.checked=owners.some(owner=>owner.id===group.id);
    checkbox.setAttribute('aria-label',group.title+' — '+clause.text);
    label.append(checkbox,document.createTextNode(group.title));targets.append(label);targetControls.set(clause.id+':'+group.id,checkbox);
    checkbox.onchange=()=>{
     const ids=state.groups.filter(g=>g.clauseIds.includes(clause.id)).map(g=>g.id);
     const selected=checkbox.checked?[...ids,group.id]:ids.filter(id=>id!==group.id);
     try{clearPending(clause);state=setGroupingUnitTargets(state,clause,selected);error.textContent='';renderRows(clause.id,group.id);notify();}
     catch(e){error.textContent=e.message;checkbox.checked=!checkbox.checked;}
    };
   }
   sharing.append(targets);targetLabel.after(sharing);
   select.onchange=()=>{
    addExisting.hidden=!select.value.startsWith('__existing__');
    if(!addExisting.hidden){for(const id of clause.clauseIds)pendingExisting.set(id,select.value.slice('__existing__'.length));notify();return;}
    clearPending(clause);
    if(select.value==='__shared__'){
     select.value=isTerm?'__terms__':owners.length>1?'__shared__':owners[0]?.id||(held.length?'__draft__':'');
     sharing.hidden=false;sharing.open=true;
     targets.querySelector('input')?.focus();notify();return;
    }
    try{state=setGroupingUnitTargets(state,clause,select.value&&!['__terms__','__draft__'].includes(select.value)?[select.value]:[],{projectTerm:select.value==='__terms__'});error.textContent='';renderRows(clause.id);notify();}
    catch(e){error.textContent=e.message;select.value=isTerm?'__terms__':owners.length>1?'__shared__':owners[0]?.id||(held.length?'__draft__':'');}
   };
  }
  (focusTarget!==null?targetControls.get(focusKey+':'+focusTarget):controls.get(focusKey))?.focus({preventScroll:true});
 }
 create.onclick=()=>{
  try{
   const created=addGroupingDeliverable(state,name.value);
   const target=pendingStartClauseId;
   state=target?setGroupingUnitTargets(created.state,unitFor(target),[created.id]):created.state;
   name.value='';error.textContent='';renderNames();renderRows(target);notify();
   if(target&&dialog.open){pendingStartClauseId=null;dialog.close();returnToRequirement();}
   else name.focus();
  }catch(e){error.textContent=e.message;name.focus();}
 };
 name.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();create.click();}};
 apply.onclick=()=>{try{for(const [id,input] of nameInputs){if(!input.checkValidity()){names.open=true;input.reportValidity();input.focus();return;}state=renameGroupingDeliverable(state,id,input.value);}const empty=state.groups.find(group=>!group.clauseIds.length);if(empty){error.textContent='Assign a requirement to “'+empty.title+'” or remove it.';notify();error.focus({preventScroll:true});error.scrollIntoView({block:'center'});return;}if(pendingExisting.size){error.textContent='Add the chosen requirements to their drafts, or clear those pending destinations before using this grouping.';notify();error.focus({preventScroll:true});error.scrollIntoView({block:'center'});return;}onApply(materializeProposalGrouping(state),state.excludedClauseIds);}catch(e){error.textContent=e.message;}};
 cancel.onclick=()=>onCancel();
 renderNames();renderRows();notify();heading.focus({preventScroll:true});
}
