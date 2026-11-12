import {guideWorkspace,guideFiles} from './retained-guide-data.mjs';
import {mountArtifactInspection} from './artifact-inspection.mjs';
import {createLocalDeliveryStorage} from './local-delivery-storage.mjs';
import {recordedFiles} from './delivery-bundle.mjs';

export function mountRetainedGuideEntry(root){
 const project=guideWorkspace.projects[0],cp=project.checkpoints[0];
 const entryQuery=new URLSearchParams(location.search);
 const entryRequested=entryQuery.get('example')==='guide'||!entryQuery.has('project');
 const make=(tag,value,cls='')=>{const e=document.createElement(tag);e.textContent=value;e.className=cls;return e;};
 const files=guideFiles.map(f=>({role:f.role,file:new File([Uint8Array.from(atob(f.base64),c=>c.charCodeAt(0))],f.name,{type:'text/markdown'})}));
 const heading=make('div','','entry-heading'),title=make('h2','Saved review example');
 const actions=make('div','','actions'),open=make('button','Open saved review','secondary'),fresh=make('a','Start a new project','secondary entry-new entry-start');
 open.type='button';fresh.href='./live.html?project=new';actions.append(fresh,open);heading.append(title,actions);
 const grid=make('div','','entry-review'),work=make('div','','entry-work'),decision=make('aside','','entry-decision');
 decision.append(make('h3','Accepted guide'),make('p',cp.acceptedEvidence.split('File reviewed:')[0]));
 const previous=make('details','','entry-previous');previous.open=true;previous.append(make('summary','Requested changes'),make('p',cp.reviewHistory.at(-1).changes));decision.append(previous);
 const status=make('p','','entry-status');status.setAttribute('role','status');
 grid.append(work,decision);root.append(heading,grid,status);
 const exampleLine=make('p','','entry-example-link'),example=make('a','Explore a saved review','entry-new');example.href='./live.html?example=guide';exampleLine.append(example);root.before(exampleLine);
 let prepared=false,busy=false;
 const compose=()=>{location.href='./live.html?project=new';};
 const currentFiles=()=>Object.fromEntries(files.map(f=>[f.role,f.file]));
 const prepare=()=>{
  if(prepared)return;prepared=true;
  const panel=mountArtifactInspection(work,null,cp);
  panel.open=true;
  const input=panel.querySelector('input[aria-label="Delivered file to inspect"]'),transfer=new DataTransfer();
  transfer.items.add(currentFiles().delivered);input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  const earlier=panel.querySelector('input[aria-label="Earlier delivered file to compare"]'),prior=new DataTransfer();
  prior.items.add(currentFiles().earlier);earlier.files=prior.files;earlier.dispatchEvent(new Event('change',{bubbles:true}));
  panel.querySelector('button[aria-expanded="false"]').click();

 };
 async function state(){
  const r=await fetch('/api/state?project=new',{cache:'no-store'});
  if(!r.ok)throw Error('Could not read the workspace. Try again.');
  return r.json();
 }
 open.onclick=async()=>{
  if(busy)return;busy=true;open.disabled=true;status.textContent='Opening saved review…';
  try{
   let session=await state();
   const existing=session.state.projects.find(p=>p.id===project.id);
   if(!existing){
    if(session.state.projects.length)throw Error('This workspace now contains a project. Open it from Projects.');
    const r=await fetch('/api/workspace-restore',{method:'POST',headers:{'content-type':'application/json','x-scopesignal-token':session.token},body:JSON.stringify({workspace:guideWorkspace})});
    const result=await r.json();
    if(!r.ok)throw Error(result.error||'The saved review could not be opened.');
    if(result.projectId!==project.id)throw Error('The restored project identity did not match.');
   }
   const r=await fetch('/api/state?project='+encodeURIComponent(project.id),{cache:'no-store'});
   if(!r.ok)throw Error('Could not reopen the saved review.');
   const {state:restored}=await r.json(),checkpoint=restored.checkpoints.find(v=>v.id===cp.id);
   if(!checkpoint||JSON.stringify(restored.project)!==JSON.stringify(project.project)||checkpoint.acceptedEvidence!==cp.acceptedEvidence||checkpoint.approvedAt!==cp.approvedAt)
    throw Error('The saved review has changed. Open the project from Projects.');
   await createLocalDeliveryStorage().remember({workspaceId:location.origin,projectId:project.id,checkpointId:cp.id,
    termsKey:JSON.stringify([cp.title,cp.amount,cp.proposedEvidence]),revisionKey:JSON.stringify([cp.reviewHistory.length,cp.acceptedEvidence||'',cp.approvedAt||'']),
    recorded:recordedFiles({checkpoints:[cp]})},currentFiles());
   location.href='./live.html?project='+encodeURIComponent(project.id);
  }catch(error){status.textContent=error.message+' Existing workspace records were preserved.';}
  finally{busy=false;open.disabled=false;}
 };
 return {
  get visible(){return !root.hidden;},compose,
  update(value){
   const hasDraft=['project','brief','cap'].some(id=>document.getElementById(id)?.value.trim())||[...document.querySelectorAll('#rows input,#rows textarea')].some(input=>input.value.trim());
   const visible=!value.project&&!value.projects.length&&entryRequested&&!hasDraft;
   exampleLine.hidden=Boolean(value.project)||Boolean(value.projects.length)||hasDraft||visible;
   root.hidden=!visible;document.body.dataset.entry=visible?'guide':'';
   document.querySelector('.cols').hidden=visible;
   if(visible){
    const url=new URL(location.href);
    if(url.searchParams.get('project')==='new'){url.searchParams.delete('project');history.replaceState(history.state,'',url);}
    document.getElementById('workspace-title').textContent='Review your project';prepare();
   }
  }
 };
}
