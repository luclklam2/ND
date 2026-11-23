const espn = 'https://site.api.espn.com/apis/site/v2/sports/soccer/all/';
const espnDay = new Intl.DateTimeFormat('en-CA', {
  timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'
});
const normalize = name => {
  const value = String(name ?? '').normalize('NFD').toLowerCase()
    .replace(/\p{M}/gu,'').replace(/\b(?:fc|cf|afc|sc|club)\b/g,'').replace(/[^a-z0-9]/g,'');
  const aliases={bilbao:'athletic',neftchifargona:'neftchifergana'};
  return aliases[value] ?? value;
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

