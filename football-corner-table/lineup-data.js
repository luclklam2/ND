import {lookup} from './espn.js?v=6';

export function startingXI(roster){
  const players=roster?.roster?.filter(player=>player.starter===true) ?? [];
  return players.length===11 && players.every(player=>player.athlete?.id) &&
    new Set(players.map(player=>String(player.athlete.id))).size===11 ? players : null;
}
export function rotation(current,previous){
  if(previous.length<3) return null;
  const counts=new Map();
  for(const players of previous) for(const player of players){
    const id=String(player.athlete.id);
    counts.set(id,{name:player.athlete.displayName || player.athlete.id,count:(counts.get(id)?.count ?? 0)+1});
  }
  const regular=[...counts].filter(([,player])=>player.count>previous.length/2);
  if(regular.length<8) return null;
  const ids=new Set(current.map(player=>String(player.athlete.id)));
  return {regular:regular.length,missing:regular.filter(([id])=>!ids.has(id)).map(([,player])=>player.name)};
}
export function topScorers(athletes){
  const available=athletes.flatMap(player=>{
    const goals=player.statistics?.splits?.categories?.flatMap(category=>category.stats ?? []).find(stat=>stat.name==='totalGoals')?.value;
    return player.id && player.displayName && Number.isInteger(goals) && goals>=0?
      [{id:String(player.id),name:player.displayName,goals,jersey:player.jersey}]:[];
  });
  return {available:available.length,total:athletes.length,players:available.filter(player=>player.goals>0)
    .sort((a,b)=>b.goals-a.goals || a.name.localeCompare(b.name)).slice(0,3)};
}
export function playerState(player,roster){
  const entry=roster.roster.find(item=>String(item.athlete?.id)===player.id);
  return entry?.starter===true?'正選':entry?.starter===false?'後備':'未列名';
}
const add=(parent,tag,text)=>{
  const node=document.createElement(tag);node.textContent=text;parent.append(node);return node;
};
function message(cell,text,tone='missing'){
  cell.replaceChildren();cell.className=tone;add(cell,'div',text);
}
export function createLineupService(signal){
  const find=lookup(signal);
  const rosters=new Map();
  async function rosterData(found,side){
    const header=found.summary.header;
    const league=header?.league?.slug,year=header?.season?.year;
    const team=header?.competitions?.[0]?.competitors?.find(item=>item.homeAway===side)?.team?.id;
    if(!/^[a-z0-9.]+$/.test(league ?? '') || !/^\d+$/.test(team ?? '') || !Number.isInteger(year)) throw Error('賽項／球季配對失敗');
    const key=league+'|'+year+'|'+team;
    if(!rosters.has(key)) rosters.set(key,(async()=>{
      const response=await fetch('https://site.api.espn.com/apis/site/v2/sports/soccer/'+league+'/teams/'+team+'/roster?season='+year,
        {signal:AbortSignal.any([signal,AbortSignal.timeout(12000)])});
      if(!response.ok) throw Error('射手統計讀取失敗');
      const data=await response.json();
      if(data.season?.year!==year || !Array.isArray(data.athletes)) throw Error('射手球季資料不符');
      return data;
    })());
    return rosters.get(key);
  }
  return async function loadLineups(job,historyPromise){
    const [rotationCell,scorerCell]=job.lineupCells;
    const side=job.home?'home':'away';
    let found;
    try{
      found=await find(job.match);
      if(signal.aborted) return;
      if(!found){
        message(rotationCell,'未配對到陣容');
        message(scorerCell,'未配對到陣容');
        return;
      }
    }catch{
      if(!signal.aborted){message(rotationCell,'陣容讀取失敗');message(scorerCell,'陣容讀取失敗');}
      return;
    }
    const currentRoster=found.summary.rosters?.find(item=>item.homeAway===side);
    const current=startingXI(currentRoster);
    await Promise.all([
      (async()=>{
        if(!current){message(rotationCell,'正選未確認');return;}
        try{
          const rows=(await historyPromise).slice(0,5);
          const references=await Promise.allSettled(rows.map(async row=>{
            const previous=await find(row,true);
            const previousSide=row.homeTeam.id===job.team.id?'home':'away';
            return startingXI(previous?.summary.rosters?.find(item=>item.homeAway===previousSide));
          }));
          if(signal.aborted) return;
          const previous=references.flatMap(result=>result.status==='fulfilled' && result.value?[result.value]:[]);
          const result=rotation(current,previous);
          if(!result){message(rotationCell,'輪換樣本不足');add(rotationCell,'small','完整正選 '+previous.length+'/'+rows.length+' 場');return;}
          message(rotationCell,'輪換 '+result.missing.length+' 人',result.missing.length>4?'red':'green');
          add(rotationCell,'small','常用正選 '+result.regular+' 人 · 完整樣本 '+previous.length+'/'+rows.length+' 場');
          if(result.missing.length) add(rotationCell,'small',result.missing.join('、')).className='lineup-names';
        }catch{if(!signal.aborted) message(rotationCell,'輪換資料讀取失敗');}
      })(),
      (async()=>{
        try{
          const data=await rosterData(found,side);
          if(signal.aborted) return;
          const ranking=topScorers(data.athletes);
          if(!ranking.players.length){message(scorerCell,'欠射手紀錄');return;}
          const complete=ranking.available===ranking.total;
          const missing=current?ranking.players.filter(player=>playerState(player,currentRoster)!=='正選'):[];
          message(scorerCell,!current?'正選未確認':!complete?'射手排名未齊':missing.length?'射手 '+missing.length+' 人未正選':(ranking.players.length===3?'前三射手均正選':'有入球 '+ranking.players.length+' 人均正選'),
            current && complete?(missing.length?'red':'green'):'missing');
          const names=add(scorerCell,'div','');names.className='lineup-names';
          for(const player of ranking.players){
            const entry=currentRoster?.roster?.find(item=>String(item.athlete?.id)===player.id);
            const number=entry?.jersey || player.jersey;
            add(names,'span',(number?'#'+number+' ':'')+player.name+' · '+player.goals+' 球 · '+(current?playerState(player,currentRoster):'未確認'));
          }
          add(scorerCell,'small',data.season.displayName || data.season.name || '');
          add(scorerCell,'small','入球統計 '+ranking.available+'/'+ranking.total+' 人'+(ranking.players.length<3?' · 有入球球員少於 3 人':''));
        }catch{if(!signal.aborted) message(scorerCell,'射手統計讀取失敗');}
      })()
    ]);
  };
}
