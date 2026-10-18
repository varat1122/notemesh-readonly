import { describe, expect, it } from "vitest";
import {
  issueDrConsentFormProof,
  validDrConsentFormProof,
  drConsentRequestOriginAllowed,
} from "./drive-consent-form";

const key = Buffer.alloc(32, 0x51);
const otherKey = Buffer.alloc(32, 0x29);
const now = 1_792_310_000_000;
const base = "https://notemesh-dr-test-staging.up.railway.app";

describe("DR OAuth start form proof", () => {
  it("accepts an unexpired proof only for the same session and key", () => {
    const proof = issueDrConsentFormProof("session-a", key, now);
    expect(validDrConsentFormProof(proof, "session-a", key, now + 1000)).toBe(true);
    expect(validDrConsentFormProof(proof, "session-b", key, now + 1000)).toBe(false);
    expect(validDrConsentFormProof(proof, "session-a", otherKey, now + 1000)).toBe(false);
  });

  it("fails closed for missing, tampered, expired and future proofs", () => {
    const proof = issueDrConsentFormProof("s", key, now);
    expect(validDrConsentFormProof(null, "s", key, now)).toBe(false);
    expect(validDrConsentFormProof(proof + "x", "s", key, now)).toBe(false);
    expect(validDrConsentFormProof(proof, "s", key, now + 10 * 60_000 + 1)).toBe(false);
    expect(validDrConsentFormProof(proof, "s", key, now - 30_001)).toBe(false);
    expect(validDrConsentFormProof("invalid", "s", key, now)).toBe(false);
  });

  it("accepts an absent Origin only with a separate valid form proof", () => {
    expect(drConsentRequestOriginAllowed(new Headers(), base)).toBe(true);
    const proof = issueDrConsentFormProof("s", key, now);
    expect(validDrConsentFormProof(proof, "s", key, now)).toBe(true);
    expect(validDrConsentFormProof(null, "s", key, now)).toBe(false);
  });

  it("rejects explicit cross-site origins, referers and fetch metadata", () => {
    expect(drConsentRequestOriginAllowed(new Headers({origin: base, "sec-fetch-site": "same-origin"}), base)).toBe(true);
    expect(drConsentRequestOriginAllowed(new Headers({origin: "https://evil.example"}), base)).toBe(false);
    expect(drConsentRequestOriginAllowed(new Headers({referer: "https://evil.example/start"}), base)).toBe(false);
    expect(drConsentRequestOriginAllowed(new Headers({"sec-fetch-site": "cross-site"}), base)).toBe(false);
    expect(drConsentRequestOriginAllowed(new Headers({origin: "null", "sec-fetch-site": "same-origin"}), base)).toBe(true);
  });
});
