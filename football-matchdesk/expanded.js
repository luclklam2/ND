import {confirmedResult,resultTotal} from './form.js';
const markets={FHL:['半場入球',1,3],HIL:['全場入球',1,5],FCH:['半場角球',2,3],CHL:['全場角球',2,5]};
const add=(parent,tag,text)=>{const node=document.createElement(tag);if(tag==='details')node.open=true;node.textContent=text;parent.append(node);return node;};

export function splitStats(rows,id,home,type,stage) {
  const pairs=rows.filter(row=>(row.homeTeam.id===id)===home).flatMap(row=>{
    const result=confirmedResult(row,type,stage);
    if (![result?.homeResult,result?.awayResult].every(n=>Number.isInteger(n)&&n>=0)) return [];
    return [{scored:home?result.homeResult:result.awayResult,conceded:home?result.awayResult:result.homeResult}];
  });
  const average=key=>pairs.length ? pairs.reduce((sum,row)=>sum+row[key],0)/pairs.length : null;
  return {n:pairs.length,scored:average('scored'),conceded:average('conceded')};
}

export function pairRates(home,away) {
  if(Math.min(home.n,away.n)<3) return null;
  return {home:(home.scored+away.conceded)/2,away:(away.scored+home.conceded)/2};
}

export function historicalLine(rows,type,stage,condition) {
  if (!/^\d+(\.\d+)?(\/\d+(\.\d+)?)?$/.test(String(condition))) return null;
  const parts=String(condition).split('/').map(Number);
  if(!parts.length || parts.length>2 || parts.some(n=>!Number.isFinite(n))) return null;
  const totals=rows.map(row=>resultTotal(row,type,stage)).filter(n=>n!==null);
  if(!totals.length) return null;
  let over=0,under=0,push=0;
  for(const total of totals) for(const line of parts) {
    if(total>line) over+=1/parts.length;
    else if(total<line) under+=1/parts.length;
    else push+=1/parts.length;
  }
  return {n:totals.length,over:over/totals.length,under:under/totals.length,push:push/totals.length};
}

export function marketDirection(values,confirmed,quoted) {
  if (!quoted) return {label:'未有盤口',tone:'neutral'};
  if (!confirmed) return {label:'資料待核實',tone:'neutral'};
  if (values.some(value=>!value || value.n<5)) return {label:'樣本不足',tone:'neutral'};
  if (values.every(value=>value.over>=.6)) return {label:'偏大',tone:'over'};
  if (values.every(value=>value.under>=.6)) return {label:'偏細',tone:'under'};
  return {label:'未有一致方向',tone:'neutral'};
}
export function summaryQuote(match,code) {
  const pools=(match.foPools ?? []).filter(pool=>pool.oddsType===code && pool.status==='SELLINGSTARTED');
  const available=pools.flatMap(pool=>(pool.lines ?? []).filter(line=>line.status==='AVAILABLE' &&
    (line.combinations ?? []).some(c=>c.status==='AVAILABLE' && Number(c.currentOdds)>1)).map(line=>({pool,line})));
  return available.find(item=>item.line.main) ?? available[0];
}

export function showMarketSummary(match,rows,confirmed) {
  const target=document.getElementById('quickSummary');
  target.replaceChildren();
  add(target,'p','歷史傾向 · 按今場盤線及兩隊近 20 場');
  const games=[...new Map(rows.flat().filter(row=>
    [match.homeTeam.id,match.awayTeam.id].every(id=>[row.homeTeam.id,row.awayTeam.id].includes(id)))
    .map(row=>[row.id,row])).values()].sort((a,b)=>Date.parse(b.kickOffTime)-Date.parse(a.kickOffTime)).slice(0,20);
  const grid=add(target,'div','');grid.className='grid';
  const defaults={FHL:'0.5',HIL:'2.5',FCH:'4.5',CHL:'9.5'};
  function cell(parent,sample,type,stage,line) {
    const result=historicalLine(sample,type,stage,line);
    const value=add(parent,'td',result?'大 '+(result.over*100).toFixed(0)+'%／細 '+(result.under*100).toFixed(0)+'%':'欠有效樣本');
    if(result) add(value,'small',result.n+' 場'+(result.push?' · 走 '+(result.push*100).toFixed(0)+'%':''));
    return value;
  }
  for(const [code,[label,type,stage]] of Object.entries(markets)){
    const card=add(grid,'div','');card.className='surface direction-card';
    add(card,'h3',label+'大細');
    const quote=summaryQuote(match,code);
    const line=quote?quote.line.condition:defaults[code];
    add(card,'p',quote?'馬會'+(quote.line.main?'主盤':'在售盤')+' '+line:'參考線 '+line+' · 暫無在售盤');
    const values=rows.map(sample=>historicalLine(sample.slice(0,20),type,stage,line));
    const direction=marketDirection(values,confirmed,Boolean(quote));
    card.className+=' direction-'+direction.tone;
    add(card,'strong',direction.label).className='direction-label';
    if(quote){
      add(card,'small',quote.line.combinations.filter(c=>c.status==='AVAILABLE' && Number(c.currentOdds)>1)
        .map(c=>(c.str==='H'?'大':c.str==='L'?'細':c.str)+' @ '+c.currentOdds).join('／'));
      const time=Date.parse(quote.pool.updateAt);
      if(Number.isFinite(time))add(card,'small','報價更新 '+new Intl.DateTimeFormat('zh-HK',{timeZone:'Asia/Hong_Kong',dateStyle:'short',timeStyle:'short'}).format(time));
    }
    const detail=add(card,'details','');
    add(detail,'summary','近況大／細比例');
    const table=add(detail,'table','');
    const head=add(table,'thead',''),titles=add(head,'tr','');
    ['範圍','主隊','客隊'].forEach(text=>add(titles,'th',text).scope='col');
    const body=add(table,'tbody','');
    for(const n of [5,10,15,20]){
      const row=add(body,'tr','');
      add(row,'th','近 '+n+' 場').scope='row';
      rows.forEach(sample=>cell(row,sample.slice(0,n),type,stage,line));
    }
    const meeting=add(body,'tr','');
    add(meeting,'th','雙方交手').scope='row';
    cell(meeting,games,type,stage,line).colSpan=2;
  }
  const method=add(target,'details','');
  add(method,'summary','方向點計？');
  add(method,'p','偏大／偏細係歷史傾向，唔係投注推介。須確認同季及有在售盤，每隊最少 5 場有效樣本，而且兩隊近 20 場都至少 60% 指向同一邊；其餘顯示未有一致方向。60% 係顯示規則，未經回測校準。分盤按兩條線各半計；交手只計本次載入範圍，最多 20 場。');
}
export async function showExpanded(match,histories,confirmed,signal) {
  const target=document.getElementById('expanded');
  target.replaceChildren();
  add(target,'p','正在整理同季樣本及實際大細盤…');
  const results=await Promise.allSettled(histories);
  if(signal.aborted) return;
  target.replaceChildren();
  add(target,'p',confirmed?'以下以 ESPN 同球季賽程核對馬會已完場紀錄。':'未能確認同球季，以下暫用過去 360 日同賽項紀錄，可能跨季。');
  if(results.some(r=>r.status==='rejected')) {add(target,'p','部分歷史賽果讀取失敗，請 Refresh。');showMarketSummary(match,results.map(r=>r.status==='fulfilled'?r.value:[]),false);add(document.getElementById('quickSummary'),'small','部分歷史賽果讀取失敗，方向暫未確認。請 Refresh 再試。');return;}
  const rows=results.map(r=>r.value);
  showMarketSummary(match,rows,confirmed);
  const controls=add(target,'label','配對場數');
  const select=add(controls,'select','');
  select.setAttribute('aria-label','配對場數');
  for(const size of [5,10,15,20]) {const option=add(select,'option','近 '+size+' 場');option.value=size;}
  select.value='20';
  const content=add(target,'div','');
  function render(){
    content.replaceChildren();
    const size=Number(select.value);
    const selected=rows.map(team=>team.slice(0,size));
    for(const [code,[label,type,stage]] of Object.entries(markets)){
      add(content,'h3',label+' · 近 '+size+' 場攻守配對');
      const wrap=add(content,'div','');wrap.className='table';
      const table=add(wrap,'table','');
      const head=add(table,'thead',''), tr=add(head,'tr','');
      ['範圍','主場得／失','作客得／失','配對 主／客／總數'].forEach(text=>add(tr,'th',text).scope='col');
      const body=add(table,'tbody','');
      const n=size;
      const h=splitStats(rows[0].slice(0,n),match.homeTeam.id,true,type,stage);
      const a=splitStats(rows[1].slice(0,n),match.awayTeam.id,false,type,stage);
      const pair=pairRates(h,a);
      const row=add(body,'tr','');
      add(row,'th','近 '+n+' 場（實得 '+Math.min(n,rows[0].length)+'／'+Math.min(n,rows[1].length)+'）').scope='row';
      for(const stat of [h,a]) add(row,'td',stat.n?stat.scored.toFixed(2)+'／'+stat.conceded.toFixed(2)+' · '+stat.n+' 場':'欠分隊樣本');
      add(row,'td',pair?[pair.home,pair.away,pair.home+pair.away].map(n=>n.toFixed(2)).join('／'):'每隊相關主客樣本最少 3 場');
      const quotesPanel=add(content,'details','');
      add(quotesPanel,'summary','其他盤線（主盤見頁首）');
      const mainQuote=summaryQuote(match,code);
      const pools=(match.foPools ?? []).filter(pool=>pool.oddsType===code && pool.status==='SELLINGSTARTED');
      const quoteWrap=add(quotesPanel,'div','');quoteWrap.className='table';
      const quoteTable=add(quoteWrap,'table','');
      const quoteHead=add(add(quoteTable,'thead',''),'tr','');
      ['盤線','賠率 大／細','主隊 大／細','客隊 大／細'].forEach(text=>add(quoteHead,'th',text).scope='col');
      const quoteBody=add(quoteTable,'tbody','');
      let quotes=0;
      for(const pool of pools){
        const time=Date.parse(pool.updateAt);
        if(Number.isFinite(time)) add(quotesPanel,'small','更新 '+new Intl.DateTimeFormat('zh-HK',{timeZone:'Asia/Hong_Kong',dateStyle:'short',timeStyle:'short'}).format(time));
        for(const line of pool.lines ?? []){
          if(line.status!=='AVAILABLE' || line===mainQuote?.line) continue;
          const selections=(line.combinations ?? []).filter(c=>c.status==='AVAILABLE' && Number(c.currentOdds)>1);
          if(!selections.length) continue;
          quotes++;
          const row=add(quoteBody,'tr','');
          add(row,'th',line.condition+(line.main?' 主盤':'')).scope='row';
          add(row,'td',['H','L'].map(side=>selections.find(c=>c.str===side)?.currentOdds ?? '—').join('／'));
          for(const team of selected){
            const distribution=historicalLine(team,type,stage,line.condition);
            const cell=add(row,'td',distribution?(distribution.over*100).toFixed(0)+'%／'+(distribution.under*100).toFixed(0)+'%':'欠樣本');
            if(distribution) add(cell,'small',distribution.n+' 場'+(distribution.push?' · 走 '+(distribution.push*100).toFixed(0)+'%':''));
          }
        }
      }
      if(!quotes){quoteWrap.remove();add(quotesPanel,'p','暫無其他在售盤');}
    }
    add(content,'small','攻守配對取主隊主場取得與客隊作客失去嘅平均，客隊反向計。比例屬歷史樣本，分盤按兩條線各半計；今場機率及賠率優勢尚未校準。');
  }
  select.addEventListener('change',render);
  render();
}
