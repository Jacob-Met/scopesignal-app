// Exact local text comparison. It never decides whether a deliverable is acceptable.
export const MAX_COMPARISON_BYTES = 200000;
const MAX_LINES = 5000;
const MAX_CELLS = 2000000;

export function textLines(value) {
  return value.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) || [];
}

export function compareText(before, after) {
  const a = textLines(before), b = textLines(after);
  if (a.length > MAX_LINES || b.length > MAX_LINES)
    return {limited:true, reason:'This file has too many lines for inline comparison.'};
  let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (suffix < a.length-prefix && suffix < b.length-prefix &&
    a[a.length-1-suffix] === b[b.length-1-suffix]) suffix++;
  const left = a.slice(prefix,a.length-suffix), right = b.slice(prefix,b.length-suffix);
  if ((left.length+1)*(right.length+1) > MAX_CELLS)
    return {limited:true, reason:'These files differ too widely for inline comparison.'};
  const width = right.length+1;
  const table = new Uint16Array((left.length+1)*width);
  for (let i=left.length-1;i>=0;i--) for (let j=right.length-1;j>=0;j--)
    table[i*width+j] = left[i] === right[j] ? 1+table[(i+1)*width+j+1] :
      Math.max(table[(i+1)*width+j],table[i*width+j+1]);
  const rows=[];let oldLine=1,newLine=1;
  const push=(kind,value)=>{
    rows.push({kind,text:value,oldLine:kind==='added'?null:oldLine,newLine:kind==='removed'?null:newLine});
    if(kind!=='added')oldLine++;if(kind!=='removed')newLine++;
  };
  a.slice(0,prefix).forEach(line=>push('same',line));
  let i=0,j=0;
  while(i<left.length||j<right.length){
    if(i<left.length&&j<right.length&&left[i]===right[j]){push('same',left[i]);i++;j++;}
    else if(i<left.length&&(j===right.length||table[(i+1)*width+j]>=table[i*width+j+1]))push('removed',left[i++]);
    else push('added',right[j++]);
  }
  a.slice(a.length-suffix).forEach(line=>push('same',line));
  return {limited:false,rows,removed:rows.filter(r=>r.kind==='removed').length,
    added:rows.filter(r=>r.kind==='added').length,identical:before===after};
}

export function comparisonContext(rows, context=3) {
  const shown=new Set();
  rows.forEach((row,i)=>{if(row.kind!=='same')for(let j=Math.max(0,i-context);j<=Math.min(rows.length-1,i+context);j++)shown.add(j);});
  const result=[];let skipped=0;
  rows.forEach((row,i)=>{
    if(shown.has(i)){if(skipped){result.push({kind:'gap',count:skipped});skipped=0;}result.push(row);}
    else skipped++;
  });
  if(skipped)result.push({kind:'gap',count:skipped});
  return result;
}

export function rasterImageType(bytes) {
 const starts=values=>bytes.length>=values.length&&values.every((value,index)=>bytes[index]===value);
 if(starts([137,80,78,71,13,10,26,10]))return 'image/png';
 if(starts([255,216,255]))return 'image/jpeg';
 const ascii=(offset,length)=>String.fromCharCode(...bytes.subarray(offset,offset+length));
 if(bytes.length>=6&&['GIF87a','GIF89a'].includes(ascii(0,6)))return 'image/gif';
 if(bytes.length>=12&&ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP')return 'image/webp';
 return null;
}

export async function readInspectionFile(file) {
  if(file.size>10*1024*1024)throw Error('Choose a file up to 10 MB. Inspect larger deliveries in their normal application.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const sha=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  const image=Boolean(rasterImageType(bytes));
  const pdf=(file.type==='application/pdf'||/\.pdf$/i.test(file.name))&&String.fromCharCode(...bytes.slice(0,5))==='%PDF-';
  const isText=!image&&!pdf&&(file.type.startsWith('text/')||/\.(txt|md|csv|json|log|vtt|srt|js|mjs|ts|css|html|xml)$/i.test(file.name));
  const result={file,name:file.name,size:bytes.length,sha,kind:image?'image':pdf?'pdf':isText?'text':'other',text:null,truncated:false};
  if(isText){
    result.truncated=bytes.length>MAX_COMPARISON_BYTES;
    try{
      result.text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(
        result.truncated?bytes.slice(0,MAX_COMPARISON_BYTES):bytes,
        {stream:result.truncated});
    }catch{result.kind='other';result.decodeProblem=true;}
  }
  return result;
}
