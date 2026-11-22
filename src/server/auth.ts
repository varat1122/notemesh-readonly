import { betterAuth } from "better-auth";
import { getAdapter } from "better-auth/db/adapter";
import { AsyncLocalStorage } from "node:async_hooks";
import type Database from "better-sqlite3";
import { getMigrations } from "better-auth/db/migration";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { apiKey } from "@better-auth/api-key";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";

/**
 * Every scope this authorization server both advertises and grants.
 *
 * `openid`, `profile` and `email` are here for OIDC clients: ChatGPT uses them
 * to identify the signed-in user. Nothing in the vault is gated on them — that
 * is what `vault:read` and `vault:write` are for — so granting them costs
 * nothing on a single-user server, and withholding them costs the connector.
 */
export const DEFAULT_OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "vault:read",
  "inbox:submit",
] as const;
// Registration eligibility is not a grant. Safe Edit requires an explicit scope request and new consent.
export const OAUTH_SCOPES = [...DEFAULT_OAUTH_SCOPES, "vault:edit"] as const;
import crypto from "node:crypto";
import { withAuthDatabaseOwner, d1DatabaseStatus } from "./db";
import { maintenanceActive } from "./maintenance";
import { env } from "./env";
import { authLog } from "./auth-logger";
import { userCount, withinClaimWindow, CLAIM_WINDOW_MINUTES, installSingleAdminGuard, extraAdminAccounts, type UserCount } from "./claim";
import { audit } from "./audit";

// Both used to live here, and auth is where the rest of the app reaches for
// them, so keep them importable from this module.
export { audit } from "./audit";
export { userCount, isSetupComplete, type UserCount } from "./claim";

// Session-signing secret derived from (not equal to) the credential
// encryption key, so one secret in the Railway template covers both.
function authSecret(): string {
  return crypto
    .createHash("sha256")
    .update(env.encryptionKey)
    .update("better-auth-secret")
    .digest("base64");
}

// Ceiling on dynamically-registered OAuth clients (see the /oauth2/register
// hook below). Well above what real use produces — testing accumulated a
// handful — but bounded so anonymous registration can't grow the DB forever.
export const MAX_OAUTH_CLIENTS = 50;

/** Auth hooks and response normalization share the existing bounded Auth
 * owner queue. Only the count runs under ownership; no request/password work
 * or HTTP await is enclosed in a SQLite transaction. A denied/unknown count
 * is never evidence of an unclaimed instance. The single_admin trigger remains
 * the atomic cross-process admission boundary. */
export async function authUserCount(): Promise<UserCount> {
  try {
    return await withAuthDatabaseOwner(async connection => userCount(connection));
  } catch {
    audit("usercount.failed", { message: "auth_count_admission_unavailable" });
    return { known: false, error: "auth_count_admission_unavailable" };
  }
}

function authOptions(connection: Database.Database) { return {
  baseURL: env.baseUrl,
  secret: authSecret(),
  database: connection,
  // Filters one warning Better Auth emits about its own SQLite migration
  // output on every boot — see auth-logger.ts. Everything else passes through.
  logger: { log: authLog },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
  },
  // Only the anonymous entry points are throttled. Authenticated dashboard
  // traffic keeps a high ceiling: the concern is a stranger probing, not the
  // single operator using their own server.
  rateLimit: {
    enabled: true,
    window: 60,
    max: 600,
    customRules: {
      // Password guessing. Generous enough to survive a few fat-fingered
      // attempts, and the window is short so a mistake isn't a long lockout.
      "/sign-in/email": { window: 60, max: 10 },
      // Racing to claim an unconfigured instance while its window is open.
      "/sign-up/email": { window: 3600, max: 10 },
      // Unauthenticated dynamic client registration.
      "/oauth2/register": { window: 3600, max: 20 },
    },
  },
  // Both of these were previously left to Better Auth to infer, and it infers
  // exactly this — so nothing changes behaviourally. They are stated because
  // "the session cookie is Secure" and "which origins may post here" are things
  // a reader should be able to check in this file rather than derive from a
  // dependency's defaults.
  //
  // Secure is deliberately tied to the scheme rather than pinned on. A browser
  // will not store a Secure cookie on a plain-http origin unless it is loopback
  // — measured — so pinning it would stop anyone self-hosting at
  // http://192.168.x.x from signing in at all. When BASE_URL says http but the
  // deployment is actually served over https, that is a misconfiguration, and
  // detectInsecureBaseUrl reports it on the Security tab instead.
  trustedOrigins: [env.baseUrl],
  advanced: {
    useSecureCookies: env.baseUrl.startsWith("https://"),
    ipAddress: {
      // Trust forwarding headers only where a proxy actually sets them.
      // Elsewhere a client could supply x-forwarded-for itself and get a fresh
      // bucket per request, which would make every limit above decorative.
      ipAddressHeaders:
        process.env.RAILWAY_PUBLIC_DOMAIN || process.env.TRUST_PROXY_HEADERS
          ? ["x-forwarded-for", "x-real-ip"]
          : [],
    },
  },
  hooks: {
    // This instance is single-user: exactly one admin account, created by the
    // setup wizard. Sign-up is open only while the instance is unclaimed AND
    // still inside the post-start claim window — see server/claim.ts.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-up/email") {
        const users = await authUserCount();
        if (!users.known) {
          // Never create an account on a guess. A database we cannot read is
          // not a database we know to be empty.
          audit("signup.rejected", { reason: "user_count_unavailable" });
          throw new APIError("SERVICE_UNAVAILABLE", {
            message:
              "Could not verify whether this instance is already claimed, so sign-up is " +
              "refused. Check the server logs and try again.",
          });
        }
        if (users.count > 0) {
          audit("signup.rejected", { reason: "already_claimed" });
          throw new APIError("FORBIDDEN", {
            message: "This instance is already claimed.",
          });
        }
        if (!withinClaimWindow()) {
          audit("signup.rejected", { reason: "claim_window_closed" });
          throw new APIError("FORBIDDEN", {
            message:
              `This server is locked down: it was not claimed within ` +
              `${CLAIM_WINDOW_MINUTES} minutes of starting. Restart it, then create ` +
              `the admin account.`,
          });
        }
        audit("signup.accepted", {});
      }

      // DCR cap is enforced atomically by the owned adapter, not this hook.

    }),
    after: createAuthMiddleware(async (ctx) => {
      // Audit sign-in outcomes (no credentials in the log).
      if (ctx.path === "/sign-in/email") {
        const ok = !!(ctx.context as any)?.newSession || !!(ctx.context as any)?.session;
        audit("signin", { ok });
      }
    }),
  },
  plugins: [
    // Single-user personal server: the default per-key rate limit (~10/day)
    // would break any real MCP session.
    apiKey({ rateLimit: { enabled: false } }),
    // The OAuth provider signs JWT access tokens; the jwt plugin supplies the
    // signing keys (JWKS persisted in the database).
    jwt(),
    oauthProvider({
      loginPage: "/login",
      consentPage: "/oauth/consent",
      // MCP clients (Claude.ai, Claude Code, MCP Inspector) self-register via
      // unauthenticated dynamic client registration, then use the PKCE flow.
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      // Advertised and granted are the same list, deliberately. They used to
      // differ — profile and email were advertised but only grantable if a
      // client asked for them at registration — and ChatGPT does not ask. It
      // reads scopes_supported, registers without a scope field, then requests
      // what the metadata promised and is refused its own authorization with
      // "The following scopes are invalid: profile, email". The only way out
      // was for the operator to find OIDC in an advanced settings panel and
      // switch it off.
      //
      // A client cannot be expected to know that a scope it was told about is
      // not one it may have. One constant, used twice, so the two cannot drift
      // apart again; server/oauth-scopes.test.ts pins them together.
      scopes: [...OAUTH_SCOPES],
      clientRegistrationDefaultScopes: [...OAUTH_SCOPES],
      // The protected resources this server issues tokens for: its own MCP
      // endpoint, under the two names a client may send as the RFC 8707
      // resource indicator (the endpoint URL, which the MCP spec prescribes,
      // and the bare origin, which some clients send). Both are this one
      // resource server, and mcp/oauth.ts accepts either audience. Since the
      // 1.7 line a token's audience is bound to the resource named at
      // authorization and can be narrowed but not widened at the token
      // endpoint, which is what closed GHSA-p2fr-6hmx-4528 (#55).
      resources: [
        { identifier: `${env.baseUrl}/api/mcp`, allowedScopes: [...DEFAULT_OAUTH_SCOPES] },
        { identifier: `${env.baseUrl}/api/save-analysis`, allowedScopes: [...DEFAULT_OAUTH_SCOPES] },
        { identifier: `${env.baseUrl}/api/safe-edit`, allowedScopes: ["openid", "profile", "email", "offline_access", "vault:read", "vault:edit"] },
        { identifier: env.baseUrl, allowedScopes: [...DEFAULT_OAUTH_SCOPES] },
      ],
      // 1.7 also links each client to the resources it may request, and
      // refuses `resource` for any it is not linked to. New registrations get
      // linked below, but a connector registered under 1.6 — every existing
      // deployment's — has no link and would be refused its next
      // authorization. With one resource server there is nothing per-client
      // linking can tell apart, so it is off; what closed the advisory is the
      // grant-bound audience above, which stays on.
      enforcePerClientResources: false,
      clientRegistrationDefaultResources: [`${env.baseUrl}/api/mcp`, `${env.baseUrl}/api/save-analysis`, `${env.baseUrl}/api/safe-edit`, env.baseUrl],
      silenceWarnings: {
        // The plugin warns on every boot that
        // /.well-known/oauth-authorization-server/api/auth may not exist. It
        // checks for a route it registered itself, and ours is served from
        // middleware.ts, which it cannot see. Measured against the built
        // server: that path returns 200, as do the other three discovery
        // documents. Left unsilenced the warning appears in every deployed
        // instance's logs and gets reported as a bug. server/discovery.test.ts
        // takes over guarding the path list.
        oauthAuthServerConfig: true,
      },
    }),
  ],
}; }


// Better Auth >=1.7.3 removed account.issuer. Do not silently alter a live
// legacy authentication table during the dependency security upgrade.
function assertLegacyAccountSchemaCleared(d: Database.Database): void {
  const hasAccount = d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'account'").get();
  if (!hasAccount) return;
  const columns = d.prepare("PRAGMA table_info(account)").all() as { name: string }[];
  if (columns.some(c => c.name === "issuer")) {
    throw new Error(
      "Legacy Better Auth account.issuer detected; deployment held. " +
      "A verified encrypted off-volume backup, isolated restore and separately reviewed production schema cleanup are required before this build can serve authentication.",
    );
  }
}

type AuthAdapter = Awaited<ReturnType<typeof getAdapter>>;
type RegistrationRoute = "dynamic" | "managed" | "other";
interface AuthRuntime {
  route: AsyncLocalStorage<RegistrationRoute>;
  instance?: ReturnType<typeof createConfiguredAuth>;
  flight?: Promise<ReturnType<typeof createConfiguredAuth>>;
  failure?: unknown;
  failed?: boolean;
  attempts?: number;
  retryAfter?: number;
  retryFailure?: unknown;
}
const AUTH_RUNTIME = Symbol.for("notemesh.d1.auth-runtime.v1");
function runtime(): AuthRuntime {
  const g = globalThis as unknown as Record<symbol, Map<string, AuthRuntime> | undefined>;
  const all = g[AUTH_RUNTIME] ??= new Map();
  let state = all.get(env.dbPath);
  if (!state) { state = { route: new AsyncLocalStorage() }; all.set(env.dbPath, state); }
  return state;
}

/** The adapter's already-owned SQLite transaction is the final cap boundary.
 * No caller body, userId=null heuristic, trigger, or hook count grants entry. */
function enforceDynamicCap(d: Database.Database) {
  if (!d.inTransaction) throw Error("d1_dcr_transaction_required");
  d.prepare(`DELETE FROM "oauthClient" WHERE createdAt < ?
    AND clientId NOT IN (SELECT clientId FROM "oauthAccessToken")
    AND clientId NOT IN (SELECT clientId FROM "oauthRefreshToken")
    AND clientId NOT IN (SELECT clientId FROM "oauthConsent")`)
    .run(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  const row = d.prepare('SELECT COUNT(*) AS n FROM "oauthClient"').get() as { n: number };
  if (!Number.isSafeInteger(row?.n) || row.n < 0) throw Error("d1_dcr_count_unverified");
  if (row.n >= MAX_OAUTH_CLIENTS) throw new APIError("TOO_MANY_REQUESTS", { message: "Too many registered OAuth clients on this instance." });
}
type TransactionAdapter = Omit<AuthAdapter, "transaction">;
function ownedAdapter<T extends TransactionAdapter>(base: T): T {
  return new Proxy(base, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (typeof value !== "function") return value;
    if (key === "transaction") return (work: (adapter: TransactionAdapter) => Promise<unknown>) =>
      withAuthDatabaseOwner(async () => Reflect.apply(value, target, [(tx: TransactionAdapter) => work(ownedAdapter(tx))]));
    return (...args: unknown[]) => withAuthDatabaseOwner(async connection => {
      if (key === "create" && (args[0] as { model?: string })?.model === "oauthClient") {
        const route = runtime().route.getStore();
        if (route !== "dynamic" && route !== "managed") throw Error("d1_dcr_route_binding_required");
        if (!connection.inTransaction) throw Error("d1_dcr_atomic_adapter_transaction_required");
        if (route === "dynamic") enforceDynamicCap(connection);
      }
      return Reflect.apply(value, target, args);
    });
  } });
}
function createConfiguredAuth(options: ReturnType<typeof authOptions>, adapter: AuthAdapter) {
  return betterAuth({ ...options, database: () => ownedAdapter(adapter) });
}
async function readyAuth() {
  const state = runtime();
  if (state.failed || state.failure) throw state.failure;
  if (state.instance) return state.instance;
  if (state.flight) return state.flight;
  if (state.retryAfter && Date.now() < state.retryAfter) throw state.retryFailure;
  state.attempts = (state.attempts ?? 0) + 1;
  let migrationStarted = false;
  const flight = withAuthDatabaseOwner(async connection => {
    const options = authOptions(connection);
    assertLegacyAccountSchemaCleared(connection);
    const migrations = await getMigrations(options);
    // Once the migrator is entered its partial effects are not guessed away.
    // Only a known pre-migration denial can qualify for a later retry.
    migrationStarted = true;
    await migrations.runMigrations();
    installSingleAdminGuard(connection);
    const extra = extraAdminAccounts(connection);
    if (extra > 0) throw Error("d1_existing_multiple_admins_hold");
    const adapter = await getAdapter(options);
    const instance = createConfiguredAuth(options, adapter);
    await instance.$context;
    return instance;
  }).then(instance => {
    // Publish only after owned cleanup/outcome validation also succeeded.
    state.instance = instance;
    state.retryFailure = undefined; state.retryAfter = undefined;
    return instance;
  }).catch(error => {
    const code = (error as { code?: unknown })?.code;
    const message = error instanceof Error ? error.message : "";
    const transient = code === "SQLITE_BUSY" || code === "SQLITE_BUSY_SNAPSHOT" ||
      ["d1_auth_queue_full", "d1_auth_queue_deadline", "d1_research_owner_busy", "d1_native_owner_busy"].includes(message);
    const database = d1DatabaseStatus();
    if (!migrationStarted && transient && (state.attempts ?? 0) < 3 &&
        !database.ownerActive && database.openTransactions === 0 && !database.quarantine && !maintenanceActive()) {
      state.retryAfter = Date.now() + 100;
      state.retryFailure = error;
    } else { state.failure = error; state.failed = true; }
    throw error;
  }).finally(() => { if (state.flight === flight) state.flight = undefined; });
  state.flight = flight;
  return flight;
}
function handlerRoute(request: Request): RegistrationRoute {
  if (request.method !== "POST") return "other";
  const pathname = new URL(request.url).pathname;
  return pathname === "/api/auth/oauth2/register" ? "dynamic" :
    pathname === "/api/auth/oauth2/create-client" ? "managed" : "other";
}
const apiFacade = new Proxy({}, { get(_target, key) {
  return async (...args: unknown[]) => {
    const instance = await readyAuth();
    const route: RegistrationRoute = key === "registerOAuthClient" ? "dynamic" : key === "createOAuthClient" ? "managed" : "other";
    return runtime().route.run(route, () => Reflect.apply(Reflect.get(instance.api, key), instance.api, args));
  };
} });
// Lazy public compatibility facade: importing a route cannot open SQLite or
// start migrations. All real API/HTTP entrypoints join one bootstrap flight.
export const auth = new Proxy({ handler: async (request: Request) => {
  const instance = await readyAuth();
  return runtime().route.run(handlerRoute(request), () => instance.handler(request));
} }, { get(target, key) {
  if (key === "handler") return target.handler;
  if (key === "api") return apiFacade;
  if (key === "$context") return readyAuth().then(instance => instance.$context);
  if (key === "options") {
    if (!runtime().instance) throw Error("d1_auth_not_ready");
    return runtime().instance!.options;
  }
  return undefined;
} }) as ReturnType<typeof createConfiguredAuth>;

export async function runAuthMigrations() { await readyAuth(); }
