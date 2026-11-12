// Inspect local image pixels together. This never changes findings or acceptance.
export function mountPairedImageView(pair) {
  const viewports = Array.from(pair.querySelectorAll('.artifact-image-viewport'));
  if (!viewports.length) return null;
  const controls = document.createElement('div');
  controls.className = 'paired-image-controls';
  controls.setAttribute('role','group');
  controls.setAttribute('aria-label',viewports.length===2?'Image comparison size':'Image size');
  const fit = document.createElement('button');
  fit.type='button'; fit.className='quiet'; fit.textContent='Fit';
  const original = document.createElement('button');
  original.title=viewports.length===2?'Original size · linked scrolling':'Original size'; original.type='button'; original.className='quiet'; original.textContent='100%';
  let originalSize = false;
  function setMode(value) {
    originalSize=value;
    fit.setAttribute('aria-pressed',String(!value));
    original.setAttribute('aria-pressed',String(value));
    for (const viewport of viewports) {
      viewport.classList.toggle('is-original',value);
      viewport.scrollTo(0,0);
      viewport.tabIndex=value?0:-1;
    }

  }
  for (const viewport of viewports) {
    const other=viewports.find(item=>item!==viewport);
    if(!other)continue;
    viewport.addEventListener('scroll',()=>{
      if(!originalSize)return;
      const x=viewport.scrollLeft/Math.max(1,viewport.scrollWidth-viewport.clientWidth);
      const y=viewport.scrollTop/Math.max(1,viewport.scrollHeight-viewport.clientHeight);
      const left=Math.round(x*Math.max(0,other.scrollWidth-other.clientWidth));
      const top=Math.round(y*Math.max(0,other.scrollHeight-other.clientHeight));
      if(Math.abs(other.scrollLeft-left)>1 || Math.abs(other.scrollTop-top)>1)other.scrollTo(left,top);
    });
  }
  fit.onclick=()=>setMode(false);original.onclick=()=>setMode(true);
  controls.append(fit,original);setMode(false);return controls;
}
