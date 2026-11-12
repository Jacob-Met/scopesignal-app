// Keep the existing recorded-file view and response form together while reading.
export function createFeedbackImageReader({article,view,viewer,size,comment,attribution,title,getEditor,prepareOpen,onOpen,onClose,readLabel='Read marked image full screen',dialogLabel='Marked client image'}){
 const make=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
 const read=make('button','Read full screen');read.type='button';read.hidden=true;
 read.setAttribute('aria-label',readLabel);view.insertBefore(read,viewer);
 const dialog=make('dialog');dialog.className='operator-image-reader';dialog.setAttribute('aria-label',dialogLabel);

 const header=make('header');header.className='image-reader-header';
 const heading=make('h3',title);heading.className='image-reader-title';
 const back=make('button','Return to comment');back.type='button';const identity=make('div');identity.className='image-reader-identity';identity.append(heading);header.append(identity,back);
 const body=make('div');body.className='image-reader-body';
 const canvas=make('div');canvas.className='image-reader-canvas';
 const tools=make('div');tools.className='image-reader-tools';
 const context=make('details');context.className='image-reader-context';context.open=true;
 context.append(make('summary','Client comment and response'));
 canvas.append(tools);body.append(canvas,context);dialog.append(header,body);article.append(dialog);
 const parentContext=article.querySelector(':scope>.reply-parent');let parentWasOpen=null;
 let moved=[],previousOverflow='',previousFocus=null,savedView=null,reopeningView=null,contextView=null,savedScroll=null;
 const move=(node,parent)=>{if(!node)return;const mark=document.createTextNode('');node.before(mark);moved.push([node,mark]);parent.append(node);};
 let drag=null;
 const stopPan=()=>{if(!drag)return;const {image,id}=drag;drag=null;viewer.classList.remove('panning');if(image.hasPointerCapture(id))image.releasePointerCapture(id);};
 const centerMarker=()=>{if(!dialog.open)return;const marker=viewer.querySelector('.feedback-image-point');if(marker){const a=marker.getBoundingClientRect(),b=viewer.getBoundingClientRect();viewer.scrollBy({left:a.left+a.width/2-b.left-b.width/2,top:a.top+a.height/2-b.top-b.height/2});}};
 const imageCenter=()=>{const a=viewer.querySelector('img')?.getBoundingClientRect(),v=viewer.getBoundingClientRect();return a?.width&&a.height?{x:Math.max(0,Math.min(1,(v.left+viewer.clientWidth/2-a.left)/a.width)),y:Math.max(0,Math.min(1,(v.top+viewer.clientHeight/2-a.top)/a.height))}:null;};
 const restoreCenter=point=>{const a=viewer.querySelector('img')?.getBoundingClientRect(),v=viewer.getBoundingClientRect();if(a)viewer.scrollBy({left:a.left+point.x*a.width-v.left-viewer.clientWidth/2,top:a.top+point.y*a.height-v.top-viewer.clientHeight/2});};
 // A phone response-panel toggle resizes the image viewport; retain the area
 // being inspected instead of returning to the original comment marker.
 context.querySelector('summary').addEventListener('click',()=>{
  if(!dialog.open)return;
  const point=imageCenter();contextView=point;
  requestAnimationFrame(()=>requestAnimationFrame(()=>{if(contextView===point)contextView=null;}));
 });
 const resized=new ResizeObserver(()=>{
  if(!dialog.open)return;
  const point=reopeningView||contextView;reopeningView=null;contextView=null;
  requestAnimationFrame(()=>{if(!dialog.open)return;if(point)restoreCenter(point);else centerMarker();});
 });
 const forgetView=()=>{savedView=null;reopeningView=null;contextView=null;};
 size.addEventListener('change',forgetView);size.addEventListener('click',forgetView);
 viewer.addEventListener('wheel',()=>{if(!dialog.open)forgetView();},{passive:true});
 viewer.addEventListener('pointerdown',event=>{if(!dialog.open)forgetView();const image=event.target;if(image.tagName!=='IMG'||event.pointerType!=='mouse'||event.button!==0||!dialog.open||(viewer.scrollWidth<=viewer.clientWidth&&viewer.scrollHeight<=viewer.clientHeight))return;drag={image,id:event.pointerId,x:event.clientX,y:event.clientY,left:viewer.scrollLeft,top:viewer.scrollTop};image.setPointerCapture(event.pointerId);viewer.classList.add('panning');event.preventDefault();});
 viewer.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;viewer.scrollTo(drag.left+drag.x-event.clientX,drag.top+drag.y-event.clientY);event.preventDefault();});
 for(const name of ['pointerup','pointercancel','lostpointercapture'])viewer.addEventListener(name,stopPan);
 const restore=()=>{
  if(!moved.length)return;
  resized.disconnect();reopeningView=null;contextView=null;stopPan();
  if(parentContext?.tagName==='DETAILS'&&parentWasOpen!==null)parentContext.open=parentWasOpen;
  parentWasOpen=null;
  for(const[node,mark]of moved){mark.replaceWith(node);}moved=[];
  document.body.style.overflow=previousOverflow;onClose?.(close);
  if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
 };
 const close=()=>{if(dialog.open){savedView=imageCenter();savedScroll={left:viewer.scrollLeft,top:viewer.scrollTop};dialog.close();}restore();};
 dialog.addEventListener('close',restore);
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 back.onclick=close;
 parentContext?.addEventListener('click',event=>{if(dialog.open&&event.target.closest('[data-original-comment]'))close();},true);
 read.onclick=()=>{
  if(dialog.open)return;
  previousFocus=document.activeElement;previousOverflow=document.body.style.overflow;
  move(size,tools);move(viewer,canvas);move(attribution,identity);
  if(parentContext){parentWasOpen=parentContext.open;move(parentContext,context);if(parentContext.tagName==='DETAILS')parentContext.open=true;}
  move(comment,context);
  for(const reply of article.querySelectorAll('.operator-response'))move(reply,context);
  const editor=getEditor();move(editor,context);context.querySelector('summary').textContent=editor?'Client comment and response':'Client comment';
  for(const image of viewer.querySelectorAll('img'))image.draggable=false;
  prepareOpen?.();
  document.body.style.overflow='hidden';context.open=true;dialog.showModal();onOpen?.(close);back.focus();
  reopeningView=savedView;resized.observe(viewer);
  if(!viewer.querySelector('img')&&savedScroll)requestAnimationFrame(()=>viewer.scrollTo(savedScroll));
 };
 return {setReady:ready=>{read.hidden=!ready;if(!ready){close();forgetView();}},close};
}
