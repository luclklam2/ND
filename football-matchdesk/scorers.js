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
      ? [{id:String(player.id),name:player.displayName,goals:goal.value,jersey:player.jersey}] : [];
  });
  return {available:available.length,total:athletes.length,
    players:available.filter(player=>player.goals>0).sort((a,b)=>b.goals-a.goals || a.name.localeCompare(b.name)).slice(0,5)};
}

export function shotLeaders(athletes) {
  return athletes.flatMap(player=>{
    const shots=player.statistics?.splits?.categories?.flatMap(category=>category.stats ?? []).find(stat=>stat.name==='totalShots')?.value;
    return player.id && player.displayName && Number.isInteger(shots) && shots>=0
      ? [{id:String(player.id),name:player.displayName,shots}] : [];
  }).sort((a,b)=>b.shots-a.shots || a.name.localeCompare(b.name));
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
      add(card,'h3',(side==='home'?match.homeTeam:match.awayTeam).name_ch+' · 重點球員');
      return card;
    });
    pending.remove();
    await Promise.all(['home','away'].map(async(side,index)=>{
      const card = cards[index];
      const status = add(card,'p','正在讀取球員入球統計…');
      try {
        const team = sides.find(item=>item.homeAway===side)?.team;
        if (!/^\d+$/.test(team?.id ?? '')) throw Error('未能確認球隊代碼。');
        const url = 'https://site.api.espn.com/apis/site/v2/sports/soccer/'+league+
          '/teams/'+team.id+'/roster?season='+season;
        const response = await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(12000)])});
        if (!response.ok) throw Error('ESPN 連線失敗（HTTP '+response.status+'），請稍後 Refresh。');
        const payload = await response.json();
        if (signal.aborted) return;
        if (payload.season?.year!==season) throw Error('ESPN 回傳球季不符，暫停顯示入球榜。');
        if (!Array.isArray(payload.athletes) || !payload.athletes.length) throw Error('ESPN 未提供呢隊球季球員統計。');
        add(card,'small','成功讀取 '+new Intl.DateTimeFormat('zh-HK',{timeZone:'Asia/Hong_Kong',dateStyle:'short',timeStyle:'short'}).format(new Date())+' 香港時間');
        const ranking = rankedScorers(payload.athletes);
        const roster = found.summary.rosters?.find(item=>item.homeAway===side);
        status.textContent = (payload.season.displayName || payload.season.name || header.league.name)+
          ' · 有入球數據 '+ranking.available+'/'+ranking.total+' 名現有名單球員';
        if (payload.season.type!==header.season.type) {
          add(card,'p','今場階段：'+header.season.name+'。入球榜使用 ESPN '+season+' 年球季累計，涵蓋範圍可能同今場階段不同。');
        }
        const shooters=shotLeaders(payload.athletes);
        const leaders=shooters.filter(player=>player.shots>0).slice(0,2);
        const goals=new Map(ranking.players.map(player=>[player.id,player]));
        const shots=new Map(shooters.map(player=>[player.id,player.shots]));
        const athleteMap=new Map(payload.athletes.map(player=>[String(player.id),player]));
        const players=[...new Map([...ranking.players,...leaders].map(player=>[player.id,player])).values()];
        add(card,'small','入球前五名＋射門前兩名，球員去重；射門統計 '+shooters.length+'/'+payload.athletes.length+' 人。');
        if(ranking.available<ranking.total || shooters.length<payload.athletes.length) add(card,'small','部分統計欠缺，排名按有數據球員計算。');
        if(!players.length) add(card,'p','欠球員入球及射門統計。');
        const list=add(card,'ul','');
        for(const player of players){
          const athlete=athleteMap.get(player.id);
          const goal=athlete.statistics?.splits?.categories?.flatMap(category=>category.stats ?? []).find(stat=>stat.name==='totalGoals')?.value;
          const entry=roster?.roster?.find(item=>String(item.athlete?.id)===player.id);
          const number=[entry?.jersey,entry?.athlete?.jersey,athlete.jersey].find(value=>/^\d{1,3}$/.test(String(value ?? '')));
          const shirt=number===undefined?'號碼未提供':'#'+number;
          const state=attendance(player.id,roster);
          const isLeader=leaders.some(leader=>leader.id===player.id);
          const tags=[goals.has(player.id)?'入球前五':'',isLeader?'射門前二':''].filter(Boolean).join('／');
          const item=add(list,'li',shirt+' '+player.name+' · '+(Number.isInteger(goal)?goal:'—')+' 球 · '+(shots.get(player.id) ?? '—')+' 次射門 · '+state);
          add(item,'small',tags);
          if(isLeader && ['未見列入今場名單','今場後備'].includes(state)){
            item.className=state==='今場後備'?'alert':'alert alert-danger';
            const focus=document.getElementById('focusAlerts');
            if(focus){focus.hidden=false;add(focus,'p','⚠ '+(side==='home'?match.homeTeam:match.awayTeam).name_ch+' · 射門主力 '+player.name+' · '+state).className=item.className;}
          }
        }
        const link = add(card,'a','ESPN 球隊統計');
        link.href = 'https://www.espn.com/soccer/team/stats/_/id/'+team.id+'/league/'+league+'/season/'+season;
        link.target = '_blank';
        link.rel = 'noopener';
        add(card,'small','球衣號碼優先按今場名單，欠缺時用球隊登記號碼。同數按姓名排序，入球前五與射門前二合併。今場後備代表列入後備名單。統計係讀取時嘅球季累計，已開波場次可能包括今場入球；未列名球員嘅缺陣原因有待核實。');
      } catch (error) {
        if (!signal.aborted) status.textContent = error.name==='TimeoutError' ? 'ESPN 讀取逾時，請 Refresh 重試。' : (error.message || '球員統計讀取失敗，請 Refresh 重試。');
      }
    }));
  } catch {
    if (!signal.aborted) pending.textContent = '暫未能取得入球榜，請刷新再試。';
  }
}
