# Market prices pilot verification — 2026-10-16

## Implemented scope

Daily Yahoo adapter, separate capped SQLite store, refresh receipts and correction history, quarantine, collection lease/cooldown, existing-research-resource cached read tools, and a provisional event-window calculator. No new dependency, new paid service, portfolio import, event registry or production note mutation.

## Local verification

- Lint and TypeScript: pass.
- Production build: pass; client bundle boundary and runtime dependency exclusions pass. Existing prerender requires configured auth environment; build still completes, with runtime/HTTP checks covering the built server.
- Full Vitest unit/integration/HTTP suite: 1,259 tests in 86 files pass after rebuilding current sources.
- Focused price/MCP/event tests cover listing identity, exchange-local dates, incomplete/current sessions, provider metadata/size/timeouts/rate limits, OHLC quarantine, no fill/repair, idempotency, whole-batch rollback, corrections, lease ownership, disk reserve, query-only reads, scope isolation, no vault mutation/network from MCP, observed-session alignment, pending horizons, missing/quarantined stock/comparator dates and missing adjusted prices.
- Local Chromium E2E: blocked because Playwright's browser is absent and the download returns a truncated/non-ZIP response in this environment. Do not classify the 31 launch failures as 31 product regressions. Run the existing browser job on GitHub CI before merge.
- Local Docker: unavailable (no Docker executable); the existing GitHub image job must build and smoke-test it. Docker's build test command includes the new suites.

An earlier full-test invocation was deliberately rejected by the HTTP suite's freshness check after source edits; the suite above was rerun against the rebuilt server and passed. An initial Thai pull rejected contradictory OHLC; the final parser quarantines and exposes those rows instead of fabricating prices.

## Live source pilot (outside production)

Eight instruments, target five-year window, exchange-local dates starting 2021-10-18. Last inspected snapshot fetched at 2026-10-16T06:50:58.333Z:

| Listing | Usable bars | Latest cached session |
| --- | ---: | --- |
| US:NVDA | 1,254 | 2026-10-15 |
| US:SPY | 1,254 | 2026-10-15 |
| TH:PTT | 1,209 | 2026-10-15 |
| TH:TDEX | 1,206 | 2026-10-14 |
| HK:9988 | 1,229 | 2026-10-15 |
| HK:2800 | 1,227 | 2026-10-14 |
| JP:7203 | 1,220 | 2026-10-15 |
| JP:1306 | 1,220 | 2026-10-15 |

Total: 9,819 usable rows; approximately 1.96 MB including earlier diagnostic correction receipts. Fresh retrieval does not guarantee every provider series includes the latest session: the TH/HK comparator lag is visible above. Five observed OHLC anomalies are quarantined: PTT on 2023-05-18 / 2023-06-08 and TDEX on 2023-06-06 / 2023-06-09 / 2023-07-12. Their dates are not silently compressed into an apparent N-session event window.

Live computation with an arbitrary test event-session anchor of 2026-09-01 succeeded for 1/5/20 observed sessions in all four stock/comparator pairs; 60-session windows were correctly unavailable. This is an arithmetic/coverage test using a synthetic event anchor, not a claim that a real event occurred or caused those returns.

Every result describes its provider price basis, timing assumption, benchmark identity, freshness and provisional-calendar limitation. These checks do not establish exchange-certified data accuracy, total-return equivalence, an immutable historical archive or causal attribution.

## Release acceptance

At source preparation: CODE_READY / LOCAL_TESTED / LIVE_SOURCE_PILOT_VERIFIED. GitHub CI, image/browser verification, merge, production rollout and feature activation are separate checks. Safe Edit OAuth/canary remains paused; no edit flag or existing OAuth grant is changed by this feature.

Read-only tools require catalogue refresh after activation. Ordinary ChatGPT/mobile availability has not been demonstrated by local MCP tests. Event registry/Obsidian automatic indexing, transaction ledger and portfolio website/app remain future phases in INVESTMENT_DATA_ARCHITECTURE.md.
