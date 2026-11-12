import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {buildLiveReview,renderLiveReviewHtml} from './live-review-export.mjs';
import {renderRecipientFeedbackHtml,recipientVersions,appendRecipientFeedback} from './recipient-feedback.mjs';
import {recordedFiles} from './review-file-references.mjs';
import {rasterImageType} from './artifact-comparison.mjs';

export function clientReviewMode(baseUrl){
 try{
  const url=new URL(baseUrl),host=url.hostname.toLowerCase();
  return ['http:','https:'].includes(url.protocol)&&host!=='localhost'&&!host.endsWith('.localhost')&&host!=='[::1]'&&!/^127\./.test(host)?'shared':'local';
 }catch{return 'local';}
}

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const failure=(status,message)=>Object.assign(new Error(message),{status});
const must=(ok,status,message)=>{if(!ok)throw failure(status,message);};
const sha=/^[a-f0-9]{64}$/;
const uuid=/^[a-zA-Z0-9-]{16,100}$/;
const MAX_FILES=30,MAX_TOTAL=20*1024*1024;
function cookieName(id){return 'ss_share_'+id.replaceAll('-','');}
function cookies(header){return Object.fromEntries(String(header||'').split(';').map(s=>s.trim().split('=').slice(0,2)).filter(x=>x.length===2));}
function validToken(token,expectedHash){
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||!sha.test(expectedHash))return false;
 return timingSafeEqual(Buffer.from(hash(token),'hex'),Buffer.from(expectedHash,'hex'));
}
async function readJSON(req,limit=256*1024){
 let bytes=0,chunks=[];for await(const c of req){bytes+=c.length;must(bytes<=limit,413,'Request is too large.');chunks.push(c);}
 let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw failure(400,'Invalid request.');}
 must(input&&typeof input==='object'&&!Array.isArray(input),400,'Expected an object.');return input;
}
function asJSON(res,status,value){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));}
function asHTML(res,html){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});res.end(html);}
function checkedFileMetadata(ref,raw,bytes){
 const name=ref.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120);
 const path='files/'+ref.sha256+'/'+name;
 const image=/\.(png|jpe?g|webp|gif)$/i.test(ref.name)?rasterImageType(bytes):null;
 const isPdf=/\.pdf$/i.test(ref.name)&&bytes.subarray(0,5).toString('ascii')==='%PDF-';
 const kind=image?'image':isPdf?'pdf':null;
 const text=raw.previewKind==='text'&&typeof raw.previewText==='string'&&raw.previewText.length<=200000?raw.previewText:null;
 const verifiedText=text!==null&&bytes.length<=200000&&Buffer.from(text,'utf8').equals(bytes);
 return {...ref,included:true,path,previewKind:kind??(verifiedText?'text':null),
 ...(image?{previewMime:image}:{}),...(verifiedText?{previewText:text}:{})};
}
export function createClientSharePortal({storePath,ready,getWorkspace,commit,baseUrl}){
 const fileDir=join(dirname(storePath),'client-files');
 const clientServer=createServer(async(req,res)=>{
  try{
   await ready;
   const url=new URL(req.url,'http://localhost');
   const match=/^\/share\/([a-zA-Z0-9-]{16,100})\/(review\.html|feedback\.html|submit|files\/[a-f0-9]{64}\/[a-zA-Z0-9._-]+)$/.exec(url.pathname);
   must(match,404,'Not found.');
   const [_,shareId,resource]=match;
   const project=getWorkspace().projects.find(p=>(p.clientShares??[]).some(s=>s.id===shareId));
   const share=project?.clientShares?.find(s=>s.id===shareId);
   must(share&&!share.revokedAt&&Date.parse(share.expiresAt)>Date.now(),404,'This review link is unavailable or expired.');
   const candidate=url.searchParams.get('key');
   if(req.method==='GET'&&candidate){
    must(validToken(candidate,share.secretHash),403,'Review link is invalid.');
    const secure=new URL(baseUrl()).protocol==='https:'?'; Secure':'';
    res.writeHead(303,{'location':url.pathname,'cache-control':'no-store','referrer-policy':'no-referrer',
      'set-cookie':cookieName(shareId)+'='+candidate+'; Path=/share/'+shareId+'/; HttpOnly; SameSite=Strict; Max-Age=2592000'+secure});
    res.end();return;
   }
   must(validToken(cookies(req.headers.cookie)[cookieName(shareId)],share.secretHash),403,'Open the complete client invitation link to access this review.');
   const report={...share.report,recipientFeedback:(project.recipientFeedback??[]).filter(c=>share.versionKeys.includes(c.versionKey)),clientDecisions:(project.clientDecisions??[]).filter(d=>d.shareId===shareId)};
   if(req.method==='GET'&&resource==='review.html')return asHTML(res,renderLiveReviewHtml(report,share.files,null,'feedback.html'));
   if(req.method==='GET'&&resource==='feedback.html')return asHTML(res,renderRecipientFeedbackHtml(report,share.files,{liveSubmitUrl:'submit',decisions:(project.clientDecisions??[]).filter(d=>d.shareId===shareId)})??'<p>No reviewed delivery versions.</p>');
   if(req.method==='GET'&&resource.startsWith('files/')){
    const file=share.files.find(f=>f.path===resource);
    must(file,404,'File not in this invitation.');
    const bytes=await readFile(join(fileDir,file.sha256));
    must(bytes.length===file.bytes&&hash(bytes)===file.sha256,409,'Delivered file no longer matches the reviewed version.');
    const mime=file.previewKind==='pdf'?'application/pdf':file.previewKind==='image'?(file.previewMime||'application/octet-stream'):'application/octet-stream';
    res.writeHead(200,{'content-type':mime,'content-disposition':'inline; filename="'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_')+'"','x-content-type-options':'nosniff','cache-control':'private, no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; sandbox"});
    res.end(bytes);return;
   }
   if(req.method==='POST'&&resource==='submit'){
    must(req.headers.origin===new URL(baseUrl()).origin,403,'Feedback must come from this client review.');
    const input=await readJSON(req);
    const output=await commit(async(workspace,save,record)=>{
     const project=workspace.projects.find(p=>p.id===share.report.project.id);
     const current=project?.clientShares?.find(s=>s.id===shareId);
     must(current&&!current.revokedAt&&Date.parse(current.expiresAt)>Date.now(),409,'The shared review has expired.');
     must(!project.archivedAt,409,'This project is archived and cannot accept new feedback.');
     const versions=new Map(recipientVersions(current.report).map(v=>[v.key,v]));
     must(Array.isArray(input.comments)&&input.comments.length<=20,400,'Send up to 20 comments at a time.');
     let next=project.recipientFeedback??[];
     if(input.comments.length){
      must(input.comments.every(c=>versions.has(c.versionKey)),409,'This version was not shared in the invitation.');
      try{next=appendRecipientFeedback(project,{schema:'scopesignal.recipient-feedback',version:input.comments.some(c=>c.replyTo)?3:input.comments.some(c=>c.imagePoint)?2:1,projectId:project.id,comments:input.comments});}
      catch(error){throw failure(400,error.message);}
     }
     const decision=input.decision;let newDecision=null;
     if(decision){
      const v=versions.get(decision.versionKey);
      must(v&&v.current&&current.files.some(f=>f.sha256===v.sha256&&f.bytes===v.bytes),409,'Only a complete current shared file version can be accepted.');
      must(uuid.test(decision.id||'')&&typeof decision.author==='string'&&decision.author.trim().length>0&&decision.author.length<=120,400,'Name and decision identity required.');
      must(decision.action==='accept'&&typeof decision.note==='string'&&decision.note.length<=2000,400,'Unsupported client decision.');
      const prior=(project.clientDecisions??[]).find(d=>d.shareId===shareId&&d.versionKey===v.key);
      if(prior)must(prior.id===decision.id&&prior.author===decision.author.trim()&&prior.note===decision.note,409,'A decision was already submitted for this exact shared file.');
      else newDecision={id:decision.id,shareId,versionKey:v.key,file:{name:v.name,sha256:v.sha256,bytes:v.bytes,checkpointId:v.checkpointId,title:v.title},author:decision.author.trim(),note:decision.note,action:'accept',at:new Date().toISOString()};
     }
     const commentCount=next.length-(project.recipientFeedback??[]).length;
     if(commentCount||newDecision){
      project.recipientFeedback=next;
      if(newDecision)project.clientDecisions=[...(project.clientDecisions??[]),newDecision];
      record(project,commentCount?'client.feedback_saved':'client.version_accepted',null,{shareId});
      await save();
     }
     return {savedComments:commentCount,accepted:Boolean(newDecision||(decision&&(project.clientDecisions??[]).some(d=>d.id===decision.id)))};
    });
    return asJSON(res,200,output);
   }
   throw failure(405,'Method not permitted.');
  }catch(error){asJSON(res,error.status??500,{error:error.status?error.message:'The shared review could not be processed.'});}
 });
 return {
  clientServer,
  async create(state,input){
   const report=buildLiveReview({...state,projectId:state.id});
   const refs=recordedFiles(report);
   must(refs.length>0&&refs.length<=MAX_FILES,400,'Record and review up to 30 delivery files before sharing.');
   must((state.clientShares??[]).length<30,409,'This project has 30 review invitations. Revoke or let an existing link expire before creating another.');
   must(Array.isArray(input.files)&&input.files.length===refs.length&&Array.isArray(input.manifest)&&input.manifest.length===refs.length,400,'Include every reviewed file in this shared delivery.');
   const entries=new Map(),metadata=new Map();
   let total=0;
   for(const f of input.files){
    must(f&&sha.test(f.sha256)&&typeof f.data==='string'&&f.data.length<MAX_TOTAL*1.4,400,'Invalid shared file.');
    const bytes=Buffer.from(f.data,'base64');
    must(bytes.toString('base64')===f.data&&hash(bytes)===f.sha256&&bytes.length>0,400,'File contents do not match the recorded fingerprint.');
    must(!entries.has(f.sha256),400,'Repeated delivered file.');
    total+=bytes.length;must(total<=MAX_TOTAL,413,'A shared review can include up to 20 MiB of files.');
    entries.set(f.sha256,bytes);
   }
   for(const f of input.manifest){
    must(f&&sha.test(f.sha256)&&!metadata.has(f.sha256),400,'Repeated manifest file.');
    metadata.set(f.sha256,f);
   }
   const files=refs.map(ref=>{
    const bytes=entries.get(ref.sha256),raw=metadata.get(ref.sha256);
    must(bytes&&bytes.length===ref.bytes&&raw&&raw.bytes===ref.bytes&&raw.name===ref.name,400,'Every delivered file must match its recorded version.');
    return checkedFileMetadata(ref,raw,bytes);
   });
   must(entries.size===refs.length&&metadata.size===refs.length,400,'Unreviewed files cannot be shared.');
   await mkdir(fileDir,{recursive:true,mode:0o700});
   for(const ref of refs){
    const path=join(fileDir,ref.sha256);
    try{await writeFile(path,entries.get(ref.sha256),{mode:0o600,flag:'wx'});}
    catch(error){
     if(error.code!=='EEXIST')throw error;
     const bytes=await readFile(path);
     must(bytes.length===ref.bytes&&hash(bytes)===ref.sha256,409,'An earlier stored file does not match this version.');
    }
   }
   const secret=randomBytes(32).toString('hex'),id=randomUUID();
   const share={id,secretHash:hash(secret),createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+30*86400*1000).toISOString(),
    report,files,versionKeys:recipientVersions(report).map(v=>v.key)};
   state.clientShares=[...(state.clientShares??[]),share];
   const link=baseUrl().replace(/\/$/,'')+'/share/'+id+'/review.html?key='+secret;
   return {shareUrl:link,expiresAt:share.expiresAt,state};
  }
 };
}
