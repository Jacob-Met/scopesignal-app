import {splitScopeClauses} from './local-scope-ai.mjs';
import {createProposalGrouping,materializeProposalGrouping} from './proposal-grouping.mjs';
const validText=(value,max)=>typeof value==='string'&&[...value].length<=max;
const unique=values=>new Set(values).size===values.length;
function groupsValid(groups,maxIds,allowEmpty=false){
 return Array.isArray(groups)&&groups.length<=12&&groups.every(group=>group&&validText(group.title,80)&&group.title.trim()&&Array.isArray(group.clauseIds)&&(allowEmpty||group.clauseIds.length>0)&&group.clauseIds.length<=maxIds&&unique(group.clauseIds));
}

// Old clause IDs refer to source spans, not ordinal positions in a new parser.
// Expand each old span to its exact current parts before validating the draft;
// assignments, project terms and shared ownership keep the same source text.
function upgradeClauseIds(value,brief,editorOnly=false){
 if(value?.version!==1)return value;
 const previous=splitScopeClauses(brief,{legacyShortFragments:true}),current=splitScopeClauses(brief);
 const positions=clauses=>{let cursor=0;return clauses.map(clause=>{const start=brief.indexOf(clause.text,cursor);cursor=start+clause.text.length;return {...clause,start,end:cursor};});};
 const now=positions(current),mapping=new Map(positions(previous).map(old=>[old.id,now.filter(part=>part.start>=old.start&&part.end<=old.end).map(part=>part.id)]));
 const ids=values=>Array.isArray(values)?values.flatMap(id=>{if(!mapping.has(id))throw Error('Unknown saved source clause.');return mapping.get(id);}):values;
 const groups=values=>Array.isArray(values)?values.map(group=>({...group,clauseIds:ids(group?.clauseIds)})):values;
 const next=structuredClone(value);next.version=2;
 const editor=record=>{
  if(!record?.state)return record;
  return {...record,version:2,state:{...record.state,groups:groups(record.state.groups),excludedClauseIds:ids(record.state.excludedClauseIds)}};
 };
 if(editorOnly)return editor(next);
 next.proposals=groups(next.proposals);next.conditionIds=ids(next.conditionIds);
 if(next.editor)next.editor=editor(next.editor);
 return next;
}

export function restoreGroupingEditorDraft(value,brief){
 value=upgradeClauseIds(value,brief,true);
 if(value?.version!==2||!value.state)throw Error('The saved grouping could not be restored.');
 const saved=value.state,base=createProposalGrouping([],brief,saved.excludedClauseIds||[]),maxIds=base.clauses.length;
 if(!Array.isArray(saved.excludedClauseIds)||saved.excludedClauseIds.length>maxIds||!unique(saved.excludedClauseIds)||!groupsValid(saved.groups,maxIds,true)||!unique(saved.groups.map(g=>g.id))||saved.groups.some(g=>typeof g.id!=='string'||!/^g(?:0|[1-9]\d{0,2})$/.test(g.id))||!Number.isInteger(saved.nextId)||saved.nextId<0||saved.nextId>1000||saved.groups.some(g=>Number(g.id.slice(1))>=saved.nextId))throw Error('The saved grouping could not be restored.');
 createProposalGrouping(saved.groups.filter(g=>g.clauseIds.length),brief,saved.excludedClauseIds);
 if(!value.names||typeof value.names!=='object'||Array.isArray(value.names)||Object.keys(value.names).length!==saved.groups.length||saved.groups.some(g=>!Object.hasOwn(value.names,g.id)||!validText(value.names[g.id],80))||!validText(value.newName,80)||typeof value.namesOpen!=='boolean')throw Error('The saved grouping could not be restored.');
 const pending=value.pendingExisting;
 if(pending!==undefined&&(!pending||typeof pending!=='object'||Array.isArray(pending)||Object.keys(pending).length>maxIds||Object.entries(pending).some(([id,target])=>!base.clauses.some(clause=>clause.id===id)||typeof target!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(target))))throw Error('The saved grouping could not be restored.');
 return {version:2,state:{brief,clauses:base.clauses,groups:saved.groups.map(g=>({id:g.id,title:g.title.trim(),clauseIds:[...g.clauseIds]})),excludedClauseIds:[...saved.excludedClauseIds],nextId:saved.nextId},names:{...value.names},newName:value.newName,namesOpen:value.namesOpen,...(pending&&Object.keys(pending).length?{pendingExisting:{...pending}}:{})};
}
export function restoreProposalDraft(value,identity){
 try{
  value=upgradeClauseIds(value,identity.brief);
  if(value?.version!==2||value.draftId!==identity.draftId||value.brief!==identity.brief||value.projectLabel!==identity.label||!validText(value.brief,8000)||!value.brief.trim()||!validText(value.projectLabel,120))return null;
  const base=createProposalGrouping([],identity.brief),maxIds=base.clauses.length;
  if(!groupsValid(value.proposals,maxIds)||!Array.isArray(value.conditionIds)||value.conditionIds.length>maxIds||!unique(value.conditionIds)||!Array.isArray(value.addedIndices)||value.addedIndices.length>value.proposals.length||!unique(value.addedIndices)||value.addedIndices.some(i=>!Number.isInteger(i)||i<0||i>=value.proposals.length))return null;
  const rowBindings=value.adoptedRowIds;
  if(rowBindings!==undefined&&(!rowBindings||typeof rowBindings!=='object'||Array.isArray(rowBindings)||!unique(Object.values(rowBindings))||Object.entries(rowBindings).some(([index,id])=>!/^(0|[1-9]\d*)$/.test(index)||!value.addedIndices.includes(Number(index))||typeof id!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(id))))return null;
  const grouping=createProposalGrouping(value.proposals,identity.brief,value.conditionIds);
  const proposals=grouping.groups.length?materializeProposalGrouping(grouping):[];
  if(value.editor&&value.addedIndices.length)return null;
  const editor=value.editor?restoreGroupingEditorDraft(value.editor,identity.brief):null;
  return {proposals,context:{draftId:identity.draftId,brief:identity.brief,local:true,...(value.manual===true?{manual:true}:{}),...(value.humanReviewed===true?{humanReviewed:true}:{}),...(value.reviewRequired===true?{reviewRequired:true}:{}),conditionIds:[...value.conditionIds],addedIndices:[...value.addedIndices],...(rowBindings?{adoptedRowIds:{...rowBindings}}:{}),adopted:value.addedIndices.length>0},editor};
 }catch{return null;}
}
export function serializeProposalDraft(preview,identity){
 if(!preview?.context.local||preview.context.draftId!==identity.draftId||preview.context.brief!==identity.brief)return null;
 const editor=preview.editor;
 const value={version:2,...(preview.context.manual===true?{manual:true}:{}),...(preview.context.humanReviewed===true?{humanReviewed:true}:{}),...(preview.context.reviewRequired===true?{reviewRequired:true}:{}),draftId:identity.draftId,brief:identity.brief,projectLabel:identity.label,proposals:preview.proposals.map(p=>({title:p.title,clauseIds:p.clauseIds})),conditionIds:preview.context.conditionIds||[],addedIndices:preview.context.addedIndices||[],...(Object.keys(preview.context.adoptedRowIds||{}).length?{adoptedRowIds:{...preview.context.adoptedRowIds}}:{}),editor:editor?{version:2,state:{groups:editor.state.groups,excludedClauseIds:editor.state.excludedClauseIds,nextId:editor.state.nextId},names:editor.names,newName:editor.newName,namesOpen:editor.namesOpen,...(editor.pendingExisting?{pendingExisting:editor.pendingExisting}:{})}:null};
 if(!restoreProposalDraft(value,identity))throw Error('The grouping draft could not be saved.');
 return value;
}

// Retain only uniquely identifiable exact source text across a human edit.
// The changed brief always requires explicit assignment review before adoption.
export function reviseProposalBrief(preview,identity){
 try{
  if(!preview?.context.local||(preview.context.adopted&&!preview.context.addedIndices?.length)||
    preview.context.draftId!==identity.draftId||!identity.brief.trim()||identity.brief.length>8000)return null;
  const oldIdentity={...identity,brief:preview.context.brief};
  const old=restoreProposalDraft(serializeProposalDraft(preview,oldIdentity),oldIdentity);
  if(!old)return null;
  const adopted=new Set(old.context.addedIndices);
  if(adopted.size&&adopted.size>=old.proposals.length)return null;
  const previous=splitScopeClauses(oldIdentity.brief),current=splitScopeClauses(identity.brief);
  const occurrences=clauses=>{
   const values=new Map();
   for(const clause of clauses){const ids=values.get(clause.text)||[];ids.push(clause.id);values.set(clause.text,ids);}
   return values;
  };
  const before=occurrences(previous),after=occurrences(current);
  const mapping=new Map(previous.flatMap(clause=>before.get(clause.text).length===1&&after.get(clause.text)?.length===1
    ?[[clause.id,after.get(clause.text)[0]]]:[]));
  const ids=values=>values.flatMap(id=>mapping.has(id)?[mapping.get(id)]:[]).sort((a,b)=>Number(a.slice(1))-Number(b.slice(1)));
  const base=old.editor||{version:2,state:createProposalGrouping(old.proposals,oldIdentity.brief,old.context.conditionIds),
    names:Object.fromEntries(old.proposals.map((p,i)=>['g'+i,p.title])),newName:'',namesOpen:false};
  const pendingGroups=base.state.groups.filter((group,index)=>!adopted.has(index));
  const editor={...base,pendingExisting:undefined,names:Object.fromEntries(pendingGroups.map(group=>[group.id,base.names[group.id]])),state:{...base.state,clauses:current,
    groups:pendingGroups.map(group=>({...group,clauseIds:ids(group.clauseIds)})),
    excludedClauseIds:ids(base.state.excludedClauseIds)}};
  const conditionIds=ids(old.context.conditionIds);
  const retained=old.proposals.filter((group,index)=>!adopted.has(index)).map(group=>({...group,clauseIds:ids(group.clauseIds)})).filter(group=>group.clauseIds.length);
  const proposals=retained.length?materializeProposalGrouping(createProposalGrouping(retained,identity.brief,conditionIds)):[];
  const next={proposals,context:{...old.context,brief:identity.brief,manual:true,humanReviewed:false,reviewRequired:true,conditionIds,addedIndices:[],adoptedRowIds:{},adopted:false},editor};
  return restoreProposalDraft(serializeProposalDraft(next,identity),identity);
 }catch{return null;}
}
