import {teamStats,scalarTone,pairTone} from './stats.js';

const endpoint='https://info.cld.hkjc.com/graphql/base/';
const dayMs=86400000;
const hkDay=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'});
const hkTime=new Intl.DateTimeFormat('zh-HK',{timeZone:'Asia/Hong_Kong',hour:'2-digit',minute:'2-digit',hour12:false});
const hkFull=new Intl.DateTimeFormat('zh-HK',{timeZone:'Asia/Hong_Kong',dateStyle:'short',timeStyle:'short'});
const button=document.getElementById('refresh');
const status=document.getElementById('status');
const body=document.getElementById('matches');
const queries=Promise.all(['footballMatchesQuery','historicFootballMatchesQuery'].map(async name=>{
  const response=await fetch(name+'.graphql');
  if(!response.ok) throw Error('查詢設定載入失敗');
  return [name,await response.text()];
})).then(entries=>Object.fromEntries(entries));
let controller;
let generation=0;
const name=team=>team.name_ch || team.name_en || '—';
const add=(parent,tag,text)=>{
  const node=document.createElement(tag);
  node.textContent=text;
  parent.append(node);
  return node;
};

async function request(query,variables,signal){
  const source=(await queries)[query];
  for(let attempt=0;attempt<2;attempt++){
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({query:source,variables}),signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
      if(!response.ok) throw Error('馬會連線失敗 HTTP '+response.status);
      const result=await response.json();
      if(result.errors?.length || !Array.isArray(result.data?.matches)) throw Error('馬會回應異常');
      return result.data;
    }catch(error){
      if(signal.aborted || attempt===1) throw error;
    }
  }
}

async function todayResults(today,signal){
  const rows=[];
  let total;
  for(let offset=0;total===undefined || offset<total;offset+=20){
    const data=await request('historicFootballMatchesQuery',{
      startDate:today,endDate:today,startIndex:offset,endIndex:offset+20,teamId:null
    },signal);
    total=Number(data.matchNumByDate?.total);
    if(!Number.isInteger(total) || total<0 || (!data.matches.length && offset<total)) throw Error('今日賽果紀錄未完整');
    rows.push(...data.matches);
  }
  return rows;
}

async function history(team,match,asOf,signal){
  const cutoff=Math.min(asOf,Date.parse(match.kickOffTime));
  const last=Date.parse(hkDay.format(cutoff)+'T00:00:00Z');
  const first=last-359*dayMs;
  const unique=new Map();
  for(let end=last;end>=first;){
    const start=Math.max(first,end-29*dayMs);
    let total;
    for(let offset=0;total===undefined || offset<total;offset+=20){
      const data=await request('historicFootballMatchesQuery',{
        teamId:team.id,startDate:new Date(start).toISOString().slice(0,10),
        endDate:new Date(end).toISOString().slice(0,10),startIndex:offset,endIndex:offset+20
      },signal);
      total=Number(data.matchNumByDate?.total);
      if(!Number.isInteger(total) || total<0 || (!data.matches.length && offset<total)) throw Error('歷史紀錄未完整');
      for(const row of data.matches){
        const time=Date.parse(row.kickOffTime);
        if(row.id!==match.id && ['MATCHENDED','INPLAYMATCHENDED'].includes(row.status) &&
          time<cutoff && [row.homeTeam?.id,row.awayTeam?.id].includes(team.id)) unique.set(row.id,row);
      }
    }
    if(unique.size>=10) break;
    end=start-dayMs;
  }
  return [...unique.values()].sort((a,b)=>Date.parse(b.kickOffTime)-Date.parse(a.kickOffTime)).slice(0,10);
}

function scalar(cell,stat,line){
  cell.replaceChildren();
  cell.className=scalarTone(stat.value,line);
  add(cell,'div',stat.value===null?'—':stat.value.toFixed(2)).className='value';
  add(cell,'small',stat.n+' 場');
}
function pair(cell,stat,individual=false){
  cell.replaceChildren();
  if(!stat.values){
    cell.className='missing';
    add(cell,'div','—').className='value';
    add(cell,'small','0 場');
    return;
  }
  cell.className=individual?'':pairTone(stat.values,10);
  if(individual){
    stat.values.forEach((value,i)=>{
      if(i) cell.append(' ／ ');
      add(cell,'span',value.toFixed(2)).className='goal-value '+scalarTone(value,2);
    });
  }else{
    add(cell,'div',stat.values.map(value=>value.toFixed(2)).join(' ／ ')).className='value';
    add(cell,'small','合計 '+(stat.values[0]+stat.values[1]).toFixed(2));
  }
  add(cell,'small',stat.n+' 場');
}
function render(cells,stats){
  scalar(cells[0],stats.half,5);
  scalar(cells[1],stats.full,9.5);
  pair(cells[2],stats.corners);
  pair(cells[3],stats.goals,true);
  pair(cells[4],stats.splitCorners);
}

async function load(){
  controller?.abort();
  controller=new AbortController();
  const signal=controller.signal;
  const run=++generation;
  const asOf=Date.now();
  const today=hkDay.format(asOf);
  document.getElementById('date').textContent=today+' · 香港時間';
  body.replaceChildren();
  button.disabled=true;
  status.textContent='正在讀取馬會今日場次…';
  try{
    const sources=await Promise.allSettled([
      request('footballMatchesQuery',{
        fbOddsTypes:['HAD'],fbOddsTypesM:['HAD'],showAllMatch:false,
        inplayOnly:false,featuredMatchesOnly:false,earlySettlementOnly:false
      },signal).then(data=>data.matches),
      todayResults(today,signal)
    ]);
    if(sources.every(source=>source.status==='rejected')) throw Error('今日賽程及賽果均未能取得');
    const partial=sources.some(source=>source.status==='rejected');
    const listed=sources.flatMap(source=>source.status==='fulfilled'?source.value:[]);
    if(run!==generation) return;
    const matches=[...new Map(listed.filter(match=>match.homeTeam?.id && match.awayTeam?.id &&
      Number.isFinite(Date.parse(match.kickOffTime)) && hkDay.format(Date.parse(match.kickOffTime))===today)
      .map(match=>[match.id,match])).values()].sort((a,b)=>Date.parse(a.kickOffTime)-Date.parse(b.kickOffTime));
    body.replaceChildren();
    const jobs=[];
    for(const match of matches){
      [match.homeTeam,match.awayTeam].forEach((team,i)=>{
        const row=add(body,'tr','');
        if(i===0){
          const fixture=add(row,'th',match.frontEndId || match.id);
          fixture.className='match';fixture.rowSpan=2;fixture.scope='rowgroup';
          add(fixture,'small',hkTime.format(Date.parse(match.kickOffTime))+' · '+(Date.parse(match.kickOffTime)<=asOf?(['MATCHENDED','INPLAYMATCHENDED'].includes(match.status)?'已完場':'已到開波時間'):'未開波'));
          add(fixture,'div',name(match.homeTeam)+' vs '+name(match.awayTeam));
          add(fixture,'small',match.tournament?.name_ch || match.tournament?.name_en || '');
        }
        const label=add(row,'th',name(team));label.className='team';label.scope='row';
        add(label,'small',i===0?'主隊 · 主場拆分':'客隊 · 作客拆分');
        const cells=Array.from({length:5},()=>{const cell=add(row,'td','讀取中…');cell.className='missing';return cell;});
        jobs.push({team,match,cells,home:i===0});
      });
    }
    if(!matches.length){status.textContent=(partial?'部分來源未能取得，暫無可列場次 · 更新 ':'今日暫無馬會場次 · 更新 ')+hkFull.format(asOf);return;}
    let completed=0,failed=0;
    const cache=new Map();
    const progress=()=>{status.textContent=(partial?'部分賽程／賽果來源讀取失敗，場次可能未齊 · ':'')+matches.length+' 場 · 已完成 '+completed+'/'+jobs.length+' 隊'+(failed?' · '+failed+' 隊讀取失敗，可 Refresh 重試':'')+' · 讀取 '+hkFull.format(asOf);};
    progress();
    let next=0;
    async function worker(){
      while(next<jobs.length && !signal.aborted){
        const job=jobs[next++];
        try{
          const key=job.team.id+'|'+Math.min(asOf,Date.parse(job.match.kickOffTime));
          if(!cache.has(key)) cache.set(key,history(job.team,job.match,asOf,signal));
          const rows=await cache.get(key);
          if(run!==generation || signal.aborted) return;
          render(job.cells,teamStats(rows,job.team.id,job.home));
        }catch(error){
          if(run!==generation || signal.aborted) return;
          failed++;
          for(const cell of job.cells){cell.replaceChildren();cell.className='missing';add(cell,'div','讀取失敗');cell.title=error.message;}
        }
        completed++;progress();
      }
    }
    await Promise.all(Array.from({length:Math.min(3,jobs.length)},worker));
  }catch(error){
    if(run===generation && !signal.aborted) status.textContent='更新失敗 · '+error.message+'。請按 Refresh 重試。';
  }finally{
    if(run===generation) button.disabled=false;
  }
}
button.addEventListener('click',load);
load();
