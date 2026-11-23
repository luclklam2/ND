import { showExpanded } from './expanded.js?v=20261123';
import { setMatchOverview, showComparison } from './view.js?v=20261123';
import { showScorers } from './scorers.js?v=20261123';
import { showScoreAnalysis } from './score.js?v=20261123';
import { formatResult, resultTotal, summarize } from './form.js';
import { lookup, showLineups } from './lineups.js?v=20261123';
import { inSeason, seasonSchedules } from './season.js';
const endpoint = 'https://info.cld.hkjc.com/graphql/base/';
const element = id => document.getElementById(id);
const fixture = element('fixture');
const refresh = element('refresh');
const dayMs = 86400000;
const localDay = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'});
const localTime = new Intl.DateTimeFormat('zh-HK', {timeZone:'Asia/Hong_Kong',dateStyle:'medium',timeStyle:'short'});
const queries = new Map();
let matches = [];
let selection = new AbortController();

async function request(name, variables, signal) {
  if (!queries.has(name)) {
    const source = await fetch(name + '.graphql');
    if (!source.ok) throw new Error('查詢設定載入失敗');
    queries.set(name, await source.text());
  }
  const response = await fetch(endpoint, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({query:queries.get(name),variables}),
    signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])
  });
  if (!response.ok) throw new Error('馬會連線失敗（' + response.status + '）');
  const payload = await response.json();
  if (payload.errors?.length || !Array.isArray(payload.data?.matches)) throw new Error('馬會賽事服務回應異常');
  return payload.data;
}

const teamName = team => team.name_ch || team.name_en;
const kickoff = match => Date.parse(match.kickOffTime);
const dateKey = ms => new Date(ms).toISOString().slice(0,10);
const dayStart = date => Date.parse(date + 'T00:00:00Z');
const teamList = match => [match.homeTeam,match.awayTeam];
const name = match => teamList(match).map(teamName).join(' vs ');

async function loadFixtures() {
  refresh.disabled = true;
  const status = element('status');
  status.textContent = '正在更新馬會場次…';
  try {
    const data = await request('footballMatchesQuery', {
      fbOddsTypes:['HAD','HIL','FHL','CHL','FCH'],fbOddsTypesM:['HAD'],showAllMatch:false,
      inplayOnly:false,featuredMatchesOnly:false,earlySettlementOnly:false
    }, new AbortController().signal);
    const previous = fixture.value;
    matches = data.matches.filter(m => m.homeTeam && m.awayTeam && Number.isFinite(kickoff(m)))
      .sort((a,b) => kickoff(a)-kickoff(b));
    fixture.replaceChildren(new Option(matches.length ? '請選擇場次' : '目前沒有可選場次',''));
    for (const m of matches) {
      fixture.add(new Option([m.frontEndId,localTime.format(kickoff(m)),m.tournament?.name_ch,name(m)].filter(Boolean).join(' · '),m.id));
    }
    fixture.disabled = !matches.length;
    if (matches.some(m => m.id === previous)) fixture.value = previous;
    status.textContent = '已更新 ' + localTime.format(Date.now()) + '（香港時間） · ' + matches.length + ' 場';
    await selectFixture();
  } catch (error) {
    status.textContent = '更新失敗。' + error.message + '。' + (matches.length ? '仍顯示上次成功取得嘅場次。' : '請再按 REFRESH。');
  } finally {
    refresh.disabled = false;
  }
}

async function historyWindow(teamId, start, end, signal) {
  const rows = [];
  let total;
  for (let offset = 0; total === undefined || offset < total; offset += 20) {
    const data = await request('historicFootballMatchesQuery', {
      teamId,startDate:dateKey(start),endDate:dateKey(end),startIndex:offset,endIndex:offset+20
    },signal);
    total = Number(data.matchNumByDate?.total);
    if (!Number.isInteger(total) || total < 0 || (!data.matches.length && offset < total)) {
      throw new Error('馬會歷史紀錄回應不完整');
    }
    rows.push(...data.matches);
  }
  return rows;
}

async function history(team, match, start, sameSeason, signal) {
  const end = dayStart(localDay.format(Math.min(Date.now(),kickoff(match))));
  const unique = new Map();
  for (let cursor = end; cursor >= start;) {
    const windows = [];
    for (let i=0;i<3 && cursor>=start;i++) {
      const first = Math.max(start,cursor-29*dayMs);
      windows.push(historyWindow(team.id,first,cursor,signal));
      cursor = first-dayMs;
    }
    const batches = await Promise.all(windows);
    for (const row of batches.flat()) {
      if (row.id !== match.id && ['MATCHENDED','INPLAYMATCHENDED'].includes(row.status) && kickoff(row) < kickoff(match)
          && kickoff(row) <= Date.now() && [row.homeTeam?.id,row.awayTeam?.id].includes(team.id)
          && (!sameSeason || row.tournament?.code === match.tournament.code)) unique.set(row.id,row);
    }
    if (!sameSeason && unique.size >= 20) break;
  }
  const sorted = [...unique.values()].sort((a,b)=>kickoff(b)-kickoff(a));
  return sameSeason ? sorted : sorted.slice(0,20);
}

function add(parent, tag, value) {
  const node = document.createElement(tag);
  node.textContent = value ?? '';
  parent.append(node);
  return node;
}

function renderTable(card, rows, teamId) {
  if (!rows.length) {
    add(card,'p','呢段期間未搵到符合條件嘅馬會賽果。');
    return;
  }
  add(card,'p',rows.length+' 場');
  if (teamId) {
    const stats = add(card,'dl');
    stats.className = 'metrics';
    for (const [label,value,samples] of summarize(rows,teamId)) {
      const item = add(stats,'div');
      add(item,'dt',label);
      add(item,'dd',value);
      add(item,'small','樣本 '+samples+'/'+rows.length+' 場');
    }
  }
  const wrapper = add(card,'div');
  wrapper.className = 'table';
  wrapper.tabIndex = 0;
  wrapper.setAttribute('aria-label','歷史賽果，可橫向捲動');
  const table = add(wrapper,'table');
  const head = table.createTHead().insertRow();
  for (const label of ['香港日期','賽項／對賽','半場比分','全場比分','半場角球','全場角球']) {
    add(head,'th',label).scope = 'col';
  }
  const body = table.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    add(tr,'td',localDay.format(kickoff(row)));
    const teams = add(tr,'td',name(row));
    add(teams,'br');
    add(teams,'small',row.tournament?.name_ch || row.tournament?.name_en);
    for (const [type,stage,threshold] of [[1,3,2],[1,5,3],[2,3,4],[2,5,9]]) {
      const value = formatResult(row,type,stage);
      const cell = add(tr,'td',value);
      const total = resultTotal(row,type,stage);
      if (total===null) continue;
      const meets = total>=threshold;
      cell.classList.add(meets ? 'meets-threshold' : 'below-threshold');
      cell.title = '合計 '+total+' · '+(meets ? '達標' : '未達標')+'（門檻 '+threshold+'）';
      cell.setAttribute('aria-label',value+'，'+cell.title);
    }
  }
}

async function loadPanels(target, match, start, sameSeason, signal, histories = []) {
  target.replaceChildren();
  await Promise.all(teamList(match).map(async (team,i)=>{
    const card = add(target,'article');
    add(card,'h3',(i===0?'主隊 · ':'客隊 · ')+teamName(team));
    const loading = add(card,'p','正在查閱馬會賽果…');
    try {
      const rows = await (histories[i] ?? history(team,match,start,sameSeason,signal));
      if (signal.aborted) return;
      loading.remove();
      if (!sameSeason && rows.length) {
        const hours = Math.round((kickoff(match)-kickoff(rows[0]))/3600000);
        add(card,'p','距上場開波約 '+Math.floor(hours/24)+' 日 '+hours%24+' 小時');
      }
      renderTable(card,rows,team.id);
    } catch (error) {
      if (!signal.aborted) loading.textContent = '未能載入賽果。' + error.message + '。請重新選擇或刷新。';
    }
  }));
}

function showMeetings(match, results, signal, loading=false) {
  if (signal.aborted) return;
  const target = element('meetings');
  target.replaceChildren();
  if (loading) {
    add(target,'p','正在檢查近期交手…');
    return;
  }
  const unique = new Map();
  for (const entry of results) {
    if (entry.status !== 'fulfilled') continue;
    for (const row of entry.value) {
      const both = teamList(match).every(team=>teamList(row).some(side=>side.id===team.id));
      if (both) unique.set(row.id,row);
    }
  }
  if (results.some(entry=>entry.status==='rejected')) add(target,'p','部分近期賽果載入失敗，交手紀錄可能未齊。');
  if (!unique.size) {
    add(target,'p','已載入嘅近期賽果未見兩隊交手。');
    return;
  }
  renderTable(target,[...unique.values()].sort((a,b)=>kickoff(b)-kickoff(a)));
}

let recentView;

async function showRecent() {
  if (!recentView) return;
  const {match,start,histories} = recentView;
  recentView.render?.abort();
  recentView.render = new AbortController();
  const signal = recentView.render.signal;
  const onlySame = element('sameOnly').checked;
  const code = match.tournament?.code;
  const count = Number(element('sampleSize').value);
  const visible = histories.map(promise=>promise.then(rows=>rows.slice(0,count).filter(row=>!onlySame || (code && row.tournament?.code===code))));
  showMeetings(match,[],signal,true);
  await Promise.all([
    loadPanels(element('recent'),match,start,onlySame,signal,visible),
    showScoreAnalysis(element('scoreAnalysis'),match,visible,signal),
    showComparison(match,visible,signal,histories),
    Promise.allSettled(visible).then(results=>showMeetings(match,results,signal))
  ]);
}

async function showSeason(match,start,signal,getMatch) {
  const target = element('same');
  target.replaceChildren();
  const status = element('seasonStatus');
  if (!match.tournament?.code) {
    status.textContent = '馬會未提供賽事代碼，暫時無法篩選同賽項。';
    element('expanded').textContent = '欠賽項代碼，暫未能取得同季攻守配對樣本。';
    return;
  }
  status.textContent = '正在配對今場賽季及歷史賽果…';
  let schedules = null;
  try {
    schedules = await seasonSchedules(await getMatch(match),signal);
  } catch {
    // The fallback is explicitly labelled as competition-only.
  }
  if (signal.aborted) return;
  status.textContent = schedules
    ? schedules[0].label+' · 以 ESPN 賽程核對同季，比分及角球來自馬會。'
    : '暫未能確認賽季。以下顯示過去 360 日同賽項紀錄，可能跨季。';
  const histories = teamList(match).map(async (team,i)=>{
    const schedule = schedules?.[i];
    const first = schedule ? Math.min(...schedule.events.map(event=>dayStart(localDay.format(Date.parse(event.date))))) : start;
    const rows = await history(team,match,first,true,signal);
    return schedule ? inSeason(rows,schedule.events) : rows;
  });
  await Promise.all([loadPanels(target,match,start,true,signal,histories),showExpanded(match,histories,Boolean(schedules),signal)]);
}

async function selectFixture() {
  recentView?.render?.abort();
  recentView = null;
  selection.abort();
  selection = new AbortController();
  const match = matches.find(m=>m.id===fixture.value);
  element('details').hidden = !match;
  if (!match) return;
  setMatchOverview(match);
  element('selected').textContent = name(match);
  const venue = match.venue?.name_ch || match.venue?.name_en;
  element('venue').textContent = venue ? '球場 '+venue : '馬會場次資料暫未有球場';
  showMeetings(match, [], selection.signal, true);
  element('expanded').textContent = '正在核對同球季資料…';
  element('meta').textContent =[match.frontEndId,match.tournament?.name_ch || match.tournament?.name_en,localTime.format(kickoff(match))+' 香港時間'].filter(Boolean).join(' · ');
  const start = dayStart(localDay.format(Math.min(Date.now(),kickoff(match))))-359*dayMs;
  const signal = selection.signal;
  const histories = teamList(match).map(team => history(team,match,start,false,signal));
  recentView = {match,start,histories};
  const getMatch = lookup(signal);
  await Promise.all([
    showRecent(),
    showLineups(element('lineups'),match,histories,signal,getMatch),
    showScorers(element('scorers'),match,signal,getMatch),
    showSeason(match,start,signal,getMatch)
  ]);
}

element('sameOnly').addEventListener('change',showRecent);
element('sampleSize').addEventListener('change',showRecent);
fixture.addEventListener('change',selectFixture);
refresh.addEventListener('click',loadFixtures);
loadFixtures();
