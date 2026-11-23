const markets={FHL:'半場入球',HIL:'全場入球',FCH:'半場角球',CHL:'全場角球'};
const add=(parent,tag,text)=>{
  const node=document.createElement(tag);
  node.textContent=text;
  parent.append(node);
  return node;
};

export function showMarkets(target,match){
  target.replaceChildren();
  for(const [code,label] of Object.entries(markets)){
    const card=add(target,'article','');
    add(card,'h3',label+'大細');
    const pools=(match.foPools ?? []).filter(pool=>pool.oddsType===code && pool.status==='SELLINGSTARTED');
    const lines=pools.flatMap(pool=>(pool.lines ?? []).filter(line=>line.status==='AVAILABLE')
      .map(line=>({line,pool,selections:(line.combinations ?? []).filter(c=>c.status==='AVAILABLE' && Number(c.currentOdds)>1)})))
      .filter(item=>item.selections.length)
      .sort((a,b)=>Number(b.line.main)-Number(a.line.main));
    if(!lines.length){add(card,'p','暫無在售盤');continue;}
    const table=add(card,'table','');
    const header=add(add(table,'thead',''),'tr','');
    ['盤線','大','細'].forEach(text=>add(header,'th',text).scope='col');
    const body=add(table,'tbody','');
    for(const {line,selections} of lines){
      const row=add(body,'tr','');
      if(line.main) row.className='main-line';
      add(row,'th',line.condition+(line.main?' 主盤':'')).scope='row';
      for(const side of ['H','L']) add(row,'td',selections.find(c=>c.str===side)?.currentOdds ?? '—');
    }
    const times=[...new Set(lines.map(item=>item.pool.updateAt).filter(Boolean))];
    for(const value of times){
      const time=Date.parse(value);
      if(Number.isFinite(time)) add(card,'small','馬會報價更新 '+new Intl.DateTimeFormat('zh-HK',{
        timeZone:'Asia/Hong_Kong',dateStyle:'short',timeStyle:'short'
      }).format(time));
    }
  }
}
