# Safe Edit Chat — Web App action-registry upgrade (2026-10-19)

> **Operational blocker, not a completed 12-tool migration.** Do not change the production Vault or publish a new desktop-only connector as a substitute.

## Independently inspected systems

| Layer | Live identifier | State verified on 2026-10-19 |
|---|---|---|
| Existing **Web-capable App-backed** Safe Edit Chat | App ID `asdk_app_6ad25a7072088191ac6369edd1aee5fa`, plugin `plugin_asdk_app_6ad25a7072088191ac6369edd1aee5fa` | The existing installed app exposes **seven tools** in ChatGPT Web; its Plugin Creator package has `.app.json` and `.codex-plugin/plugin.json` only |
| Standalone Safe Edit **MCP plugin** | `plugins_6ad192d975148191aa4398b8214049ef`, release v1.0.1 | Separate plugin with `.mcp.json` and `mcp.json` pointing to the existing protected Railway MCP; desktop-only icon in user's directory view |
| Safe Edit MCP server source | `src/server/mcp/safe-edit-server.ts` on `main` | Code registers **twelve actions** on the protected Safe Edit endpoint |
| MCP HTTPS endpoint | `https://notemesh-production-a893.up.railway.app/api/safe-edit` | No new Vault/server necessary; actual Web App developer action-binding needs independent validation |

Existing seven actions, **retain unchanged**:
1. `preview_edit`
2. `apply_edit`
3. `append_section`
4. `update_frontmatter`
5. `create_note`
6. `get_edit_status`
7. `rollback_edit`

Five additional server actions to approve/enable for the **existing Web App**:
1. `archive_original_source` — mutating: protected OAuth `vault:read` + `vault:edit`, allowlisted HTTPS download, no redirects, actual original bytes with SHA-256 readback
2. `inspect_original_source_archive` — read-only: independently rehash existing stored original revisions
3. `get_sync_delivery_evidence` — read-only: aggregate server evidence; **no** desktop/mobile/remote per-note assertion
4. `store_user_attachment` — mutating: only explicitly permitted file sources, upload/hash receipts
5. `inspect_user_attachment` — read-only: verify previously saved user attachment

## App registration update — action required in Web App developer management

1. Find the **existing App-backed developer App** ID `asdk_app_6ad25a7072088191ac6369edd1aee5fa`, not the separate standalone MCP plugin.
2. Review the underlying App's configured MCP endpoint and OAuth provider against the live Safe Edit server. If a different server backs that App, stop and reconcile; never point two unrelated products to the same Vault by guessing.
3. In the authorized App/Actions management view, refresh/rescan its registered action snapshot from the verified server, then review the old seven actions and five new ones. ChatGPT can freeze tool snapshots, so server code changes and plugin wrapper version bumps **do not automatically activate new actions**.
4. Preserve the existing App ID, Web compatibility, user permissions and approval prompts. Keep allowed OAuth scopes and per-action annotations explicit, especially write-confirmations and protected Thesis/Portfolio edits.
5. Publish/activate the action update through the permitted owner workflow. **Do not** uninstall/replace the working seven-action app or upload a second desktop-only MCP plugin as a substitute.
6. Start a new ChatGPT **Web** chat with the existing Safe Edit Chat app and enumerate its **actual** exposed tool registry. Expect 12 names, not inferred server capabilities.
7. Run read-only smoke tests first: `get_sync_delivery_evidence`, `inspect_original_source_archive`. For `archive_original_source`, obtain explicit authorization to fetch a real allowed issuer/SEC URL; verify immutable bytes, SHA-256 and historical revision readback separately.
8. Confirm legacy `preview_edit` → `apply_edit` safety gates, receipt hash and reindex remain functional. Never modify Current Thesis or Portfolio without explicit approval. Independently test desktop/mobile delivery before claiming Sync.

## Why normal Plugin Creator edit is insufficient

The existing Web App plugin wrapper only declares `"apps":"./.app.json"` → `asdk_app_...`. The available Plugin Creator update action explicitly permits App-backed metadata, skills and support-file edits **while preserving App bindings and MCP configuration**; it does not expose a mutation for the underlying App's action schema. Changing README, icon, version, or `.codex-plugin/plugin.json` alone cannot certify the missing five actions are now registered in the Web App.

Do **not** alter the installed App-backed binding to the standalone MCP format, as this can remove Web support and break the working seven actions.

## Exact stop conditions

- Underlying App developer/action-refresh controls are unavailable with the authorized toolset.
- Any ambiguity about App server endpoint, OAuth resource, permissions or stale schema.
- Newly added write actions lack review/confirmation semantics.
- ChatGPT Web registry still lists seven actions after an action-refresh attempt.

In those cases, retain the current seven-action Web app, leave the 12-action Railway server unchanged, and request the app owner to open the **App action-management screen**, or use an explicitly authorized browser/Work agent to update it after reviewing the exact permissions. Do not claim success from a modified plugin wrapper alone.

## Acceptance evidence

- Current **Web-safe App ID** remains the same.
- A fresh Web chat lists **12 exact tool names**, seven old + five additional.
- Old read/write controls retain valid OAuth confirmation and correct version-safe write receipts.
- Source archive is backed by real SHA-256 byte/receipt tests.
- Device Sync is marked unverified until target-device readback.
