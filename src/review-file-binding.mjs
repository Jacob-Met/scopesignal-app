const bindings=new WeakMap();
const referencePattern=/^File reviewed: (.*?) \((\d+) bytes; SHA-256 ([a-f0-9]{64})\)\.$/;
export function splitReviewFileDraft(value){
 const files=[],human=[];
 for(const line of String(value||'').split('\n')){
  const match=line.match(referencePattern);
  if(match)files.push({name:match[1],size:Number(match[2]),sha:match[3],reference:line});
  else human.push(line);
 }
 return {text:human.join('\n'),files};
}
export function joinReviewFileDraft(text,files){
 const references=files.map(file=>file.reference).join('\n');
 return references?(text?text+'\n':'')+references:text;
}
export function createReviewFileBinding(input){
 if(bindings.has(input))return bindings.get(input);
 const limit=input.maxLength>0?input.maxLength:5000;
 let files=[],displayed=null;
 const element=document.createElement('div');element.className='review-file-rows';element.setAttribute('role','list');element.setAttribute('aria-label','Files attached to this review');
 const anchor=input.closest('label')||input;anchor.after(element);
 function render(){
  element.replaceChildren();element.hidden=!files.length;
  input.maxLength=Math.max(0,limit-files.map(file=>file.reference).join('\n').length-(files.length?1:0));
  for(const file of files){
   const row=document.createElement('div');row.className='review-file-row actions';row.setAttribute('role','listitem');
   const name=document.createElement('span');name.textContent=file.name+' · '+file.size.toLocaleString()+' bytes';
   if(displayed?.sha===file.sha&&displayed?.size===file.size){row.setAttribute('aria-current','true');name.textContent+=' · Showing';}
   const remove=document.createElement('button');remove.type='button';remove.className='quiet';remove.textContent='Remove';remove.setAttribute('aria-label','Remove '+file.name+' from review');
   remove.onclick=()=>{files=files.filter(item=>item!==file);render();input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();};
   const details=document.createElement('details');details.className='evidence';
   const summary=document.createElement('summary');summary.textContent='File details';
   const hash=document.createElement('code');hash.textContent='SHA-256 '+file.sha;details.append(summary,hash);
   row.append(name,remove,details);element.append(row);
  }
  input.dispatchEvent(new Event('reviewfileschange'));
 }
 const binding={
  element,
  read:()=>joinReviewFileDraft(input.value,files),
  has:file=>Boolean(file)&&files.some(item=>item.sha===file.sha&&item.size===file.size),
  setDisplayed:file=>{
   if(displayed?.sha===file?.sha&&displayed?.size===file?.size)return;
   displayed=file?{sha:file.sha,size:file.size}:null;render();
  },
  write:value=>{const restored=splitReviewFileDraft(value);files=restored.files;input.value=restored.text;render();},
  attach:file=>{
   const name=String(file.name).replace(/[\r\n]/g,' ');
   const reference='File reviewed: '+name+' ('+file.size+' bytes; SHA-256 '+file.sha+').';
   if(binding.has(file))return;
   const next=[...files,{name,size:file.size,sha:file.sha,reference}];
   if(joinReviewFileDraft(input.value,next).length>limit)throw Error('Shorten your review before adding this file.');
   files=next;render();input.dispatchEvent(new Event('input',{bubbles:true}));
  }
 };
 bindings.set(input,binding);binding.write(input.value);return binding;
}
