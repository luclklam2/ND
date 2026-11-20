function add(parent,tag,text) {
  const node = document.createElement(tag);
  node.textContent = text;
  parent.append(node);
  return node;
}

export function rankedScorers(athletes) {
  const available = athletes.flatMap(player=>{
    const goal = player.statistics?.splits?.categories?.flatMap(category=>category.stats ?? [])
      .find(stat=>stat.name==='totalGoals');
    return player.id && player.displayName && Number.isInteger(goal?.value) && goal.value>=0
      ? [{id:String(player.id),name:player.displayName,goals:goal.value}] : [];
  });
  return {available:available.length,total:athletes.length,
    players:available.filter(player=>player.goals>0).sort((a,b)=>b.goals-a.goals || a.name.localeCompare(b.name)).slice(0,5)};
}

export function attendance(id,roster) {
  const entries = roster?.roster ?? [];
  const starters = entries.filter(player=>player.starter===true);
  const complete = starters.length===11 && new Set(starters.map(player=>player.athlete?.id)).size===11;
  if (!complete) return '今場名單未確認';
  const player = entries.find(player=>String(player.athlete?.id)===id);
  if (player?.starter===true) return '今場正選';
  if (player?.starter===false) return '今場後備';
  return '未見列入今場名單';
}

export async function showScorers(target,match,signal,getMatch) {
  target.replaceChildren();
  const pending = add(target,'p','正在查閱兩隊入球榜…');
  try {
    const found = await getMatch(match);
    if (signal.aborted) return;
    if (!found) {
      pending.textContent = '未能配對今場賽項及球隊，暫未能取得隊內入球榜。';
      return;
    }
    const header = found.summary.header;
    const league = header?.league?.slug;
    const season = header?.season?.year;
    if (!/^[a-z0-9.]+$/.test(league ?? '') || !Number.isInteger(season)) throw Error();
    const sides = header.competitions?.[0]?.competitors ?? [];
    const cards = ['home','away'].map(side=>{
      const card = add(target,'article','');
      add(card,'h3',(side==='home'?match.homeTeam:match.awayTeam).name_ch+' · 入球頭五名');
      return card;
    });
    pending.remove();
    await Promise.all(['home','away'].map(async(side,index)=>{
      const card = cards[index];
      const status = add(card,'p','正在讀取球員入球統計…');
      try {
        const team = sides.find(item=>item.homeAway===side)?.team;
        if (!/^\d+$/.test(team?.id ?? '')) throw Error();
        const url = 'https://site.api.espn.com/apis/site/v2/sports/soccer/'+league+
          '/teams/'+team.id+'/roster?season='+season;
        const response = await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(12000)])});
        if (!response.ok) throw Error();
        const payload = await response.json();
        if (signal.aborted) return;
        if (payload.season?.year!==season ||
            !Array.isArray(payload.athletes) || !payload.athletes.length) throw Error();
        const ranking = rankedScorers(payload.athletes);
        const roster = found.summary.rosters?.find(item=>item.homeAway===side);
        status.textContent = (payload.season.displayName || payload.season.name || header.league.name)+
          ' · 有入球數據 '+ranking.available+'/'+ranking.total+' 名現有名單球員';
        if (payload.season.type!==header.season.type) {
          add(card,'p','今場階段：'+header.season.name+'。入球榜使用 ESPN '+season+' 年球季累計，涵蓋範圍可能同今場階段不同。');
        }
        if (!ranking.players.length) {
          add(card,'p','暫未取得有入球嘅球員數據。');
          return;
        }
        if (ranking.available<ranking.total) add(card,'p','部分球員統計欠缺，以下係有數據球員嘅入球排序。');
        const list = add(card,'ol','');
        for (const player of ranking.players) add(list,'li',player.name+' · '+player.goals+' 球 · '+attendance(player.id,roster));
        const link = add(card,'a','ESPN 球隊統計');
        link.href = 'https://www.espn.com/soccer/team/stats/_/id/'+team.id+'/league/'+league+'/season/'+season;
        link.target = '_blank';
        link.rel = 'noopener';
        add(card,'small','同球數按姓名排序，最多顯示五人。今場後備代表列入後備名單。統計係讀取時嘅球季累計，已開波場次可能包括今場入球；未列名球員嘅缺陣原因有待核實。');
      } catch {
        if (!signal.aborted) status.textContent = '呢隊嘅同季入球統計暫時未能取得。';
      }
    }));
  } catch {
    if (!signal.aborted) pending.textContent = '暫未能取得入球榜，請刷新再試。';
  }
}
