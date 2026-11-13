# Cost / quota worksheet — estimates, no live plan verified

All measurements below use synthetic prices; none establish a free license, account plan,
real payload size or real five-year coverage. No paid call or remote compute was started.

| Item | Pilot8, one UTC attempt/day | Limit / unresolved evidence |
|---|---|---|
| Provider calls | Normally8/day; overlap-change worst16/day; weekly full replaces ordinary incremental call | Hard24/run, no auto-retry; quota shared across account/other entrypoints NOT enforced globally. Rights+official provider quota HOLD |
| Collector wall time | Existing600s soft budget; proposed720s supervisor | 3s source spacing, max25s/request + bounded Drive; provider/Drive round trips and cold start unmeasured live |
| Workflow/job minutes | Example3–10min/day =90–300min/30days, plus build/cold-start allocation | GitHub private minutes/runner multiplier/account included quota unknown; external-host plan and stop charges unknown |
| Synthetic five-year-size partition | 1260 weekday rows:233472 bytes SQLite,38667 bytes signed compressed snapshot | From `synthetic-sizing.json`; regular generated prices compress unusually well; no real provider data |
| Synthetic immutable storage/year | 8 ×38667 ×365 =112907640 bytes (~107.7MiB), plus catalogue generations/OAuth metadata | Keeps history generations, no deletion. Does not include varying corrections, actions or real entropy |
| Conservative planning scenario | Assume512KiB/archive:8 ×512KiB ×365 ≈1.43GiB/year, plus catalogues | Assumption, not guarantee or cap; signed payload max4MiB+64KiB, uncompressed partition max4MiB |
| Drive operations | At least one new upload+download/readback per changed partition; old partition download on refresh; catalogue list/download+upload/readback per batch; folder lookup, auth refresh extra |8 new archives and2 catalogues for first mock run; no new uploads for mock same-day replay. Actual Google request quota NOT measured |
| Payload transfer (512KiB scenario) |8 ×(old download + upload + readback) ×512KiB ≈12MiB/day (~360MiB/30days), plus provider and catalogue | Backfill/weekly full/source response max2MiB/request; reads for analysts additional. Provider response/egress/billing UNKNOWN |
| Railway active time |0 remote minutes intentionally initiated by this task | Sleeping app is not chosen scheduler. Future staging deploy/wake must separately bound startup writers and billed stop |
| Persistence / monitoring | Daily job receipt up to256KiB; durable shared root + off-host evidence/alerts | Real host/volume/backup/monitor/retention/access policy not provisioned. Date receipts accumulate; no cleanup authorized |

Capacity204 instruments in catalogue is not permission or quota for204 daily providers calls.
Retained inactive entries consume that catalogue limit. A12-identifier worst-case rebase uses
all24 requests;100–200 symbols exceed the present one-run cap. Keep approved pilot small.

Future account review must state: plan+included credits, per-account API limits and reset timezone,
expected symbols/session lag, actual compressed sizes after approved real pilot, Drive storage
owned by test account, scheduler runner minutes/cold start, provider/Drive network egress,
timeout/compute-stop verification, alert delivery and a maximum monthly budget. If this adds
real cost or lacks internal/team archival rights, keep activation HOLD and request narrow scope.
