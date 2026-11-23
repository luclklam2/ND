import { confirmedResult, resultTotal } from './form.js';

export function cornerAnalysis(match,homeRows,awayRows) {
  const sample = (rows,teamId)=>rows.flatMap(row=>{
    const total = resultTotal(row,2,5);
    if (total===null) return [];
    const pair = confirmedResult(row,2,5);
    const validPair = [pair.homeResult,pair.awayResult].every(n=>Number.isInteger(n) && n>=0);
    const home = row.homeTeam.id===teamId;
    return [{id:row.id,total,home,
      scored:validPair ? (home?pair.homeResult:pair.awayResult) : null,
      conceded:validPair ? (home?pair.awayResult:pair.homeResult) : null}];
  });
  const home = sample(homeRows,match.homeTeam.id);
  const away = sample(awayRows,match.awayTeam.id);
  const unique = [...new Map([...home,...away].map(row=>[row.id,row])).values()];
  return {home,away,unique};
}

function showCorners(target,match,homeRows,awayRows) {
  add(target,'h3','全場角球分析');
  const {home,away,unique} = cornerAnalysis(match,homeRows,awayRows);
  add(target,'p','有效角球樣本 · 主隊 '+home.length+'/'+homeRows.length+' 場 · 客隊 '+away.length+'/'+awayRows.length+' 場');
  for (const [label,rows] of [['主隊',home],['客隊',away]]) {
    if (!rows.length) continue;
    const mean = key=>rows.reduce((sum,row)=>sum+row[key],0)/rows.length;
    const pairs = rows.filter(row=>row.scored!==null);
    let text = label+'近期比賽總角球場均 '+mean('total').toFixed(2);
    if (pairs.length) {
      const own = key=>(pairs.reduce((sum,row)=>sum+row[key],0)/pairs.length).toFixed(2);
      text+=' · 取得／失去 '+own('scored')+'／'+own('conceded')+'（'+pairs.length+' 場分隊角球）';
    }
    add(target,'p',text);
  }
  if (Math.min(home.length,away.length)<5) {
    add(target,'p','兩隊各要最少 5 場有效全場角球，暫未提供總角球參考。');
    return;
  }
  const average = rows=>rows.reduce((sum,row)=>sum+row.total,0)/rows.length;
  add(target,'p','兩隊近期總角球均值參考 '+((average(home)+average(away))/2).toFixed(2)+' 球');
  add(target,'p','歷史總角球高於指定線嘅場次（重複交手只計一次，共 '+unique.length+' 場）');
  const list = add(target,'ul','');
  for (const line of [8.5,9.5,10.5,11.5]) {
    const count = unique.filter(row=>row.total>line).length;
    add(list,'li','大 '+line+' · '+count+'/'+unique.length+' 場（'+(count/unique.length*100).toFixed(1)+'%）');
  }
  add(target,'small','以上係歷史樣本比例及均值。今場角球機率、盤口價值及輪換影響有待另行評估。');
}

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
  if(tag==='details') node.open=true;
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
  const goals = add(target,'div','');
  const cornerColumn = add(target,'div','');
  const corners = add(cornerColumn,'details','');
  add(corners,'summary','角球詳細樣本及其他盤線');
  showCorners(corners,match,homeRows,awayRows);
  target = goals;
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
  details.open=false;
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
