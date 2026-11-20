import { summarize, resultTotal } from './form.js';

const add = (parent,tag,text)=>{
  const node=document.createElement(tag);
  node.textContent=text;
  parent.append(node);
  return node;
};
let activeMatch;
export function setMatchOverview(match) {
  activeMatch=match;
  updateClock();
}
function updateClock() {
  const target=document.getElementById('countdown');
  if (!activeMatch) return;
  const minutes=Math.ceil((Date.parse(activeMatch.kickOffTime)-Date.now())/60000);
  target.textContent=minutes>0 ? '距離開波 '+Math.floor(minutes/60)+' 小時 '+minutes%60+' 分' : '已到開波時間 · 請核對賽事狀態';
}
setInterval(updateClock,60000);

export async function showComparison(match,histories,signal) {
  const coverage=document.getElementById('coverage');
  const target=document.getElementById('comparison');
  coverage.replaceChildren();
  target.replaceChildren();
  add(target,'p','正在整理兩隊數據…');
  const results=await Promise.allSettled(histories);
  if (signal.aborted) return;
  const teams=[match.homeTeam,match.awayTeam];
  const samples=results.map(result=>result.status==='fulfilled'?result.value:null);
  teams.forEach((team,i)=>{
    const card=add(coverage,'div','');
    add(card,'strong',(i?'客隊 · ':'主隊 · ')+(team.name_ch || team.name_en));
    const rows=samples[i];
    if (!rows) {add(card,'p','賽果讀取失敗，請 Refresh 重試。');return;}
    const dates=rows.map(row=>row.kickOffTime).sort();
    const format=value=>new Intl.DateTimeFormat('zh-HK',{timeZone:'Asia/Hong_Kong',dateStyle:'medium'}).format(new Date(value));
    add(card,'p',rows.length+' 場可用賽果');
    add(card,'small',dates.length ? '樣本日期 '+format(dates[0])+' 至 '+format(dates.at(-1)) : '所選條件下未有樣本');
  });
  target.replaceChildren();
  const table=add(target,'table','');
  const head=add(table,'thead','');
  const titles=add(head,'tr','');
  ['指標',teams[0].name_ch || teams[0].name_en,teams[1].name_ch || teams[1].name_en].forEach(name=>add(titles,'th',name).scope='col');
  const body=add(table,'tbody','');
  const metrics=samples.map((rows,i)=>rows?summarize(rows,teams[i].id):null);
  for (let index=0;index<6;index++) {
    const row=add(body,'tr','');
    const label=metrics.find(Boolean)?.[index]?.[0] || ['全場勝／和／負','半場領先／打和／落後','場均入球／失球','場均半場總角球','場均全場總角球','場均角球取得／失去'][index];
    add(row,'th',label).scope='row';
    metrics.forEach((data,side)=>{
      const cell=add(row,'td',data?data[index][1]+' · '+data[index][2]+' 場':'未取得');
      if (index!==3 && index!==4) return;
      const line=index===3?4.5:9.5;
      const totals=(samples[side] ?? []).map(game=>resultTotal(game,2,index===3?3:5))
        .filter(value=>value!==null);
      if (!totals.length) return;
      const difference=totals.reduce((sum,value)=>sum+value,0)-line*totals.length;
      cell.className=difference>0?'meets-threshold':difference<0?'below-threshold':'';
      cell.title='場均總角球'+(difference>0?'大過':difference<0?'低過':'等於')+line;
    });
  }
  const splitRow=add(body,'tr','');
  add(splitRow,'th','主隊主場／客隊作客 入球／失球').scope='row';
  samples.forEach((rows,i)=>{
    const split=(rows ?? []).filter(row=>(row.homeTeam.id===teams[i].id)===(i===0));
    const stat=summarize(split,teams[i].id)[2];
    add(splitRow,'td',rows?stat[1]+' · '+stat[2]+' 場':'未取得');
  });
}

const tabs=[...document.querySelectorAll('[role=tab]')];
function activate(tab,focus=false) {
  for (const item of tabs) {
    const selected=item===tab;
    item.setAttribute('aria-selected',String(selected));
    item.tabIndex=selected?0:-1;
    document.getElementById(item.getAttribute('aria-controls')).hidden=!selected;
  }
  if(focus) tab.focus();
}
tabs.forEach((tab,index)=>{
  tab.addEventListener('click',()=>activate(tab));
  tab.addEventListener('keydown',event=>{
    const next={ArrowRight:(index+1)%tabs.length,ArrowLeft:(index+tabs.length-1)%tabs.length,Home:0,End:tabs.length-1}[event.key];
    if(next===undefined) return;
    event.preventDefault();
    activate(tabs[next],true);
  });
});
