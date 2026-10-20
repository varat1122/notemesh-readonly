import {describe,expect,it} from "vitest";
import {generateKeyPairSync,createHash,sign} from "node:crypto";
import {
  createOfflineEnrollmentChallenge,offlineEnrollmentChallengeBytes,
  verifyOfflineEnrollmentKeyPossession,
} from "./offline-owner-enrollment-challenge";
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
const newKey=()=>{
  const p=generateKeyPairSync("ed25519");
  return {publicKey:p.publicKey.export({format:"pem",type:"spki"}).toString(),
    keySha256:sha(p.publicKey.export({format:"der",type:"spki"}) as Buffer),
    privateKey:p.privateKey};
};
describe("PR #81 offline owner key possession challenge, not identity",()=>{
  it("verifies a signature from synthetic candidate private key without enrolling owner",()=>{
    const p=newKey();
    const prep=createOfflineEnrollmentChallenge({
      registrySha256:"a".repeat(64),registryRevision:3,
      keyId:"synthetic-owner",keySpkiSha256:p.keySha256,
    });
    const signatureBase64url=sign(null,offlineEnrollmentChallengeBytes(
      prep.challenge),p.privateKey).toString("base64url");
    const r=verifyOfflineEnrollmentKeyPossession({
      challenge:prep.challenge,
      candidateOwnerPublicKeySpkiPem:p.publicKey,signatureBase64url,
    });
    expect(r).toMatchObject({
      status:"candidate_private_key_possession_consistent_only",
      candidateKeyPossessionConsistent:true,
      independentOwnerIdentityVerified:false,
      registryPinnedByIndependentAuthority:false,
      witnessedEnrollmentCompleted:false,
      challengeNonceConsumed:false,
      ownerApprovalGranted:false,canAutoWrite:false,
      canAutoUpdateThesis:false,vaultModified:false,
    });
    expect(prep).toMatchObject({
      realOwnerIdentityVerified:false,privateKeyCreated:false,
      enrollmentActivated:false,ownerApprovalGranted:false,
    });
  });
  it("generates unpredictable different challenge nonces",()=>{
    const p=newKey(),input={registrySha256:"a".repeat(64),
      registryRevision:1,keyId:"owner",keySpkiSha256:p.keySha256};
    const one=createOfflineEnrollmentChallenge(input);
    const two=createOfflineEnrollmentChallenge(input);
    expect(one.challenge.nonce).not.toEqual(two.challenge.nonce);
    expect(one.challengeSha256).not.toEqual(two.challengeSha256);
  });
  it("refuses wrong key, wrong pin and modified challenge with same signature",()=>{
    const p=newKey(),alien=newKey();
    const c=createOfflineEnrollmentChallenge({
      registrySha256:"a".repeat(64),registryRevision:1,
      keyId:"owner",keySpkiSha256:p.keySha256,
    }).challenge;
    const signatureBase64url=sign(null,offlineEnrollmentChallengeBytes(c),
      p.privateKey).toString("base64url");
    expect(verifyOfflineEnrollmentKeyPossession({
      challenge:c,candidateOwnerPublicKeySpkiPem:alien.publicKey,
      signatureBase64url,
    }).status).toBe("hold_for_human_enrollment");
    const tampered={...c,registrySha256:"b".repeat(64)};
    expect(verifyOfflineEnrollmentKeyPossession({
      challenge:tampered,candidateOwnerPublicKeySpkiPem:p.publicKey,
      signatureBase64url,
    }).status).toBe("hold_for_human_enrollment");
  });
  it("rejects expiry, future issuance, invalid hash and invalid nonce",()=>{
    const p=newKey();
    const c=createOfflineEnrollmentChallenge({
      registrySha256:"f".repeat(64),registryRevision:1,
      keyId:"owner",keySpkiSha256:p.keySha256,
    }).challenge;
    const mk=(changed:typeof c)=>verifyOfflineEnrollmentKeyPossession({
      challenge:changed,candidateOwnerPublicKeySpkiPem:p.publicKey,
      signatureBase64url:"Z".repeat(86),
    });
    expect(mk({...c,expiresAt:new Date(Date.now()-5000).toISOString()})
      .status).toBe("hold_for_human_enrollment");
    expect(mk({...c,issuedAt:new Date(Date.now()+60000).toISOString()})
      .status).toBe("hold_for_human_enrollment");
    expect(mk({...c,registrySha256:"bad"}).status)
      .toBe("hold_for_human_enrollment");
    expect(mk({...c,nonce:"a"}).status)
      .toBe("hold_for_human_enrollment");
  });
});
