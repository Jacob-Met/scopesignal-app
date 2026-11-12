export function recordedFiles(report){
 const map=new Map();
 for(const cp of report.checkpoints)for(const [evidence,decision] of [[cp.acceptedEvidence,'Accepted delivery'],...(cp.reviewHistory||[]).map((r,i)=>[r.evidence,'Revision request '+(i+1)+' · '+r.at])]){
  for(const match of (evidence||'').matchAll(/File reviewed: (.*?) \((\d+) bytes; SHA-256 ([a-f0-9]{64})\)\./g)){
   const [_,name,size,sha256]=match;
   if(!map.has(sha256))map.set(sha256,{name,bytes:Number(size),sha256,checkpoints:[],decisions:[]});
   const item=map.get(sha256);if(!item.checkpoints.includes(cp.id))item.checkpoints.push(cp.id);item.decisions.push({checkpointId:cp.id,title:cp.title,decision});
  }
 }
 return [...map.values()];
}
