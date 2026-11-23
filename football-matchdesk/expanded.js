import {confirmedResult,resultTotal} from './form.js';
const markets={FHL:['半場入球',1,3],HIL:['全場入球',1,5],FCH:['半場角球',2,3],CHL:['全場角球',2,5]};
const add=(parent,tag,text)=>{const node=document.createElement(tag);node.textContent=text;parent.append(node);return node;};

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

export async function showExpanded(match,histories,confirmed,signal) {
  const target=document.getElementById('expanded');
  target.replaceChildren();
  add(target,'p','正在整理同季樣本及實際大細盤…');
  const results=await Promise.allSettled(histories);
  if(signal.aborted) return;
  target.replaceChildren();
  add(target,'p',confirmed?'以下以 ESPN 同球季賽程核對馬會已完場紀錄。':'未能確認同球季，以下暫用過去 360 日同賽項紀錄，可能跨季。');
  if(results.some(r=>r.status==='rejected')) {add(target,'p','部分歷史賽果讀取失敗，請 Refresh。');return;}
  const rows=results.map(r=>r.value);
  const controls=add(target,'label','配對樣本範圍');
  const select=add(controls,'select','');
  select.setAttribute('aria-label','配對樣本範圍');
  for(const size of [5,10,20]) {const option=add(select,'option','近 '+size+' 場');option.value=size;}
  select.value='20';
  const content=add(target,'div','');
  function render(){
    content.replaceChildren();
    const size=Number(select.value);
    const selected=rows.map(team=>team.slice(0,size));
    for(const [code,[label,type,stage]] of Object.entries(markets)){
      add(content,'h3',label+' · 近 5／10／20 場');
      const wrap=add(content,'div','');wrap.className='table';
      const table=add(wrap,'table','');
      const head=add(table,'thead',''), tr=add(head,'tr','');
      ['範圍','主隊主場取得／失去','客隊作客取得／失去','攻守配對均值（主／客／合計）'].forEach(text=>add(tr,'th',text).scope='col');
      const body=add(table,'tbody','');
      for(const n of [5,10,20]){
        const h=splitStats(rows[0].slice(0,n),match.homeTeam.id,true,type,stage);
        const a=splitStats(rows[1].slice(0,n),match.awayTeam.id,false,type,stage);
        const pair=pairRates(h,a);
        const row=add(body,'tr','');
        add(row,'th','近 '+n+' 場（實得 '+Math.min(n,rows[0].length)+'／'+Math.min(n,rows[1].length)+'）').scope='row';
        for(const stat of [h,a]) add(row,'td',stat.n?stat.scored.toFixed(2)+'／'+stat.conceded.toFixed(2)+' · '+stat.n+' 場':'欠分隊樣本');
        add(row,'td',pair?[pair.home,pair.away,pair.home+pair.away].map(n=>n.toFixed(2)).join('／'):'每隊相關主客樣本最少 3 場');
      }
      const pools=(match.foPools ?? []).filter(pool=>pool.oddsType===code && pool.status==='SELLINGSTARTED');
      let quotes=0;
      for(const pool of pools) for(const line of pool.lines ?? []){
        if(line.status!=='AVAILABLE') continue;
        const selections=(line.combinations ?? []).filter(c=>c.status==='AVAILABLE' && Number(c.currentOdds)>1);
        if(!selections.length) continue;
        quotes++;
        const box=add(content,'p',label+' '+line.condition+(line.main?'（主盤）':'')+' · '+selections.map(c=>(c.str==='H'?'大':c.str==='L'?'細':c.str)+' @ '+c.currentOdds).join(' ／ '));
        const time=Date.parse(pool.updateAt);
        add(box,'small',Number.isFinite(time)?'馬會報價更新 '+new Intl.DateTimeFormat('zh-HK',{timeZone:'Asia/Hong_Kong',dateStyle:'short',timeStyle:'short'}).format(time):'馬會未提供報價時間');
        selected.forEach((team,i)=>{
          const distribution=historicalLine(team,type,stage,line.condition);
          add(box,'small',(i?'客隊':'主隊')+'所選近況 · '+(distribution?distribution.n+' 場，大 '+(distribution.over*100).toFixed(0)+'%／細 '+(distribution.under*100).toFixed(0)+'%／走 '+(distribution.push*100).toFixed(0)+'%':'欠樣本'));
        });
      }
      if(!quotes) add(content,'p','馬會暫未提供在售'+label+'盤。');
    }
    add(content,'small','攻守配對取主隊主場取得與客隊作客失去嘅平均，客隊反向計。比例屬歷史樣本，分盤按兩條線各半計；今場機率及賠率優勢尚未校準。');
  }
  select.addEventListener('change',render);
  render();
}
