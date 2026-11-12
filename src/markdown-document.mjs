const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// A document view of common prose blocks. Original bytes remain a separate source view.
function inline(value){
 const tokens=String(value).split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^\s)]+\))/g);
 return tokens.map(token=>{
  if(token.startsWith('`')&&token.endsWith('`'))return '<code>'+escape(token.slice(1,-1))+'</code>';
  if(token.startsWith('**')&&token.endsWith('**'))return '<strong>'+escape(token.slice(2,-2))+'</strong>';
  const link=/^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(token);
  if(link){try{const url=new URL(link[2]);if(['https:','http:'].includes(url.protocol))return '<a href="'+escape(url.href)+'" target="_blank" rel="noopener noreferrer">'+escape(link[1])+'</a>';}catch{}}
  return escape(token);
 }).join('');
}
export function renderMarkdownDocument(source){
 if(typeof source!=='string'||source.length>200000)return null;
 const lines=source.replace(/\r\n?/g,'\n').split('\n'),out=[];
 let paragraph=[],list=null,fence=null,code=[];
 const flush=()=>{if(paragraph.length){out.push('<p>'+inline(paragraph.join(' '))+'</p>');paragraph=[];}};
 const closeList=()=>{if(list){out.push('</'+list+'>');list=null;}};
 for(const line of lines){
  const marker=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if(fence){if(marker&&marker[1][0]===fence[0]&&marker[1].length>=fence.length&&!marker[2].trim()){out.push('<pre><code>'+escape(code.join('\n'))+'</code></pre>');fence=null;code=[];}else code.push(line);continue;}
  if(marker){flush();closeList();fence=marker[1];continue;}
  if(!line.trim()){flush();closeList();continue;}
  const heading=/^ {0,3}(#{1,6})\s+(.+?)\s*$/.exec(line);
  if(heading){flush();closeList();const level=Math.min(6,heading[1].length+1);out.push('<h'+level+'>'+inline(heading[2].replace(/\s+#+\s*$/,''))+'</h'+level+'>');continue;}
  const item=/^ {0,3}(?:([-+*])|(\d+)[.)])\s+(.+)$/.exec(line);
  if(item){flush();const type=item[1]?'ul':'ol';if(list!==type){closeList();out.push('<'+type+(type==='ol'?' start="'+Number(item[2])+'"':'')+'>');list=type;}out.push('<li>'+inline(item[3])+'</li>');continue;}
  if(/^ {0,3}(?:---+|\*\*\*+|___+)\s*$/.test(line)){flush();closeList();out.push('<hr>');continue;}
  const quote=/^ {0,3}>\s?(.*)$/.exec(line);
  if(quote){flush();closeList();out.push('<blockquote>'+inline(quote[1])+'</blockquote>');continue;}
  closeList();paragraph.push(line);
 }
 flush();closeList();if(fence)out.push('<pre><code>'+escape(code.join('\n'))+'</code></pre>');
 return '<article class="markdown-document">'+out.join('')+'</article>';
}
