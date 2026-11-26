# SIGNAL — token-radar v1

A fully offline token launch research terminal built from the sealed DefiLlama snapshot. Node 22 and the standard library are the complete build/runtime dependency set. No live requests, external fonts, hosted assets or hard-coded protocol valuations.

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out /home/hatch/tools/node22/bin/node main.ts \
  --input ../kit/token-radar-01-kit/input/snapshot.json --selftest
```

Open `out/dashboard/index.html` directly. The accompanying `out/data.js` embeds the snapshot, generated results and the exact pure scoring engine. The browser reruns that engine and validates the board and held-out scores on load. All filters work from a local file. Detail views and filtered views have shareable hash routes. CSV exports contain the current filtered set.

The build preserves the main.ts input/output contract and vendored dossier library. It writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json`. The vendored library and all original dossier caps are unchanged. The HTML source also includes a generated build audit so its numerical evidence remains in the text dossier.

On the provided 2026-11-14 snapshot:

- 758 records: 198 ranked, 416 token-recorded, 42 exchanges, 43 bridges, 43 staking derivatives, 5 named derivatives, 11 versioned products, 0 below the $5M research floor.
- All 40 watchlist slugs are ranked; 158 further protocols are ranked.
- 128 positive-market-cap anchors. Reorthogonalized QR ordinary least squares fits log market cap. Median multiplicative error is ×3.398721 in leave-one-out validation and ×3.411342 in the chronological 66-train / 29-test split. Thirty-three undated anchors are excluded only from the chronological split.
- Forward selection and a final backward ablation audit keep a candidate only when it improves **median absolute log error in both tests**. Log TVL is kept. Category, 7-day change, listed age and chain count are dropped. RMS log errors (2.107240 LOO / 2.305498 walk-forward) and tail errors are also visible; optimizing the median does not guarantee improved RMS error.
- Prediction ranges use signed held-out residual P10–P90. Market cap is conditional on a token, not FDV. Scores used for selection have selection optimism; the chronological test is not a historical market-data backtest.
- Launch odds use exact-category × size × listed-age peers, hierarchical smoothing, a monotone age envelope and a continuous age discount. This is an explicitly uncalibrated cross-sectional proxy, not identifiable survival analysis.
- Every ranked protocol has a uniform $500 / 30-day / two-hour scenario, eight chain-costed transactions, application fees, capital opportunity cost, a risk reserve, reward share sensitivity, break-even share and dollar net/hour. Default results: 32 FARM, 68 THIN, 98 SKIP. FARM is conditional on verified live access and eligibility; no incentive program is claimed.

Every protocol, including excluded records, has all ten raw fields, a lane reason, a fitted-value decomposition, peer arithmetic, costed reference steps and caveats. Excluded records are explicitly marked as counterfactual references, never assigned a board rank.

`--selftest` repeats deterministic builds and both held-out tests, independently checks the fitted one-variable OLS and its validation scores, tests non-increasing odds with age, validates coverage and economics, and executes the browser-serialized scoring function in a separate JavaScript context.

The screenshot/interaction check uses an existing external Puppeteer installation only as a development tool. It does not enter the build or dashboard dependencies. See `scripts/screenshots.mjs` for executable/cache path options. Screenshots must be regenerated from `out/dashboard/index.html`, then main.ts run again so the copied images and vendored dossier match the final screenshots. No submission or network service is involved.
