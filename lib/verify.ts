import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildRadar, boardIssue, computeRadar, dataScript } from './model.ts';
import type { Snapshot } from './model.ts';

/** Refit, compare an independent closed-form OLS and test the actual browser serialization. */
export function selftest(snapshot: Snapshot): void {
  const first = buildRadar(snapshot), second = buildRadar(snapshot);
  assert.deepEqual(first, second, 'deterministic rebuild');
  const {board, radar:r} = second;
  assert.equal(boardIssue(board, snapshot), null);
  assert.ok(Object.values(r.checks).every(Boolean), 'all engine checks');
  assert.equal(r.lanes.reduce((n, l) => n+l.count, 0), snapshot.protocols.length);
  assert.equal(new Set(r.protocols.map(p=>p.slug)).size, snapshot.protocols.length);
  assert.ok(snapshot.watchlist.every(s=>board.some(p=>p.slug===s)));
  for(const p of r.protocols) {
    assert.deepEqual(p.raw, snapshot.protocols.find(q=>q.slug===p.slug));
    assert.ok(p.value.low <= p.value.point && p.value.point <= p.value.high, 'range brackets fit');
    assert.ok(p.odds.probability>0 && p.odds.probability<1);
    const f=p.farm;
    assert.ok(Math.abs(f.gas+f.fees+f.opportunity+f.risk-f.total_cost)<1e-9);
    assert.ok(Math.abs((f.expected-f.total_cost)/f.hours-f.hourly)<1e-9);
    assert.ok(Math.abs(f.break_even_share*p.value.point*p.odds.probability-f.total_cost)<1e-9);
    if(f.verdict==='FARM') assert.ok(f.hourly>=15 && !f.restricted && p.lane==='ranked');
  }
  const target=board[0].slug;
  let last=1;
  for(const days of [30,179,180,364,365,729,730,1459,1460,2920]) {
    const s=structuredClone(snapshot);
    s.protocols.find(p=>p.slug===target)!.listed_at=new Date(Date.parse(s.as_of+'T00:00:00Z')-days*86400000).toISOString().slice(0,10);
    const odds=buildRadar(s).radar.protocols.find(p=>p.slug===target)!.odds.probability;
    assert.ok(odds<=last+1e-12, 'launch odds must not rise with age');last=odds;
  }
  // Independent analytic fit verifies the selected one-variable model and BOTH held-out scores.
  if(r.model.selected.length===1 && r.model.selected[0]==='log TVL') {
    const anchors=snapshot.protocols.filter(p=>p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0).sort((a,b)=>a.slug<b.slug?-1:a.slug>b.slug?1:0);
    const fit=(ps: typeof anchors)=>{
      const xs=ps.map(p=>Math.log(p.tvl_usd/1e8)),ys=ps.map(p=>Math.log(p.mcap_usd!));
      const mx=xs.reduce((a,b)=>a+b,0)/ps.length,my=ys.reduce((a,b)=>a+b,0)/ps.length;
      const slope=xs.reduce((a,x,i)=>a+(x-mx)*(ys[i]-my),0)/xs.reduce((a,x)=>a+(x-mx)**2,0);
      return [my-slope*mx,slope];
    };
    const pred=(p: typeof anchors[number], b: number[])=>b[0]+b[1]*Math.log(p.tvl_usd/1e8);
    const median=(a: number[])=>{a.sort((a,b)=>a-b);const i=(a.length-1)/2;return (a[Math.floor(i)]+a[Math.ceil(i)])/2;};
    const b=fit(anchors);b.forEach((x,i)=>assert.ok(Math.abs(x-r.model.coefficients[i])<1e-10,'closed-form fit matches QR'));
    const loo=anchors.map((p,i)=>Math.abs(Math.log(p.mcap_usd!)-pred(p,fit(anchors.filter((_,j)=>i!==j)))));
    assert.ok(Math.abs(Math.exp(median(loo))-r.model.loo.median_factor)<1e-9,'independent LOO');
    const dated=anchors.filter(p=>p.listed_at!==null).sort((a,b)=>a.listed_at!<b.listed_at!?-1:a.listed_at!>b.listed_at!?1:a.slug<b.slug?-1:1),cut=Math.floor(dated.length*.7),wfFit=fit(dated.slice(0,cut));
    const errors=dated.slice(cut).map(p=>Math.abs(Math.log(p.mcap_usd!)-pred(p,wfFit)));
    assert.ok(Math.abs(Math.exp(median(errors))-r.model.walk.median_factor)<1e-9,'independent walk-forward');
  }
  const context={window:{}};
  vm.runInNewContext(dataScript(r),context,{timeout:10000});
  const browser=context.window as {RADAR:typeof r;rebuildRadar:typeof computeRadar};
  const rebuilt=browser.rebuildRadar(browser.RADAR.snapshot);
  assert.equal(JSON.stringify(rebuilt.board),JSON.stringify(board),'serialized browser engine matches Node board');
  assert.equal(JSON.stringify(rebuilt.radar.model),JSON.stringify(r.model),'serialized engine reruns held-out tests');
  console.log(`SELFTEST PASS: ${board.length} ranked; ${snapshot.watchlist.length}/${snapshot.watchlist.length} watchlist; ${snapshot.protocols.length} accounted for.`);
  console.log(`LOO median error ×${r.model.loo.median_factor.toFixed(6)} (${r.model.loo.n} held-out fits), RMS log ${r.model.loo.rms_log.toFixed(6)}.`);
  console.log(`Walk-forward median error ×${r.model.walk.median_factor.toFixed(6)} (${r.model.walk_split.train} train / ${r.model.walk_split.test} test), RMS log ${r.model.walk.rms_log.toFixed(6)}.`);
  console.log('Terms kept:',r.model.selected.join(', '));
  for(const a of r.model.ablations)console.log(`${a.kept?'KEEP':'DROP'} ${a.term}: trial LOO ×${a.forward.after_loo.toFixed(4)}, walk ×${a.forward.after_walk.toFixed(4)}`);
  console.log('Lanes:',r.lanes.map(l=>`${l.id}=${l.count}`).join(', '));
}
