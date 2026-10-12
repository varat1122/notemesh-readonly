# Add-only Investment OS intake

The research replica remains pull-only. Existing OAuth grants carrying only vault:read retain exactly the read-only tool surface, including legacy vault:write tokens. No vault mutation tools are enabled.

A NEW explicitly consented inbox:submit scope adds submit_investment_notes and get_submission_status. It writes only a bounded SQLite queue in DATA_DIR; it does not write the server vault. Ordinary API keys do not acquire this scope. A separately named API key, `Investment OS Intake Worker`, authenticates GET/POST /api/intake-worker for queue delivery and receipts. Revoke that key to disconnect the local receiver.

The Windows receiver writes only newly generated .md paths under 00_Inbox/ChatGPT, preserves the package and SHA-256 receipt outside the vault, refuses traversal/symlinks/missing related targets, and never overwrites differing content. Obsidian on the computer must be running and Sync online for propagation. When the computer is off, packages remain queued. A failed package becomes blocked for operator review; it is not reported as saved.

Quotas: 20 notes / 300 KB per batch, 1,000 batches / 20 MB retained queue data, 50 MB free disk reserve. Exact normalized payload retries share a hash and receipt. Semantic duplication and claim correctness require research review, not hash matching. No external LLM API or paid plan is used.

Activation requires user OAuth consent for inbox:submit and a user-created worker credential. Never silently upgrade an existing read-only grant. On ChatGPT refresh/install the tool catalogue after consent. Write calls are annotated non-read-only and non-destructive; client confirmation settings still apply.

Rollback deployment to 4c94b640611080735cf51a3494d81f4cb9a8975c disables new routes/tools without deleting queue records or previously imported files. Stop the local receiver before rollback. No schema destructive migration.
