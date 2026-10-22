# Architecture diagrams

Mermaid source is rendered in fenced blocks compatible with GitHub and Obsidian. These diagrams show the target architecture; dashed/future nodes are not P0 implementation claims. P0 implementation is enumerated in SYSTEM_ARCHITECTURE.md. Physical ER is implemented; logical entity relationships are contracts for phased implementation.

## System context

Source: [01-system-context.mmd](01-system-context.mmd)

```mermaid
flowchart LR
  Owner[Owner and research users] --> API[Investment OS API]
  Chat[AI frontend] --> API
  Optional[Future Web Mobile LINE] -.-> API
  Intake[Manual PDF CSV Excel and Drive] -.-> API
  API --> PG[(Canonical PostgreSQL)]
  API --> Agent[Authorized local Vault agent]
  Agent --> Vault[(Obsidian Markdown)]
  API -.-> Model[Approved model adapter]
  API -.-> Market[Approved market data adapter]
  API --> Files[(Original bytes and Parquet)]
```

## Components and import direction

Source: [02-components.mmd](02-components.mmd)

```mermaid
flowchart TD
  API[FastAPI boundary] --> Policy[Policy and identity]
  API --> Services[Future application use cases]
  API --> Domain[Canonical domain contracts]
  Services --> Ports[Typed internal ports]
  Ports --> Domain
  Adapters[Provider and persistence adapters] --> Ports
  Adapters --> Domain
  Adapters --> PG[(PostgreSQL)]
  Adapters --> Local[Scoped local filesystem]
  Services -.-> Worker[Future worker entrypoint]
  Policy --> Domain
```

## Source data flow

Source: [03-data-flow.mmd](03-data-flow.mmd)

```mermaid
flowchart TD
  Input[Manual file or allowed source] --> Rights{Rights and file safety}
  Rights -->|Fail| Quarantine[Quarantine and audit]
  Rights -->|Pass| Bytes[Immutable original bytes and hash]
  Bytes --> Registry[Document Source and canonical registry]
  Registry --> Parse[Versioned parser and exact locators]
  Parse --> Dedup{Duplicate correction or new event}
  Dedup --> Evidence[Claim evidence and contradictions]
  Evidence --> Context[Permission and as-of filtered context]
  Context --> Draft[Research draft and missing evidence]
  Draft --> Approval[Scoped approval gate]
  Approval --> Receipt[Future writeback and readback receipt]
```

## Knowledge closed loop

Source: [04-knowledge-loop.mmd](04-knowledge-loop.mmd)

```mermaid
flowchart LR
  A[Event A and original source] --> H[Historical thesis and evidence]
  H --> R[Review draft with counter-evidence]
  R --> G[Typed link proposals]
  G --> P{Owner scoped authorization}
  P -->|Approved| W[Journaled note and timeline write]
  W --> V{Byte index and link readback}
  V -->|Pass| C[Committed receipt]
  V -->|Fail| F[Partial state and reconciliation]
  C --> B[Event B retrieval]
  B --> N[Prior review remains non-independent]
  N --> H
```

## Investment decision loop

Source: [05-decision-loop.mmd](05-decision-loop.mmd)

```mermaid
flowchart TD
  R[Fundamental and industry research] --> IC[Committee proposal]
  Q[Deterministic quant] --> IC
  T[Tactical mandate and horizon] --> IC
  IC --> Risk{Independent risk and constraints}
  Risk -->|Insufficient| Watch[Watch or no action]
  Risk -->|Fits mandate| Owner{Owner authority}
  Owner --> Ledger[Decision ledger]
  Ledger --> Journal[Separately authorized portfolio journal]
  Journal --> Outcome[Outcome and attribution]
  Outcome --> Review[Forecast thesis timing sizing process review]
  Review --> R
  Ledger -.-> NoExecution[No automatic broker execution]
```

## Research orchestration

Source: [06-orchestration.mmd](06-orchestration.mmd)

```mermaid
flowchart TD
  C[Context pack with provenance] --> Gate[Rights freshness and cost gate]
  Gate --> Router[Framework router]
  Router --> F[Fundamental lens]
  Router --> I[Industry and supply chain lens]
  Router --> RT[Counter-thesis lens]
  F --> S[Structured specialist results]
  I --> S
  RT --> S
  S --> Check[Citation schema and evidence validation]
  Check --> Merge[Synthesis preserving disagreement]
  Check --> Abstain[Abstain and required evidence]
  Merge --> Draft[Unverified research draft]
  Model[Provider-neutral model adapter] -.-> Router
```

## Quant and trading separation

Source: [07-quant-tactical.mmd](07-quant-tactical.mmd)

```mermaid
flowchart LR
  Data[(Versioned Parquet)] --> Engine[Deterministic Python and DuckDB]
  Engine --> Run[Reproducible QuantRun]
  Run --> Signal[Expiring signal]
  Signal --> Tactical[Tactical mandate setup]
  Thesis[Core fundamental thesis] --> Core[Long-horizon mandate]
  Core --> Risk[Independent portfolio risk]
  Tactical --> Risk
  Risk --> Proposal[Owner-visible decision proposal]
  AI[AI hypothesis] -.-> Engine
  AI -.-> NoNumbers[No invented computed result]
```

## Storage ownership

Source: [08-storage.mmd](08-storage.mmd)

```mermaid
flowchart TD
  PG[(PostgreSQL IDs claims edges decisions audit)] -->|note ID path version hash| MD[(Markdown narrative)]
  PG -->|document ID digest rights| OBJ[(Original PDF Excel CSV bytes)]
  PG -->|dataset ID digest as-of| PAR[(Parquet datasets and results)]
  DU[DuckDB computation] --> PAR
  MD --> IDX[Rebuildable search and link projection]
  IDX --> PG
  Backup[Coordinated backup manifest] --> PG
  Backup --> MD
  Backup --> OBJ
  Backup --> PAR
```

## Authorization and trust boundaries

Source: [09-trust.mmd](09-trust.mmd)

```mermaid
flowchart TD
  subgraph Untrusted
    Text[Sources attachments and AI output]
    Client[Client requests]
  end
  Client --> Auth[Authenticated server principal]
  Auth --> Policy{Resource action scope and version}
  Text --> Data[Data-only context and schemas]
  Data --> Draft[Proposal only]
  Draft --> Policy
  Policy -->|Denied| Audit[Denial audit]
  Policy -->|Separate approval| Writer[Single authorized writer]
  Writer --> Protected[(Protected state)]
  Writer --> Receipts[Readback and durable receipts]
  Admin[Owner approval authority] --> Policy
  Text -.-> Deny[Cannot grant rights or invoke persistence]
```

## Local-first and cloud boundary

Source: [10-local-cloud.mmd](10-local-cloud.mmd)

```mermaid
flowchart LR
  subgraph Local_P0
    API[Loopback API with dummy auth] --> DB[(Synthetic PostgreSQL)]
    Mig[One-shot migration owner] --> DB
    Reader[Read-only synthetic Vault adapter] --> Fixture[(Marked fixture Vault)]
  end
  subgraph Future_Cloud_requires_approval
    Cloud[API and worker with real identity] --> CDB[(Private PostgreSQL)]
    Cloud --> Store[(Encrypted object and Parquet storage)]
  end
  Enrolled[Owner-enrolled local agent] -.->|Authenticated outbound transport| Cloud
  Enrolled --> RealVault[(Authorized local Vault)]
  API -.->|Preserve UUID contracts| Cloud
```

## Logical entities

Source: [11-logical-er.mmd](11-logical-er.mmd)

```mermaid
erDiagram
  COMPANY ||--o{ INSTRUMENT : issues
  COMPANY }o--o{ INDUSTRY : operates_in
  COMPANY }o--o{ TECHNOLOGY : typed_exposure
  DOCUMENT ||--o{ SOURCE : original_bytes
  SOURCE }o--o{ EVENT : describes
  EVENT ||--o{ CLAIM : raises
  CLAIM ||--o{ EVIDENCE : evaluated_by
  SOURCE ||--o{ EVIDENCE : cites
  EVIDENCE }o--o{ RELATIONSHIP : supports
  EVENT ||--o{ RESEARCH_REVIEW : reviewed_in
  NOTE ||--o{ RESEARCH_REVIEW : narrative
  COMPANY ||--o{ THESIS_VERSION : interpreted_by
  MANDATE ||--o{ THESIS_VERSION : scopes
  INSTRUMENT ||--o{ MARKET_DATA_REFERENCE : observed_in
  MARKET_DATA_REFERENCE }o--o{ QUANT_RUN : input
  QUANT_RUN ||--o{ SIGNAL : produces
  MANDATE ||--o{ TRADE_SETUP : scopes
  SIGNAL ||--o{ TRADE_SETUP : informs
  THESIS_VERSION ||--o{ DECISION : references
  RESEARCH_REVIEW }o--o{ DECISION : informs
  PORTFOLIO ||--o{ TRANSACTION : records
  MANDATE }o--o{ PORTFOLIO : aggregates
  JOB ||--o{ RECEIPT : records
  JOB ||--o{ AUDIT_EVENT : traces
```

## Physical registry

Source: [12-physical-er.mmd](12-physical-er.mmd)

```mermaid
erDiagram
  entities ||--|{ entity_versions : has
  entity_versions ||--o{ entity_references : references_from
  entities ||--o{ entity_references : references_to
  operations ||--o{ receipts : produces
  operations ||--o{ audit_events : audits
  entities {
    uuid id PK
    text kind
    int current_version FK
    timestamptz created_at
  }
  entity_versions {
    uuid entity_id PK,FK
    int version PK
    text schema_version
    jsonb payload
    text content_sha256
    timestamptz recorded_at
  }
  entity_references {
    uuid from_id PK,FK
    int from_version PK,FK
    text field_name PK
    uuid to_id PK,FK
    int to_version FK
  }
  operations {
    uuid id PK
    uuid actor_id
    text idempotency_key
    text request_sha256
    text state
    int version
  }
  receipts {
    uuid id PK
    uuid operation_id FK
    text state
    text after_sha256
    boolean physical_verified
    boolean index_verified
    boolean links_verified
  }
  audit_events {
    uuid id PK
    uuid operation_id FK
    uuid actor_id
    text action
    text outcome
  }
  permission_grants {
    uuid id PK
    uuid principal_id
    text action
    text resource_scope
    uuid approved_by
    timestamptz expires_at
  }
```
