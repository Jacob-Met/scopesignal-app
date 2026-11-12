const specifications=[
 ['Archivo.ttf',658596,'0e094a7d3c7c4c25cf1310c4b30014f1dae9332220b1c2c88f4fa996f0b05053'],
 ['Archivo-OFL.txt',4388,'108b4e57c9c796d3d38d0428ca7ee39de47ad93187302718d9b2d8864b9b716b'],
 ['archivo-source.txt', 267, '91ee34786dd89b787feec58054d1f43b2c2029357219c7eb1c0918f133cf203e']
];
export async function validateReportAssets(assets){
 if(!Array.isArray(assets)||assets.length!==specifications.length)throw Error('The report font and license are unavailable. Reload Studio and prepare the bundle again.');
 const checked=[];
 for(const [name,bytes,sha256] of specifications){
  const asset=assets.find(a=>a.name===name);
  if(!(asset?.data instanceof Uint8Array)||asset.data.length!==bytes)throw Error('The report font assets are incomplete.');
  const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',asset.data)),b=>b.toString(16).padStart(2,'0')).join('');
  if(actual!==sha256)throw Error('The report font assets do not match this Studio build.');
  checked.push({name,path:'assets/'+name,bytes,sha256,data:asset.data});
 }
 return checked;
}
export async function loadReportAssets(fetchImpl=fetch){
 const assets=await Promise.all(specifications.map(async([name])=>{
  const response=await fetchImpl(new URL('../media/'+name,import.meta.url));
  if(!response.ok)throw Error('The report font and license are unavailable. Reload Studio and prepare the bundle again.');
  return {name,data:new Uint8Array(await response.arrayBuffer())};
 }));
 return validateReportAssets(assets);
}
export function reportFontDataUrl(assets){
 const data=assets.find(a=>a.name==='Archivo.ttf').data;
 let binary='';for(let i=0;i<data.length;i+=8192)binary+=String.fromCharCode(...data.subarray(i,i+8192));
 return 'data:font/ttf;base64,'+btoa(binary);
}
