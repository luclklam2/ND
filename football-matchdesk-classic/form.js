export function confirmedResult(row,type,stage) {
  return (row.results ?? []).filter(r=>r.payoutConfirmed && r.resultType===type && r.stageId===stage)
    .sort((a,b)=>b.sequence-a.sequence)[0];
}

const valid = n => Number.isInteger(n) && n>=0;

export function formatResult(row,type,stage) {
  const record = confirmedResult(row,type,stage);
  if (!record) return '—';
  if (valid(record.homeResult) && valid(record.awayResult)) return record.homeResult+'–'+record.awayResult;
  return type===2 && valid(record.ttlCornerResult) ? '合計 '+record.ttlCornerResult : '—';
}

export function resultTotal(row,type,stage) {
  const record = confirmedResult(row,type,stage);
  if (!record) return null;
  if (valid(record.homeResult) && valid(record.awayResult)) return record.homeResult+record.awayResult;
  return type===2 && valid(record.ttlCornerResult) ? record.ttlCornerResult : null;
}

function tally(rows,teamId,type,stage) {
  let pairs=0, samples=0, scored=0, conceded=0, total=0, wins=0, draws=0, losses=0;
  for (const row of rows) {
    const r = confirmedResult(row,type,stage);
    if (!r) continue;
    if (valid(r.homeResult) && valid(r.awayResult)) {
      const home = row.homeTeam.id===teamId;
      const own = home ? r.homeResult : r.awayResult;
      const other = home ? r.awayResult : r.homeResult;
      pairs++;
      samples++;
      scored+=own;
      conceded+=other;
      total+=own+other;
      if (own>other) wins++;
      else if (own===other) draws++;
      else losses++;
    } else if (type===2 && valid(r.ttlCornerResult)) {
      samples++;
      total+=r.ttlCornerResult;
    }
  }
  return {pairs,samples,scored,conceded,total,wins,draws,losses};
}

const average = (sum,count) => count ? (sum/count).toFixed(1) : '—';

export function summarize(rows,teamId) {
  const full = tally(rows,teamId,1,5);
  const half = tally(rows,teamId,1,3);
  const corners = tally(rows,teamId,2,5);
  const halfCorners = tally(rows,teamId,2,3);
  return [
    ['全場勝／和／負',full.samples ? [full.wins,full.draws,full.losses].join('／') : '—',full.samples],
    ['半場領先／打和／落後',half.samples ? [half.wins,half.draws,half.losses].join('／') : '—',half.samples],
    ['場均全場入球／失球',average(full.scored,full.pairs)+'／'+average(full.conceded,full.pairs),full.pairs],
    ['場均半場總角球',average(halfCorners.total,halfCorners.samples),halfCorners.samples],
    ['場均全場總角球',average(corners.total,corners.samples),corners.samples],
    ['場均全場角球取得／失去',average(corners.scored,corners.pairs)+'／'+average(corners.conceded,corners.pairs),corners.pairs]
  ];
}
