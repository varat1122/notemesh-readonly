# Read-only deployment

This fork of NoteMesh 1.3.0 is restricted to research retrieval.

- OAuth advertises and grants `vault:read` only (plus identity/refresh scopes).
- API keys cannot gain write access.
- MCP server registration always removes mutation tools, even for legacy write tokens.
- Daily-note append/prepend are rejected by both schema and handler.
- Before each Obsidian daemon launch, a wrapper sets and verifies `pull-only` mode. Failure prevents startup.
- Admin credentials, encrypted sync credentials, search index and the local downloaded replica remain writable as required for operation. This is MCP read-only plus one-way replication, not a read-only disk mount.
- The Obsidian account still needs appropriate isolation. Start with a synthetic test vault; do not infer account-level read-only permissions from MCP scopes.

The upstream test suite contains tests expecting writes and therefore is not a valid acceptance suite for this deliberately restricted fork. Use the dedicated read-only protocol tests, plus compatible upstream read/path/security tests. No claim of Android compatibility is made until an actual device test succeeds.
