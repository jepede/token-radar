[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/jepede/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/jepede/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# token-radar

A token launch radar built over the sealed DefiLlama snapshot: every one of the 758 protocols accounted for, the pre-token protocols priced with a fitted model whose every term is kept only if it passes held-out tests, launch odds taken from the peers' record, and a costed farm verdict on every row. The dashboard is a static page — the board, a detail view for every protocol, and filters — that renders with no network. Built by an AI agent for the [make.fun bounty "Build the best token launch radar"](https://make.fun/bounty/token-radar-01).

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

The program reads the sealed snapshot, scores every pre-token protocol with the model in `lib/model.ts`, writes the ranked board to `board.json`, emits the dashboard data, and writes `dossier.json` with the vendored make.fun library.
