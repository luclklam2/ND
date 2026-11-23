const espn = 'https://site.api.espn.com/apis/site/v2/sports/soccer/all/';
const espnDay = new Intl.DateTimeFormat('en-CA', {
  timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'
});
const normalize = name => {
  const value = String(name ?? '').normalize('NFD').toLowerCase()
    .replace(/\p{M}/gu,'').replace(/\b(?:fc|cf|afc|sc|club)\b/g,'').replace(/[^a-z0-9]/g,'');
  return value==='bilbao' ? 'athletic' : value;
};
const names = team => [team?.displayName,team?.shortDisplayName,team?.name,team?.location]
  .map(normalize).filter(Boolean);

export function matchesEvent(match,event) {
  const difference = Math.abs(Date.parse(event.date)-Date.parse(match.kickOffTime));
  if (!(difference<=15*60000)) return false;
  const sides = event.competitions?.[0]?.competitors ?? [];
  return [['home',match.homeTeam],['away',match.awayTeam]].every(([side,team])=>
    names(sides.find(c=>c.homeAway===side)?.team).includes(normalize(team.name_en)));
}

async function espnJson(path,signal) {
  const response = await fetch(espn+path,{signal:AbortSignal.any([signal,AbortSignal.timeout(12000)])});
  if (!response.ok) throw new Error('ESPN 連線失敗');
  return response.json();
}

export function lookup(signal) {
  const days = new Map();
  const summaries = new Map();
  return async (match,finished=false) => {
    const time = Date.parse(match.kickOffTime);
    const day = espnDay.format(time).replaceAll('-','');
    if (!days.has(day)) days.set(day,espnJson('scoreboard?dates='+day+'&limit=1000',signal));
    const {events=[]} = await days.get(day);
    const candidates = events.filter(event=>{
      return (!finished || event.status?.type?.completed) && matchesEvent(match,event);
    });
    if (candidates.length!==1 || !/^\d+$/.test(candidates[0].id)) return null;
    const event = candidates[0];
    if (!summaries.has(event.id)) summaries.set(event.id,espnJson('summary?event='+event.id,signal));
    return {event,summary:await summaries.get(event.id)};
  };
}

function starters(match,side) {
  const roster = match?.summary.rosters?.find(item=>item.homeAway===side);
  const xi = roster?.roster?.filter(player=>player.starter===true) ?? [];
  if (xi.length!==11 || xi.some(player=>!player.athlete?.id || !player.athlete?.displayName)
      || new Set(xi.map(player=>player.athlete.id)).size!==11) return null;
  return {xi,formation:roster.formation,bench:new Set(roster.roster.filter(player=>player.starter===false).map(player=>player.athlete?.id))};
}

function compare(current,previous) {
  if (previous.length<3) return null;
  const appearances = new Map();
  for (const lineup of previous) {
    for (const {athlete,position} of lineup.xi) {
      const entry = appearances.get(athlete.id);
      appearances.set(athlete.id,{athlete,position:entry?.position || position?.abbreviation,count:(entry?.count ?? 0)+1});
    }
  }
  const regular = [...appearances.values()].filter(entry=>entry.count>previous.length/2);
  if (regular.length<8) return {regular};
  const currentIds = new Set(current.xi.map(player=>player.athlete.id));
  const missing = regular.filter(({athlete})=>!currentIds.has(athlete.id));
  const label = missing.length>=4 ? '明顯輪換跡象' : missing.length>=2 ? '部分輪換跡象' : '接近常用正選';
  return {regular,missing,label};
}

function append(parent,tag,value) {
  const node = document.createElement(tag);
  node.textContent = value;
  parent.append(node);
  return node;
}

const positions = {G:'門將',D:'後衛',M:'中場',F:'前鋒'};

function alternativeSources(target,match) {
  const panel = append(target,'article','');
  append(panel,'h3','其他正選來源');
  append(panel,'p','ESPN 未有資料時，可查球會／賽會官方公告，以及以下比賽頁搜尋。搜尋結果要核對兩隊、開波日期及正選公布狀態。');
  const date = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Hong_Kong'}).format(new Date(match.kickOffTime));
  const query = [match.homeTeam.name_en,match.awayTeam.name_en,date,'lineups'].join(' ');
  const list = append(panel,'ul','');
  for (const [label,site] of [['SofaScore','sofascore.com'],['FotMob','fotmob.com'],['Flashscore','flashscore.com']]) {
    const item = append(list,'li','');
    const link = append(item,'a',label+' 場次搜尋');
    link.href = 'https://www.google.com/search?q='+encodeURIComponent('site:'+site+' '+query);
    link.target = '_blank';
    link.rel = 'noopener';
  }
  const official = append(panel,'a','搜尋球會／賽會官方正選公告');
  official.href = 'https://www.google.com/search?q='+encodeURIComponent(query+' official starting XI');
  official.target = '_blank';
  official.rel = 'noopener';
  append(panel,'small','以上提供外部搜尋入口。輪換比較採用本頁已取得嘅 ESPN 球員紀錄，預計陣容要等正式名單公布後再核實。');
}

export function lineupTakeaways(teams) {
  const lines = teams.map(({name,lineup,comparison,coverage,reason})=>{
    const formation = lineup?.formation ? '（'+lineup.formation+'）' : '';
    if (!comparison?.label) return name+formation+' · '+reason+(coverage ? ' '+coverage : '');
    const {regular,missing,label} = comparison;
    const changes = new Map();
    for (const player of missing) {
      const role = positions[player.position] || '位置未明';
      changes.set(role,(changes.get(role) ?? 0)+1);
    }
    const areas = [...changes].map(([role,count])=>role+' '+count+' 人').join('、');
    const bench = missing.filter(({athlete})=>lineup.bench.has(athlete.id));
    const benchText = bench.length ? ' 其中 '+bench.length+' 人列後備。' : '';
    return name+formation+' · '+label+'，保留 '+(regular.length-missing.length)+'/'+regular.length+' 名常用正選。'
      +(areas ? ' 未正選球員按近期位置分佈為'+areas+'。' : '')+benchText+' '+coverage;
  });
  const [home,away] = teams;
  if (home.comparison?.label && away.comparison?.label) {
    const share = ({comparison})=>comparison.missing.length/comparison.regular.length;
    const delta = share(home)-share(away);
    lines.push(Math.abs(delta)<1e-9 ? '兩隊常用正選變動比例相同。'
      : (delta>0 ? home.name : away.name)+'未正選嘅常用球員比例較高。');
  } else {
    lines.push('暫時資料未足以比較兩隊嘅輪換幅度。');
  }
  return lines;
}

export async function showLineups(target,match,histories,signal,getMatch=lookup(signal)) {
  const summary = document.getElementById('lineupSummary');
  summary.replaceChildren();
  append(summary,'h3','陣容分析總結');
  const pending = append(summary,'p','正在比較兩隊出場人員…');
  target.replaceChildren();
  const current = getMatch(match);
  const teams = await Promise.all(['home','away'].map(async (side,index)=>{
    const team = side==='home' ? match.homeTeam : match.awayTeam;
    const card = append(target,'article','');
    const name = team.name_ch || team.name_en;
    append(card,'h3',name);
    const message = append(card,'p','正在查閱 ESPN 正選…');
    try {
      const found = await current;
      if (signal.aborted) return;
      if (!found) {
        message.textContent = '未能配對 ESPN 場次，暫時無法判斷。';
        return {name,reason:message.textContent};
      }
      const lineup = starters(found,side);
      const link = append(card,'a','ESPN 場次資料');
      link.href = 'https://www.espn.com/soccer/match/_/gameId/'+found.event.id;
      link.target = '_blank';
      link.rel = 'noopener';
      if (!lineup) {
        message.textContent = 'ESPN 暫未提供完整正選 11 人。可以稍後撳 REFRESH 再查。';
        return {name,reason:message.textContent};
      }
      message.textContent = 'ESPN 列出正選 11 人'+(lineup.formation?' · '+lineup.formation:'');
      const verdict = append(card,'p','正在比對近期正選…');
      const list = append(card,'details','');
      append(list,'summary','查看正選 11 人');
      const players = append(list,'ol','');
      for (const {athlete} of lineup.xi) append(players,'li',athlete.displayName);
      const recent = (await histories[index].catch(()=>[])).slice(0,5);
      const references = await Promise.allSettled(recent.map(async row=>{
        const previousSide = row.homeTeam.id===team.id ? 'home' : 'away';
        return starters(await getMatch(row,true),previousSide);
      }));
      if (signal.aborted) return;
      const previous = references.flatMap(item=>item.status==='fulfilled' && item.value ? [item.value] : []);
      const coverage = '有完整正選紀錄 '+previous.length+'/'+recent.length+' 場。';
      const comparison = compare(lineup,previous);
      if (!comparison?.label) {
        verdict.textContent = '暫未能判斷輪換。'+coverage+(comparison?' 常用正選少於 8 人。':'');
        return {name,lineup,coverage,reason:comparison?'常用正選少於 8 人，暫未能分類。':'近期正選樣本不足，暫未能判斷輪換。'};
      }
      const {regular,missing,label} = comparison;
      if (missing.length>4) {
        const warning='⚠ '+name+' · '+missing.length+' 名常用正選今場未正選。';
        append(card,'p',warning).className='alert alert-danger';
        const focus=document.getElementById('focusAlerts');
        if(focus){focus.hidden=false;append(focus,'p',warning).className='alert alert-danger';}
      }
      verdict.textContent = label+' · '+(regular.length-missing.length)+'/'+regular.length+' 名常用正選今場正選。'+coverage;
      if (missing.length) append(card,'p','今場未列入正選：'+missing.map(({athlete})=>athlete.displayName).join('、'));
      return {name,lineup,comparison,coverage};
    } catch {
      if (!signal.aborted) message.textContent = '暫時未能取得 ESPN 正選資料，請稍後刷新。';
      return {name,reason:message.textContent};
    }
  }));
  if (signal.aborted) return;
  alternativeSources(target,match);
  pending.remove();
  for (const line of lineupTakeaways(teams)) append(summary,'p',line);
  append(summary,'small','位置按近期正選紀錄。輪換跡象只反映人腳變動，缺陣原因及比分影響有待核實。');
}
