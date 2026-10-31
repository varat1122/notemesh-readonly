# Architecture Decision Records — Investment OS

ตาม Blueprint v1.0 §22: ห้ามเขียนประวัติใหม่ — การเปลี่ยนการตัดสินใจทำโดย ADR ใหม่ที่ `supersedes` ฉบับเดิม

สถานะ: `PROPOSED` → `ACCEPTED` (Owner อนุมัติ) → `SUPERSEDED`
ADR เป็นนโยบายสถาปัตยกรรม ไม่ใช่หลักฐานว่า deploy แล้ว และไม่เปิดสิทธิ์ใด ๆ

| ADR | หัวข้อ | สถานะ |
|---|---|---|
| [001](ADR-001-core-runtime-typescript-mcp.md) | Core runtime: TypeScript + MCP แทน Python/FastAPI | PROPOSED |
| [002](ADR-002-sqlite-until-postgres-trigger.md) | SQLite จนกว่าจะถึงเงื่อนไขย้าย PostgreSQL | PROPOSED |
| [003](ADR-003-quant-store.md) | Quant store: SQLite bars ตอนนี้, Parquet/DuckDB เมื่อ backtest | PROPOSED |
| [004](ADR-004-cloud-owned-vault.md) | Cloud-owned Vault + one-way device sync | PROPOSED |
| [005](ADR-005-market-data-provider.md) | Market data provider: Yahoo เป็น pilot เท่านั้น | PROPOSED |
| [006](ADR-006-claim-edge-registry.md) | Claim/Edge registry: frontmatter ตอนนี้, table เมื่อ P1 | PROPOSED |

แม่แบบ: Context · Decision · Alternatives · Consequences · Evidence · Migration trigger · Owner approval
