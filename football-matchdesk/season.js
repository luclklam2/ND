import { matchesEvent } from './lineups.js';

export async function seasonSchedules(found,signal) {
  const league = found?.summary.header?.league?.slug;
  const year = found?.summary.header?.season?.year;
  if (!league || !/^[a-z0-9.]+$/.test(league) || !Number.isInteger(year)) return null;
  const competitors = found.event.competitions?.[0]?.competitors ?? [];
  const base = 'https://site.api.espn.com/apis/site/v2/sports/soccer/'+league+'/teams/';
  const schedules = await Promise.all(['home','away'].map(async side=>{
    const id = competitors.find(row=>row.homeAway===side)?.team?.id;
    if (!/^\d+$/.test(id)) return null;
    const response = await fetch(base+id+'/schedule?season='+year,{
      signal:AbortSignal.any([signal,AbortSignal.timeout(12000)])
    });
    if (!response.ok) return null;
    const data = await response.json();
    const events = (data.events ?? []).filter(event=>event.season?.year===year);
    if (!events.some(event=>event.id===found.event.id)) return null;
    return {events,label:data.season?.displayName || String(year)};
  }));
  return schedules.every(Boolean) ? schedules : null;
}

export function inSeason(rows,events) {
  return rows.filter(row=>events.some(event=>matchesEvent(row,event)));
}
