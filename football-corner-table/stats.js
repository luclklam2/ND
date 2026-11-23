import {confirmedResult,resultTotal} from './form.js';

export function totals(rows,type,stage) {
  const values=rows.map(row=>resultTotal(row,type,stage)).filter(value=>value!==null);
  return {n:values.length,value:values.length?values.reduce((sum,n)=>sum+n,0)/values.length:null};
}

export function pair(rows,id,type) {
  const values=rows.flatMap(row=>{
    const score=confirmedResult(row,type,5);
    if(![score?.homeResult,score?.awayResult].every(value=>Number.isInteger(value)&&value>=0)) return [];
    return row.homeTeam.id===id ? [[score.homeResult,score.awayResult]] : [[score.awayResult,score.homeResult]];
  });
  return {n:values.length,values:values.length?[0,1].map(i=>values.reduce((sum,row)=>sum+row[i],0)/values.length):null};
}

export function teamStats(rows,id,home) {
  const split=rows.filter(row=>(row.homeTeam.id===id)===home);
  return {
    half:totals(rows,2,3),full:totals(rows,2,5),
    corners:pair(rows,id,2),goals:pair(split,id,1),splitCorners:pair(split,id,2),
    sample:rows.length,split:split.length
  };
}

export function scalarTone(value,line) {
  return value===null?'missing':value>=line?'green':'red';
}
export function pairTone(values,line) {
  return values===null?'missing':scalarTone(values[0]+values[1],line);
}
