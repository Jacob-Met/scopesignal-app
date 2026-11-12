import {splitScopeClauses} from './local-scope-ai.mjs';
import {seedExplicitDeliverables} from './proposal-grouping.mjs';

// This checks only distinct literal output anchors, not the quality of a model's
// titles or interpretation of ambiguous references. Human decisions stay human.
export function unrepresentedNamedOutputs(proposals,brief){
 const clauses=splitScopeClauses(brief),ids=clauses.map(clause=>clause.id);
 const expected=clauses.flatMap(clause=>seedExplicitDeliverables(brief,ids.filter(id=>id!==clause.id)).map(output=>({title:output.title,clauseId:clause.id})));
 if(!expected.length||expected.length>12)return null;
 const groups=Array.isArray(proposals)?proposals:[],assigned=groups.map(()=>-1);
 const match=(output,visited)=>{
  for(let group=0;group<groups.length;group++){
   if(visited.has(group)||!groups[group]?.clauseIds?.includes(expected[output].clauseId))continue;
   visited.add(group);
   if(assigned[group]<0||match(assigned[group],visited)){assigned[group]=output;return true;}
  }
  return false;
 };
 for(let index=0;index<expected.length;index++)match(index,new Set());
 const represented=new Set(assigned.filter(index=>index>=0));
 return represented.size===expected.length?null:{expected:expected.map(output=>output.title),represented:represented.size};
}
