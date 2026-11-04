import type { DatabaseSync } from "node:sqlite";
import { hash, Hold } from "./contract";

export const WAVE3_OWNERSHIP = Object.freeze({
  name: "IOS P3 historical remainder Wave 3 scoped staging writer",
  clientHash: "b7529bac8afe25cb1c01d54646d36320d5a1aa4438b622aff0c0a3726d078678",
  sessionHash: "88bb5632ec3d8ae0e28493621f0cc77d30c1d0f77210a2526b7c89fcd71e8899",
});
export function authWitness(db: DatabaseSync, accepted: { name: string; clientHash: string; sessionHash: string } = WAVE3_OWNERSHIP) {
  const rows = (sql: string) => {
    const result = db.prepare(sql + " LIMIT 10001").all();
    if (result.length > 10_000) throw new Hold("AUTH_BOUND_EXCEEDED");
    return result;
  };
  // Project only the columns needed for ownership, never tokens or credentials.
  const clients = rows('SELECT clientId,name,userId FROM "oauthClient"');
  const sessions = rows('SELECT id,userId FROM "session"');
  const access = rows('SELECT clientId,sessionId FROM "oauthAccessToken"');
  const refresh = rows('SELECT clientId,sessionId FROM "oauthRefreshToken"');
  const named = clients.filter(r => r.name === accepted.name);
  const matchingClients = clients.filter(r => hash(String(r.clientId)) === accepted.clientHash);
  const matchingSessions = sessions.filter(r => hash(String(r.id)) === accepted.sessionHash);
  const scopedTokens = [...access, ...refresh].filter(r => hash(String(r.clientId)) === accepted.clientHash || hash(String(r.sessionId)) === accepted.sessionHash);
  const client = matchingClients[0], session = matchingSessions[0];
  const ownership = named.length === 1 && matchingClients.length === 1 && matchingSessions.length === 1 &&
    named[0] === client && Boolean(client.userId) && client.userId === session.userId;
  return { scope: "accepted Wave 3 client/session and linked access+refresh tokens", name: accepted.name,
    counts: { client: matchingClients.length, session: matchingSessions.length, token: scopedTokens.length },
    totals: { client: clients.length, session: sessions.length, access_token: access.length, refresh_token: refresh.length },
    named_client_count: named.length, clientID_SHA256: client ? hash(String(client.clientId)) : null,
    sessionID_SHA256: session ? hash(String(session.id)) : null, ownership_matches: ownership,
    accepted_state_matches: ownership && scopedTokens.length === 0, mutated: false };
}
