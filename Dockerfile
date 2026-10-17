# Build stage
# trixie (not bookworm): better-sqlite3 v13's linux prebuilds need glibc >= 2.38.
FROM node:24-trixie-slim AS build
WORKDIR /app
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# The root postinstall runs this patch during dependency installation.
COPY scripts/patch-oauth-refresh-scopes.mjs ./scripts/patch-oauth-refresh-scopes.mjs
RUN pnpm install --frozen-lockfile
COPY . .
RUN node scripts/patch-oauth-refresh-scopes.mjs
RUN pnpm exec vitest run src/server/market-prices src/server/mcp/price-tools.test.ts src/server/safe-edit/engine.test.ts src/server/safe-edit/sync.test.ts src/server/mcp/safe-edit-server.test.ts src/server/ob/supervisor-safe-edit.test.ts src/routes/api/market-prices-drive.test.ts src/routes/api/safe-edit-approval.test.ts src/routes/api/safe-edit-route.test.ts src/server/cloud-intake.test.ts src/server/cloud-preflight.test.ts src/server/oauth-refresh-scopes.test.ts src/server/oauth-diagnostics.test.ts src/server/mcp/readonly-deployment.test.ts src/server/mcp/tool-auth.test.ts src/server/intake.test.ts src/routes/api/intake-worker.test.ts src/server/mcp/save-server.test.ts src/server/mcp/oauth-endpoint.test.ts src/routes/api/save-analysis.test.ts src/server/discovery.test.ts src/server/vault/investment-context.test.ts && pnpm exec tsc --noEmit
RUN pnpm build

# Runtime stage
FROM node:24-trixie-slim
WORKDIR /app
# The ob CLI is spawned as a child process (not bundled by the server build),
# so install it globally in the runtime image. Keep the version pinned in
# lockstep with package.json.
# git + git-lfs are for the git sync backend. LFS matters even though notemesh
# never writes binaries: cloning an LFS-backed vault without it yields ~130-byte
# pointer files in place of every attachment, which contain no NUL bytes and so
# read as text — the server would hand those to a model as if they were images.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git git-lfs ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && git lfs install --system
RUN npm install -g obsidian-headless@0.0.14
COPY --from=build /app/.output ./.output
COPY scripts/check-runtime-exclusions.mjs /app/check-runtime-exclusions.mjs
# Include the separately installed ob CLI and its dependencies in the review.
RUN node /app/check-runtime-exclusions.mjs .output /usr/local/lib/node_modules
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
COPY scripts/ob-readonly.mjs /app/ob-readonly.mjs
COPY scripts/cloud-sync-preflight.mjs /app/cloud-sync-preflight.mjs
COPY scripts/intake-importer.cjs /app/scripts/intake-importer.cjs
RUN chmod 755 /app/ob-readonly.mjs
ENV OB_BIN=/app/ob-readonly.mjs
ENV CLOUD_INTAKE=1
# The server runs as the image's unprivileged `node` user (see the
# entrypoint), so a compromise of the process — the class of thing the
# frontmatter parser fix in 1.2.0 closed — does not hand out root in the
# container. /app stays owned by root and read-only to node; only DATA_DIR
# is writable. HOME is node's own, not root's: git reads ~/.gitconfig and
# would refuse to run against a home it cannot open.
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    HOME=/home/node
EXPOSE 3000
# tini as PID 1, node as its child. PID 1 is expected to reap orphaned
# processes; node only ever waits on its own direct children. This server
# spawns a lot of children — the ob sync daemon, every git call under a 120 s
# timeout — and kills them individually, so their grandchildren (git-remote-https,
# LFS filters, the sh credential helper) are orphaned onto PID 1 whenever a
# parent is killed mid-flight. Under node they were never reaped: one zombie per
# timeout, accumulating for the life of the container until PID exhaustion
# stopped spawn() and sync with it. Docker's --init does the same thing but is
# a runtime flag Railway does not expose, so it is baked in.
# The entrypoint runs as root under tini only long enough to make DATA_DIR
# writable by node, then drops privileges for the command.
ENTRYPOINT ["tini", "--", "/app/docker-entrypoint.sh"]
CMD ["node", ".output/server/index.mjs"]
