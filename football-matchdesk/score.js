import { confirmedResult } from './form.js';

function goalSample(rows,teamId) {
  return rows.flatMap(row=>{
    const score = confirmedResult(row,1,5);
    if (![score?.homeResult,score?.awayResult].every(value=>Number.isInteger(value) && value>=0)) return [];
    const home = row.homeTeam.id===teamId;
    return [{
      date:row.kickOffTime, home, opponent:(home?row.awayTeam:row.homeTeam).name_ch,
      scored:home?score.homeResult:score.awayResult,
      conceded:home?score.awayResult:score.homeResult
    }];
  });
}

function rates(rows,home) {
  const matching = rows.filter(row=>row.home===home);
  function average(key) {
    const all = rows.reduce((sum,row)=>sum+row[key],0)/rows.length;
    if (matching.length<3) return all;
    const split = matching.reduce((sum,row)=>sum+row[key],0)/matching.length;
    const weight = matching.length/(matching.length+4);
    return all*(1-weight)+split*weight;
  }
  return {scored:average('scored'),conceded:average('conceded'),split:matching.length};
}

function poisson(rate) {
  const values = [Math.exp(-rate)];
  for (let goals=1;goals<=Math.max(10,Math.ceil(rate)+1);goals++) {
    values.push(values[goals-1]*rate/goals);
  }
  return values;
}

export function scoreAnalysis(match,homeRows,awayRows) {
  const home = goalSample(homeRows,match.homeTeam.id);
  const away = goalSample(awayRows,match.awayTeam.id);
  if (Math.min(home.length,away.length)<5) return {home,away};
  const h = rates(home,true);
  const a = rates(away,false);
  const homeRate = (h.scored+a.conceded)/2;
  const awayRate = (a.scored+h.conceded)/2;
  const awayWeights = poisson(awayRate);
  const rankings = poisson(homeRate).flatMap((p,homeGoals)=>awayWeights
    .map((q,awayGoals)=>({score:homeGoals+'–'+awayGoals,weight:p*q})));
  rankings.sort((a,b)=>b.weight-a.weight);
  return {home,away,h,a,homeRate,awayRate,scores:rankings.slice(0,3)};
}

function add(parent,tag,value) {
  const node = document.createElement(tag);
  node.textContent = value;
  parent.append(node);
  return node;
}

export async function showScoreAnalysis(target,match,histories,signal) {
  target.replaceChildren();
  add(target,'p','正在等候兩隊賽果…');
  const results = await Promise.allSettled(histories);
  if (signal.aborted) return;
  target.replaceChildren();
  if (results.some(row=>row.status==='rejected')) {
    add(target,'p','有球隊嘅賽果載入失敗。請撳 REFRESH 再試。');
    return;
  }
  const [homeRows,awayRows] = results.map(row=>row.value);
  const analysis = scoreAnalysis(match,homeRows,awayRows);
  const title = [match.homeTeam,match.awayTeam].map(team=>team.name_ch || team.name_en).join(' vs ');
  add(target,'p','有效全場比分樣本 · 主隊 '+analysis.home.length+'/'+homeRows.length+' 場 · 客隊 '+analysis.away.length+'/'+awayRows.length+' 場');
  if (!analysis.scores) {
    add(target,'p','兩隊各要最少 5 場有完整全場比分，樣本暫時不足。');
    return;
  }
  const {h,a,homeRate,awayRate,scores} = analysis;
  const labels = scores.map(({score,weight})=>score+'（'+(weight*100).toFixed(1)+'%）');
  const line = add(target,'p','');
  add(line,'strong','模型首選 '+labels[0]);
  line.append(' · 其他較高排序 '+labels.slice(1).join('、')+'（主–客）');
  add(target,'p','百分比係每個確切比分嘅模型估算機率。');
  add(target,'p','主隊估算入球均值 '+homeRate.toFixed(2)+' · 客隊 '+awayRate.toFixed(2));
  add(target,'p','主隊近況入／失球 '+h.scored.toFixed(2)+'／'+h.conceded.toFixed(2)
    +' · 客隊 '+a.scored.toFixed(2)+'／'+a.conceded.toFixed(2)+'（已按可用主客樣本調整）');
  add(target,'p','主隊近期主場 '+h.split+' 場 · 客隊近期作客 '+a.split+' 場。每邊相關樣本滿 3 場先加權。');
  const details = add(target,'details','');
  add(details,'summary','用 ChatGPT 分析呢場比分');
  add(details,'p','複製以下資料到 ChatGPT，就可以就呢場再分析。');
  const prompt = [
    '用廣東話分析呢場足球比賽嘅全場比分。用以下資料說明支持與反對主要比分情境嘅證據及樣本限制。',
    '可以指出仲需要核實邊啲資料。請勿捏造傷停、陣容、賠率、概率或其他未提供資料。',
    '比賽：'+title+' · '+match.kickOffTime+' · '+(match.tournament?.name_ch || match.tournament?.name_en || ''),
    '每列比分按分析球隊入球–失球排列。',
    ...[['主隊',analysis.home],['客隊',analysis.away]].flatMap(([side,rows])=>[
      side+'近期有效比分：',
      ...rows.map(row=>[row.date,row.home?'主場':'作客',row.opponent || '',row.scored+'–'+row.conceded].join(' · '))
    ]),
    'Poisson 模型比分排序（主–客）：'+labels.join('、')+'。括號內係模型估算機率。模型入球均值 '+homeRate.toFixed(2)+'／'+awayRate.toFixed(2)+'。'
  ].join('\n');
  const input = add(details,'textarea','');
  input.value = prompt;
  input.readOnly = true;
  input.rows = 6;
  input.setAttribute('aria-label','可複製嘅比分分析資料');
  const copy = add(details,'button','複製分析資料');
  copy.type = 'button';
  const status = add(details,'p','');
  status.setAttribute('role','status');
  copy.addEventListener('click',async()=>{
    try {
      await navigator.clipboard.writeText(prompt);
      status.textContent = '已複製，可以貼到 ChatGPT。';
    } catch {
      input.select();
      status.textContent = '請複製已選取嘅文字。';
    }
  });
}
