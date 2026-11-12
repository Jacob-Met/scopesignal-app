import {splitScopeClauses} from './local-scope-ai.mjs';
import {MAX_PLANNED_EVIDENCE_LENGTH} from './scope-plan.mjs';

function title(value){
 if(typeof value!=='string'||!value.trim()||[...value.trim()].length>80)throw Error('Name the deliverable in 1–80 characters.');
 return value.trim();
}
function evidence(state,ids){
 const byId=new Map(state.clauses.map(c=>[c.id,c.text]));
 const selected=new Set(ids);
 const units=state.brief?quotedGroupingUnits(state,state.brief):[];
 const joined=new Map(units.filter(unit=>unit.clauseIds.length>1&&unit.clauseIds.every(id=>selected.has(id))).flatMap(unit=>unit.clauseIds.map(id=>[id,unit])));
 const emitted=new Set(),lines=ids.flatMap(id=>{
  const unit=joined.get(id);if(!unit)return [byId.get(id)];
  if(emitted.has(unit))return [];emitted.add(unit);return [unit.text];
 });
 const value='Verify these source requirements:\n'+lines.map(text=>'- '+text).join('\n');
 if(value.length>MAX_PLANNED_EVIDENCE_LENGTH)throw Error('That deliverable contains too much text. Keep some requirements in another deliverable.');
 return value;
}
export function createProposalGrouping(proposals,brief,excludedClauseIds=[]){
 const clauses=splitScopeClauses(brief),known=new Set(clauses.map(c=>c.id)),excluded=new Set(excludedClauseIds);
 if([...excluded].some(id=>!known.has(id)))throw Error('Unknown project term.');
 if(!Array.isArray(proposals)||proposals.length>12)throw Error('Unsupported deliverables.');
 const state={brief,clauses,excludedClauseIds:[...excluded],nextId:proposals.length,groups:proposals.map((p,i)=>{
  if(!Array.isArray(p.clauseIds)||!p.clauseIds.length||new Set(p.clauseIds).size!==p.clauseIds.length||p.clauseIds.some(id=>!known.has(id)||excluded.has(id)))throw Error('Only original work requirements can be regrouped.');
  return {id:'g'+i,title:title(p.title),clauseIds:[...p.clauseIds]};
 })};
 state.groups.forEach(g=>evidence(state,g.clauseIds));return state;
}
export function renameGroupingDeliverable(state,id,name){
 if(!state.groups.some(g=>g.id===id))throw Error('Choose a current deliverable.');
 const next=structuredClone(state);next.groups.find(g=>g.id===id).title=title(name);return next;
}
// Only seed a new correction sheet; saved human edits remain authoritative.

// A literal request for a named artifact can open the editor without a model.
// Do not infer output identity from general project work, commercial terms,
// incidental mentions of formats, or two separate artifacts in one clause.
const OUTPUT_ARTIFACT=/\b(?:animation|app|application|article|banner|booklet|brochure|card|checklist|codebase|csv|deck|diagram|document|email|film|flyer|form|game|guide|handout|illustration|image|infographic|interface|leaflet|letter|logo|map|mockup|newsletter|pdf|photo|photograph|plan|poster|presentation|proposal|render|report|schedule|screenshots?|captions?|programmes?|script|sheet|slides?|slideshow|spreadsheet|storyboard|template|timetable|transcript|video|website|webpage|wireframe|worksheet)\b/i;
const TECHNICAL_OUTPUT_NOUN=/\b(?:plot|sheet|list|rundown|register|manifest|palette|armature|jig|loom|breakdown|blueprint|ledger|schedule|specification|dossier|bill|matrix|treatment|score|storyboard|schematic|mockup|wireframe|model)\b$/i;
// Literal Spanish production requests use the same source-linked editor as English.
const SPANISH_OUTPUT_ARTIFACT=/(?:^|[^\p{L}])(?:cartel|afiche|p[oó]ster|plantilla|correo(?:\s+electr[oó]nico)?|mapa|gu[ií]a|folleto|informe|presentaci[oó]n|p[aá]gina\s+web|sitio\s+web|v[ií]deo|guion|ilustraci[oó]n|imagen|logo|hoja\s+de\s+c[aá]lculo|documento|formulario|infograf[ií]a|pdf|csv)(?=$|[^\p{L}])/iu;
function spanishExplicitOutputAction(text){
 const match=text.match(/^(Entregar|Crear|Producir|Diseñar|Redactar|Elaborar|Preparar)\s+(un|una|el|la)\s+(.+)/iu);
 if(!match||/\b(?:si|salvo|excepto|cuando|siempre que)\b/iu.test(text)||
    /\s+(?:y|o)\s+(?:un|una|el|la)\s+/iu.test(text))return null;
 if(/^Preparar$/iu.test(match[1])&&/\bpara\s+(?:revisi[oó]n|aprobaci[oó]n)\b/iu.test(match[3]))return null;
 const object=match[3].split(/\b(?:para|con|que|incluyendo|basad[oa]s?\s+en)\b/iu,1)[0].replace(/[.!?;]+$/,'').trim();
 return SPANISH_OUTPUT_ARTIFACT.test(object)?match[1]:null;
}
function explicitOutputAction(text){
 // A contingent export is not confirmed scope before its condition occurs.
 if(/^(?:Deliver|Export|Provide|Supply)\b/i.test(text)&&
    /\b(?:if|unless|only if|subject to|after approval|upon approval)\b/i.test(text))return null;
 // An either/or export is not a decided client deliverable. It needs author
 // selection rather than being priced as if both formats had been ordered.
 if(/^Deliver\b/i.test(text)&&/\b(?:PDF\s+or\s+DOCX|DOCX\s+or\s+PDF)\b/i.test(text))return null;
 // Compound sources with an explicit second determiner must be parsed as
 // separate artifacts or kept wholly unassigned. Never price just the first.
 if(/\b(?:and|or)\s+(?:an?|the|one|two|three)\s+\S/i.test(text))return null;
 if(/^Deliver\s+(?:an?|the|one|two|three)\s+\S/i.test(text))return 'Deliver';
 const match=text.match(/^(Create|Produce|Provide|Supply|Design|Write|Build|Prepare|Make|Draft)\s+(an?|the|one|two|three)\s+(.+)/i);
 if(!match)return spanishExplicitOutputAction(text);
 // Readiness or review of an existing artifact is not another payable output.
 if(/^(?:Prepare|Make)$/i.test(match[1])&&
    /\b(?:for (?:client|internal|stakeholder|final) review|available|accessible|public|published|ready for)\b/i.test(match[3]))return null;
 const object=match[3].split(/\b(?:for|with|using|based on|from|to|that|which|including|containing|listing|showing|retaining|where|about|regarding|concerning|of)\b/i,1)[0].replace(/[.!?;]+$/,'').trim();
 return (OUTPUT_ARTIFACT.test(object)||TECHNICAL_OUTPUT_NOUN.test(object))?match[1]:null;
}
// Two named artifacts in one source clause remain two editable outputs,
// while each retains the *same complete original* clause as evidence.
function twoExplicitOutputs(text){
 if(text.length>420||/["'“”‘’]/.test(text))return null;
 if(/\b(?:unless|except|if|only if|subject to|but|however|not|without)\b/i.test(text))return null;
 const match=text.match(/^(Deliver|Create|Produce|Provide|Supply|Design|Write|Build|Prepare|Make|Draft)\s+((?:an?|the|one|two|three)\s+.{1,180}?)\s+and\s+((?:an?|the|one|two|three)\s+.{1,180}?)[.!?;]?$/i);
 if(!match)return null;
 const [verb,first,second]=match.slice(1).map(x=>x.trim());
 if(/[;,]/.test(first+second)||/\b(?:and|or)\b/i.test(first+second))return null;
 // The first noun phrase must be a direct output; "a map with a route
 // and an email" could describe content rather than a second deliverable.
 if(/\b(?:for|with|using|based on|from|to|that|which|including|containing|listing|showing|retaining|where|about|regarding|concerning|of)\b/i.test(first))return null;
 const secondIdentity=second.split(/\b(?:for|with|using|based on|from|to|that|which|including|containing|listing|showing|retaining|where|about|regarding|concerning|of|by)\b/i,1)[0];
 if(!OUTPUT_ARTIFACT.test(first)||!OUTPUT_ARTIFACT.test(secondIdentity))return null;
 if(/^(?:Prepare|Make)$/i.test(verb)&&/\b(?:available|accessible|public|published|ready)\b/i.test(first+second))return null;
 return [verb+' '+first,verb+' '+second];
}

// In a natural brief, named recipients can explicitly need new work without
// using an imperative: "Stage management needs a cue sheet." The original
// clause, not this grammatical normalization, stays the review evidence.
function recipientRequestedOutputs(text){
 if(text.length>420||!/[.!?;]$/.test(text.trim())||/[;"'“”‘’]/u.test(text)||
    /\b(?:if|unless|except|only if|subject to|once|after|before|until|upon|when|pending|depending|otherwise|but|or|instead|without|not|never|maybe|might|could|would|perhaps|optional|optionally|approval|permission|consent|supplied|provided|attached|existing|prior|reference)\b/i.test(text)||
    /\b(?:prices?|pricing|costs?|budgets?|payments?|paid|payable|invoices?|discounts?|fees?|refunds?|purchases?|orders?)\b/i.test(text)||
    /\b(?:from|by)\s+(?:the\s+)?(?:client|customer|supplier|donor|venue)\b/i.test(text))return null;
 // The ordinary direct-request parser already handles polite imperatives.
 // Recipient-led imperatives preserve the "For the crew" source phrasing.
 const imperative=text.match(/^For\s+[^,]{2,75},\s*((?:Deliver|Create|Produce|Provide|Supply|Design|Write|Build|Prepare|Make|Draft)\s+.+)$/i);
 if(imperative){
  const wording=imperative[1];
  const pair=twoExplicitOutputs(wording);
  if(pair)return pair;
  return explicitOutputAction(wording)!==null?[wording]:null;
 }
 const request=line=>{
  const match=line.trim().replace(/[.!?]$/,'').match(/^(.{2,120}?)\s+(?:needs?|requires?)\s+((?:an?)\s+.{2,180})$/i);
  if(!match)return null;
  const subject=match[1].trim(),required=match[2].trim();
  // Existing work can need subcomponents. That does not order another product.
  if(/^(?:it|this|that|he|she|one)\b/i.test(subject)||OUTPUT_ARTIFACT.test(subject)||
     /\b(?:should|might|may|could|would|already|available)\b/i.test(subject))return null;
  const pair=twoExplicitOutputs('Deliver '+required+'.');
  if(pair)return pair;
  if(/\b(?:and|or)\s+(?:an?|the|one|two|three)\s+/i.test(required))return null;
  const identity=required.split(/\b(?:for|with|using|based on|from|to|that|which|including|containing|listing|showing|retaining|where|about|regarding|concerning|of)\b/i,1)[0].trim();
  if(identity.length>80||!OUTPUT_ARTIFACT.test(identity))return null;
  return ['Deliver '+identity];
 };
 // Each independently requested output in a coordinated clause keeps that
 // same original source. Refuse the whole clause if either request is unclear.
 const coordinated=text.match(/^(.{3,170}?),\s+and\s+(.{3,170})$/i);
 if(coordinated&&/\b(?:needs?|requires?)\s+an?\s+/i.test(coordinated[2])){
  const left=request(coordinated[1]),right=request(coordinated[2]);
  return left&&right&&left.length+right.length<=12?[...left,...right]:null;
 }
 return request(text);
}

// A brief may state its deliverables as a literal inline list rather than
// an imperative. Reuse the ordinary strict output-list parser after adding
// the implied verb and determiner; keep the original labeled source intact.
function labeledOutputList(text){
 const match=text.match(/^(?:Deliverables|Outputs)\s*:\s*(.+)$/i);
 if(!match||text.length>720||/["'“”‘’]/.test(text))return null;
 const parts=match[1].replace(/[.!?;]$/,'').split(/\s*,\s*(?:and\s+)?|\s+and\s+/i);
 if(parts.length<2||parts.length>12||parts.some(part=>!part.trim()||/\b(?:or|but|unless|except|if|without|not|supplied|provided|attached|reference|existing|prior|input)\b/i.test(part)))return null;
 const normalized=parts.map(part=>{
  part=part.trim();
  return /^(?:an?|the|one|two|three)\s+/i.test(part)?part:'a '+part;
 });
 if(new Set(normalized.map(name=>name.toLowerCase())).size!==normalized.length)return null;
 const implied='Deliver '+(normalized.length===2?
  normalized.join(' and '):
  normalized.slice(0,-1).join(', ')+', and '+normalized.at(-1))+'.';
 const recognized=explicitOutputList(implied);
 if(recognized)return recognized;
 // A literal Deliverables/Outputs heading is stronger evidence of output
 // identity than a fixed media-type vocabulary. For unfamiliar nouns require
 // an authored determiner rather than inventing an item from generic terms.
 const unsafe=/[;,:]|\b(?:and|or|for|with|using|based on|from|to|that|which|including|containing|listing|showing|retaining|where|about|regarding|concerning|of|by|available|accessible|public|published|ready)\b/i;
 if(parts.some(raw=>raw.length>180||unsafe.test(raw)||
    (!OUTPUT_ARTIFACT.test(raw)&&!/^(?:an?|the|one|two|three)\s+\S/i.test(raw))))return null;
 return normalized.map(part=>'Deliver '+part);
}

// Multiline lists are common authored briefs: a standalone Deliverables /
// Outputs heading gives the following *marked lines* output identity. Each
// source line remains the complete evidence for its own work. Never price an
// omitted or ambiguous item merely because its neighbor could be identified.
function multilineLabeledOutputs(clauses){
 const named=new Map();
 for(let i=0;i<clauses.length;i++){
  if(!/^(?:Deliverables|Outputs)\s*:\s*$/i.test(clauses[i].text.trim()))continue;
  const lines=[];let cursor=i+1;
  while(cursor<clauses.length){
   const match=clauses[cursor].text.trim().match(/^(?:[-*+•]|\d+[.)]|\(\d+\))\s+(.+)$/u);
   if(!match)break;
   lines.push({original:clauses[cursor],name:match[1].trim()});cursor++;
  }
  if(!lines.length||lines.length>12)continue;
  const names=lines.map(({name})=>{
   if(name.length>180||/[;"'“”‘’:,]/u.test(name)||
     /\b(?:or|unless|except|if|without|either|instead|depending|optional|as needed|subject to|provided|supplied|attached|reference|existing|prior|input)\b/i.test(name)||
     /^(?:do|don't|not|never|no|contact|send|pay|include|keep|use|review|check|approve|confirm|estimate|quote|budget|price)\b/i.test(name)||
     /\b(?:fast turnaround|low price|good communication|best effort|flexibility)\b/i.test(name))return null;
   // Marked lines that already contain an explicit work verb keep their
   // original action; they are not a new noun phrase prefixed with 'a'.
   if(explicitOutputAction(name)!==null)return name;
   if(/^(?:an?|the|one)\s+\S/i.test(name))return name;
   if(OUTPUT_ARTIFACT.test(name)&&!/^\d+\b/.test(name))return 'a '+name;
   // Explicitly labeled work can use bare technical nouns: Lighting plot, Foley palette.
   if(/^[\p{L}][\p{L}\p{N} ()/&+.-]*(?:\s+[\p{L}\p{N} ()/&+.-]+)+$/u.test(name)&&
      TECHNICAL_OUTPUT_NOUN.test(name))
     return (/^[aeiou]/i.test(name)?'an ':'a ')+name;
   return null;
  });
  // All-or-nothing for a given list: refusing one uncertain row must not
  // silently convert the other rows into an apparently complete scope.
  if(names.some(x=>!x)||new Set(names.map(x=>x.toLowerCase())).size!==names.length)continue;
  lines.forEach((line,index)=>named.set(line.original,[{original:line.original,text:explicitOutputAction(names[index])!==null?names[index]:'Deliver '+names[index],heading:clauses[i]}]));
  i=cursor-1;
 }
 return named;
}

// Explicit lists retain the complete shared source clause for every output.
// Restrict three-or-more items to direct, determined noun phrases: modifiers
// and alternatives need the author's interpretation rather than a partial seed.
function explicitOutputList(text){
 const pair=twoExplicitOutputs(text);if(pair)return pair;
 if(text.length>720||/["'“”‘’]/.test(text)||/\b(?:unless|except|if|subject to|but|however|not|without|or)\b/i.test(text))return null;
 const match=text.match(/^(Deliver|Create|Produce|Provide|Supply|Design|Write|Build|Prepare|Make|Draft)\s+(.+?)[.!?;]?$/i);
 if(!match||!/\s+and\s+(?:an?|the|one|two|three)\s+/i.test(match[2]))return null;
 const parts=match[2].split(/\s*,\s*(?:and\s+)?|\s+and\s+/i);
 if(parts.length<3||parts.length>12)return null;
 if(parts.some(part=>part.length>180||!/^(?:an?|the|one|two|three)\s+\S/i.test(part)||!OUTPUT_ARTIFACT.test(part)||
   /[;,:]|\b(?:and|or|for|with|using|based on|from|to|that|which|including|containing|listing|showing|retaining|where|about|regarding|concerning|of|by|available|accessible|public|published|ready)\b/i.test(part)))return null;
 return parts.map(part=>match[1]+' '+part);
}

// Attach only requirements that grammatically name one *unique* requested
// output. This makes "The map must ..." useful without guessing which PDF is
// meant by "The PDF must ..." when a project has multiple PDFs.
const NON_OUTPUT_SUBJECT_WORDS=new Set([
 'a','an','the','this','that','one','two','three','four','each','every',
 'all','both','either','neither','original','current','new','final',
 'supplied','approved','editable','provided','attached','required',
 'file','files','output','outputs','deliverable','deliverables',
 'work','project','client','customer','scope','budget','cost','costs',
 'payment','price','prices','condition','conditions','version',
 'versions','name','date','deadline','address','contact','details',
 'content','source','materials','material','requirements'
]);
function outputReferenceTokens(value){
 return (value.toLowerCase().match(/[a-z0-9]+/g)||[])
  .filter(word=>!NON_OUTPUT_SUBJECT_WORDS.has(word));
}
// Negative content or fidelity requirements can describe the output itself,
// rather than excluding work. Only attach an explicit named/subset restriction
// when the original sentence itself makes that identity and quality clear.
function specificNegativeOutputQuality(text){
 if(!/(?:\b(?:must|should|shall|will|needs?\s+to|has\s+to|have\s+to)\s+(?:not|never)\b|^(?:Do not|Don't|Never)\b|\b(?:without|free of)\b)/i.test(text))return false;
 if(/\b(?:unless|except|if|provided that|subject to|only if|but|however|or)\b/i.test(text))return false;
 if(/\b(?:prices?|pricing|costs?|budgets?|payments?|paid|payable|invoices?|discounts?|fees?|quotations?|quoted|quotes?|revisions?|corrections?|printing|published?|purchases?|orders?|manufactur(?:e|ing)|shipping)\b/i.test(text))return false;
 return /\b(?:crop|stretch|distort|recompress|downsample|upscale|blur|pixelat(?:e|ed|ion)|truncate|obscure|redact|reorder)\b/i.test(text)
   || /\b(?:watermarks?|personal (?:data|details|information|phone numbers?)|private information|confidential information)\b/i.test(text);
}

function explicitlyNamesOneOutput(text,anchors,sourceText,{allowCondition=false}={}){
 // The splitter can fragment an oversized sentence at a word boundary.
 // Never treat that partial prefix as the complete requirement.
 if(!/[.!?;]$/.test(text.trim()))return null;
 if(!allowCondition&&(/\b(?:unless|except|if|provided that|subject to|only if)\b/i.test(text)||
    /\b(?:si|salvo|excepto|cuando|siempre que|s[oó]lo si|[uú]nicamente si|tras aprobaci[oó]n)\b/iu.test(text)))return null;
 if(/\b(?:prices?|pricing|costs?|budgets?|payments?|paid|payable|invoices?|discounts?|fees?|quotations?|quoted|quotes?|revisions?|corrections?)\b/i.test(text))return null;
 if(/\b(?:precios?|pagos?|facturas?|reembolsos?|descuentos?|tarifas?)\b/iu.test(text))return null;
 if(/\b(?:not|never)\s+(?:be\s+)?(?:printed?|published?|purchased?|bought|sent|contacted|ordered|manufactured|translated|licensed)\b/i.test(text))return null;
 const subject=text.match(/^(?:(The|This|That)\s+)?(.{2,90}?)\s+(?:must|should|shall|needs?\s+to|has\s+to|is\s+required\s+to|will)\b/i);
 const spanishSubject=subject?null:text.match(/^(El|La|Los|Las)\s+(.{2,90}?)\s+(?:debe(?:n)?|tiene(?:n)?\s+que)\s+/iu);
 // A bare "Map PDF must ..." can be unique work just like "The map PDF
 // must ...", but the subject still has to name an artifact, not a person,
 // project or possible contextual noun.
 if(subject&&!subject[1]&&!OUTPUT_ARTIFACT.test(subject[2]))return null;
 // Keep explicit "include ... in the email" and "show ... on the map"
 // without transferring an unidentified or multiply named requirement.
 const suffix=subject||spanishSubject?null:text.match(/^(?:(?:Include|Keep|Retain|Show|Display|Place|Put|Use|Add|List|Print|Preserve)\b|(?:Do not|Don't|Never)\s+(?:crop|stretch|distort|recompress|downsample|upscale|blur|truncate|redact|reorder)\b).+\b(?:in|on|within|for)\s+(?:the|this|that)\s+([A-Za-z][A-Za-z0-9 -]{1,75})[.!?;]$/i);
 // Natural briefs often lead with the destination rather than ending with it.
 // Require an explicit output and a content action; a project prerequisite
 // such as "For the museum, contact the printer" is not output work.
 const prefix=subject||spanishSubject?null:text.match(/^(?:For|In|On|Within)\s+(?:the|this|that)\s+([A-Za-z][A-Za-z0-9 -]{1,75}),\s+(?:please\s+)?(?:include|show|display|place|put|keep|use|add|list|retain|preserve|mark|render)\b/i);
 if(suffix&&/^(?:Do not|Don't|Never)/i.test(text)&&!specificNegativeOutputQuality(text))return null;
 // A quoted instruction may mention other outputs literally; leave the whole
 // requirement for its author rather than reinterpreting that quotation.
 const name=subject?subject[2]:spanishSubject?.[2]||suffix?.[1]||prefix?.[1];
 if(!name||(!subject&&!spanishSubject&&/(?:["“”]|'[^']+'|‘[^’]+’)/u.test(text)))return null;
 // An unfamiliar name is safe only if it identifies the head of a unique
 // explicitly requested output, not a stakeholder or location in its title.
 const knownArtifact=OUTPUT_ARTIFACT.test(name);
 if(/\b(?:and|or|both|all|either|neither)\b/i.test(name))return null;
 const reference=outputReferenceTokens(name);
 if(!reference.length)return null;
 const matches=anchors.filter(anchor=>{
  // Context and supplied inputs are not names for the requested artifact.
  // Keep the original complete clause for evidence; narrow only matching.
  const identity=sourceText(anchor).split(/\b(?:for|with|using|based on|from|to|that|which|including|containing|listing|showing|retaining|where|about|regarding|concerning|of)\b/i,1)[0];
  const identityWords=outputReferenceTokens(identity);
  const words=new Set(identityWords);
  return reference.every(word=>words.has(word))&&
    (subject||spanishSubject||knownArtifact||reference.at(-1)===identityWords.at(-1));
 });
 return matches.length===1?matches[0]:null;
}

// Spanish category references are shared only when every named recipient is
// identified by its output type. A second mention in a title is not its type.
const SPANISH_ARTIFACT_TYPES=[
 ['guia',/^guias?$/],['mapa',/^mapas?$/],['cartel',/^cartel(?:es)?$/],
 ['poster',/^poster(?:es|s)?$/],['plantilla',/^plantillas?$/],
 ['correo',/^correos?$/],['folleto',/^folletos?$/],['informe',/^informes?$/],
 ['presentacion',/^presentacion(?:es)?$/],['documento',/^documentos?$/],
 ['video',/^videos?$/],['ilustracion',/^ilustracion(?:es)?$/],
 ['formulario',/^formularios?$/]
];
const spanishWords=value=>(value.toLowerCase().normalize('NFD').replace(/\p{M}/gu,'').match(/[a-z]+/g)||[]);
function spanishSharedAbstain(text){
 return text.length>340||!/[.!?;]$/.test(text.trim())||/["'“”‘’]/u.test(text)||
  /\b(?:si|salvo|excepto|pero|sino|sin|no|nunca|ni|s[oó]lo|solamente|[uú]nicamente|antes|despu[eé]s|hasta|aprobaci[oó]n|precio|pago|factura|descuento|presupuesto|coste|costo|tarifa|reembolso|imprimir|publicar|enviar|cobrar|vender)\b/iu.test(text);
}
function spanishNamedOutputSubset(text,anchors){
 if(anchors.length<2||spanishSharedAbstain(text))return [];
 const type='(gu[ií]as?|mapas?|carteles?|p[oó]sters?|plantillas?|correos?|folletos?|informes?|presentaciones?|documentos?|v[ií]deos?|ilustraciones?|formularios?)';
 const quant='(Cada|Todos los|Todas las|Ambos|Ambas|Los dos|Las dos)';
 const action='(?:mostrar|incluir|contener|usar|utilizar|incorporar|mantener|indicar|tener|llevar)';
 const obligation='(?:debe(?:n|r[aá](?:n)?)?|tiene(?:n)? que)';
 const subject=new RegExp('^'+quant+'\\s+'+type+'\\s+'+obligation+'\\s+'+action+'\\b','iu').exec(text);
 const leading=new RegExp('^(?:En|Para)\\s+'+quant+'\\s+'+type+',\\s+'+action+'\\b','iu').exec(text);
 const trailing=new RegExp('^'+action+'\\s+.{2,240}?\\s+(?:en|para)\\s+'+quant+'\\s+'+type+'[.!?;]$','iu').exec(text);
 const match=subject||leading||trailing;
 if(!match)return [];
 const quantifier=match[1].toLowerCase();
 const noun=spanishWords(match[2]).join('');
 const category=SPANISH_ARTIFACT_TYPES.find(([,pattern])=>pattern.test(noun))?.[0];
 if(!category)return [];
 const targets=anchors.filter(anchor=>{
  const identity=anchor.text.toLowerCase().normalize('NFD').replace(/\p{M}/gu,'').split(/\b(?:en|para|con|sobre|de|del|que)\b/,1)[0];
  const types=SPANISH_ARTIFACT_TYPES.filter(([,pattern])=>spanishWords(identity).some(word=>pattern.test(word)));
  return types.length===1&&types[0][0]===category;
 });
 const dual=/^(?:ambos|ambas|los dos|las dos)$/u.test(quantifier);
 return targets.length>1&&(!dual||targets.length===2)?targets:[];
}
function explicitlyNamesOutputSubset(text,anchors){
 const spanish=spanishNamedOutputSubset(text,anchors);
 if(spanish.length)return spanish;
 if(!/[.!?;]$/.test(text.trim())||/\b(?:unless|except|if|provided that|subject to|only|prices?|pricing|costs?|budgets?|payments?|paid|payable|invoices?|discounts?|fees?|quotations?|quoted|quotes?|revisions?|corrections?)\b/i.test(text))return [];
 if(/\b(?:not|never|without|no)\b/i.test(text)&&!specificNegativeOutputQuality(text))return [];
 const subject=text.match(/^(The|Both|All|Each|Every)\s+(.{2,100}?)\s+(?:must|should|shall|needs?\s+to|have\s+to|has\s+to|are\s+required\s+to|will)\b/i);
 // An imperative can explicitly name a *subset* as its destination:
 // "Keep speaker names unchanged in the captions and description script."
 // Its two unique output names are evidence; an unidentified "both" isn't.
 const destination=subject?null:text.match(/^(?:Keep|Retain|Preserve|Include|Show|Display|Place|Put|Use|Add|List)\b.{2,230}?\b(in|on|within|for|across|between)\s+(?:the|this|that)\s+([A-Za-z][A-Za-z0-9 ,\-]{1,100})[.!?;]$/i);
 const reference=subject?.[2]||destination?.[2]||'';
 if(!reference||/["“”]|\bor\b/i.test(reference))return [];
 const tokens=value=>(value.toLowerCase().match(/[a-z0-9]+/g)||[]).filter(word=>!['a','an','the','both','all','one','two','three'].includes(word)).map(word=>word.replace(/^(screenshot|caption|poster|programme|guide|map|email|script|report|image|checklist|document|pdf)s$/,'$1'));
 const matching=name=>{
  const reference=tokens(name);
  if(!reference.length)return [];
  return anchors.filter(anchor=>{
   const identity=anchor.text.split(/\b(?:for|with|using|based on|from|to|that|which|including|containing|listing|showing|retaining|where|about|regarding|concerning|of)\b/i,1)[0];
   const words=new Set(tokens(identity));return reference.every(word=>words.has(word));
  });
 };
 // Lists of independently named outputs are just as explicit as a pair.
 // A name must identify exactly one current artifact; ambiguous PDFs and
 // repeated names cannot silently expand the work.
 const names=reference.split(/\s*,\s*(?:and\s+)?|\s+and\s+/i).map(name=>name.trim());
 if(destination?.[1].toLowerCase()==='between'&&names.length!==2)return [];
 if(names.length>1&&names.length<=anchors.length&&names.every(Boolean)){
  const matched=names.map(matching);
  if(matched.some(items=>items.length!==1))return [];
  const targets=[...new Set(matched.flat())];
  return targets.length===names.length&&targets.length>1?targets:[];
 }
 if(!subject||subject[1].toLowerCase()==='the')return [];
 // "Both screenshots" names exactly two; "both" alone never assigns a subset.
 const individual=/^(?:Each|Every)$/i.test(subject[1]);
 if(individual?!/\b(?:screenshot|caption|poster|programme|guide|map|email|script|report|image|checklist|document|pdf)\b/i.test(subject[2])
   : !/\b(?:screenshots|captions|posters|programmes|guides|maps|emails|scripts|reports|images|checklists|documents|pdfs)\b/i.test(subject[2]))return [];
 const targets=matching(subject[2]);
 return targets.length>1&&(subject[1].toLowerCase()!=='both'||targets.length===2)?targets:[];
}

// A numbered reference can name a deliverable rather than another task,
// but only while the numbered outputs still have one local, explicit order.
// Do not use proximity to turn approval, billing or publication clauses into
// automatic scope. All evidence keeps the original sentence verbatim.
function positionalOutputReference(text,clauses,clause,anchors){
 if(anchors.length<2||anchors.length>12||text.length>280||!/[.!?;]$/.test(text.trim())||
    /["'“”‘’]|\b(?:if|unless|except|provided that|subject to|only if|once|after|before|when|until|upon|pending|approved?|approval|permission|consent|depending|otherwise|either|neither|or)\b/i.test(text)||
    /\b(?:not|never|without|no|prices?|pricing|costs?|budgets?|payments?|paid|payable|invoices?|discounts?|fees?|refunds?|purchases?|orders?|ship(?:ping)?|publish(?:ed|ing)?|distribute|release)\b/i.test(text))return null;
 const action='(?:use|include|show|keep|retain|display|contain|carry|feature|put|place|add|render|mark|preserve|list|have)';
 const ordinal='(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|last|former|latter)';
 const noun='(?:one|output|deliverable)';
 const prefix=new RegExp('^(?:For|In|On|Within)\\s+the\\s+'+ordinal+'(?:\\s+'+noun+')?\\s*,\\s*(?:please\\s+)?'+action+'\\b','i');
 const subject=new RegExp('^The\\s+'+ordinal+'(?:\\s+'+noun+')?\\s+(?:must|should|shall|will|needs?\\s+to|has\\s+to|have\\s+to)\\s+'+action+'\\b','i');
 const match=prefix.exec(text)||subject.exec(text);
 if(!match)return null;
 // Bare ordinals are valid only for a two-item former/latter reference.
 const value=match[1].toLowerCase();
 if(!/(?:former|latter)/.test(value)&&!new RegExp('\\b'+value+'\\s+'+noun+'\\b','i').test(text))return null;
 const index=clauses.indexOf(clause);
 const starts=anchors.map(anchor=>clauses.indexOf(anchor.original));
 if(index<0||starts.some(start=>start<0||start>=index))return null;
 const nearest=Math.max(...starts),first=Math.min(...starts);
 // Explicit ordinal references remain valid across a long brief if every
 // requested output was introduced in one uninterrupted ordered list.
 // Bare former/latter keep their short-range, conversational meaning.
 if((index-nearest>5&&(value==='former'||value==='latter'))||
    nearest-first>anchors.length-1||
    new Set(starts).size!==nearest-first+1)return null;
 const ordinals=['first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth','eleventh','twelfth'];
 const selected=value==='last'?anchors.length-1:
   value==='former'&&anchors.length===2?0:
   value==='latter'&&anchors.length===2?1:ordinals.indexOf(value);
 return selected>=0&&selected<anchors.length?anchors[selected]:null;
}

// A next-sentence 'It must ...' may carry a content requirement when the
// immediately preceding sentence identified precisely one output. This is
// never a project-wide, conditional, payment or approval instruction.
function immediateOutputReference(text,clauses,clause,anchors){
 if(!/^It\s+(?:must|should|shall|will|needs?\s+to|has\s+to)\s+(?:use|include|show|keep|retain|display|contain|carry|feature|put|place|add|render|mark|preserve|list|have)\b/i.test(text)||
    !/[.!?;]$/.test(text.trim())||
    /\b(?:if|unless|except|provided that|subject to|only if|once|after|before|when|until|upon|pending|depending|otherwise|either|neither|or|prices?|pricing|costs?|budgets?|payments?|paid|payable|invoices?|discounts?|fees?|refunds?|purchases?|orders?|publish|distribute|release)\b/i.test(text))return null;
 const index=clauses.indexOf(clause);
 if(index<1)return null;
 const previous=clauses[index-1];
 const anchored=anchors.filter(anchor=>anchor.original===previous);
 if(anchored.length===1)return anchored[0];
 if(anchored.length>1)return null;
 const prior=previous.text.replace(/^(?:(?:[-*+•]|\d+[.)]|\(\d+\))\s+)+/u,'');
 return explicitlyNamesOneOutput(prior,anchors,anchor=>anchor.text)||
   positionalOutputReference(prior,clauses,previous,anchors);
}

// Conditional instructions stay unassigned in automatic grouping. In the
// correction sheet an explicitly unique destination is useful as a one-click
// *human* choice; it must never assert that the prerequisite was satisfied.
export function conditionalRequirementHint(state,source){
 if(typeof source!=='string')return null;
 const conditional=/\b(?:if|unless|provided that|subject to|only if|pending approval|once approved|after approval)\b/i.test(source);
 if(!conditional)return null;
 // The prerequisite is still present in the original requirement; remove it
 // only from a temporary destination-matching copy for a human decision.
 const candidate=source.trim()
  .replace(/^(?:If|Once|Only if|Unless|Provided that)\s+[^,]{2,120},\s*/i,'')
  .replace(/\s+(?:(?:only\s+)?if|unless|provided that|subject to)\s+[^.!?;]{2,120}([.!?;])$/i,'$1');
 const content=/(?:\b(?:must|should|shall|will|needs?\s+to|has\s+to)\s+(?:\w+\s+){0,3}(?:show|include|use|keep|retain|display|contain|carry|feature)\b|^(?:For|In|On|Within)\b.+,\s*(?:please\s+)?(?:include|show|display|place|put|keep|use|add|list|retain|preserve)\b|^(?:Keep|Retain|Preserve|Include|Show|Display|Place|Put|Use|Add|List)\b)/i.test(candidate);
 const anchors=state.groups.map(group=>({id:group.id,text:group.title}));
 const matched=content?explicitlyNamesOneOutput(candidate,anchors,anchor=>anchor.text,{allowCondition:true}):null;
 if(matched)return {conditional:true,groupId:matched.id,title:matched.text};
 // Multiple named targets need the strict existing uniqueness matcher; the
 // automated seeding intentionally continues to abstain on every condition.
 const subset=content&&!/["'“”‘’]/.test(candidate)?explicitlyNamesOutputSubset(candidate,anchors):[];
 return {conditional:true,...(subset.length>1?{groupIds:subset.map(item=>item.id),titles:subset.map(item=>item.text)}:{})};
}

// A literal exception can narrow an otherwise universal *content* rule.
// Unlike an unspecified "except the other one", this names one unique artifact
// and leaves its original requirement entirely absent from the exception.
// Keep all other exception/condition language in the correction editor.
function explicitlyExceptsOneOutput(text,anchors){
 if(anchors.length<3||text.length>320||!/[.!?;]$/.test(text.trim())||
    /["'“”‘’]|\b(?:if|unless|either|neither|or|instead|otherwise|provided that|subject to|only if)\b/i.test(text))return [];
 const cleaned=text.trim().replace(/[.!?;]$/,'');
 const match=cleaned.match(/^(.*?)\s+except\s+(?:for\s+)?the\s+([A-Za-z][A-Za-z0-9 -]{1,70})$/i);
 if(!match)return [];
 const [,condition,excludedName]=match;
 if(/\b(?:prices?|pricing|costs?|budgets?|payments?|paid|payable|invoices?|discounts?|fees?|quotations?|quoted|quotes?|revisions?|corrections?|print(?:ing|ed)?|purchases?|orders?)\b/i.test(condition))return [];
 // Only unqualified, positive content requirements have a determined result.
 // "Must exclude imagery except..." and conditional constraints are left
 // for human correction, not silently converted into a different instruction.
 if(/\b(?:not|never|without|no|exclude|excluded|excluding)\b/i.test(condition))return [];
 const quantified=condition.match(/^All (outputs|deliverables|screenshots|images|posters|emails|maps|guides|reports|slides|documents) must (?:show|include|use|keep|retain|display|contain|carry|have|feature)\s+.+$/i);
 const imperative=/^(?:Keep|Include|Show|Retain|Display|Use|Place|Put|Preserve)\s+.+\s+(?:in|on|across) all (outputs|deliverables)$/i.exec(condition);
 const category=(quantified?.[1]||imperative?.[1]||'').toLowerCase();
 if(!category)return [];
 const relevant=/^(?:outputs|deliverables)$/.test(category)?anchors:
  anchors.filter(anchor=>new RegExp('\\b'+category.replace(/s$/,'')+'s?\\b','i').test(anchor.text));
 if(relevant.length<3)return [];
 const targetWords=outputReferenceTokens(excludedName);
 if(!targetWords.length||/\b(?:all|both|either|other|each|every)\b/i.test(excludedName))return [];
 const matches=relevant.filter(anchor=>{
  const identity=anchor.text.split(/\b(?:for|with|using|based on|from|to|that|which|including|containing|listing|showing|retaining|where|about|regarding|concerning|of)\b/i,1)[0];
  const words=new Set(outputReferenceTokens(identity));
  return targetWords.every(word=>words.has(word));
 });
 return matches.length===1?relevant.filter(anchor=>anchor!==matches[0]):[];
}

// "Two guides: one in English and one in Spanish" names *two work
// products*, not one generic design phase. Keep both tied to the same
// original source clause without converting an arbitrary count into outputs.
function countedVariantOutputs(text){
 if(text.length>380||/["'“”‘’]/.test(text)||/\b(?:unless|except|if|or|either|instead|depending)\b/i.test(text))return null;
 const match=text.match(/^(Create|Prepare|Produce|Deliver|Design|Write|Build|Draft|Make)\s+two\s+(.{3,160}?)\s*:\s*one\s+(in|for)\s+([A-Za-z][A-Za-z -]{0,42}?)\s+and\s+one\s+\3\s+([A-Za-z][A-Za-z -]{0,42}?)(?:,\s*each\s+(?:exactly|at least|at most)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+[^.!?;]{1,90})?[.!?;]$/i);
 if(!match)return null;
 const [,verb,rawArtifact,relation,first,second]=match;
 if(first.trim().toLowerCase()===second.trim().toLowerCase()||
    /\b(?:or|unless|except|if|without|either|instead|both|all|using|including|containing|with|based|depending)\b/i.test(first+' '+second))return null;
 const artifact=rawArtifact.split(/\b(?:for|with|using|based on|from|to|that|which|including|containing|listing|showing)\b/i,1)[0].trim();
 const plural=/\b(guides|posters|reports|screenshots|images|maps|emails|videos|documents|brochures|booklets|newsletters|scripts|slides|presentations|plans|diagrams|illustrations|flyers|checklists|worksheets|websites|apps|forms|cards|templates|pdfs)\b$/i.exec(artifact);
 if(!plural)return null;
 const singular=artifact.slice(0,plural.index)+plural[1].slice(0,-1);
 if(!OUTPUT_ARTIFACT.test(singular)||singular.length>65)return null;
 const article=/^[aeiou]/i.test(singular)?'an':'a';
 return [first,second].map(variant=>({
  text:verb+' '+article+' '+singular+' '+relation.toLowerCase()+' '+variant.trim(),
  relation:relation.toLowerCase(),variant:variant.trim()
 }));
}

// A source brief may also require a single editable package containing both
// explicitly named language versions. Keep the PDF delivery clause on both
// language-specific guides and make the source package a third artifact.
function variantSourcePackage(text,variants){
 if(variants.length!==2||variants[0].original!==variants[1].original||
    variants.some(anchor=>anchor.variantRelation!=='in')||text.length>300)return null;
 const match=text.match(/^(Deliver|Provide|Supply|Produce)\s+(?:an?|one)\s+(.{2,120}?)\s+for each language\s+and\s+(?:an?|one)\s+((?:editable|layered|source)\s+)?([A-Za-z][A-Za-z0-9-]{1,35}\s+)?package\s+(?:containing|including|with)\s+both versions[.!?;]$/i);
 if(!match||!OUTPUT_ARTIFACT.test(match[2]))return null;
 const packageName=(match[3]||'')+(match[4]||'')+'package';
 return match[1]+' an '+packageName.trim();
}

// Clients often name deliverables as a request, not an imperative. Convert
// only direct, complete requests for authored artifacts into the same strict
// output parser used by "Deliver a poster". The original sentence remains
// source evidence; its wording is never replaced in the review.
function directRequestOutput(text){
 if(text.length>720||!/[.!?;]$/.test(text.trim())||
    /\b(?:if|unless|except|only if|provided that|subject to|once|after|before|until|upon|when|pending|depending|otherwise|or|but|instead|without|not|maybe|perhaps|optional|approval|permission|consent|supplied|provided|attached|existing|prior|reference)\b/i.test(text)||
    /\b(?:prices?|pricing|costs?|budgets?|payments?|paid|payable|invoices?|discounts?|fees?|refunds?|purchases?|orders?)\b/i.test(text)||
    /\b(?:from|by)\s+(?:the\s+)?(?:client|customer|supplier|donor|venue)\b/i.test(text))return text;
 const polite=text.match(/^(?:Please\s+|(?:Can|Could|Would)\s+you\s+(?:please\s+)?)((?:Deliver|Create|Produce|Provide|Supply|Design|Write|Build|Prepare|Make|Draft)\s+(?:an?|the|one|two|three)\s+.+)$/i);
 const request=text.match(/^(?:(?:We|I)\s+(?:need|want|would\s+like)|(?:We|I)['’]d\s+like)\s+((?:an?|one|two|three)\s+.+)$/i);
 const spanishPolite=text.match(/^Por favor[,:]?\s+((?:Entregar|Crear|Producir|Diseñar|Redactar|Elaborar|Preparar)\s+(?:un|una|el|la)\s+.+)$/iu);
 const spanishRequest=text.match(/^(?:Necesitamos|Queremos|Quiero|Me gustaría|Nos gustaría)\s+((?:un|una)\s+.+)$/iu);
 const explicit=polite?.[1]||(request?'Deliver '+request[1]:null)||spanishPolite?.[1]||(spanishRequest?'Entregar '+spanishRequest[1]:null);
 return explicit?explicit.replace(/\?$/,'.'):text;
}

// Explicit exported document variants describe a *delivered file set*.
// They do not ask clients to pay separately for editing, export and checking.
// A single adjacent authored work can own its formats; otherwise the file set
// remains its own named output rather than being assigned to a guessed one.
function literalDocumentFormatBundle(text){
 if(text.length>430||!/[.!?;]$/.test(text.trim())||
    !/^(?:Deliver|Export|Provide|Supply)\s+/i.test(text)||
    /[;"“”‘’]|'[^']+'|\b(?:if|unless|except|either|or|optional|maybe|perhaps|approval|permission|consent|separate|standalone|supplied|provided by|existing|prior|reference|source files?|for review|only for|prices?|pricing|costs?|budgets?|payments?|invoices?|fees?|refunds?)\b/i.test(text))return null;
 const sentence=text.replace(/[.!?;]+$/,'').replace(/^(?:Deliver|Export|Provide|Supply)\s+/i,'');
 const parts=sentence.split(/\s+and\s+(?:(?:an?|one|the)\s+)?/i);
 if(parts.length!==2||parts.some(part=>/\band\b/i.test(part)||part.length>190))return null;
 const format=part=>/\bPDF\b/i.test(part)?'pdf':/\bDOCX\b/i.test(part)?'docx':null;
 const kinds=parts.map(format);
 if(kinds.some(x=>!x))return null;
 const distinctArtifactRole=part=>(part.match(/\b(?:handout|leaflet|guide|roster|checklist|map|poster|brochure|manual|schedule|report|newsletter|template|slide deck|presentation)\b/gi)||[]).at(-1)?.toLowerCase();
 const roles=parts.map(distinctArtifactRole);
 if(roles.every(Boolean)&&roles[0]!==roles[1])return null;
 const bothPDF=kinds.every(kind=>kind==='pdf');
 if(bothPDF&&!(
   /\b(?:print|press|bleed)\b/i.test(parts[0])&&
   /\b(?:screen|digital|tagged|accessible)\b/i.test(parts[1])
 ))return null;
 const suffix=bothPDF?'print PDF + screen PDF':'PDF + DOCX';
 return {suffix,title:bothPDF?'print PDF + screen PDF files':'PDF + DOCX document files'};
}
function separateExplicitCompanionOutputs(text){
 if(text.length>420||!/[.!?;]$/.test(text.trim())||/["'“”‘’]/.test(text)||
    /\b(?:if|unless|except|or|either|optional|provided|supplied|attached|existing|reference|not|without|pending|approved?|approval|permission|consent)\b/i.test(text))return null;
 const match=text.match(/^(Create|Prepare|Produce|Deliver|Design|Write|Build|Draft)\s+((?:an?|the|one|two|three)\s+.{3,185}?)\s+and\s+((?:an?|the|one|two|three)\s+separate\s+.{3,170}?)[.!?;]$/i);
 if(!match)return null;
 const [,verb,first,second]=match;
 if(!OUTPUT_ARTIFACT.test(first)||!OUTPUT_ARTIFACT.test(second)||
    /\b(?:with|containing|including|listing|based on|using)\b/i.test(first)||
    /\b(?:and|or|with|containing|including)\b/i.test(second))return null;
 return [verb+' '+first,verb+' '+second];
}
function additionalStandaloneDocument(text){
 if(text.length>300||!/[.!?;]$/.test(text.trim())||
    !/^Add\s+(?:an?|the|one)\s+/i.test(text)||
    /\b(?:if|unless|except|or|either|optional|perhaps|maybe|approval|permission|consent|supplied|provided|attached|existing|reference|prices?|pricing|costs?|budgets?|payments?|fees?|invoices?)\b/i.test(text))return null;
 const match=text.match(/^Add\s+((?:an?|the|one)\s+(?:(?:separate|standalone)\s+)?(?:(?:one|two|three|\d+)-page\s+)?[A-Za-z][A-Za-z0-9 -]{1,90}?\b(?:handout|leaflet|checklist|guide|worksheet|report|document|schedule))\b/i);
 if(!match||!/\b(?:separate|standalone|(?:one|two|three|\d+)-page)\b/i.test(match[1]))return null;
 return 'Deliver '+match[1];
}
function documentBundleRequirement(text,clauses,clause,anchors){
 if(!/[.!?;]$/.test(text.trim())||text.length>360||
    !/^(?:Include|Keep|Retain|Preserve|Place|Put|Check|Verify|Ensure)\b/i.test(text)||
    /\b(?:if|unless|except|optional|perhaps|maybe|approval|permission|consent|budget|payment|invoice|fee|refund|purchase|order|shipping|publishing)\b/i.test(text)||
    (/^Keep\b/i.test(text)&&
     !/\b(?:text|copy|word|warning|hours|ticket|prices?|map|label|image|font|colou?r|layout|type|names?|dates?|address|dimensions?|size|page|content|figures?|numbers?|links?|logo|brand|accessib)/i.test(text))||
    (/^(?:Check|Verify|Ensure)\b/i.test(text)&&
     !/\b(?:readable|legible|overflow|layout|resolution|contrast|type|size|colou?r|crop|fonts?|spelling|pages?|links?|QR|accessibility|tagged|print|screen|versions?|proof|alignment)\b/i.test(text)))return null;
 const index=clauses.indexOf(clause);
 const candidate=anchors.filter(anchor=>anchor.formatSource&&clauses.indexOf(anchor.formatSource)<index);
 if(!candidate.length)return null;
 const latest=candidate.at(-1);
 const formatEnd=clauses.indexOf(latest.formatSource);
 if(anchors.some(anchor=>anchor!==latest&&clauses.indexOf(anchor.original)>formatEnd&&clauses.indexOf(anchor.original)<index))return null;
 return latest;
}
function checkedNamedDocumentReference(text,anchors){
 if(!/[.!?;]$/.test(text.trim())||
    /\b(?:if|unless|except|optional|approval|permission|consent|payment|invoice|budget|fee|cost)\b/i.test(text))return null;
 const match=text.match(/^(?:Check|Ensure|Verify)\s+that\s+(?:the|this|that)\s+([A-Za-z][A-Za-z0-9 -]{2,70}?)\s+(?:remains?|is|will|can|has|retains?)\b/i);
 if(!match||!OUTPUT_ARTIFACT.test(match[1]))return null;
 const name=outputReferenceTokens(match[1]);
 const matching=anchors.filter(anchor=>{
  const identity=anchor.text.split(/\b(?:for|with|using|based on|from|to|that|which|including|containing)\b/i,1)[0];
  const words=new Set(outputReferenceTokens(identity));
  return name.length>0&&name.every(token=>words.has(token));
 });
 return matching.length===1?matching[0]:null;
}

// A recording delivered in WAV and MP3 is one authored audio work with two
// exports, not two billable workflow phases. A transcript is a different output.
// Only explicit file delivery, never supplied reference assets, opens this path.
function literalAudioFileDelivery(text){
 if(text.length>440||!/[.!?;]$/.test(text.trim())||
    !/^(?:Deliver|Export|Provide|Supply)\s+/i.test(text)||
    /\b(?:if|unless|except|or|either|optional|perhaps|maybe|approval|permission|consent|source|reference|existing|supplied|provided by|attached|internal review|prices?|pricing|costs?|payments?|invoices?|fees?|refunds?)\b/i.test(text))return null;
 const head=text.replace(/[.!?;]+$/,'').replace(/^(?:Deliver|Export|Provide|Supply)\s+/i,'')
  .split(/,\s+(?:with|at|including|where|which|that)\b/i,1)[0];
 const wav=head.search(/\bWAV\b/i),mp3=head.search(/\bMP3\b/i);
 if(wav<0||mp3<0||!/\bfiles?\b/i.test(head))return null;
 const between=head.slice(Math.min(wav,mp3)+3,Math.max(wav,mp3));
 return /\band\b/i.test(between)?'WAV + MP3 audio files':null;
}
function literalAudioEditIdentity(text){
 if(text.length>340||!/[.!?;]$/.test(text.trim())||
    /\b(?:if|unless|except|optional|maybe|perhaps|approval|permission|consent|prices?|pricing|costs?|payments?|invoices?)\b/i.test(text))return null;
 const match=text.match(/^(?:Edit|Mix|Master|Restore|Trim|Clean up|Cut)\s+(an?|the)\s+(.+)$/i);
 if(!match)return null;
 const name=match[2].split(/\b(?:for|with|using|from|based on)\b/i,1)[0].replace(/[.!?;]+$/,'').trim();
 if(!name||name.length>65||/\b(?:existing|supplied|reference|source|attached)\b/i.test(name)||
    !/\b(?:audio|spoken|recorded|recording|voiceover|voice-over|narration|podcast|interview|telephone|speech|sound)\b/i.test(name))return null;
 return match[1]+' '+name;
}
function literalAudioEditInstruction(text){
 return text.length<=260&&
   /^(?:Remove|Trim|Clean(?: up)?|Cut|Reduce|Normalize|Balance)\b/i.test(text)&&
   /\b(?:false starts?|gaps?|silences?|pauses?|noise|hiss|breaths?|words?|phrases?|spoken|voice|speech|audio|recordings?|peaks?|levels?|pops?|clicks?)\b/i.test(text)&&
   !/\b(?:if|unless|except|or|optional|approval|permission|payment|fees?|prices?)\b/i.test(text);
}
function literalAudioPackage(clauses,excluded){
 if(clauses.some(c=>/^(?:Outputs|Deliverables)\s*:/i.test(c.text)))return null;
 const delivered=clauses.filter(c=>!excluded.has(c.id)&&literalAudioFileDelivery(c.text));
 if(delivered.length!==1)return null;
 const delivery=delivered[0],position=clauses.indexOf(delivery);
 // An already declared audio artifact must not acquire a second file-set row.
 if(clauses.some(c=>c!==delivery&&/^(?:Deliver|Create|Produce|Provide|Supply|Export)\s+(?:an?|the)\s+[^.!?;]{0,90}\b(?:audio|recording|voiceover|podcast)\b/i.test(c.text)))return null;
 const candidates=clauses.slice(0,position).filter(c=>!excluded.has(c.id)&&literalAudioEditIdentity(c.text));
 const edit=candidates.length===1&&
   clauses.slice(clauses.indexOf(candidates[0])+1,position).every(c=>!excluded.has(c.id)&&literalAudioEditInstruction(c.text))?
   candidates[0]:null;
 const support=edit?clauses.slice(clauses.indexOf(edit)+1,position):[];
 return {delivery,edit,support,title:edit?literalAudioEditIdentity(edit.text)+' (WAV + MP3)':'WAV + MP3 audio files'};
}
// A unique edited audio work can be called "the recording" after it was
// introduced as a spoken welcome, interview, podcast, etc. This source-level
// reference does not create an extra "audio editing" phase.
function explicitAudioOutputReference(text,audio,anchors){
 if(!audio||text.length>310||
    !/^(?:The|This|That)\s+(?:(?:edited|final|mixed|mastered|finished)\s+)?(?:audio|recording|track|mix|master)\s+(?:must|should|shall|will|needs?\s+to|has\s+to)\s+/i.test(text)||
    /\b(?:if|unless|except|optional|maybe|perhaps|approval|permission|consent|prices?|pricing|costs?|budgets?|payments?|invoices?|fees?|refunds?|purchases?|orders?)\b/i.test(text))return null;
 const matches=anchors.filter(anchor=>anchor.original===(audio.edit||audio.delivery));
 return matches.length===1?matches[0]:null;
}

function standaloneTranscriptRequest(text){
 if(text.length>330||!/[.!?;]$/.test(text.trim())||
    /(?:"|“|”|'[^']+'|‘[^’]+’)/u.test(text)||
    /\b(?:if|unless|except|or|optional|maybe|perhaps|approval|permission|consent|existing|supplied|provided|attached|reference|prior|prices?|pricing|costs?|payments?|invoices?|fees?|refunds?)\b/i.test(text))return null;
 const match=text.match(/^(?:Include|Attach|Add)\s+(an?|the)\s+((?:[A-Za-z0-9][A-Za-z0-9 -]{0,72}?\s+)?transcript)\s*(?:(?:that|which|with|containing|marking|showing|listing)\b[^.!?;]*)?[.!?;]$/i);
 return match?'Deliver '+match[1]+' '+match[2].trim():null;
}

export function seedExplicitDeliverables(brief,excludedClauseIds=[]){
 const sourceText=c=>c.text.replace(/^(?:(?:[-*+•]|\d+[.)]|\(\d+\))\s+)+/u,'');
 const clauses=splitScopeClauses(brief);
 const excluded=new Set(excludedClauseIds);
 const audio=literalAudioPackage(clauses,excluded);
 const formatBundles=new Map(clauses.filter(c=>!excluded.has(c.id)).map(c=>[c,literalDocumentFormatBundle(sourceText(c))]).filter(([,bundle])=>bundle));
 const namedLines=multilineLabeledOutputs(clauses);
 const alreadyNamedTranscript=[...namedLines.values()].flat().some(item=>/\btranscript\b/i.test(item.text))||
   clauses.some(c=>{const normalized=directRequestOutput(c.text);
    return /\btranscript\b/i.test(normalized)&&
      (explicitOutputAction(normalized)!==null||Boolean(labeledOutputList(normalized))||Boolean(explicitOutputList(normalized)));});
 // Pseudo-anchors have distinct identities but point to the same original
 // clause for a compound request. We never alter or fabricate source evidence.
 let anchors=clauses.flatMap(original=>{
  if(namedLines.has(original))return namedLines.get(original);
  if(formatBundles.has(original))return [{original,text:'Deliver '+formatBundles.get(original).title,formatBundle:formatBundles.get(original)}];
  if(audio?.edit===original||audio?.delivery===original)
   return audio.edit&&audio.delivery===original?[]:[{original,text:'Deliver '+audio.title}];
  const transcript=standaloneTranscriptRequest(sourceText(original));
  if(transcript&&!alreadyNamedTranscript)return [{original,text:transcript}];
  const additional=additionalStandaloneDocument(sourceText(original));
  if(additional)return [{original,text:additional}];
  const text=directRequestOutput(sourceText(original));
  const variants=countedVariantOutputs(text);
  if(variants)return variants.map(item=>({original,text:item.text,variantRelation:item.relation}));
  const pair=separateExplicitCompanionOutputs(text)||labeledOutputList(text)||explicitOutputList(text)||recipientRequestedOutputs(text);
  if(pair)return pair.map(fragment=>({original,text:fragment}));
  return explicitOutputAction(text)!==null?[{original,text}]:[];
 });
 for(const formatAnchor of anchors.filter(anchor=>anchor.formatBundle)){
  const index=clauses.indexOf(formatAnchor.original);
  const before=anchors.filter(anchor=>anchor!==formatAnchor&&clauses.indexOf(anchor.original)<index);
  if(before.length!==1||clauses.indexOf(before[0].original)!==index-1||
     !/\b(?:handout|leaflet|guide|booklet|brochure|document|worksheet|report)\b/i.test(before[0].text))continue;
  const parent=before[0],base=parent.text.replace(/^(?:Deliver|Create|Produce|Provide|Supply|Design|Write|Build|Prepare|Make|Draft)\s+/i,'')
    .split(/\b(?:for|using|from|with)\b/i,1)[0].trim();
  parent.formatSource=formatAnchor.original;
  const suffix=' ('+formatAnchor.formatBundle.suffix+')',limit=80-suffix.length;
  const compact=base.length>limit?base.slice(0,limit).replace(/\s+\S*$/,'').trim():base;
  parent.formattedTitle=compact+suffix;
  anchors=anchors.filter(anchor=>anchor!==formatAnchor);
 }
 const variants=anchors.filter(anchor=>anchor.variantRelation);
 const companions=[];
 for(const original of clauses){
  const name=variantSourcePackage(sourceText(original),variants);
  if(name&&!anchors.some(anchor=>anchor.original===original)){
   const companion={original,text:name};anchors.push(companion);companions.push(companion);
  }
 }
 if(!anchors.length||anchors.length>12)return [];
 const anchorClauses=new Set(anchors.map(anchor=>anchor.original));
 const shared=[];
 if(anchors.length>1)for(const clause of clauses){
  const position=clauses.indexOf(clause);
  const prior=anchors.length===2&&(
   (anchors[0].original===anchors[1].original&&clauses[position-1]===anchors[0].original)||
   (clauses[position-2]===anchors[0].original&&clauses[position-1]===anchors[1].original));
  if(excluded.has(clause.id)||anchorClauses.has(clause)||!explicitlyAppliesToEveryOutput(sourceText(clause),anchors.length,prior))continue;
  try{for(const anchor of anchors)evidence({clauses},[anchor.original.id,...shared.map(c=>c.id),clause.id]);}
  catch{continue;}
  shared.push(clause);
 }
 const specific=new Map(anchors.map(anchor=>[anchor,anchor.heading?[anchor.heading]:[]]));
 for(const anchor of anchors)if(anchor.formatSource)specific.get(anchor).push(anchor.formatSource);
 if(audio?.edit){
  const edited=anchors.find(anchor=>anchor.original===audio.edit);
  if(edited)specific.get(edited).push(...audio.support,audio.delivery);
 }
 // The companion source explicitly delivers a PDF for *each* language.
 for(const companion of companions)for(const anchor of variants)
  specific.get(anchor).push(companion.original);
 for(const clause of clauses){
  if(excluded.has(clause.id)||anchorClauses.has(clause)||shared.includes(clause)||
     anchors.some(anchor=>anchor.formatSource===clause))continue;
  const target=explicitlyNamesOneOutput(sourceText(clause),anchors,anchor=>anchor.text);
  const positional=target?null:positionalOutputReference(sourceText(clause),clauses,clause,anchors);
  const checked=target||positional?null:checkedNamedDocumentReference(sourceText(clause),anchors);
  const audioReference=target||positional||checked?null:explicitAudioOutputReference(sourceText(clause),audio,anchors);
  const documentContext=target||positional||checked||audioReference?null:documentBundleRequirement(sourceText(clause),clauses,clause,anchors);
  const immediate=target||positional||checked||audioReference||documentContext?null:immediateOutputReference(sourceText(clause),clauses,clause,anchors);
  const targets=target?[target]:positional?[positional]:checked?[checked]:audioReference?[audioReference]:documentContext?[documentContext]:immediate?[immediate]:explicitlyExceptsOneOutput(sourceText(clause),anchors).concat(explicitlyNamesOutputSubset(sourceText(clause),anchors));
  if(!targets.length||targets.some(item=>excluded.has(item.original.id)))continue;
  try{for(const item of targets)evidence({clauses},[item.original.id,...shared.map(c=>c.id),...specific.get(item).map(c=>c.id),clause.id]);}
  catch{continue;}
  for(const item of targets)specific.get(item).push(clause);
 }
 return anchors.filter(anchor=>!excluded.has(anchor.original.id)).map(anchor=>({
  title:anchor.formattedTitle||[...anchor.text.replace(/^(?:Deliver|Create|Produce|Provide|Supply|Design|Write|Build|Prepare|Make|Draft|Entregar|Crear|Producir|Diseñar|Redactar|Elaborar|Preparar)\s+/iu,'').replace(/[.!;]+$/,'')].slice(0,80).join(''),
  clauseIds:clauses.filter(item=>item===anchor.original||shared.includes(item)||specific.get(anchor).includes(item)).map(item=>item.id)
 }));
}

function spanishAppliesToEveryOutput(text,count,bareBothHasLocalAntecedent){
 if(count<2||spanishSharedAbstain(text))return false;
 const content='(?:mostrar|incluir|contener|llevar|usar|utilizar|incorporar|conservar|mantener|indicar|tener|presentar)';
 const obligation='(?:debe(?:n|r[aá](?:n)?)?|tiene(?:n)? que)';
 const barePair=new RegExp('^(?:Ambos|Ambas)\\s+'+obligation+'\\s+'+content+'\\b','iu');
 if(barePair.test(text))return count===2&&bareBothHasLocalAntecedent;
 const namedPair=new RegExp('^(?:Ambos|Ambas|Los dos|Las dos)\\s+(?:entregables|productos|resultados)\\s+'+obligation+'\\s+'+content+'\\b','iu');
 if(namedPair.test(text))return count===2;
 const all=new RegExp('^(?:Todos los|Todas las|Cada)\\s+(?:(dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|[2-9]|1[012])\\s+)?(?:entregables|entregable|productos|producto|resultados|resultado)\\s+'+obligation+'\\s+'+content+'\\b','iu').exec(text);
 if(all){
  const quantity=all[1]?.toLowerCase();
  const names=['dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez','once','doce'];
  return !quantity||(names.includes(quantity)?names.indexOf(quantity)+2:Number(quantity))===count;
 }
 const leading=/^(?:En|Para)\s+(todos los|cada|ambos|ambas|los dos|las dos)\s+(?:entregables|entregable|productos|producto|resultados|resultado),\s+(?:mostrar|incluir|contener|usar|mantener|indicar|tener)\b/iu.exec(text);
 if(leading)return /^(?:todos los|cada)$/.test(leading[1].toLowerCase())||count===2;
 const trailing=/^(?:Mostrar|Incluir|Usar|Mantener|Indicar)\s+.{2,240}?\s+(?:en|para)\s+(todos los|cada|ambos|ambas|los dos|las dos)\s+(?:entregables|entregable|productos|producto|resultados|resultado)[.!?;]$/iu.exec(text);
 return !!trailing&&(/^(?:todos los|cada)$/.test(trailing[1].toLowerCase())||count===2);
}
function explicitlyAppliesToEveryOutput(text,count,bareBothHasLocalAntecedent=false){
 if(spanishAppliesToEveryOutput(text,count,bareBothHasLocalAntecedent))return true;
 // Literal quantifiers may describe shared output requirements. Never treat
 // commercial conditions, exceptions or implicit subsets as output work.
 text=text.replace(/"[^"]*"|'[^']*'|“[^”]*”|‘[^’]*’/g,'');
 if(/\b(?:except|unless|excluding|excluded|instead|either|neither|if|don't|do not|but|however|whereas|otherwise)\b/i.test(text))return false;
 if(/\b(?:not|never|without|no)\b/i.test(text)&&!specificNegativeOutputQuality(text))return false;
 if(/\b(?:prices?|pricing|costs?|budgets?|payments?|paid|payable|invoices?|discounts?|fees?|quotations?|quoted|quotes?|revisions?|corrections?)\b/i.test(text))return false;
 if(/\bonly\s+(?:on|in|for|across|both|all|each|every)\b/i.test(text))return false;
 // Bare "Both must..." has a trustworthy antecedent only when the two
 // named artifacts are the immediately preceding two independent clauses.
 if(bareBothHasLocalAntecedent&&/^Both\s+(?:must|should|shall|will|needs?\s+to|have\s+to)\b/i.test(text)&&/[.!?;]$/.test(text.trim()))return count===2;
 const direct=/^(?:Use|Keep|Retain|Include|Show|Apply|Preserve|Display|Place|Put|Ensure|Make sure)\b/i;
 const quantified=/^(?:Both (?:outputs|deliverables)|All(?: (?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+))? (?:outputs|deliverables)|(?:Each|Every) (?:output|deliverable))\s+(?:must|should|shall|will|needs?\s+to|has\s+to)\b/i;
 const leading=/^(?:In|On|Across|For)\s+(?:both (?:outputs|deliverables)|all(?: (?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+))? (?:outputs|deliverables)|(?:each|every) (?:output|deliverable))\s*,\s+(?:Use|Keep|Retain|Include|Show|Apply|Preserve|Display|Place|Put)\b/i;
 if(!direct.test(text)&&!quantified.test(text)&&!leading.test(text))return false;
 const references=[...text.matchAll(/(?:\b(?:on|in|across|for)\s+|^)(both (?:outputs|deliverables)|all(?: (two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+))? (?:outputs|deliverables)|(?:each|every) (?:output|deliverable))\b/gi)];
 if(references.length!==1)return false;
 const reference=references[0];
 if(reference.index!==0&&!/^[.!;\s]*$/.test(text.slice(reference.index+reference[0].length)))return false;
 if(/^both/i.test(reference[1]))return count===2;
 if(reference[2]){
  const words=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'];
  const named=reference[2].toLowerCase();
  return (words.includes(named)?words.indexOf(named):Number(named))===count;
 }
 return true;
}
export function addGroupingDeliverable(state,name){
 if(state.groups.length>=12)throw Error('A scope can contain at most 12 deliverables.');
 const next=structuredClone(state),id='g'+next.nextId++;
 next.groups.push({id,title:title(name),clauseIds:[]});return {state:next,id};
}
export function removeGroupingDeliverable(state,id){
 if(!state.groups.some(g=>g.id===id))throw Error('Choose a current deliverable.');
 const next=structuredClone(state);next.groups=next.groups.filter(g=>g.id!==id);return next;
}
export function moveGroupingClause(state,fromId,clauseId,toId){
 if(!state.clauses.some(c=>c.id===clauseId))throw Error('Choose an original requirement.');
 const isTerm=state.excludedClauseIds.includes(clauseId);
 const from=state.groups.find(g=>g.id===fromId),target=state.groups.find(g=>g.id===toId);
 if(fromId==='__terms__'?!isTerm:fromId!==null&&(!from||!from.clauseIds.includes(clauseId)))throw Error('This requirement is no longer in that place.');
 if(fromId===null&&(isTerm||state.groups.some(g=>g.clauseIds.includes(clauseId))))throw Error('This requirement is already assigned.');
 if(toId!==null&&toId!=='__terms__'&&!target)throw Error('Choose a current deliverable.');
 const next=structuredClone(state);
 if(fromId===toId)return next;
 next.excludedClauseIds=next.excludedClauseIds.filter(id=>id!==clauseId);
 if(toId==='__terms__'){
  next.groups.forEach(g=>g.clauseIds=g.clauseIds.filter(id=>id!==clauseId));
  next.excludedClauseIds.push(clauseId);return next;
 }
 if(from)next.groups.find(g=>g.id===fromId).clauseIds=from.clauseIds.filter(id=>id!==clauseId);
 if(target)assignClause(next,clauseId,toId);
 return next;
}
function assignClause(state,clauseId,toId){
 const group=state.groups.find(g=>g.id===toId);
 group.clauseIds=[...new Set([...group.clauseIds,clauseId])].sort((a,b)=>state.clauses.findIndex(c=>c.id===a)-state.clauses.findIndex(c=>c.id===b));
 evidence(state,group.clauseIds);
}
export function shareGroupingClause(state,clauseId,toId){
 if(!state.groups.some(g=>g.clauseIds.includes(clauseId)))throw Error('Assign the requirement to a deliverable first.');
 if(!state.groups.some(g=>g.id===toId))throw Error('Choose a current deliverable.');
 const next=structuredClone(state);assignClause(next,clauseId,toId);return next;
}
export function materializeProposalGrouping(state){
 const groups=state.groups.filter(g=>g.clauseIds.length);
 if(!groups.length)throw Error('Put at least one requirement in a deliverable.');
 return groups.map(g=>{
  const source=state.clauses.filter(c=>g.clauseIds.includes(c.id));
  const quoted=source.find(c=>!/^(?:Deliverables|Outputs)\s*:\s*$/i.test(c.text))||source[0];
  return {title:title(g.title),clauseIds:[...g.clauseIds],evidence:evidence(state,g.clauseIds),sourceQuote:[...quoted.text].slice(0,280).join('')};
 });
}


export function setGroupingClauseTargets(state,clauseId,groupIds,{projectTerm=false}={}){
 if(!state.clauses.some(c=>c.id===clauseId))throw Error('Choose an original requirement.');
 if(!Array.isArray(groupIds)||new Set(groupIds).size!==groupIds.length||groupIds.some(id=>!state.groups.some(g=>g.id===id)))throw Error('Choose current deliverables.');
 if(projectTerm&&groupIds.length)throw Error('A project term cannot also belong to a priced deliverable.');
 const next=structuredClone(state);
 next.groups.forEach(g=>g.clauseIds=g.clauseIds.filter(id=>id!==clauseId));
 next.excludedClauseIds=next.excludedClauseIds.filter(id=>id!==clauseId);
 if(projectTerm)next.excludedClauseIds.push(clauseId);
 else for(const id of groupIds)assignClause(next,clauseId,id);
 return next;
}

/** Correction-only view: stored clause IDs and source spans never change. */
export function quotedGroupingUnits(state,brief,{allowJoined=true,retainedTargets={}}={}){
 const targets=id=>JSON.stringify([state.excludedClauseIds.includes(id),state.groups.filter(g=>g.clauseIds.includes(id)).map(g=>g.id).sort(),[...(retainedTargets[id]||[])].sort()]);
 const quotes=allowJoined?[...brief.matchAll(/"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’/gu)].map(m=>({start:m.index,end:m.index+m[0].length})):[];
 const units=[];let cursor=0;
 for(const clause of state.clauses){
  const start=brief.indexOf(clause.text,cursor),end=start+clause.text.length;
  if(start<0)throw Error('The original requirement is no longer present.');
  cursor=end;
  const previous=units.at(-1);
  const sameQuote=previous&&quotes.some(q=>q.start<previous.end&&q.end>start);
  if(sameQuote&&end-previous.start<=400&&previous.targets===targets(clause.id)){
   previous.clauseIds.push(clause.id);previous.end=end;previous.text=brief.slice(previous.start,end);
  }else units.push({...clause,clauseIds:[clause.id],start,end,targets:targets(clause.id)});
 }
 return units.map(({start,end,targets,...unit})=>unit);
}
export function setGroupingUnitTargets(state,unit,groupIds,options={}){
 if(!unit||!Array.isArray(unit.clauseIds)||!unit.clauseIds.length)throw Error('Choose an original requirement.');
 // Keep the old state intact if a later fragment exceeds the evidence bound.
 let next=state;
 for(const id of unit.clauseIds)next=setGroupingClauseTargets(next,id,groupIds,options);
 return next;
}

export function exactSourceRequirementCount(originals,content,brief){
 if(!Array.isArray(originals)||!originals.length)return null;
 const legacy='Verify these source requirements:\n'+originals.map(text=>'- '+text).join('\n');
 if(content===legacy)return originals.length;
 try{
  const clauses=createProposalGrouping([],brief).clauses;
  const ids=originals.map(text=>{
   const matches=clauses.filter(clause=>clause.text===text);
   if(matches.length!==1)throw Error('Source wording is not uniquely identified.');
   return matches[0].id;
  });
  const state=createProposalGrouping([{title:'Source requirements',clauseIds:ids}],brief);
  if(materializeProposalGrouping(state)[0].evidence!==content)return null;
  const selected=new Set(ids);
  return quotedGroupingUnits(state,brief).filter(unit=>unit.clauseIds.every(id=>selected.has(id))).length;
 }catch{return null;}
}

export function appendGroupingSourceToDraft(brief,clauseIds,content,sourceClauses=[]){
 if(typeof content!=='string'||!Array.isArray(sourceClauses)||sourceClauses.some(text=>typeof text!=='string'))throw Error('This draft could not be read.');
 const ids=Array.isArray(clauseIds)?clauseIds:[clauseIds];
 const state=createProposalGrouping([{title:'Requirement',clauseIds:ids}],brief);
 const selected=new Set(ids),chosen=state.clauses.filter(clause=>selected.has(clause.id)),additions=[];
 for(const unit of quotedGroupingUnits(state,brief).filter(unit=>unit.clauseIds.every(id=>selected.has(id)))){
  const parts=unit.clauseIds.map(id=>chosen.find(clause=>clause.id===id).text);
  const present=parts.map(text=>content.includes(text));
  if(present.every(Boolean))continue;
  if(present.some(Boolean))throw Error('Part of this quotation is already in the draft. Review its criteria before adding the complete requirement.');
  additions.push(unit.text);
 }
 const text=additions.length?(content.trim()?content+'\n':'Verify these source requirements:\n')+additions.map(text=>'- '+text).join('\n'):content;
 if(text.length>MAX_PLANNED_EVIDENCE_LENGTH)throw Error('This draft has no room for another requirement. Shorten its criteria first.');
 return {text,sourceClauses:[...new Set([...sourceClauses,...chosen.map(clause=>clause.text)])]};
}

/** Preserve each authored row's missing assignment, even for shared source IDs. */
export function quotedUnresolvedRequirements(state,brief,fragments,options={}){
 const key=(rowId,id)=>JSON.stringify([rowId??'',id]);
 const byKey=new Map(fragments.map(item=>[key(item.rowId,item.clause.id),item]));
 const unitById=new Map(quotedGroupingUnits(state,brief,options).flatMap(unit=>unit.clauseIds.map(id=>[id,unit])));
 const emitted=new Set();
 return fragments.flatMap(item=>{
  const unit=unitById.get(item.clause.id);
  if(!unit)throw Error('Choose an original requirement.');
  const parts=unit.clauseIds.map(id=>byKey.get(key(item.rowId,id)));
  if(parts.every(Boolean)&&new Set(parts.map(part=>part.label)).size===1){
   const identity=key(item.rowId,unit.id);
   if(emitted.has(identity))return [];
   emitted.add(identity);
   return [{...item,clause:unit}];
  }
  return [{...item,clause:{...item.clause,clauseIds:[item.clause.id]}}];
 });
}
