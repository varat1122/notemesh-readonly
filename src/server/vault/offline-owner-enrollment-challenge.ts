/**
 * PR #81: a detached owner-key *possession* challenge for human enrollment
 * preparation. Neither the challenge nor a matching signature proves that
 * the signing key belongs to the real Vault owner.
 *
 * No signing, key generation, permanent enrollment, network or Vault writes.
 */
import {randomBytes,createHash,createPublicKey,verify as verifySignature}
  from "node:crypto";
const SHA=/^[a-f0-9]{64}$/;
const NONCE=/^[a-f0-9]{64}$/;
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
export type EnrollmentChallenge={
  schema:"investment_os_offline_key_enrollment_challenge_v1";
  purpose:"key_possession_only_not_owner_identity";
  registrySha256:string;
  registryRevision:number;
  keyId:string;
  keySpkiSha256:string;
  issuedAt:string;
  expiresAt:string;
  nonce:string;
};
function valid(c:EnrollmentChallenge):boolean{
  return !!c&&c.schema==="investment_os_offline_key_enrollment_challenge_v1"&&
    c.purpose==="key_possession_only_not_owner_identity"&&
    SHA.test(c.registrySha256)&&SHA.test(c.keySpkiSha256)&&
    Number.isSafeInteger(c.registryRevision)&&c.registryRevision>0&&
    typeof c.keyId==="string"&&
    /^[a-zA-Z0-9_-]{1,80}$/.test(c.keyId)&&NONCE.test(c.nonce)&&
    typeof c.issuedAt==="string"&&typeof c.expiresAt==="string"&&
    !Number.isNaN(Date.parse(c.issuedAt))&&
    !Number.isNaN(Date.parse(c.expiresAt))&&
    new Date(c.issuedAt).toISOString()===c.issuedAt&&
    new Date(c.expiresAt).toISOString()===c.expiresAt;
}
export function offlineEnrollmentChallengeBytes(c:EnrollmentChallenge):Buffer {
  if(!valid(c))throw Error("offline_enrollment_challenge_invalid");
  return Buffer.from(JSON.stringify([
    "investment-os-possession-challenge-v1",c.schema,c.purpose,
    c.registrySha256,c.registryRevision,c.keyId,c.keySpkiSha256,
    c.issuedAt,c.expiresAt,c.nonce,
  ]),"utf8");
}
export function createOfflineEnrollmentChallenge(input:{
  registrySha256:string;registryRevision:number;
  keyId:string;keySpkiSha256:string;
}){
  const now=Date.now();
  const c:EnrollmentChallenge={
    schema:"investment_os_offline_key_enrollment_challenge_v1",
    purpose:"key_possession_only_not_owner_identity",
    ...input,issuedAt:new Date(now).toISOString(),
    expiresAt:new Date(now+10*60_000).toISOString(),
    nonce:randomBytes(32).toString("hex"),
  };
  offlineEnrollmentChallengeBytes(c);
  return {
    challenge:c,challengeSha256:sha(offlineEnrollmentChallengeBytes(c)),
    privateKeyCreated:false as const,
    realOwnerIdentityVerified:false as const,
    independentWitnessCompleted:false as const,
    enrollmentActivated:false as const,
    ownerApprovalGranted:false as const,canAutoWrite:false as const,
  };
}
export function verifyOfflineEnrollmentKeyPossession(input:{
  challenge:EnrollmentChallenge;
  /** Registry pointer only; NOT an independently provisioned key registry. */
  candidateOwnerPublicKeySpkiPem:string;
  signatureBase64url:string;
}){
  let validSignature=false,reason="invalid_or_untrusted_challenge";
  try{
    const c=input.challenge,body=offlineEnrollmentChallengeBytes(c);
    const now=Date.now(),start=Date.parse(c.issuedAt),end=Date.parse(c.expiresAt);
    if(start>now+30_000||start<now-10*60_000||end<=now||
      end<=start||end-start>10*60_000)
      reason="challenge_expired_or_clock_untrusted";
    else if(typeof input.candidateOwnerPublicKeySpkiPem!=="string"||
      input.candidateOwnerPublicKeySpkiPem.length>3000||
      !/^[A-Za-z0-9_-]{86}$/.test(input.signatureBase64url))
      reason="invalid_public_key_or_signature_encoding";
    else{
      const key=createPublicKey(input.candidateOwnerPublicKeySpkiPem);
      if(key.asymmetricKeyType!=="ed25519"||
        sha(key.export({format:"der",type:"spki"}) as Buffer)!==
          c.keySpkiSha256)
        reason="candidate_public_key_fingerprint_mismatch";
      else {
        const signature=Buffer.from(input.signatureBase64url,"base64url");
        validSignature=signature.length===64&&
          verifySignature(null,body,key,signature);
        reason=validSignature?
          "private_key_possession_matches_supplied_candidate_only":
          "signature_did_not_match_challenge";
      }
    }
  }catch{reason="invalid_or_untrusted_challenge";}
  return {
    status:validSignature?
      "candidate_private_key_possession_consistent_only" as const:
      "hold_for_human_enrollment" as const,
    reason,
    challengeSha256:(()=>{try{return sha(offlineEnrollmentChallengeBytes(
      input.challenge));}catch{return null;}})(),
    candidateKeyPossessionConsistent:validSignature,
    challengeNonceConsumed:false as const,
    independentOwnerIdentityVerified:false as const,
    registryPinnedByIndependentAuthority:false as const,
    witnessedEnrollmentCompleted:false as const,
    keyRevocationChecked:false as const,
    ownerApprovalGranted:false as const,
    canAutoWrite:false as const,canAutoUpdateThesis:false as const,
    vaultModified:false as const,
  };
}
