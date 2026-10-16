# Safe Edit connection package

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

After connection, discover all seven actual tools. Use the existing read-only
connection for note retrieval. Writes still require SAFE_EDIT_ENABLED=1 and
SAFE_EDIT_SINGLE_WRITER=1 on the server; consent does not turn these flags on.
Thesis changes also require the signed-in administrator to approve the exact
preview at its server-generated approval URL.

Obtain explicit approval for the runbook's named synthetic production canary,
then verify preview/apply/readback/audit/index, idempotency, stale-version refusal
and guarded rollback. Verify ordinary Chat independently of Work/API tests.
Remote and mobile Sync require separate observed device arrival.
