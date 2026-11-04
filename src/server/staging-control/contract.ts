import { z } from "zod";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const TASK = "IOS-ORCH-STAGING-CONTROL-PATH-001";
export const VERSION = "staging-control/1";
export const TARGET = Object.freeze({
  project: "8ac4a414-9f0b-4a90-bcce-4995e5736d9d",
  environment: "bce3bde4-29c1-44e5-8cfe-7400db9f7f51",
  service: "0f673bc3-e433-4641-85a8-12b2678eb040",
  foundation: "b0aeed37b910efbd3a96a52d41b885621e7f25d7",
  volume: "b4115737-ff34-4912-92d7-7524d27c969b",
  data_root: "/pilot-001-data/p3-hist-batch-001-r2",
  tier: "staging",
});
export const OPERATIONS = ["inspect", "writer_status", "reconcile_preview_status", "auth_cleanup_wave3", "writer_start", "writer_drain", "writer_stop"] as const;
export type Operation = typeof OPERATIONS[number];
export const READ_ONLY = new Set<Operation>(OPERATIONS.slice(0, 3));
const id = z.string().regex(/^[A-Za-z0-9_-]{16,96}$/);
export const requestSchema = z.object({
  request_id: id, nonce: id, operation: z.enum(OPERATIONS),
  target: z.object({
    project: z.literal(TARGET.project), environment: z.literal(TARGET.environment),
    service: z.literal(TARGET.service), foundation: z.literal(TARGET.foundation),
    volume: z.literal(TARGET.volume), data_root: z.literal(TARGET.data_root), tier: z.literal("staging"),
  }).strict(),
  issued_at: z.iso.datetime(),
  diagnostic: z.literal("controlled_read_only_failure").optional(),
}).strict().refine(r => !r.diagnostic || r.operation === "inspect");
export type ControlRequest = z.infer<typeof requestSchema>;
export class Hold extends Error { constructor(readonly code: string) { super(code); } }
export const hash = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
export const sign = (body: string, key: string) => createHmac("sha256", Buffer.from(key, "hex")).update("POST\n/v1/maintenance\n" + body).digest("hex");
export type Keys = { reader: string; recovery?: string };
export function authenticate(body: string, keyId: string, signature: string, keys: Keys) {
  if (keyId !== "reader" && keyId !== "recovery") throw new Hold("AUTH_REJECTED");
  const key = keys[keyId];
  if (!key || !/^[a-f0-9]{64}$/.test(key) || !/^[a-f0-9]{64}$/.test(signature) ||
      !timingSafeEqual(Buffer.from(sign(body, key), "hex"), Buffer.from(signature, "hex"))) throw new Hold("AUTH_REJECTED");
  return keyId;
}
export function assertRuntimeIdentity(env: NodeJS.ProcessEnv) {
  const actual = { project: env.RAILWAY_PROJECT_ID, environment: env.RAILWAY_ENVIRONMENT_ID,
    service: env.RAILWAY_SERVICE_ID, volume: env.RAILWAY_VOLUME_ID, data_root: env.DATA_DIR,
    tier: env.RAILWAY_ENVIRONMENT_NAME };
  for (const [k, v] of Object.entries(actual)) if (v !== TARGET[k as keyof typeof TARGET]) throw new Hold("RUNTIME_TARGET_REJECTED");
  if (env.RAILWAY_VOLUME_MOUNT_PATH !== "/pilot-001-data" || env.RAILWAY_REPLICA_COUNT !== "1" ||
      !env.RAILWAY_DEPLOYMENT_ID || !/^[a-f0-9]{40}$/.test(env.RAILWAY_GIT_COMMIT_SHA ?? "")) throw new Hold("RUNTIME_IDENTITY_MISSING");
  return { deployment: env.RAILWAY_DEPLOYMENT_ID, commit: env.RAILWAY_GIT_COMMIT_SHA };
}
