import { createHash, timingSafeEqual } from "node:crypto";

export function isAuthorized(authorizationHeader: string | null | undefined, expectedToken: string): boolean {
  const prefix = "Bearer ";
  const candidate = authorizationHeader?.startsWith(prefix)
    ? authorizationHeader.slice(prefix.length)
    : "";
  const candidateDigest = createHash("sha256").update(candidate, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expectedToken, "utf8").digest();
  return timingSafeEqual(candidateDigest, expectedDigest) && candidate.length > 0;
}
