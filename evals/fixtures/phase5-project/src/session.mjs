import { isExpired } from "./auth.mjs";

export function sessionExpired(session, nowMs) {
  return isExpired(session.expiresAtMs, Math.floor(nowMs / 1000));
}

