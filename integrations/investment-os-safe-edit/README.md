# Safe Edit connection package

## Research MVP: install Instructions first

For daily news → historical research → approved save, start with
[the Thai installation and user acceptance steps](USER_ACCEPTANCE_TH.md).
Copy [PROJECT_INSTRUCTIONS_TH.md](PROJECT_INSTRUCTIONS_TH.md) into ChatGPT
Project Instructions; add [RESEARCH_WORKFLOW.md](RESEARCH_WORKFLOW.md) and
[INVESTMENT_REVIEW_TEMPLATE.md](INVESTMENT_REVIEW_TEMPLATE.md) as Project files.
This reuses existing tools and ChatGPT reasoning; no Developer API key is needed.
News automatically starts the instructions' read/research path; explicit fallback:
“วิเคราะห์ข่าวนี้ด้วย Investment OS”. Actual frontend invocation must be observed.

The source-bound graph workflow requires all three candidate tools:
`prepare_investment_graph_review`, `write_investment_graph_bundle`,
`verify_investment_graph_writeback`. If unavailable, use read-only research and
an unsaved draft. A local package does not update a connected App's actions.
See [current acceptance and release gates](../../docs/LIVE_RESEARCH_MVP_HANDOFF.md).

## Connection and publication boundary

This package points to the existing Railway server. It creates no server, vault
or migration. Upload only after the `/api/safe-edit` OAuth challenge and resource
metadata have been verified on the reviewed production deployment.

The existing Read Only and Save Linked Notes connections are not replaced.
No credentials are packaged. OAuth uses dynamic registration and the new exact
Safe Edit resource audience; the user must approve new read/edit consent.
`offline_access` requests refresh capability for that same grant.

Preparation/upload is not proof of connection. Before connecting, explain the
new edit scope and obtain the user's approval as requested in this rollout.
Use the host's secure OAuth flow; never copy tokens or authentication codes into
chat or package files. Record the returned plugin/app identity after upload.

After connection, inspect the actual registered tools. The PR #108 candidate
defines fifteen Safe Edit tools; historical App snapshots exposed seven/twelve.
Do not assume the candidate is deployed or registered in ChatGPT. Use the existing
read-only connection for note retrieval. Writes still require SAFE_EDIT_ENABLED=1 and
SAFE_EDIT_SINGLE_WRITER=1 on the server; consent does not turn these flags on.
The graph action additionally requires INVESTMENT_GRAPH_BUNDLE_ENABLED=1;
enabling any live flags requires owner approval. Thesis changes also require the signed-in administrator to approve the exact
preview at its server-generated approval URL.

Obtain explicit approval for the runbook's named synthetic production canary,
then verify preview/apply/readback/audit/index, idempotency, stale-version refusal
and guarded rollback. Verify ordinary Chat independently of Work/API tests.
Remote and mobile Sync require separate observed device arrival.

 
User screenshot/PDF raw attachment capture: after refreshing Safe Edit tools, `store_user_attachment` preserves actual file bytes (up to 4 MiB JPEG/PNG/WebP/PDF) in the content-addressed Vault attachments area and `inspect_user_attachment` verifies stored bytes. Neither tool proves issuer/broker facts or mobile device arrival, and neither automatically retrieves files from earlier ChatGPT conversations.
