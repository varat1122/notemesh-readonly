/**
 * Decrypt the dedicated DR OAuth credential produced by the server's
 * /api/backup-drive/callback. No credential is printed or saved to disk.
 * This CLI remains offline/development-only; NEVER call from a live writer.
 */
import {createDecipheriv, hkdfSync} from "node:crypto";
const scope="https://www.googleapis.com/auth/drive.file";
function decodedKey(raw){
  const key=(raw||"").trim();
  if(/^[0-9a-fA-F]{64}$/.test(key))return Buffer.from(key,"hex");
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(key))throw Error("Invalid DR encryption key");
  const decoded=Buffer.from(key,"base64");
  if(decoded.length!==32)throw Error("Invalid DR encryption key");
  return decoded;
}
export function openStoredDrCredential(values=process.env) {
  try {
    const raw=values.NOTEMESH_DRIVE_CREDENTIAL||"";
    const clientId=values.NOTEMESH_DRIVE_CLIENT_ID||"";
    if(!raw || raw.length>10000 || !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId))throw Error();
    const parts=raw.split(".");
    if(parts.length!==3 || parts.some(x=>!x))throw Error();
    const [iv,bytes,tag]=parts.map(x=>Buffer.from(x,"base64url"));
    if(iv.length!==12 || tag.length!==16)throw Error();
    const key=Buffer.from(hkdfSync("sha256",decodedKey(values.ENCRYPTION_KEY),
      "investment-os-notemesh-dr","investment-os-notemesh-dr/oauth-v1",32));
    const decipher=createDecipheriv("aes-256-gcm",key,iv);
    decipher.setAuthTag(tag);
    const data=JSON.parse(Buffer.concat([decipher.update(bytes),decipher.final()]).toString("utf8"));
    if(data.version!==1 || data.clientId!==clientId || data.scope!==scope ||
       typeof data.refreshToken!=="string" ||
       data.refreshToken.length<10 || data.refreshToken.length>4000)throw Error();
    return {refreshToken:data.refreshToken,clientId};
  } catch { throw Error("Dedicated DR encrypted credential missing or invalid"); }
}
