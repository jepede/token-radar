/** Pure deterministic engine. Its exact function body is shipped in data.js and rerun by the page. */
export interface SnapshotProtocol {
  slug: string; name: string; category: string | null; chains: string[]; tvl_usd: number;
  change_7d: number | null; mcap_usd: number | null; listed_at: string | null;
  gecko_id: string | null; symbol: string | null;
}
export interface Snapshot { as_of: string; source: string; floor_usd: number; protocols: SnapshotProtocol[]; watchlist: string[] }

export function computeRadar(snapshot: Snapshot) {
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const day = (date) => Date.parse(date.length === 10 ? date + 'T00:00:00Z' : date);
  const age = (p) => p.listed_at && Number.isFinite(day(p.listed_at)) ? Math.max(0, Math.floor((day(snapshot.as_of) - day(p.listed_at)) / 86400000)) : null;
  const hasToken = (p) => p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
  const structuralLane = (p) => {
    if (p.category === 'CEX') return 'exchange';
    if (['Bridge', 'Canonical Bridge'].includes(p.category)) return 'bridge';
    if (['Liquid Staking', 'Liquid Restaking', 'Restaked BTC'].includes(p.category)) return 'staking';
    if (/\b(wrapped|staked|staking)\b/i.test(p.name) || /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i.test(p.name)) return 'derivative';
    if (/\s(?:v\d+(?:\.\d+)?|\d+\.\d+)$/i.test(p.name)) return 'versioned';
    return null;
  };
  const laneFor = (p) => hasToken(p) ? 'token' : structuralLane(p) || (p.tvl_usd < 5000000 ? 'small' : 'ranked');
  const laneInfo = [
    ['ranked', 'Pre-token radar', 'No token recorded; independent category/name screen; TVL at least $5M.'],
    ['token', 'Token recorded', 'A market cap, CoinGecko ID or symbol is present. No new-token valuation claim.'],
    ['exchange', 'Exchanges', 'Centralized exchange balances are not independent DeFi launch candidates.'],
    ['bridge', 'Bridges', 'Bridge or Canonical Bridge category; balances can represent existing tokens.'],
    ['staking', 'Staking derivatives', 'Liquid Staking, Liquid Restaking or Restaked BTC category.'],
    ['derivative', 'Named derivatives', 'Whole-word wrapped/staked/staking, or an exchange-prefixed product.'],
    ['versioned', 'Versioned products', 'Name ends in Vn, vn or n.n: a product version, not a distinct launch.'],
    ['small', 'Below $5M floor', 'Under the fixed $5M research floor; retained in the full universe.'],
  ];
  const family = (p) => {
    const c = p.category || '';
    if (/Lending|CDP|Collateral/.test(c)) return 'Credit';
    if (/Dexs|Derivatives|Options|Prediction|OTC/.test(c)) return 'Trading';
    if (/RWA/.test(c)) return 'RWA';
    if (/Curator|Allocator|Manager/.test(c)) return 'Allocation';
    if (/Yield|Farm|Basis|CeDeFi/.test(c)) return 'Yield';
    return 'Other';
  };
  const terms = ['log TVL', 'Category', '7d change', 'Listed age', 'Chain count'];
  const features = (p, selected) => {
    const x = [1];
    for (const term of selected) {
      if (term === 'log TVL') x.push(Math.log(Math.max(1, p.tvl_usd) / 1e8));
      if (term === 'Category') for (const f of ['Credit', 'Trading', 'RWA', 'Allocation', 'Yield']) x.push(family(p) === f ? 1 : 0);
      if (term === '7d change') x.push(Math.asinh(clamp(p.change_7d ?? 0, -100, 500) / 25));
      if (term === 'Listed age') x.push(Math.log1p((age(p) ?? 365) / 365));
      if (term === 'Chain count') x.push(Math.log(Math.max(1, p.chains.length)));
    }
    return x;
  };
  const labels = (selected) => ['Intercept', ...selected.flatMap(t => t === 'Category' ? ['Credit', 'Trading', 'RWA', 'Allocation', 'Yield'].map(f => 'Category: ' + f) : [t])];
  // Reorthogonalized modified Gram-Schmidt QR: genuine OLS, no fitted penalty or dependency.
  // Rank-deficient columns get zero coefficients; unseen categories fall back to Other.
  const ols = (records, selected) => {
    const X = records.map(p => features(p, selected));
    const y = records.map(p => Math.log(p.mcap_usd));
    const k = X[0].length, R = Array.from({ length: k }, () => Array(k).fill(0)), Q = [], z = [];
    for (let j = 0; j < k; j++) {
      const v = X.map(x => x[j]);
      for (let pass = 0; pass < 2; pass++) for (let i = 0; i < j; i++) {
        const r = v.reduce((a, b, n) => a + b * Q[i][n], 0);
        R[i][j] += r;
        for (let n = 0; n < v.length; n++) v[n] -= r * Q[i][n];
      }
      const norm = Math.sqrt(v.reduce((s, a) => s + a * a, 0));
      R[j][j] = norm > 1e-9 ? norm : 0;
      Q[j] = v.map(a => norm > 1e-9 ? a / norm : 0);
      z[j] = Q[j].reduce((s, a, n) => s + a * y[n], 0);
    }
    const b = Array(k).fill(0);
    for (let i = k - 1; i >= 0; i--) b[i] = R[i][i] ? (z[i] - b.reduce((s, v, j) => s + (j > i ? R[i][j] * v : 0), 0)) / R[i][i] : 0;
    return b;
  };
  const predict = (p, selected, b) => features(p, selected).reduce((s, x, j) => s + x * b[j], 0);
  const quantile = (a, q) => { const x = a.slice().sort((a, b) => a - b), at = (x.length - 1) * q, i = Math.floor(at); return x[i] + (x[Math.ceil(at)] - x[i]) * (at - i); };
  const score = (errors) => ({ n: errors.length, rms_log: Math.sqrt(errors.reduce((s, x) => s + x * x, 0) / errors.length), median_factor: Math.exp(quantile(errors.map(Math.abs), .5)), p80_factor: Math.exp(quantile(errors.map(Math.abs), .8)) });
  const anchors = snapshot.protocols.filter(p => p.mcap_usd > 0 && p.tvl_usd > 0).sort((a, b) => order(a.slug, b.slug));
  if (anchors.length < 12) throw new Error('Need at least 12 positive market-cap anchors to fit and validate.');
  const dated = anchors.filter(p => age(p) !== null).sort((a, b) => order(a.listed_at, b.listed_at) || order(a.slug, b.slug));
  const cut = Math.floor(dated.length * .7), train = dated.slice(0, cut), test = dated.slice(cut);
  if (train.length < 8 || test.length < 3) throw new Error('Insufficient dated anchors for walk-forward validation.');
  const evaluate = (selected) => {
    const loo = anchors.map((p, i) => Math.log(p.mcap_usd) - predict(p, selected, ols(anchors.filter((_, j) => i !== j), selected)));
    const b = ols(train, selected);
    const wf = test.map(p => Math.log(p.mcap_usd) - predict(p, selected, b));
    return { loo: score(loo), walk: score(wf), residuals: loo };
  };
  let selected = [], current = evaluate([]);
  const baseline = current, trials = [];
  for (const term of terms) {
    const result = evaluate([...selected, term]);
    const keep = result.loo.median_factor < current.loo.median_factor - 1e-10 && result.walk.median_factor < current.walk.median_factor - 1e-10;
    trials.push({ term, keep, before_loo: current.loo.median_factor, after_loo: result.loo.median_factor, before_walk: current.walk.median_factor, after_walk: result.walk.median_factor });
    if (keep) { selected.push(term); current = result; }
  }
  // Backward audit: every final retained term must also help BOTH tests in the final model.
  let changed = true;
  while (changed) {
    changed = false;
    for (const term of selected.slice()) {
      const reduced = evaluate(selected.filter(t => t !== term));
      if (!(current.loo.median_factor < reduced.loo.median_factor - 1e-10 && current.walk.median_factor < reduced.walk.median_factor - 1e-10)) {
        selected = selected.filter(t => t !== term); current = reduced; changed = true;
      }
    }
  }
  const ablations = terms.map(term => {
    const kept = selected.includes(term), result = evaluate(kept ? selected.filter(t => t !== term) : [...selected, term]);
    return { term, kept, loo: result.loo, walk: result.walk, comparison: kept ? 'without term' : 'with term', forward: trials.find(t => t.term === term) };
  });
  const coefficients = ols(anchors, selected), names = labels(selected);
  const residualLow = quantile(current.residuals, .1), residualHigh = quantile(current.residuals, .9);
  const model = { version: 'SIGNAL / 01', anchors: anchors.length, anchor_slugs: anchors.map(p => p.slug), selected, coefficients, labels: names, baseline: { loo: baseline.loo, walk: baseline.walk }, loo: current.loo, walk: current.walk, ablations, residualLow, residualHigh,
    walk_split: { train: train.length, test: test.length, unknown_dates: anchors.length - dated.length, last_train: train.at(-1).listed_at, first_test: test[0].listed_at },
    anchor_tvl: [Math.min(...anchors.map(p => p.tvl_usd)), Math.max(...anchors.map(p => p.tvl_usd))] };
  const valuation = (p) => {
    const x = features(p, selected), log = predict(p, selected, coefficients);
    return { point: Math.max(1, Math.round(Math.exp(clamp(log, 0, Math.log(1e14))))), low: Math.max(1, Math.round(Math.exp(clamp(log + residualLow, 0, Math.log(1e14))))), high: Math.max(1, Math.round(Math.exp(clamp(log + residualHigh, 0, Math.log(1e14))))), log,
      decomposition: names.map((name, j) => ({ term: name, input: x[j], coefficient: coefficients[j], contribution: x[j] * coefficients[j], multiplier: Math.exp(x[j] * coefficients[j]) })),
      extrapolated: p.tvl_usd < model.anchor_tvl[0] || p.tvl_usd > model.anchor_tvl[1], category_family: family(p) };
  };
  const peerUniverse = snapshot.protocols.filter(p => !structuralLane(p) && p.tvl_usd >= 5000000);
  const ageBand = (d) => d < 180 ? 0 : d < 365 ? 1 : d < 730 ? 2 : d < 1460 ? 3 : 4;
  const ageLabels = ['<180d', '180–364d', '1–2y', '2–4y', '4y+'];
  const sizeBand = (p) => p.tvl_usd < 5e7 ? '<$50M' : p.tvl_usd < 2.5e8 ? '$50–250M' : '$250M+';
  const count = (ps) => ({ n: ps.length, k: ps.filter(hasToken).length });
  const oddsFor = (p) => {
    const peers = peerUniverse.filter(q => q.slug !== p.slug), g = count(peers), global = (g.k + 1) / (g.n + 2);
    const categoryPeers = peers.filter(q => q.category === p.category), cat = count(categoryPeers), catRate = (cat.k + 12 * global) / (cat.n + 12);
    const similar = categoryPeers.filter(q => sizeBand(q) === sizeBand(p)), base = count(similar), prior = (base.k + 8 * catRate) / (base.n + 8);
    const days = age(p), band = ageBand(days ?? 365), cohorts = [];
    let monotone = 1;
    for (let a = 0; a <= band; a++) {
      const c = count(similar.filter(q => age(q) !== null && ageBand(age(q)) === a));
      const posterior = (c.k + 8 * prior) / (c.n + 8);
      monotone = Math.min(monotone, posterior); cohorts.push({ band: ageLabels[a], ...c, posterior });
    }
    const adjustedOdds = (monotone / (1 - monotone)) / (1 + (days ?? 365) / 730);
    const probability = adjustedOdds / (1 + adjustedOdds), cohort = cohorts.at(-1);
    return { probability, age_band: days === null ? 'unknown → 1–2y' : ageLabels[band], size_band: sizeBand(p), category: p.category, cohort, cohorts, category_peers: cat, size_peers: base, global_peers: g, prior, monotone_rate: monotone, age_discount: 1 / (1 + (days ?? 365) / 730), sparse: cohort.n < 8 };
  };
  const assumptions = { capital: 500, hold_days: 30, hours: 2, transactions: 8, app_fee_rate: .0025, opportunity_apr: .05, risk_reserve_rate: .01, share_low: .000002, share: .00001, share_high: .00002, minimum_hourly: 15,
    fee_tiers: { Ethereum: 3.5, Bitcoin: 2, Solana: .03, Sui: .03, Aptos: .03, Stellar: .03, Algorand: .03, Base: .15, Arbitrum: .15, Optimism: .15, Polygon: .15, Binance: .15, Avalanche: .15, 'Hyperliquid L1': .15, Monad: .15, unknown: 1 } };
  const planFor = (p, v, o, ranked) => {
    const chain = p.chains[0] || 'Unspecified', gasEach = assumptions.fee_tiers[chain] ?? assumptions.fee_tiers.unknown;
    const gas = gasEach * assumptions.transactions, fees = assumptions.capital * assumptions.app_fee_rate, opportunity = assumptions.capital * assumptions.opportunity_apr * assumptions.hold_days / 365, risk = assumptions.capital * assumptions.risk_reserve_rate;
    const total = gas + fees + opportunity + risk;
    const expected = v.point * o.probability * assumptions.share, low = v.low * o.probability * assumptions.share_low, high = v.high * o.probability * assumptions.share_high;
    const net = expected - total, hourly = net / assumptions.hours, breakEven = total / (v.point * o.probability);
    const restricted = /RWA|OTC|Insurance|Chain|Payments|Crypto Card|Staking Pool|Anchor BTC|Decentralized BTC/.test(p.category || '');
    const verdict = !ranked || restricted || hourly <= 0 ? 'SKIP' : hourly >= assumptions.minimum_hourly ? 'FARM' : 'THIN';
    const c = p.category || '', name = p.name;
    let action;
    if (/Curator|Allocator|Manager|Yield|Farm|Basis|CeDeFi/.test(c)) action = `Find a public ${name} vault on ${chain}; inspect its underlying strategy and withdrawal terms. If a retail deposit is supported, deposit $500 of an accepted asset; do not assume USDC is supported.`;
    else if (/Lending|Collateral/.test(c)) action = `In ${name} on ${chain}, select a liquid supported supply market, confirm its utilization and caps, and supply $500. Avoid borrowing or leverage for speculative eligibility.`;
    else if (/CDP|Stablecoin/.test(c)) action = `Inspect ${name}'s mint/redeem rules on ${chain}; test the minimum redeemable amount before allocating the $500 budget. Use only supported collateral and stay below 20% LTV if debt is required.`;
    else if (/Dexs|Liquidity/.test(c)) action = `On ${name} (${chain}), inspect a deep pool and make one small $50 swap; supply up to the $500 budget only to a pair whose price risk you accept. Budget for slippage and impermanent loss.`;
    else if (/Derivatives|Options/.test(c)) action = `Inspect ${name} on ${chain}, its margin rules and maker fees. Test a $50 collateral deposit and one minimum-size trade only if competent with the product; allocate at most $500 and avoid leverage.`;
    else if (/Restaking/.test(c)) action = `Review ${name}'s operator, slashing and withdrawal terms on ${chain}. If a supported collateral pool is open, allocate at most $500 and record the receipt token; never count underlying and receipt as two deposits.`;
    else if (/Prediction/.test(c)) action = `Check legal access to ${name} and supported ${chain} funding. Use at most $25 of the $500 budget on one position you understand; the position can lose its entire stake.`;
    else if (restricted) action = `Verify ${name}'s retail access, asset minimums and legal restrictions on ${chain}. Do not allocate the $500 scenario until a suitable public product and eligibility are independently confirmed.`;
    else action = `Inspect ${name}'s actual product on ${chain}; confirm a retail action and a reversible test transaction before committing any of the $500 budget. Snapshot metadata alone does not confirm eligibility.`;
    const steps = [
      `Verify ${name}'s official app through independently checked documentation. Check live token status, retail access, audits, accepted assets and any published rewards rules; no program is confirmed by this snapshot.`,
      action,
      `If eligible, keep the position for 30 days and review it weekly. Make only four economically useful follow-up actions; the full scenario allows 8 transactions on ${chain} at $${gasEach.toFixed(2)} each ($${gas.toFixed(2)} gas total).`,
      `Log wallet, deposits and transaction IDs. Budget $${fees.toFixed(2)} app fees, $${opportunity.toFixed(2)} capital opportunity cost and $${risk.toFixed(2)} risk reserve, plus gas: $${total.toFixed(2)} modeled cost and 2 active hours.`,
      `After 30 days, test withdrawal and revoke unused allowances. Check rewards only via verified documentation; do not pay a claim fee to an unsolicited site. Any reward is speculative, with zero airdrop as a valid outcome.`,
    ];
    return { verdict, restricted, reason: !ranked ? 'Excluded from the pre-token board.' : restricted ? 'Retail access or product fit is unverified; research only.' : hourly <= 0 ? 'Central reward does not cover modeled costs.' : hourly < assumptions.minimum_hourly ? 'Positive central net, below the $15/hour hurdle.' : 'Central net clears $15/hour; verify live eligibility first.', chain, fee_tier: Object.hasOwn(assumptions.fee_tiers, chain) ? chain : 'unknown', capital: assumptions.capital, hours: assumptions.hours, gas, fees, opportunity, risk, total_cost: total, expected, low, high, net, hourly, break_even_share: breakEven, hurdle_share: (total + 15 * assumptions.hours) / (v.point * o.probability), steps };
  };
  const risksFor = (p, v, o, f) => [
    'No token recorded is a metadata statement, not proof of no token or a promised launch. Parent relationships are absent from the sealed input; name/category screening cannot detect every subsidiary.',
    'Implied value estimates current circulating market cap conditional on a token existing, not FDV, a launch price or a liquid airdrop allocation. TVL may be recursive or double counted.',
    'The 80% range is empirical held-out anchor residuals, not guaranteed future coverage. Term selection uses these same tests; reported scores have selection optimism and domain-shift risk.',
    `Launch odds are a cross-sectional heuristic, not a calibrated forecast. Listing age is not founding age. ${o.sparse ? 'Sparse cohort: prior assumptions dominate this estimate.' : 'Peer counts still include survivor and selection bias.'}`,
    'Airdrop share, gas, fees, holding period and risk reserve are uniform scenarios, not observed eligibility. Rewards can be zero; capital losses can exceed the 1% modeling reserve.',
    ...(p.category === 'Risk Curators' ? ['Curator TVL is managed third-party capital, not necessarily a deposit product or token claim. Verify a public vault and who would issue a reward.'] : []),
    ...(f.restricted ? ['Product access is unverified or restricted; scenario economics do not authorize a deposit.'] : []),
    ...(v.extrapolated ? ['TVL falls outside the anchor range: this is extrapolation.'] : []),
  ];
  const protocols = snapshot.protocols.map(p => {
    const lane = laneFor(p), value = valuation(p), odds = oddsFor(p), farm = planFor(p, value, odds, lane === 'ranked');
    return { ...p, raw: p, lane, lane_reason: laneInfo.find(l => l[0] === lane)[2], rank: null, age_days: age(p), watchlist: snapshot.watchlist.includes(p.slug), implied_value_usd: value.point, value, odds, farm, risks: risksFor(p, value, odds, farm) };
  });
  const rows = protocols.filter(p => p.lane === 'ranked').sort((a, b) => b.implied_value_usd - a.implied_value_usd || order(a.slug, b.slug));
  rows.forEach((p, i) => { p.rank = i + 1; });
  const board = rows.map(p => ({ rank: p.rank, ...p.raw, token_status: 'pre-token', age_days: p.age_days, implied_value_usd: p.implied_value_usd, implied_low_usd: p.value.low, implied_high_usd: p.value.high, model: p.value, launch_odds: p.odds, farm: p.farm, farm_steps: p.farm.steps }));
  const lanes = laneInfo.map(([id, label, reason]) => ({ id, label, reason, count: protocols.filter(p => p.lane === id).length }));
  const checks = { coverage: lanes.reduce((s, l) => s + l.count, 0) === snapshot.protocols.length && new Set(protocols.map(p => p.slug)).size === snapshot.protocols.length,
    watchlist: snapshot.watchlist.every(slug => rows.some(p => p.slug === slug)),
    ranks: board.every((p, i) => p.rank === i + 1 && (!i || board[i - 1].implied_value_usd >= p.implied_value_usd)),
    finite: protocols.every(p => Number.isFinite(p.value.point) && Number.isFinite(p.farm.hourly) && p.odds.probability > 0 && p.odds.probability < 1),
    retained_terms: ablations.filter(a => a.kept).every(a => current.loo.median_factor < a.loo.median_factor && current.walk.median_factor < a.walk.median_factor),
    farm_math: protocols.every(p => Math.abs(p.farm.net - (p.farm.expected - p.farm.total_cost)) < 1e-7),
  };
  return { board, radar: { as_of: snapshot.as_of, source: snapshot.source, snapshot, model, assumptions, lanes, checks, protocols, board_size: board.length, early_size: rows.filter(p => !p.watchlist).length, live_size: lanes.find(l => l.id === 'token').count, watchlist_size: snapshot.watchlist.length, verdicts: ['FARM', 'THIN', 'SKIP'].map(v => ({ verdict: v, count: rows.filter(p => p.farm.verdict === v).length })) } };
}
export const buildRadar = computeRadar;

export function parseSnapshot(text: string): Snapshot {
  const s = JSON.parse(text);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s.as_of) || !Number.isFinite(Date.parse(s.as_of)) || typeof s.source !== 'string' || !Number.isFinite(s.floor_usd) || !Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) throw new Error('Invalid snapshot shape');
  const ids = new Set();
  for (const p of s.protocols) {
    if (!p || typeof p.slug !== 'string' || ids.has(p.slug) || typeof p.name !== 'string' || !Number.isFinite(p.tvl_usd) || !Array.isArray(p.chains)) throw new Error('Invalid or duplicate protocol');
    ids.add(p.slug);
    for (const k of ['mcap_usd', 'change_7d']) if (p[k] !== null && !Number.isFinite(p[k])) throw new Error('Invalid ' + k);
    for (const k of ['listed_at', 'symbol', 'gecko_id', 'category']) if (p[k] !== null && typeof p[k] !== 'string') throw new Error('Invalid ' + k);
  }
  if (s.watchlist.some(x => !ids.has(x)) || new Set(s.watchlist).size !== s.watchlist.length) throw new Error('Invalid watchlist');
  return s;
}
export function boardIssue(board: ReturnType<typeof computeRadar>['board'], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return 'Expected 100–4000 ranked rows';
  const ids = new Set(board.map(p => p.slug));
  if (ids.size !== board.length || snapshot.watchlist.some(x => !ids.has(x))) return 'Coverage or uniqueness failed';
  for (let i = 0; i < board.length; i++) {
    const p = board[i];
    if (p.rank !== i + 1 || !Number.isSafeInteger(p.implied_value_usd) || p.implied_value_usd < 1 || p.implied_value_usd > 1e14 || (i && p.implied_value_usd > board[i - 1].implied_value_usd)) return 'Rank/value failed';
    if (p.farm_steps.length < 3 || p.farm_steps.length > 12 || p.farm_steps.some(s => s.trim().length < 20 || s.trim().length > 600)) return 'Farm steps failed: ' + p.slug;
  }
  if (board[0].implied_value_usd === board.at(-1).implied_value_usd) return 'No valuation differentiation';
  return null;
}
export function dataScript(radar: ReturnType<typeof computeRadar>['radar']): string {
  return `window.RADAR=${JSON.stringify(radar).replace(/</g, '\\u003c')};\nwindow.rebuildRadar=${computeRadar.toString()};\n`;
}
