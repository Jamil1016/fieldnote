// Local verification only: mint HS256 JWTs for the PostgREST container, signed
// with the throwaway secret from docker-compose.local.yml.
//
//   node scripts/local/jwt.mjs service_role
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LOCAL_JWT_SECRET = "local-only-jwt-secret-with-at-least-32-characters";

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

export function mintJwt(role, secret = LOCAL_JWT_SECRET) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ role, iss: "fieldnote-local", exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 });
  const signature = crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${signature}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(mintJwt(process.argv[2] ?? "service_role"));
}
